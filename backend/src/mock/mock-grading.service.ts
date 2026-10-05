import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MockAttemptMode,
  MockAttemptStatus,
  MockQuestionType,
  MockSkill,
  Prisma,
} from '@prisma/client';
import { Request, Response } from 'express';
import { AccessService } from '../common/access.service';
import { ExamProgramService } from '../common/exam-program.service';
import { studentExamTitle } from './student-exam-title';
import { AppException } from '../common/app.exception';
import { Paginated } from '../common/pagination';
import { AuthUser } from '../common/types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../videos/storage.service';
import { GradeMockAnswerDto, ListAttemptsQueryDto } from './dto/mock.dto';
import { MOCK_EXAM_INCLUDE } from './mock-attempt.service';
import { isAnswerCorrect } from './mock-answer';
import { duplicateMatchingResponses } from './question-engine';
import { audioContentType, streamFileRange } from './mock-storage';
import {
  AUTO_SKILLS,
  bandFromRaw,
  cefrFromBand,
  cefrFromPercent,
  criteriaAverage,
  overallBand as computeOverallBand,
  roundHalfBand,
  rubricKeysFor,
} from './mock-scoring';
import { SettingsService } from '../settings/settings.service';
import { MULTILEVEL_VERSION, ESTIMATE_VERSION, convertExpertScore, estimateObjective, multilevelLevel, multilevelOverall, taskGuidance } from './multilevel-specification';

interface SectionAgg {
  skill: MockSkill;
  score: number;
  max: number;
  manual: boolean;
  manualPending: boolean;
  /** Non-blank javoblar soni — bandFromRaw dagi attempted bayrog'i uchun. */
  answeredCount: number;
  tasks: Array<{ type: MockQuestionType; score: number }>;
}

type RawScores = Record<string, { score: number; max: number }>;
type SectionBands = Record<string, number>;

function isStaff(viewer: AuthUser): boolean {
  return viewer.role === 'teacher' || viewer.role === 'admin' || viewer.role === 'super_admin';
}

@Injectable()
export class MockGradingService {
  private readonly base: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    config: ConfigService,
    private readonly programs: ExamProgramService = new ExamProgramService(prisma),
  ) {
    this.base = `${config.get<string>('PUBLIC_URL') ?? 'http://localhost:3001'}/v1`;
  }

  /**
   * POST /mock/attempts/:attemptId/submit — avtomatik baholash + band hisoblash.
   * `skills` berilsa faqat shu bo'limlar baholanadi (section-by-section submit);
   * berilmasa butun urinish (eski xatti).
   */
  async submit(student: AuthUser, attemptId: string, skills?: MockSkill[]) {
    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.studentId !== student.id) {
      throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    }
    if (attempt.status !== 'in_progress') {
      if (attempt.specificationVersion === MULTILEVEL_VERSION) return this.submissionResult(attempt);
      throw new AppException('MOCK_ATTEMPT_FINISHED', 'Bu urinish allaqachon topshirilgan', 400);
    }
    if (attempt.specificationVersion === MULTILEVEL_VERSION) {
      const profile = await this.prisma.studentProfile.findUnique({ where: { userId: student.id }, select: { availablePrograms: true } });
      if (!profile?.availablePrograms.includes('MULTILEVEL')) throw new AppException('PROGRAM_NOT_ENROLLED', 'Not enrolled in Multilevel', 403);
      const claimed = await this.prisma.mockAttempt.updateMany({ where: { id: attemptId, studentId: student.id, status: 'in_progress' }, data: { status: 'grading', submittedAt: new Date() } });
      if (!claimed.count) {
        const saved = await this.prisma.mockAttempt.findUniqueOrThrow({ where: { id: attemptId } });
        return this.submissionResult(saved);
      }
    }
    const result = await this.gradeAndCompute(attemptId, true, attempt.specificationVersion === MULTILEVEL_VERSION ? undefined : skills);
    if (result.status === 'completed') {
      await this.notifyResult(attemptId);
    } else {
      await this.notifyTeacherPending(attemptId);
    }
    return result;
  }

  // ─────────────────── Staff attempt control ───────────────────

  /** Xodim qotib qolgan urinishni majburan yakunlaydi (deadline o'tgan bo'lsa ham). */
  async forceSubmit(staff: AuthUser, attemptId: string) {
    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.access.assertCanViewStudent(staff, attempt.studentId);
    if (attempt.status !== 'in_progress') {
      throw new AppException('MOCK_ATTEMPT_FINISHED', 'Bu urinish allaqachon yakunlangan', 400);
    }
    const result = await this.gradeAndCompute(attemptId, true);
    await this.audit.log({
      userId: staff.id,
      action: 'mock.attempt.force_submit',
      entity: 'mockAttempt',
      entityId: attemptId,
      newValue: { status: result.status },
    });
    if (result.status === 'completed') {
      await this.notifyResult(attemptId);
    } else {
      await this.notifyTeacherPending(attemptId);
    }
    return result;
  }

  /** Deadline uzaytirish — barcha muddatlar (bo'lim + umumiy) +minutes siljiydi. */
  async extendDeadline(staff: AuthUser, attemptId: string, minutes: number) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      throw new AppException('VALIDATION_ERROR', 'Minutes 1 dan 180 gacha bo‘lsin', 400);
    }
    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.access.assertCanViewStudent(staff, attempt.studentId);
    if (attempt.status !== 'in_progress') {
      throw new AppException('MOCK_ATTEMPT_FINISHED', 'Bu urinish allaqachon yakunlangan', 400);
    }
    const shift = (d: Date | null) => (d ? new Date(d.getTime() + minutes * 60_000) : d);
    const deadlines = (attempt.sectionDeadlines as Record<string, string> | null) ?? null;
    const shifted: Record<string, string> | null = deadlines
      ? Object.fromEntries(
          Object.entries(deadlines).map(([k, v]) => [k, new Date(new Date(v).getTime() + minutes * 60_000).toISOString()]),
        )
      : null;
    const updated = await this.prisma.mockAttempt.update({
      where: { id: attemptId },
      data: {
        deadlineAt: shift(attempt.deadlineAt),
        overallDeadlineAt: shift(attempt.overallDeadlineAt),
        ...(shifted ? { sectionDeadlines: shifted as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({
      userId: staff.id,
      action: 'mock.attempt.extend',
      entity: 'mockAttempt',
      entityId: attemptId,
      newValue: { minutes },
    });
    return {
      saved: true,
      deadlineAt: updated.deadlineAt,
      overallDeadlineAt: updated.overallDeadlineAt,
      sectionDeadlines: updated.sectionDeadlines,
      serverTime: new Date(),
    };
  }

  /** Baholashdagi urinishni qayta ochish (grading → in_progress). */
  async reopen(staff: AuthUser, attemptId: string) {
    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.access.assertCanViewStudent(staff, attempt.studentId);
    if (attempt.status !== 'grading') {
      throw new AppException('MOCK_CANNOT_REOPEN', 'Faqat baholanayotgan urinish qayta ochiladi', 400);
    }
    await this.prisma.mockAttempt.update({
      where: { id: attemptId },
      data: { status: 'in_progress', submittedAt: null },
    });
    await this.audit.log({
      userId: staff.id,
      action: 'mock.attempt.reopen',
      entity: 'mockAttempt',
      entityId: attemptId,
    });
    return { saved: true, status: 'in_progress' as const };
  }

  /** Urinishni to'liq o'chirish (javoblar + cheat-log bilan) — admin only. */
  async deleteAttempt(admin: AuthUser, attemptId: string) {
    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.prisma.$transaction([
      this.prisma.mockAnswer.deleteMany({ where: { attemptId } }),
      this.prisma.mockCheatEvent.deleteMany({ where: { attemptId } }),
      this.prisma.mockAttempt.delete({ where: { id: attemptId } }),
    ]);
    await this.audit.log({
      userId: admin.id,
      action: 'mock.attempt.delete',
      entity: 'mockAttempt',
      entityId: attemptId,
      oldValue: { studentId: attempt.studentId, examId: attempt.examId },
    });
    return { deleted: true };
  }

  /** POST /mock/attempts/:attemptId/grade — Writing/Speaking qo'lda baholash */
  async grade(teacher: AuthUser, attemptId: string, dto: GradeMockAnswerDto) {    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    if (attempt.status === 'in_progress') {
      throw new AppException('MOCK_ATTEMPT_NOT_SUBMITTED', 'Imtihon hali topshirilmagan', 400);
    }
    await this.access.assertCanViewStudent(teacher, attempt.studentId);

    const question = await this.prisma.mockQuestion.findFirst({
      where: { id: dto.questionId, group: { section: { examId: attempt.examId } } },
      include: { group: { include: { section: { select: { skill: true } } } } },
    });
    if (!question) {
      throw new AppException('QUESTION_NOT_IN_EXAM', 'Savol bu imtihonga tegishli emas', 400);
    }
    if (AUTO_SKILLS.includes(question.group.section.skill)) {
      throw new AppException('NOT_MANUAL_QUESTION', 'Bu savol avtomatik baholanadi', 400);
    }
    const skill = question.group.section.skill;
    if (attempt.specificationVersion === MULTILEVEL_VERSION && dto.rubricScores) throw new AppException('SCORE_REQUIRED', 'Multilevel uses holistic task raw scores; enter a half-point raw score', 400);
    this.validateRubrics(skill, dto.rubricScores);

    // Score berilmasa — 4 ta rubric to'liq bo'lsa o'rtachadan hisoblanadi.
    let finalScore = dto.score;
    if (finalScore === undefined) {
      const allowed = rubricKeysFor(skill);
      const values = allowed.map((k) => dto.rubricScores?.[k]);
      if (
        dto.rubricScores &&
        values.every((v) => typeof v === 'number' && !Number.isNaN(v))
      ) {
        finalScore = criteriaAverage(values as number[]) ?? undefined;
      }
      if (finalScore === undefined) {
        throw new AppException(
          'SCORE_REQUIRED',
          'Ball kiriting yoki 4 ta mezonni to‘liq baholang',
          400,
        );
      }
    }
    // Server-side clamp (ilgari faqat frontend cheklagan): 0..points.
    if (finalScore < 0 || finalScore > question.points) {
      throw new AppException(
        'SCORE_OUT_OF_RANGE',
        `Ball 0 dan ${question.points} gacha bo'lishi kerak`,
        400,
      );
    }
    if (attempt.specificationVersion === MULTILEVEL_VERSION && (!Number.isFinite(finalScore) || finalScore * 2 !== Math.round(finalScore * 2))) throw new AppException('SCORE_OUT_OF_RANGE', 'Use half-point raw scores', 400);
    const before = await this.prisma.mockAnswer.findUnique({ where: { attemptId_questionId: { attemptId, questionId: dto.questionId } } });

    await this.prisma.mockAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      update: {
        score: finalScore,
        isGraded: true,
        gradedById: teacher.id,
        feedback: dto.feedback ?? null,
        rubricScores: (dto.rubricScores ?? null) as unknown as Prisma.InputJsonValue,
      },
      create: {
        attemptId,
        questionId: dto.questionId,
        response: '',
        score: finalScore,
        isGraded: true,
        gradedById: teacher.id,
        feedback: dto.feedback,
        rubricScores: (dto.rubricScores ?? null) as unknown as Prisma.InputJsonValue,
      },
    });

    const result = await this.gradeAndCompute(attemptId, false);
    await this.audit.log({
      userId: teacher.id,
      action: 'mock.answer.grade',
      entity: 'mockAnswer',
      entityId: dto.questionId,
      oldValue: { score: before?.score ?? null, gradedById: before?.gradedById ?? null, feedback: before?.feedback ?? null },
      newValue: { attemptId, score: finalScore, status: result.status },
    });
    if (result.status === 'completed') await this.notifyResult(attemptId);
    return { saved: true, status: result.status };
  }

  /** Recompute the legacy attempt projection inside a caller-owned transaction.
   * AI finalization and teacher review use this path while the attempt row is
   * locked, so the durable assessment ledger and the student-facing result
   * cannot diverge. */
  async recompute(tx: Prisma.TransactionClient, attemptId: string) {
    const attempt = await tx.mockAttempt.findUnique({ where: { id: attemptId }, include: { exam: { include: MOCK_EXAM_INCLUDE }, answers: true } });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    const isIelts = attempt.exam.type === 'ielts_academic' || attempt.exam.type === 'ielts_general';
    const isMl = !isIelts && attempt.specificationVersion === MULTILEVEL_VERSION;
    const bands: SectionBands = {};
    const rawScores: RawScores = {};
    const standardScores: Record<string, unknown> = {};
    let manualPending = false;
    const bandTables = isIelts ? await this.settings.getBandTables() : undefined;
    for (const section of attempt.exam.sections) {
      const sectionAnswers = section.groups.flatMap(group => group.questions.map(question => ({ question, answer: attempt.answers.find(a => a.questionId === question.id), group })));
      const manual = !AUTO_SKILLS.includes(section.skill);
      const graded = sectionAnswers.filter(item => item.answer?.isGraded);
      if (manual && graded.length !== sectionAnswers.length) manualPending = true;
      let score = manual ? graded.reduce((sum, item) => sum + (item.answer?.score ?? 0), 0) : sectionAnswers.reduce((sum, item) => sum + (item.answer?.score ?? 0), 0);
      let max = sectionAnswers.reduce((sum, item) => sum + item.question.points, 0);
      if (isMl && section.skill === 'speaking') {
        const partScores = section.groups.map(group => {
          const values = group.questions.map(question => attempt.answers.find(a => a.questionId === question.id)?.score).filter((value): value is number => typeof value === 'number');
          return values.length === group.questions.length && values.length ? roundHalfBand(values.reduce((a, b) => a + b, 0) / values.length) : null;
        });
        score = partScores.every((value): value is number => value !== null) ? partScores.reduce((a, b) => a + b, 0) : 0;
        max = section.groups.reduce((sum, group) => sum + (group.questions[0]?.points ?? 0), 0);
      }
      rawScores[section.skill] = { score, max };
      if (isIelts && !manual && max > 0) bands[section.skill] = bandFromRaw(section.skill, attempt.exam.type, score, max, bandTables, sectionAnswers.some(item => Boolean(item.answer?.response?.trim())));
      if (isIelts && manual && !manualPending && graded.length) bands[section.skill] = this.manualSectionBand(section.skill, graded.map(item => ({ type: item.question.type, score: item.answer?.score ?? 0 })));
      if (isMl && max > 0 && !manualPending) {
        const converted = manual ? convertExpertScore(section.skill as 'writing' | 'speaking', score) : estimateObjective(score, max).estimatedStandardScore;
        standardScores[section.skill] = { rawScore: score, rawMax: max, estimatedStandardScore: converted, scoreMethod: 'ESTIMATED', scoreVersion: ESTIMATE_VERSION, isOfficial: false };
      }
    }
    const overallBand = isIelts && !manualPending ? computeOverallBand(Object.values(bands), (attempt as { flowMode?: string | null }).flowMode === 'full_test' ? { fixedDivisor: 4 } : {}) : null;
    const overallScore = isMl && !manualPending ? multilevelOverall(Object.fromEntries(Object.entries(standardScores).map(([key, value]) => [key, (value as { estimatedStandardScore: number }).estimatedStandardScore])) as Partial<Record<MockSkill, number>>) : null;
    const cefrLevel = isIelts ? (overallBand === null ? null : cefrFromBand(overallBand)) : isMl ? (overallScore === null ? null : multilevelLevel(overallScore)) : null;
    const status: MockAttemptStatus = manualPending ? 'grading' : 'completed';
    await tx.mockAttempt.update({ where: { id: attemptId }, data: { status, rawScores: rawScores as Prisma.InputJsonValue, sectionBands: isIelts ? bands as Prisma.InputJsonValue : Prisma.JsonNull, overallBand, cefrLevel,
      ...(isMl ? { standardScores: standardScores as Prisma.InputJsonValue, overallScore, scoreMethod: 'ESTIMATED', scoreVersion: ESTIMATE_VERSION } : {}), finishedAt: status === 'completed' ? new Date() : null } });
    return { status, rawScores, sectionBands: isIelts ? bands : null, overallBand, overallScore, cefrLevel };
  }

  /**
   * Auto savollarni baholaydi, bo'lim bo'yicha xom ball va IELTS band /
   * Multilevel CEFR ni hisoblab saqlaydi. Manual savol qolgan bo'lsa — "grading".
   * `skills` berilsa faqat shu skill'lar hisobga olinadi (section-only submit).
   */
  private async gradeAndCompute(attemptId: string, markSubmitted: boolean, skills?: MockSkill[]) {
    const attempt = await this.prisma.mockAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: { include: MOCK_EXAM_INCLUDE }, answers: true },
    });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);

    const answerByQ = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const examType = attempt.exam.type;
    const isIelts = examType === 'ielts_academic' || examType === 'ielts_general';
    const isVersionedMultilevel = !isIelts && attempt.specificationVersion === MULTILEVEL_VERSION;
    // Section-only submit: faqat so'ralgan skill'lar (bo'sh massiv = filtr yo'q).
    const wanted = skills && skills.length > 0 ? new Set<string>(skills) : null;
    const examSections = wanted
      ? attempt.exam.sections.filter((s) => wanted.has(s.skill))
      : attempt.exam.sections;
    if (wanted && examSections.length === 0) {
      throw new AppException('VALIDATION_ERROR', 'Bunday bo‘lim bu imtihonda yo‘q', 400);
    }
    // Admin tahrirlagan xom→band jadvallari (bo'lmasa standart).
    const bandTables = isIelts ? await this.settings.getBandTables() : undefined;
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    const aggs: SectionAgg[] = [];

    for (const section of examSections) {
      const auto = AUTO_SKILLS.includes(section.skill);
      const agg: SectionAgg = {
        skill: section.skill,
        score: 0,
        max: 0,
        manual: !auto,
        manualPending: false,
        answeredCount: 0,
        tasks: [],
      };
      for (const group of section.groups) {
        const groupScores: number[] = [];
        const duplicateSelections = group.optionsReusable === false
          ? duplicateMatchingResponses(group.questions, new Map(group.questions.map((q) => [q.id, answerByQ.get(q.id)?.response ?? ''])))
          : new Set<string>();
        for (const q of group.questions) {
          agg.max += q.points;
          const ans = answerByQ.get(q.id);
          if (auto) {
            // Bo'sh bo'lmagan javob "urinish" hisoblanadi (mock-answer.ts dagi
            // bo'sh-javob qoidasi bilan bir xil: trim() qilinganda bo'sh emas).
            if (ans?.response?.trim()) agg.answeredCount += 1;
            const key = (q.correctAnswers as string[] | null) ?? [];
            // Spec §3: wordLimit (NO MORE THAN X) + Br/Am acceptedVariants.
            const wordLimit = (q as { wordLimit?: number | null }).wordLimit ?? null;
            const acceptedVariants = (q as { acceptedVariants?: string[] | null }).acceptedVariants ?? null;
            const correct = ans
              ? !duplicateSelections.has(q.id) && isAnswerCorrect(q.type, ans.response, key, { wordLimit, acceptedVariants, answerRule: q.answerRule, options: (q.options as string[] | null) ?? null })
              : false;
            const s = correct ? q.points : 0;
            agg.score += s;
            if (ans) {
              updates.push(
                this.prisma.mockAnswer.update({
                  where: { id: ans.id },
                  data: { isCorrect: correct, score: s, isGraded: true },
                }),
              );
            }
          } else if (ans && ans.isGraded) {
            agg.score += ans.score ?? 0;
            groupScores.push(ans.score ?? 0);
            agg.tasks.push({ type: q.type, score: ans.score ?? 0 });
          } else {
            agg.manualPending = true;
          }
        }
        if (isVersionedMultilevel && section.skill === 'speaking') {
          // A speaking part is one holistic raw score even when several
          // recordings are assessed. Average prompt ratings, round to .5.
          agg.score -= groupScores.reduce((sum, score) => sum + score, 0);
          if (groupScores.length === group.questions.length && groupScores.length) agg.score += roundHalfBand(groupScores.reduce((sum, score) => sum + score, 0) / groupScores.length);
          agg.max -= group.questions.reduce((sum, q) => sum + q.points, 0);
          agg.max += group.questions[0]?.points ?? 0;
        }
      }
      aggs.push(agg);
    }

    const manualPending = aggs.some((a) => a.manual && a.manualPending);

    const rawScores: RawScores = {};
    for (const a of aggs) rawScores[a.skill] = { score: a.score, max: a.max };

    let sectionBands: SectionBands | null = null;
    let overall: number | null = null;
    let cefrLevel: string | null = null;
    let standardScores: Record<string, unknown> | null = null;
    let overallScore: number | null = null;

    if (isIelts) {
      const bands: SectionBands = {};
      for (const a of aggs) {
        if (a.max === 0) continue;
        if (!a.manual) {
          bands[a.skill] = bandFromRaw(a.skill, examType, a.score, a.max, bandTables, a.answeredCount > 0);
        } else if (!a.manualPending) {
          bands[a.skill] = this.manualSectionBand(a.skill, a.tasks);
        }
      }
      sectionBands = bands;
      if (!manualPending) {
        // Spec §5: full_test da maxraj har doim 4 (bo'lim yetishmasa ham).
        const isFullTest = (attempt as { flowMode?: string | null }).flowMode === 'full_test';
        overall = computeOverallBand(Object.values(bands), isFullTest ? { fixedDivisor: 4 } : {});
        if (overall !== null) cefrLevel = cefrFromBand(overall);
      }
    } else if (isVersionedMultilevel) {
      standardScores = {};
      const scores: Partial<Record<MockSkill, number>> = {};
      for (const a of aggs) {
        if (!a.max || a.manualPending) continue;
        const result = a.manual
          ? { rawScore: a.score, rawMax: a.max, estimatedStandardScore: convertExpertScore(a.skill as 'writing' | 'speaking', a.score), scoreMethod: 'ESTIMATED', scoreVersion: ESTIMATE_VERSION, isOfficial: false, gradingSource: 'HUMAN' }
          : estimateObjective(a.score, a.max);
        standardScores[a.skill] = result;
        scores[a.skill] = result.estimatedStandardScore;
      }
      overallScore = multilevelOverall(scores);
      if (overallScore != null) cefrLevel = multilevelLevel(overallScore);
    } else if (!manualPending) {
      const totalScore = aggs.reduce((s, a) => s + a.score, 0);
      const totalMax = aggs.reduce((s, a) => s + a.max, 0);
      cefrLevel = cefrFromPercent(totalMax > 0 ? (totalScore / totalMax) * 100 : 0);
    }

    const status: MockAttemptStatus = manualPending ? 'grading' : 'completed';
    updates.push(
      this.prisma.mockAttempt.update({
        where: { id: attemptId },
        data: {
          status,
          rawScores: rawScores as Prisma.InputJsonValue,
          sectionBands: sectionBands ? (sectionBands as Prisma.InputJsonValue) : Prisma.JsonNull,
          overallBand: overall,
          cefrLevel,
          ...(isVersionedMultilevel ? { standardScores: standardScores as Prisma.InputJsonValue, overallScore, scoreMethod: 'ESTIMATED', scoreVersion: ESTIMATE_VERSION } : {}),
          ...(markSubmitted ? { submittedAt: new Date() } : {}),
          finishedAt: status === 'completed' ? new Date() : null,
        },
      }),
    );

    await this.prisma.$transaction(updates);
    return { status, rawScores, sectionBands, overallBand: overall, cefrLevel,
      ...(isVersionedMultilevel ? { standardScores, overallScore, scoreMethod: 'ESTIMATED', scoreVersion: ESTIMATE_VERSION, specificationVersion: attempt.specificationVersion, isOfficial: false } : {}) };
  }

  /** Writing: Task 2 ikki barobar; Speaking: o'rtacha. Natija 0.5 ga yaxlitlanadi. */
  private manualSectionBand(
    skill: MockSkill,
    tasks: Array<{ type: MockQuestionType; score: number }>,
  ): number {
    if (tasks.length === 0) return 0;
    if (skill === 'writing') {
      const t1 = tasks.find((t) => t.type === 'essay_task1')?.score;
      const t2 = tasks.find((t) => t.type === 'essay_task2')?.score;
      if (t1 !== undefined && t2 !== undefined) return roundHalfBand((t1 + 2 * t2) / 3);
    }
    const avg = tasks.reduce((s, t) => s + t.score, 0) / tasks.length;
    return roundHalfBand(avg);
  }

  // ─────────────────────────── Ro'yxat / tafsilot ───────────────────────────

  async listAttempts(viewer: AuthUser, q: ListAttemptsQueryDto) {
    const where: Prisma.MockAttemptWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.examId ? { examId: q.examId } : {}),
      ...(q.program ? { exam: { type: q.program === 'MULTILEVEL' ? 'multilevel' : { in: ['ielts_academic', 'ielts_general'] } } } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
    };
    if (viewer.role === 'teacher') {
      where.student = { group: { teacherId: viewer.id } };
    }
    const [total, rows] = await Promise.all([
      this.prisma.mockAttempt.count({ where }),
      this.prisma.mockAttempt.findMany({
        where,
        include: {
          student: { include: { user: { select: { name: true } } } },
          exam: { select: { title: true, type: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
    ]);
    return new Paginated(
      rows.map((a) => this.summary(a)),
      { page: q.page, limit: q.limit, total },
    );
  }

  async myAttempts(student: AuthUser, q: ListAttemptsQueryDto) {
    const active = await this.programs.active(student.id, q.program);
    const where: Prisma.MockAttemptWhereInput = {
      studentId: student.id,
      exam: { type: active === 'MULTILEVEL' ? 'multilevel' : active === 'IELTS' ? { in: ['ielts_academic', 'ielts_general'] } : { in: [] } },
      ...(q.status ? { status: q.status } : {}),
      ...(q.examId ? { examId: q.examId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.mockAttempt.count({ where }),
      this.prisma.mockAttempt.findMany({
        where,
        include: { exam: { select: { title: true, type: true } } },
        orderBy: { startedAt: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
    ]);
    return new Paginated(
      rows.map((a) => this.summary(a, true)),
      { page: q.page, limit: q.limit, total },
    );
  }

  async getAttempt(viewer: AuthUser, attemptId: string) {
    const attempt = await this.prisma.mockAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { include: MOCK_EXAM_INCLUDE },
        answers: true,
        cheatEvents: { orderBy: { createdAt: 'asc' } },
        student: { include: { user: { select: { name: true } } } },
      },
    });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.access.assertCanViewStudent(viewer, attempt.studentId);

    const staff = isStaff(viewer);
    // O'quvchi urinish tugagach o'z to'g'ri javoblarini ko'radi (mashq uchun)
    const showAnswers = staff || attempt.status === 'completed';
    const answerByQ = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const rawScores = (attempt.rawScores as RawScores | null) ?? {};
    const sectionBands = (attempt.sectionBands as SectionBands | null) ?? {};

    const sections = attempt.exam.sections.map((s) => ({
      id: s.id,
      skill: s.skill,
      title: s.title,
      durationMinutes: s.durationMinutes,
      instructions: s.instructions,
      score: rawScores[s.skill]?.score ?? null,
      max: rawScores[s.skill]?.max ?? null,
      band: sectionBands[s.skill] ?? null,
      standardScore: ((attempt.standardScores as Record<string, { estimatedStandardScore?: number }> | null)?.[s.skill]?.estimatedStandardScore) ?? null,
      groups: s.groups.map((g, gi) => ({
        id: g.id,
        title: g.title,
        instructions: g.instructions,
        passageText: attempt.specificationVersion === MULTILEVEL_VERSION && s.skill === 'listening' && !showAnswers ? null : g.passageText,
        contentHtml: g.contentHtml,
        contentLayout: g.contentLayout,
        optionsReusable: g.optionsReusable,
        hasAudio: !!g.audioKey,
        questions: g.questions.map((qq, qi) => {
          const ans = answerByQ.get(qq.id);
          return {
            id: qq.id,
            number: qq.number,
            type: qq.type,
            prompt: qq.prompt,
            options: (qq.options as string[] | null) ?? null,
            points: qq.points,
            wordLimit: qq.wordLimit,
            answerRule: qq.answerRule,
            ...(attempt.specificationVersion === MULTILEVEL_VERSION ? { guidance: taskGuidance(s.skill, gi, qi) } : {}),
            response: ans?.response ?? null,
            hasAudio: !!ans?.audioKey,
            audioUrl: ans?.audioKey
              ? `${this.base}/mock/attempts/${attemptId}/answers/${qq.id}/audio`
              : null,
            score: ans?.score ?? null,
            isCorrect: ans?.isCorrect ?? null,
            isGraded: ans?.isGraded ?? false,
            feedback: ans?.feedback ?? null,
            rubricScores: (ans as { rubricScores?: unknown } | undefined)?.rubricScores ?? null,
            ...(showAnswers ? { correctAnswers: (qq.correctAnswers as string[] | null) ?? null } : {}),
          };
        }),
      })),
    }));

    return {
      ...this.summary(attempt, !staff),
      serverTime: new Date(),
      annotations: attempt.annotations ?? [],
      sections,
      ...(staff
        ? { cheatEvents: attempt.cheatEvents.map((e) => ({ event: e.event, date: e.createdAt })) }
        : {}),
    };
  }

  /** GET /mock/attempts/:attemptId/answers/:questionId/audio — Speaking javob audiosi */
  async streamSpeakingAudio(
    viewer: AuthUser,
    attemptId: string,
    questionId: string,
    req: Request,
    res: Response,
  ) {
    const attempt = await this.prisma.mockAttempt.findUnique({
      where: { id: attemptId },
      select: { studentId: true },
    });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.access.assertCanViewStudent(viewer, attempt.studentId);

    const answer = await this.prisma.mockAnswer.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
      select: { audioKey: true },
    });
    if (!answer?.audioKey || !this.storage.exists(answer.audioKey)) {
      throw new AppException('FILE_NOT_FOUND', 'Audio topilmadi', 404);
    }
    streamFileRange(this.storage, answer.audioKey, audioContentType(answer.audioKey), req, res);
  }

  /** Sertifikat uchun ma'lumot */
  async certificateData(viewer: AuthUser, attemptId: string) {
    const attempt = await this.prisma.mockAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { select: { title: true, type: true, level: true } },
        student: { include: { user: { select: { name: true } } } },
      },
    });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.access.assertCanViewStudent(viewer, attempt.studentId);
    if (attempt.status !== 'completed') {
      throw new AppException('MOCK_ATTEMPT_NOT_COMPLETED', 'Natija hali tayyor emas', 400);
    }
    const rawScores = (attempt.rawScores as RawScores | null) ?? {};
    const sectionBands = (attempt.sectionBands as SectionBands | null) ?? {};
    const order: MockSkill[] = ['listening', 'reading', 'writing', 'speaking'];
    const sections = order
      .filter((skill) => rawScores[skill])
      .map((skill) => ({
        skill,
        score: rawScores[skill].score,
        max: rawScores[skill].max,
        band: sectionBands[skill] ?? null,
        standardScore: ((attempt.standardScores as Record<string, { estimatedStandardScore: number }> | null)?.[skill]?.estimatedStandardScore) ?? null,
      }));

    return {
      studentName: attempt.student.user.name,
      examTitle: viewer.role === 'student' ? studentExamTitle(attempt.exam.title) : attempt.exam.title,
      examType: attempt.exam.type,
      level: attempt.exam.level,
      isIelts: attempt.exam.type !== 'multilevel',
      finishedAt: attempt.finishedAt ?? new Date(),
      attemptId: attempt.id,
      sections,
      overallBand: attempt.overallBand,
      overallScore: attempt.overallScore,
      specificationVersion: attempt.specificationVersion,
      cefrLevel: attempt.cefrLevel,
    };
  }

  // ─────────────────────────── Helpers ───────────────────────────

  /** Rubric kalitlari: writing {ta,cc,lr,gra}, speaking {fluency,lexical,grammar,pronunciation} — qiymat 0..9, 0.5 qadam. */
  private validateRubrics(skill: MockSkill, rubrics: Record<string, number> | undefined): void {
    if (rubrics === undefined) return;
    const allowed = rubricKeysFor(skill);
    for (const [key, value] of Object.entries(rubrics)) {
      if (!allowed.includes(key)) {
        throw new AppException('VALIDATION_ERROR', `Noma'lum rubric: ${key}`, 400);
      }
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 9) {
        throw new AppException('VALIDATION_ERROR', `Rubric "${key}" 0 dan 9 gacha bo'lsin`, 400);
      }
      if (Math.round(value * 2) !== value * 2) {
        throw new AppException('VALIDATION_ERROR', `Rubric "${key}" 0.5 qadamda bo'lsin`, 400);
      }
    }
  }

  private summary(a: {
    id: string;
    examId: string;
    studentId: string;
    status: MockAttemptStatus;
    mode: MockAttemptMode;
    deadlineAt: Date | null;
    rawScores: Prisma.JsonValue;
    sectionBands: Prisma.JsonValue;
    overallBand: number | null;
    cefrLevel: string | null;
    specificationVersion?: string | null;
    standardScores?: Prisma.JsonValue;
    overallScore?: number | null;
    scoreMethod?: string | null;
    scoreVersion?: string | null;
    antiCheatCount: number;
    startedAt: Date;
    submittedAt: Date | null;
    finishedAt: Date | null;
    flowMode?: string | null;
    currentSkill?: unknown;
    sectionDeadlines?: Prisma.JsonValue;
    overallDeadlineAt?: Date | null;
    exam?: { title: string; type: string } | null;
    student?: { user: { name: string } } | null;
  }, sanitizeTitle = false) {
    return {
      id: a.id,
      examId: a.examId,
      examTitle: a.exam?.title == null ? a.exam?.title : sanitizeTitle ? studentExamTitle(a.exam.title) : a.exam.title,
      examType: a.exam?.type,
      studentId: a.studentId,
      studentName: a.student?.user.name,
      status: a.status,
      mode: a.mode,
      deadlineAt: (a.overallDeadlineAt ?? a.deadlineAt) as Date | null,
      flowMode: (a.flowMode ?? 'single_skill') as string,
      currentSkill: (a.currentSkill ?? null) as unknown,
      sectionDeadlines: (a.sectionDeadlines ?? null) as Prisma.JsonValue,
      overallDeadlineAt: (a.overallDeadlineAt ?? null) as Date | null,
      rawScores: a.rawScores ?? null,
      sectionBands: a.sectionBands ?? null,
      overallBand: a.overallBand,
      cefrLevel: a.cefrLevel,
      ...(a.specificationVersion === MULTILEVEL_VERSION ? { specificationVersion: a.specificationVersion, standardScores: a.standardScores, overallScore: a.overallScore, scoreMethod: a.scoreMethod, scoreVersion: a.scoreVersion, isOfficial: false } : {}),
      antiCheatCount: a.antiCheatCount,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      finishedAt: a.finishedAt,
    };
  }

  private async notifyResult(attemptId: string): Promise<void> {
    const attempt = await this.prisma.mockAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: { select: { title: true, type: true } } },
    });
    if (!attempt) return;
    const headline =
      attempt.exam.type === 'multilevel'
        ? attempt.specificationVersion === MULTILEVEL_VERSION
          ? `estimated (unofficial): ${attempt.overallScore ?? '—'}/75 · ${attempt.cefrLevel ?? '—'}`
          : `daraja: ${attempt.cefrLevel ?? '—'}`
        : `Overall Band: ${attempt.overallBand ?? '—'}`;
    await this.notifications.notify(
      attempt.studentId,
      'test_result',
      `Mock imtihon natijangiz tayyor: "${studentExamTitle(attempt.exam.title)}" — ${headline}.`,
    );
    await this.notifications.notifyParents(
      attempt.studentId,
      'test_result',
      `Farzandingizning "${studentExamTitle(attempt.exam.title)}" mock natijasi: ${headline}.`,
    );
  }

  private submissionResult(attempt: { status: MockAttemptStatus; rawScores: Prisma.JsonValue; sectionBands: Prisma.JsonValue; overallBand: number | null; cefrLevel: string | null; standardScores: Prisma.JsonValue; overallScore: number | null; specificationVersion: string | null; scoreMethod: string | null; scoreVersion: string | null }) {
    return { status: attempt.status, rawScores: attempt.rawScores ?? {}, sectionBands: attempt.sectionBands, overallBand: attempt.overallBand, cefrLevel: attempt.cefrLevel,
      standardScores: attempt.standardScores, overallScore: attempt.overallScore, specificationVersion: attempt.specificationVersion, scoreMethod: attempt.scoreMethod, scoreVersion: attempt.scoreVersion, isOfficial: false };
  }

  private async notifyTeacherPending(attemptId: string): Promise<void> {
    const attempt = await this.prisma.mockAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { select: { title: true } },
        student: {
          include: { group: { select: { teacherId: true } }, user: { select: { name: true } } },
        },
      },
    });
    if (!attempt?.student.group?.teacherId) return;
    await this.notifications.notify(
      attempt.student.group.teacherId,
      'test_result',
      `${attempt.student.user.name} "${attempt.exam.title}" mock imtihonini topshirdi — Writing/Speaking baholashingiz kutilmoqda.`,
    );
  }
}
