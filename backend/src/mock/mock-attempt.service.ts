import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockAnswer, MockAttempt, Prisma } from '@prisma/client';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../videos/storage.service';
import {
  BulkAnswersDto,
  FlagCheatDto,
  SaveAnnotationsDto,
  SaveAnswerDto,
  StartAttemptDto,
} from './dto/mock.dto';
import { MockAccessService } from './mock-access.service';
import { assertSpeakingAudio } from './speaking-audio';
import { ExamRow, SKILL_ORDER, computeSkillTiming, shapeExam, totalDuration } from './mock-shape';
import { MULTILEVEL_VERSION, MULTILEVEL_AUDIO, MULTILEVEL_SPECIFICATION, multilevelStartReadiness, taskGuidance } from './multilevel-specification';
import { BESTWAY_MULTILEVEL_SPEAKING_2026_V2 } from './multilevel-speaking-profile';

export const MOCK_EXAM_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      groups: {
        orderBy: { sortOrder: 'asc' as const },
        include: { questions: { orderBy: { sortOrder: 'asc' as const } } },
      },
    },
  },
} satisfies Prisma.MockExamInclude;

const CHEAT_EVENT_CAP = 50;

type SectionDeadlines = Partial<Record<'listening' | 'reading' | 'writing' | 'speaking', string>>;
interface MediaPhase { startedAt: string; prepEndsAt: string; expiresAt: string; plays: number }

@Injectable()
export class MockAttemptService {
  private readonly base: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MockAccessService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.base = `${config.get<string>('PUBLIC_URL') ?? 'http://localhost:3001'}/v1`;
  }

  /** POST /mock/exams/:id/start — urinish ochadi (yoki tugallanmaganini davom ettiradi) */
  async start(student: AuthUser, examId: string, dto: StartAttemptDto) {
    if (!student.studentProfile) {
      throw new AppException('NOT_A_STUDENT', "Faqat o'quvchi imtihon topshira oladi", 403);
    }
    const exam = await this.prisma.mockExam.findUnique({
      where: { id: examId },
      include: MOCK_EXAM_INCLUDE,
    });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    if (!exam.isPublished && !exam.isDemo) {
      throw new AppException('MOCK_EXAM_NOT_PUBLISHED', 'Bu imtihon hali ochilmagan', 400);
    }
    // Pullik kirish tekshiruvi
    await this.access.assertCanStart(student, exam);
    const existing = await this.withDefinitionLock(exam, (tx) => tx.mockAttempt.findFirst({
      where: { studentId: student.id, examId, status: 'in_progress' },
      include: { answers: true },
    }));
    if (existing) {
      // Migration stamps exam definitions, never historical attempts. Resume
      // the original contract even if its content predates the new blueprint.
      const resumeExam = { ...exam, specificationVersion: existing.specificationVersion, speakingProfileVersion: existing.speakingProfileVersion ?? null };
      return this.resumeResponse(existing, shapeExam(resumeExam as unknown as ExamRow, false, this.base), totalDuration(exam as unknown as ExamRow));
    }
    if (exam.type === 'multilevel') {
      const readiness = multilevelStartReadiness(exam);
      if (!readiness.supported) throw new AppException('SPECIFICATION_UNSUPPORTED', readiness.issues[0], 400);
      if (readiness.issues.length) throw new AppException('MOCK_NOT_READY', readiness.issues.join('; '), 400);
      exam.speakingProfileVersion ??= BESTWAY_MULTILEVEL_SPEAKING_2026_V2;
    }

    const shaped = shapeExam(exam as unknown as ExamRow, false, this.base);
    if (shaped.questionCount === 0) {
      throw new AppException('MOCK_EXAM_EMPTY', "Bu imtihonda hali savollar yo'q", 400);
    }

    // --- IELTS full-test flow (v2026.1; qarorlar: dynamic audio+2min, practice=lenient, exam=strict) ---
    // Full-test flow faqat full_mock profildagi imtihonlarda — single-skill
    // practice testlarga full-test timing/transition majburan qo'llanmaydi.
    const flowMode = dto.flow === 'full_test' ? 'full_test' : 'single_skill';
    if (flowMode === 'full_test') {
      if ((exam as unknown as { profile?: string }).profile !== 'full_mock') {
        throw new AppException(
          'MOCK_FULL_TEST_UNAVAILABLE',
          'Full Mock flow faqat full_mock imtihonlarda mavjud',
          400,
        );
      }
      return this.startFullTest(student, examId, exam as unknown as ExamRow, shaped);
    }

    const mode = dto.mode ?? 'practice';
    // Single_skill timed: skill-aware deadline (IELTS qoidalari).
    // listening = audio yig'indisi + 120s review, reading/writing = durationMinutes,
    // speaking = deadline'siz. `totalDuration` faqat ko'rinish (display) uchun.
    const duration = totalDuration(exam as unknown as ExamRow);
    let deadlineAt: Date | null = null;
    let overallDeadlineAt: Date | null = null;
    let sectionDeadlines: SectionDeadlines | null = null;
    if (mode === 'timed') {
      const now = Date.now();
      const bySkill = new Map((exam.sections ?? []).map((s) => [s.skill, s]));
      const map: SectionDeadlines = {};
      let last: Date | null = null;
      for (const skill of SKILL_ORDER) {
        const section = bySkill.get(skill);
        if (!section) continue;
        const { deadline } = computeSkillTiming(skill, section, now, exam.type);
        if (!deadline) continue; // speaking — deadline yo'q
        if (skill !== 'speaking' || exam.type === 'multilevel') {
          map[skill as keyof SectionDeadlines] = deadline.toISOString();
        }
        last = deadline;
      }
      if (last) {
        deadlineAt = last;
        overallDeadlineAt = last;
        sectionDeadlines = map;
      }
      // Faqat speaking'dan iborat exam timed bo'lsa ham — deadline null.
    }

    const opened = await this.openAttempt(exam, {
      examId,
      studentId: student.id,
      specificationVersion: exam.specificationVersion,
      speakingProfileVersion: exam.speakingProfileVersion ?? null,
      mode,
      deadlineAt,
      ...(sectionDeadlines ? { sectionDeadlines: sectionDeadlines as unknown as Prisma.InputJsonValue } : {}),
      ...(overallDeadlineAt ? { overallDeadlineAt } : {}),
    });
    if (opened.resumed) {
      const resumeExam = { ...exam, specificationVersion: opened.attempt.specificationVersion, speakingProfileVersion: opened.attempt.speakingProfileVersion ?? null };
      return this.resumeResponse(opened.attempt, shapeExam(resumeExam as unknown as ExamRow, false, this.base), duration);
    }
    const attempt = opened.attempt;
    return {
      attemptId: attempt.id,
      resumed: false,
      mode: attempt.mode,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      serverTime: new Date(),
      durationMinutes: duration,
      flowMode: attempt.flowMode ?? 'single_skill',
      currentSkill: attempt.currentSkill ?? null,
      sectionDeadlines: attempt.sectionDeadlines ?? null,
      overallDeadlineAt: attempt.overallDeadlineAt ?? null,
      exam: shaped,
      annotations: [],
      savedAnswers: {},
    };
  }

  /**
   * Full-test start (exam, strict): L→R→W→S ketma-ket, server-soat.
   * Har bir skill deadline `computeSkillTiming` bilan (listening = audio+120s
   * review, reading/writing = durationMinutes), zanjir ketma-ket ulanadi.
   * Practice dan farqli — mode har doim timed, currentSkill=listening.
   */
  private async startFullTest(student: AuthUser, examId: string, exam: ExamRow, shaped: ReturnType<typeof shapeExam>) {
    const now = Date.now();
    const sections = exam.sections ?? [];
    const bySkill = new Map(sections.map((s) => [s.skill, s]));
    // Speaking has no time box (see startFullTest docstring): no per-section
    // deadline key and no overall deadline, otherwise the unconditional
    // overall check in assertNotTimedOut would MOCK_TIME_UP every speaking
    // action once writing's clock runs out.
    const hasSpeaking = bySkill.has('speaking' as never) && exam.type !== 'multilevel';

    // Zanjirli deadline: har bir bo'lim oldingisi tugagach boshlanadi.
    let cursor = now;
    const sectionDeadlines: SectionDeadlines = {};
    for (const skill of SKILL_ORDER) {
      const { seconds } = computeSkillTiming(skill, bySkill.get(skill), cursor, exam.type);
      if (seconds == null) continue;
      cursor += seconds * 1000;
      sectionDeadlines[skill] = new Date(cursor).toISOString();
    }
    const writingDeadline = new Date(cursor);
    // Speaking is untimed: no overall deadline, otherwise the unconditional
    // overall check in assertNotTimedOut would MOCK_TIME_UP every speaking
    // action once writing's clock runs out. Per-skill sectionDeadlines alone
    // guard L/R/W; the speaking key is simply omitted (missing key tolerated).
    const overallDeadline: Date | null = hasSpeaking ? null : writingDeadline;

    const opened = await this.openAttempt(exam, {
      examId,
      studentId: student.id,
      specificationVersion: exam.specificationVersion,
      speakingProfileVersion: exam.speakingProfileVersion ?? null,
      mode: 'timed',
      deadlineAt: overallDeadline,
      flowMode: 'full_test',
      currentSkill: 'listening',
      sectionDeadlines: sectionDeadlines as unknown as Prisma.InputJsonValue,
      overallDeadlineAt: overallDeadline,
      audioPlays: {} as unknown as Prisma.InputJsonValue,
      submittedSections: [] as unknown as Prisma.InputJsonValue,
    });
    if (opened.resumed) {
      const resumeExam = { ...exam, specificationVersion: opened.attempt.specificationVersion, speakingProfileVersion: opened.attempt.speakingProfileVersion ?? null };
      return this.resumeResponse(opened.attempt, shapeExam(resumeExam, false, this.base), totalDuration(exam));
    }
    const attempt = opened.attempt;
    return {
      attemptId: attempt.id,
      resumed: false,
      mode: attempt.mode,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      serverTime: new Date(),
      durationMinutes: Math.round((writingDeadline.getTime() - now) / 60_000),
      flowMode: 'full_test' as const,
      currentSkill: 'listening' as const,
      sectionDeadlines,
      overallDeadlineAt: overallDeadline,
      exam: shaped,
      annotations: [],
      savedAnswers: {},
    };
  }

  /** Definition writes and starts share the exam row lock and Serializable isolation. */
  private async withDefinitionLock<T>(exam: Pick<ExamRow, 'id' | 'contentVersion'>, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ contentVersion: number; isPublished: boolean; isDemo: boolean }>>`
          SELECT "contentVersion", "isPublished", "isDemo" FROM "MockExam" WHERE "id" = ${exam.id} FOR UPDATE`;
        const current = rows[0];
        if (!current) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
        if (current.contentVersion !== (exam.contentVersion ?? 1)) {
          throw new AppException('MOCK_CONTENT_CONFLICT', 'Exam content changed. Reload before starting or resuming', 409);
        }
        if (!current.isPublished && !current.isDemo) {
          throw new AppException('MOCK_EXAM_NOT_PUBLISHED', 'Bu imtihon hali ochilmagan', 400);
        }
        return run(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))) {
        throw new AppException('MOCK_CONTENT_CONFLICT', 'Exam state changed. Reload before starting or resuming', 409);
      }
      throw error;
    }
  }

  private async openAttempt(exam: Pick<ExamRow, 'id' | 'contentVersion'>, data: Prisma.MockAttemptUncheckedCreateInput) {
    return this.withDefinitionLock(exam, async (tx) => {
      const existing = await tx.mockAttempt.findFirst({ where: { studentId: data.studentId, examId: exam.id, status: 'in_progress' }, include: { answers: true } });
      if (existing) return { attempt: existing, resumed: true };
      const attempt = await tx.mockAttempt.create({ data, include: { answers: true } });
      return { attempt, resumed: false };
    });
  }

  /**
   * Full-test advance: joriy bo'limni yakunlab keyingisiga o'tish (L→R→W→S).
   * Server-soat asosida; orqaga qaytish yo'q (exam strict, qaror #4).
   * Speaking faqat imtihonda speaking bo'limi bo'lsa ro'yxatda bo'ladi —
   * bo'lmasa writing oxirgi bo'lib qoladi. Oxirgi bo'limdan keyin advance
   * FLOW_COMPLETE beradi (yakunlash submit orqali).
   */
  async advanceSection(student: AuthUser, attemptId: string) {
    const attempt = await this.ownAttempt(student, attemptId);
    this.assertInProgress(attempt.status);
    if (attempt.flowMode !== 'full_test') {
      throw new AppException('NOT_FULL_TEST', 'Bu urinish full_test rejimida emas', 400);
    }
    if (attempt.specificationVersion === MULTILEVEL_VERSION) {
      return this.mutateVersionedAttempt(student, attemptId, [], async (tx, fresh) => {
        if (fresh.currentSkill !== attempt.currentSkill) return { saved: true, currentSkill: fresh.currentSkill, submittedSections: fresh.submittedSections, serverTime: new Date(), sectionDeadlines: fresh.sectionDeadlines, overallDeadlineAt: fresh.overallDeadlineAt };
        const order = ['listening', 'reading', 'writing', 'speaking'] as const;
        const idx = order.indexOf(fresh.currentSkill as typeof order[number]);
        if (idx < 0 || idx === 3) throw new AppException('FLOW_COMPLETE', 'Submit the final section', 400);
        const submitted = Array.isArray(fresh.submittedSections) ? [...fresh.submittedSections] : [];
        const deadlines = { ...(fresh.sectionDeadlines as Record<string, string> | null ?? {}) };
        let cursor = Date.now();
        const overallLimit = fresh.overallDeadlineAt?.getTime() ?? Infinity;
        for (const skill of order.slice(idx+1)) {
          cursor = Math.min(overallLimit, cursor + MULTILEVEL_SPECIFICATION[skill].durationSeconds * 1000);
          deadlines[skill] = new Date(cursor).toISOString();
        }
        const updated = await tx.mockAttempt.update({ where: { id: attemptId }, data: { currentSkill: order[idx+1], submittedSections: [...submitted, fresh.currentSkill] as Prisma.InputJsonValue, sectionDeadlines: deadlines, overallDeadlineAt: new Date(cursor), deadlineAt: new Date(cursor) } });
        return { saved: true, currentSkill: updated.currentSkill, submittedSections: updated.submittedSections, serverTime: new Date(), sectionDeadlines: updated.sectionDeadlines, overallDeadlineAt: updated.overallDeadlineAt };
      }, true);
    }
    const skills = await this.prisma.mockSection.findMany({
      where: { examId: attempt.examId },
      select: { skill: true },
    });
    const base = ['listening', 'reading', 'writing'] as const;
    type FlowSkill = (typeof base)[number] | 'speaking';
    const order: readonly FlowSkill[] = skills.some((s) => s.skill === 'speaking')
      ? [...base, 'speaking']
      : base;
    const current = attempt.currentSkill as FlowSkill | null;
    const idx = current ? order.indexOf(current) : -1;
    if (idx === -1 || idx >= order.length - 1) {
      throw new AppException('FLOW_COMPLETE', 'Oxirgi bo‘limdasiz — imtihonni yakunlang', 400);
    }
    const submitted = Array.isArray(attempt.submittedSections) ? [...(attempt.submittedSections as string[])] : [];
    if (current && !submitted.includes(current)) submitted.push(current);
    const next = order[idx + 1];
    const updated = await this.prisma.mockAttempt.update({
      where: { id: attemptId },
      data: {
        currentSkill: next,
        submittedSections: submitted as unknown as Prisma.InputJsonValue,
        // Entering speaking clears any overall deadline (heals attempts
        // started before overallDeadlineAt=null; speaking is untimed).
        ...(next === 'speaking' && attempt.specificationVersion !== MULTILEVEL_VERSION ? { overallDeadlineAt: null, deadlineAt: null } : {}),
      },
    });
    return {
      saved: true,
      currentSkill: updated.currentSkill,
      submittedSections: submitted,
      serverTime: new Date(),
      sectionDeadlines: updated.sectionDeadlines,
      overallDeadlineAt: updated.overallDeadlineAt,
    };
  }

  /**
   * Listening once-only nazorati (spec §2.1; qaror #4: practice=cheksiz, timed=1 marta).
   * Timed rejimda full_test VA single_skill listening'da qo'llanadi.
   * Audio stream dan oldin chaqiriladi. Qayta urinish → 403 AUDIO_REPLAY_BLOCKED.
   */
  async recordAudioPlay(student: AuthUser | undefined, attemptId: string | undefined, groupId: string) {
    if (!attemptId || !student) return { allowed: true, plays: 0, limited: false };
    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.studentId !== student.id) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Attempt not found', 404);
    if (attempt.mode !== 'timed') {
      return { allowed: true, plays: 0, limited: false };
    }
    const group = await this.prisma.mockQuestionGroup.findUnique({
      where: { id: groupId },
      select: { id: true, audioKey: true, audioPlayLimit: true, section: { select: { skill: true, examId: true } } },
    });
    if (!group || group.section.skill !== 'listening' || !group.audioKey) {
      return { allowed: true, plays: 0, limited: false };
    }
    if (group.section.examId !== attempt.examId) throw new AppException('QUESTION_NOT_IN_EXAM', 'Audio outside attempt', 403);
    this.assertInProgress(attempt.status);
    this.assertNotTimedOut(attempt);
    if (attempt.flowMode === 'full_test' && attempt.currentSkill !== 'listening') throw new AppException('SECTION_LOCKED', 'Listening section is locked', 403);
    if (attempt.specificationVersion === MULTILEVEL_VERSION) {
      const phase = (attempt.mediaState as Record<string, MediaPhase> | null)?.[groupId];
      if (!phase?.plays || Date.now() > new Date(phase.expiresAt).getTime()) throw new AppException('AUDIO_REPLAY_BLOCKED', 'Start the scheduled playback first', 403);
      return { allowed: true, plays: phase.plays, limited: true };
    }
    const plays = ((attempt.audioPlays as Record<string, number> | null) ?? {}) as Record<string, number>;
    const count = (plays[groupId] ?? 0) + 1;
    if (count > group.audioPlayLimit) {
      throw new AppException('AUDIO_REPLAY_BLOCKED', 'Audio bir marta eshitiladi (exam rejimi)', 403);
    }
    await this.prisma.mockAttempt.update({
      where: { id: attemptId },
      data: { audioPlays: { ...plays, [groupId]: count } as unknown as Prisma.InputJsonValue },
    });
    return { allowed: true, plays: count, limited: true };
  }

  private resumeResponse(
    attempt: MockAttempt & { answers: MockAnswer[] },
    exam: ReturnType<typeof shapeExam>,
    durationMinutes: number | null,
  ) {
    return {
      attemptId: attempt.id,
      resumed: true,
      mode: attempt.mode,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.overallDeadlineAt ?? attempt.deadlineAt,
      serverTime: new Date(),
      durationMinutes,
      flowMode: attempt.flowMode ?? 'single_skill',
      currentSkill: attempt.currentSkill ?? null,
      sectionDeadlines: attempt.sectionDeadlines ?? null,
      overallDeadlineAt: attempt.overallDeadlineAt ?? null,
      exam,
      annotations: attempt.annotations ?? [],
      savedAnswers: Object.fromEntries(
        attempt.answers.map((a) => [a.questionId, a.audioKey ? '[audio]' : a.response]),
      ),
    };
  }

  /** POST /mock/attempts/:attemptId/answer — bitta javobni saqlash (upsert) */
  async saveAnswer(student: AuthUser, attemptId: string, dto: SaveAnswerDto) {
    const attempt = await this.ownAttempt(student, attemptId);
    this.assertInProgress(attempt.status);
    this.assertNotTimedOut(attempt);
    await this.assertQuestionInExam(attempt.examId, dto.questionId);
    await this.assertQuestionInCurrentSection(attempt.examId, dto.questionId, attempt);
    if (attempt.specificationVersion === MULTILEVEL_VERSION) {
      return this.mutateVersionedAttempt(student, attemptId, [dto.questionId], async (tx) => {
        await tx.mockAnswer.upsert({ where: { attemptId_questionId: { attemptId, questionId: dto.questionId } }, update: { response: dto.response }, create: { attemptId, questionId: dto.questionId, response: dto.response } });
        return { saved: true };
      });
    }
    await this.prisma.mockAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      update: { response: dto.response },
      create: { attemptId, questionId: dto.questionId, response: dto.response },
    });
    return { saved: true };
  }

  /** POST /mock/attempts/:attemptId/answers — bir nechta javobni birdan saqlash */
  async bulkAnswers(student: AuthUser, attemptId: string, dto: BulkAnswersDto) {
    const attempt = await this.ownAttempt(student, attemptId);
    this.assertInProgress(attempt.status);
    this.assertNotTimedOut(attempt);

    const valid = await this.prisma.mockQuestion.findMany({
      where: {
        group: { section: { examId: attempt.examId } },
        id: { in: dto.answers.map((a) => a.questionId) },
      },
      select: { id: true, group: { select: { section: { select: { skill: true } } } } },
    });
    // Full-test strict: faqat joriy bo'lim savollari qabul qilinadi (qaror #4).
    const inSection = attempt.flowMode === 'full_test' && attempt.currentSkill
      ? valid.filter((v) => v.group.section.skill === attempt.currentSkill)
      : valid;
    const validIds = new Set(inSection.map((v) => v.id));
    const items = dto.answers.filter((a) => validIds.has(a.questionId));
    if (attempt.specificationVersion === MULTILEVEL_VERSION && items.length !== dto.answers.length) throw new AppException('SECTION_LOCKED', 'All answers must belong to the current section', 403);
    if (items.length === 0) {
      throw new AppException(
        attempt.flowMode === 'full_test' ? 'SECTION_LOCKED' : 'QUESTION_NOT_IN_EXAM',
        attempt.flowMode === 'full_test' ? 'Hozir faqat joriy bo‘limga javob beriladi' : 'Javoblar bu imtihonga tegishli emas',
        attempt.flowMode === 'full_test' ? 403 : 400,
      );
    }

    if (attempt.specificationVersion === MULTILEVEL_VERSION) {
      return this.mutateVersionedAttempt(student, attemptId, items.map((a) => a.questionId), async (tx) => {
        for (const a of items) await tx.mockAnswer.upsert({ where: { attemptId_questionId: { attemptId, questionId: a.questionId } }, update: { response: a.response }, create: { attemptId, questionId: a.questionId, response: a.response } });
        return { saved: items.length };
      });
    }
    await this.prisma.$transaction(
      items.map((a) =>
        this.prisma.mockAnswer.upsert({
          where: { attemptId_questionId: { attemptId, questionId: a.questionId } },
          update: { response: a.response },
          create: { attemptId, questionId: a.questionId, response: a.response },
        }),
      ),
    );
    return { saved: items.length };
  }

  /** POST /mock/attempts/:attemptId/speaking/:questionId — Speaking audio javobini yuklash */
  async uploadSpeaking(
    student: AuthUser,
    attemptId: string,
    questionId: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new AppException('NO_FILE', 'Audio fayl yuklanmadi', 400);
    try { return await this.persistSpeaking(student, attemptId, questionId, file); }
    catch (error) { this.storage.delete(`mock/${file.filename}`); throw error; }
  }

  private async persistSpeaking(student: AuthUser, attemptId: string, questionId: string, file: Express.Multer.File) {
    const attempt = await this.ownAttempt(student, attemptId);
    this.assertInProgress(attempt.status);
    if (attempt.specificationVersion !== MULTILEVEL_VERSION) this.assertNotTimedOut(attempt);
    await this.assertQuestionInCurrentSection(attempt.examId, questionId, attempt);

    const q = await this.prisma.mockQuestion.findFirst({
      where: { id: questionId, group: { section: { examId: attempt.examId, skill: 'speaking' } } },
      select: { id: true },
    });
    if (!q) {
      throw new AppException(
        'NOT_SPEAKING_QUESTION',
        'Bu savol speaking emas yoki imtihonga tegishli emas',
        400,
      );
    }
    const key = `mock/${file.filename}`;
    if (attempt.specificationVersion === MULTILEVEL_VERSION) {
      assertSpeakingAudio(file);
      return this.mutateVersionedAttempt(student, attemptId, [questionId], async (tx, fresh) => {
        if (fresh.mode === 'timed') {
          const state = fresh.mediaState as Record<string, MediaPhase> | null;
          const phase = state?.[questionId];
          // Upload grace accommodates transient network failure, but cannot
          // extend recording time or overwrite a finalized take.
          if (!phase || Date.now() < new Date(phase.prepEndsAt).getTime()) throw new AppException('RECORDING_NOT_STARTED', 'Start the speaking task first', 400);
          if (Date.now() > Date.parse(phase.expiresAt) + 5 * 60 * 1000) throw new AppException('UPLOAD_WINDOW_EXPIRED', 'The recording upload recovery window has expired', 400);
        }
        const saved = await tx.mockAnswer.findUnique({ where: { attemptId_questionId: { attemptId, questionId } } });
        if (saved?.audioKey && fresh.mode === 'timed') {
          this.storage.delete(key);
          return { saved: true, audioUrl: `${this.base}/mock/attempts/${attemptId}/answers/${questionId}/audio` };
        }
        await tx.mockAnswer.upsert({ where: { attemptId_questionId: { attemptId, questionId } }, update: { audioKey: key }, create: { attemptId, questionId, response: '', audioKey: key } });
        return { saved: true, audioUrl: `${this.base}/mock/attempts/${attemptId}/answers/${questionId}/audio` };
      }, true);
    }
    const existing = await this.prisma.mockAnswer.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
    });
    await this.prisma.mockAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: { audioKey: key },
      create: { attemptId, questionId, response: '', audioKey: key },
    });
    if (existing?.audioKey && existing.audioKey !== key) {
      this.storage.delete(existing.audioKey);
    }
    return {
      saved: true,
      audioUrl: `${this.base}/mock/attempts/${attemptId}/answers/${questionId}/audio`,
    };
  }

  /** PUT /mock/attempts/:attemptId/annotations — highlight/eslatmalarni saqlash */
  async saveAnnotations(student: AuthUser, attemptId: string, dto: SaveAnnotationsDto) {
    await this.ownAttempt(student, attemptId);
    await this.prisma.mockAttempt.update({
      where: { id: attemptId },
      data: { annotations: (dto.annotations ?? []) as Prisma.InputJsonValue },
    });
    return { saved: true };
  }

  /** POST /mock/attempts/:attemptId/flag-cheat — tab almashtirish signali */
  async flagCheat(student: AuthUser, attemptId: string, dto: FlagCheatDto) {
    const attempt = await this.ownAttempt(student, attemptId);
    if (attempt.status !== 'in_progress') return { saved: true };
    const count = await this.prisma.mockCheatEvent.count({ where: { attemptId } });
    if (count >= CHEAT_EVENT_CAP) return { saved: true };
    await this.prisma.$transaction([
      this.prisma.mockCheatEvent.create({ data: { attemptId, event: dto.event } }),
      this.prisma.mockAttempt.update({
        where: { id: attemptId },
        data: { antiCheatCount: { increment: 1 } },
      }),
    ]);
    return { saved: true };
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private async ownAttempt(student: AuthUser, attemptId: string): Promise<MockAttempt> {
    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.studentId !== student.id) {
      throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    }
    return attempt;
  }

  private async mutateVersionedAttempt<T>(student: AuthUser, attemptId: string, questionIds: string[], operation: (tx: Prisma.TransactionClient, attempt: MockAttempt) => Promise<T>, uploadGrace = false): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MockAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
      const fresh = await tx.mockAttempt.findUnique({ where: { id: attemptId } });
      if (!fresh || fresh.studentId !== student.id) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Attempt not found', 404);
      const profile = await tx.studentProfile.findUnique({ where: { userId: student.id } });
      if (!profile?.availablePrograms.includes('MULTILEVEL')) throw new AppException('PROGRAM_NOT_ENROLLED', 'Not enrolled in Multilevel', 403);
      this.assertInProgress(fresh.status);
      if (!uploadGrace) this.assertNotTimedOut(fresh);
      const qs = await tx.mockQuestion.findMany({ where: { id: { in: questionIds }, group: { section: { examId: fresh.examId } } }, select: { id: true, group: { select: { section: { select: { skill: true } } } } } });
      if (qs.length !== new Set(questionIds).size || (fresh.flowMode === 'full_test' && qs.some((q) => q.group.section.skill !== fresh.currentSkill))) throw new AppException('SECTION_LOCKED', 'Question outside current section', 403);
      return operation(tx, fresh);
    });
  }

  /** Durable server-issued media phases, reused by web and Tauri clients. */
  async startMediaPhase(student: AuthUser, attemptId: string, entityId: string, kind: 'listening' | 'speaking', play = false) {
    const attempt = await this.ownAttempt(student, attemptId);
    if (attempt.specificationVersion !== MULTILEVEL_VERSION) throw new AppException('SPECIFICATION_UNSUPPORTED', 'Multilevel task required', 400);
    const exam = await this.prisma.mockExam.findUniqueOrThrow({ where: { id: attempt.examId }, include: MOCK_EXAM_INCLUDE });
    const section = exam.sections.find((s) => s.skill === kind);
    const groups = section?.groups ?? [];
    const gi = groups.findIndex((g) => kind === 'listening' ? g.id === entityId : g.questions.some((q) => q.id === entityId));
    const group = groups[gi];
    if (!group) throw new AppException('QUESTION_NOT_IN_EXAM', 'Media task not in exam', 400);
    const qi = group.questions.findIndex((q) => q.id === entityId);
    const guidance = taskGuidance(kind, gi, qi, attempt.speakingProfileVersion);
    const ids = kind === 'speaking' ? [entityId] : group.questions.map((q) => q.id);
    return this.mutateVersionedAttempt(student, attemptId, ids, async (tx, fresh) => {
      const now = Date.now();
      const state = (fresh.mediaState as Record<string, MediaPhase> | null) ?? {};
      let phase = state[entityId];
      if (!phase || fresh.mode === 'practice') {
        if (fresh.mode === 'timed' && kind === 'listening' && gi > 0) {
          const previous = state[groups[gi-1].id];
          if (!previous || previous.plays < MULTILEVEL_AUDIO.playLimit || now < new Date(previous.expiresAt).getTime()) throw new AppException('PART_LOCKED', 'Complete the previous listening part first', 403);
        }
        if (fresh.mode === 'timed' && kind === 'speaking') {
          const ordered = groups.flatMap((g) => g.questions);
          const index = ordered.findIndex((q) => q.id === entityId);
          if (index > 0) {
            const previous = state[ordered[index-1].id];
            if (!previous || now < new Date(previous.expiresAt).getTime()) throw new AppException('PART_LOCKED', 'Complete the previous speaking response first', 403);
          }
        }
        if (kind === 'speaking' && fresh.speakingProfileVersion === BESTWAY_MULTILEVEL_SPEAKING_2026_V2) {
          const ordered = groups.flatMap((g) => g.questions);
          const index = ordered.findIndex((q) => q.id === entityId);
          if (index > 0) {
            const prior = await tx.mockAnswer.findUnique({ where: { attemptId_questionId: { attemptId, questionId: ordered[index - 1].id } } });
            if (!prior?.audioKey) throw new AppException('PREVIOUS_UPLOAD_PENDING', 'Wait for the previous recording upload acknowledgement', 409);
          }
        }
        const prep = kind === 'listening' ? MULTILEVEL_AUDIO.previewSeconds : guidance?.prepSeconds ?? 0;
        const duration = kind === 'listening' ? group.audioDurationSec : guidance?.responseSeconds;
        if (!duration) throw new AppException('MEDIA_DURATION_REQUIRED', 'Media duration required', 400);
        phase = { startedAt: new Date(now).toISOString(), prepEndsAt: new Date(now+prep*1000).toISOString(), expiresAt: new Date(now+(prep+duration)*1000).toISOString(), plays: 0 };
      }
      if (kind === 'listening' && play) {
        if (now < new Date(phase.prepEndsAt).getTime() || (phase.plays > 0 && now < new Date(phase.expiresAt).getTime())) throw new AppException('PREVIEW_ACTIVE', 'Wait for the preview/current playback to finish', 403);
        if (phase.plays >= MULTILEVEL_AUDIO.playLimit) throw new AppException('AUDIO_REPLAY_BLOCKED', 'Audio plays twice in Multilevel', 403);
        phase = { ...phase, plays: phase.plays+1, expiresAt: new Date(now+group.audioDurationSec!*1000).toISOString() };
      }
      await tx.mockAttempt.update({ where: { id: attemptId }, data: { mediaState: { ...state, [entityId]: phase } as unknown as Prisma.InputJsonValue } });
      return { ...phase, serverTime: new Date().toISOString(), playLimit: MULTILEVEL_AUDIO.playLimit };
    });
  }

  private assertInProgress(status: string): void {
    if (status !== 'in_progress') {
      throw new AppException('MOCK_ATTEMPT_FINISHED', 'Bu urinish allaqachon yakunlangan', 400);
    }
  }

  /** Vaqtli rejimda muddat o'tgan bo'lsa javob qabul qilinmaydi (yakunlang) */
  private assertNotTimedOut(attempt: MockAttempt): void {
    const now = Date.now();
    const overall = attempt.overallDeadlineAt ?? attempt.deadlineAt;
    if (attempt.mode === 'timed' && overall && now > overall.getTime()) {
      throw new AppException('MOCK_TIME_UP', 'Vaqt tugadi — imtihonni yakunlang', 400);
    }
    // Joriy bo'lim deadline (currentSkill o'rnatilgan bo'lsa — flowMode dan
    // qat'iy nazar; single_skill urinishlarda currentSkill null bo'ladi va
    // umumiy deadlineAt tekshiruvi yuqorida ishlaydi; eski urinishlar ham
    // shu fallback orqali buzilmasdan ishlaydi).
    if (attempt.currentSkill) {
      const deadlines = (attempt.sectionDeadlines as SectionDeadlines | null) ?? null;
      const iso = deadlines?.[attempt.currentSkill as keyof SectionDeadlines];
      if (iso && now > new Date(iso).getTime()) {
        throw new AppException('MOCK_SECTION_TIME_UP', 'Bo‘lim vaqti tugadi — keyingi bo‘limga o‘ting', 400);
      }
    } else if (attempt.mode === 'timed' && attempt.deadlineAt && now > attempt.deadlineAt.getTime()) {
      throw new AppException('MOCK_TIME_UP', 'Vaqt tugadi — imtihonni yakunlang', 400);
    }
  }

  /** Full-test strict: faqat joriy bo'lim savollariga javob (orqaga/oldinga yo'q, qaror #4). */
  private async assertQuestionInCurrentSection(examId: string, questionId: string, attempt: MockAttempt): Promise<void> {
    if (attempt.flowMode !== 'full_test' || !attempt.currentSkill) return;
    const q = await this.prisma.mockQuestion.findFirst({
      where: { id: questionId, group: { section: { examId } } },
      select: { group: { select: { section: { select: { skill: true } } } } },
    });
    if (!q) {
      throw new AppException('QUESTION_NOT_IN_EXAM', 'Savol bu imtihonga tegishli emas', 400);
    }
    if (q.group.section.skill !== attempt.currentSkill) {
      throw new AppException('SECTION_LOCKED', 'Hozir faqat joriy bo‘limga javob beriladi', 403);
    }
  }

  private async assertQuestionInExam(examId: string, questionId: string): Promise<void> {
    const q = await this.prisma.mockQuestion.findFirst({
      where: { id: questionId, group: { section: { examId } } },
      select: { id: true },
    });
    if (!q) {
      throw new AppException('QUESTION_NOT_IN_EXAM', 'Savol bu imtihonga tegishli emas', 400);
    }
  }
}
