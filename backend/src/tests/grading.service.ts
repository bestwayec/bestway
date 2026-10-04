import { Injectable } from '@nestjs/common';
import { AttemptStatus, Prisma, StudentProfile, TestAttempt, TestType } from '@prisma/client';
import { AccessService } from '../common/access.service';
import { ExamProgramService } from '../common/exam-program.service';
import { AppException } from '../common/app.exception';
import { Paginated } from '../common/pagination';
import { AuthUser } from '../common/types';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { GradeAnswerDto, QueryAttemptsDto } from './dto/tests.dto';
import { MANUAL_SECTIONS } from './tests.service';

type AttemptWithRefs = TestAttempt & {
  student?: (StudentProfile & { user: { name: string } }) | null;
  test?: { title: string; type: TestType } | null;
};

@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly programs: ExamProgramService = new ExamProgramService(prisma),
  ) {}

  private normalize(s: string): string {
    return s.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /** To'g'ri javob variantlari "|" bilan ajratiladi: "1987|nineteen eighty seven" */
  private isCorrect(answer: string, correctAnswer: string): boolean {
    const norm = this.normalize(answer);
    if (!norm) return false;
    return correctAnswer.split('|').some((v) => this.normalize(v) === norm);
  }

  /**
   * POST /tests/attempts/:attemptId/submit
   * Listening/Reading avtomatik baholanadi; Writing/Speaking javobi bo'lsa
   * urinish "grading" holatiga o'tadi va o'qituvchi paneliga tushadi.
   */
  async submit(student: AuthUser, attemptId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: { answers: { include: { question: true } }, test: true },
    });
    if (!attempt || attempt.studentId !== student.id) {
      throw new AppException('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    }
    if (attempt.status !== 'in_progress') {
      throw new AppException('ATTEMPT_FINISHED', 'Bu urinish allaqachon topshirilgan', 400);
    }

    let autoScore = 0;
    let hasManual = false;
    const updates: Prisma.PrismaPromise<unknown>[] = [];

    for (const a of attempt.answers) {
      if (MANUAL_SECTIONS.includes(a.question.section)) {
        if (a.answer.trim().length > 0) hasManual = true;
        continue;
      }
      const score =
        a.question.correctAnswer && this.isCorrect(a.answer, a.question.correctAnswer)
          ? a.question.maxScore
          : 0;
      autoScore += score;
      updates.push(
        this.prisma.answer.update({ where: { id: a.id }, data: { score, isGraded: true } }),
      );
    }

    const status: AttemptStatus = hasManual ? 'grading' : 'completed';
    updates.push(
      this.prisma.testAttempt.update({
        where: { id: attemptId },
        data: {
          status,
          autoScore,
          manualScore: hasManual ? null : 0,
          totalScore: hasManual ? null : autoScore,
          finishedAt: new Date(),
        },
      }),
    );
    await this.prisma.$transaction(updates);

    if (status === 'completed') {
      await this.notifyResult(attempt.studentId, attempt.test.title, autoScore);
    } else {
      // Guruh o'qituvchisiga: baholash kutilmoqda
      const profile = await this.prisma.studentProfile.findUnique({
        where: { userId: attempt.studentId },
        include: { group: { select: { teacherId: true } }, user: { select: { name: true } } },
      });
      if (profile?.group?.teacherId) {
        await this.notifications.notify(
          profile.group.teacherId,
          'test_result',
          `${profile.user.name} "${attempt.test.title}" testini topshirdi — Writing/Speaking baholashingiz kutilmoqda.`,
        );
      }
    }

    return { status, autoScore };
  }

  /**
   * POST /tests/attempts/:attemptId/grade — Writing/Speaking qo'lda baholash.
   * Barcha qo'lda savollar baholangach urinish avtomatik yakunlanadi.
   */
  async grade(teacher: AuthUser, attemptId: string, dto: GradeAnswerDto) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: { test: true },
    });
    if (!attempt) throw new AppException('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    if (attempt.status === 'in_progress') {
      throw new AppException('ATTEMPT_NOT_SUBMITTED', 'Test hali topshirilmagan', 400);
    }
    // O'qituvchi faqat o'z guruhidagi o'quvchini baholaydi (admin — hammani)
    await this.access.assertCanViewStudent(teacher, attempt.studentId);

    const question = await this.prisma.question.findUnique({ where: { id: dto.questionId } });
    if (!question || question.testId !== attempt.testId) {
      throw new AppException('QUESTION_NOT_IN_ATTEMPT', 'Savol bu urinishga tegishli emas', 400);
    }
    if (!MANUAL_SECTIONS.includes(question.section)) {
      throw new AppException('NOT_MANUAL_QUESTION', 'Bu savol avtomatik baholanadi', 400);
    }
    if (dto.score > question.maxScore) {
      throw new AppException(
        'SCORE_OUT_OF_RANGE',
        `Ball 0 dan ${question.maxScore} gacha bo'lishi kerak`,
        400,
      );
    }

    await this.prisma.answer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      update: {
        score: dto.score,
        isGraded: true,
        gradedById: teacher.id,
        comment: dto.comment ?? null,
      },
      create: {
        attemptId,
        questionId: dto.questionId,
        answer: '',
        score: dto.score,
        isGraded: true,
        gradedById: teacher.id,
        comment: dto.comment,
      },
    });

    await this.finalizeIfDone(attemptId);
    return { saved: true };
  }

  private async finalizeIfDone(attemptId: string): Promise<void> {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: { answers: { include: { question: true } }, test: true },
    });
    if (!attempt || attempt.status !== 'grading') return;

    const manual = attempt.answers.filter((a) => MANUAL_SECTIONS.includes(a.question.section));
    if (manual.some((a) => !a.isGraded)) return;

    const manualScore = manual.reduce((sum, a) => sum + (a.score ?? 0), 0);
    const totalScore = (attempt.autoScore ?? 0) + manualScore;
    await this.prisma.testAttempt.update({
      where: { id: attemptId },
      data: { status: 'completed', manualScore, totalScore },
    });
    await this.notifyResult(attempt.studentId, attempt.test.title, totalScore);
  }

  private async notifyResult(studentId: string, testTitle: string, score: number): Promise<void> {
    await this.notifications.notify(
      studentId,
      'test_result',
      `Test natijangiz tayyor: "${testTitle}" — ${score} ball.`,
    );
    await this.notifications.notifyParents(
      studentId,
      'test_result',
      `Farzandingizning "${testTitle}" test natijasi: ${score} ball.`,
    );
  }

  // ---------------- Urinishlar ro'yxati / tafsiloti ----------------

  /** O'qituvchining baholash paneli va admin monitoring uchun */
  async listAttempts(viewer: AuthUser, q: QueryAttemptsDto) {
    const where: Prisma.TestAttemptWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.testId ? { testId: q.testId } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
    };
    if (viewer.role === 'teacher') {
      where.student = { group: { teacherId: viewer.id } };
    }
    const [total, rows] = await Promise.all([
      this.prisma.testAttempt.count({ where }),
      this.prisma.testAttempt.findMany({
        where,
        include: {
          student: { include: { user: { select: { name: true } } } },
          test: { select: { title: true, type: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
    ]);
    return new Paginated(
      rows.map((a) => this.attemptSummary(a)),
      { page: q.page, limit: q.limit, total },
    );
  }

  /** O'quvchining o'z natijalari tarixi */
  async myAttempts(student: AuthUser, q: QueryAttemptsDto) {
    const active = await this.programs.active(student.id, q.program);
    const where: Prisma.TestAttemptWhereInput = {
      studentId: student.id,
      test: { type: active === 'MULTILEVEL' ? 'multilevel' : active === 'IELTS' ? 'ielts' : { in: [] } },
      ...(q.status ? { status: q.status } : {}),
      ...(q.testId ? { testId: q.testId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.testAttempt.count({ where }),
      this.prisma.testAttempt.findMany({
        where,
        include: { test: { select: { title: true, type: true } } },
        orderBy: { startedAt: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
    ]);
    return new Paginated(
      rows.map((a) => this.attemptSummary(a)),
      { page: q.page, limit: q.limit, total },
    );
  }

  /** Urinish tafsiloti: savollar + javoblar (+ xodimlar uchun to'g'ri javob va anti-cheat) */
  async getAttempt(viewer: AuthUser, attemptId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        answers: true,
        test: { include: { questions: true } },
        student: { include: { user: { select: { name: true } } } },
        cheatEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!attempt) throw new AppException('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.access.assertCanViewStudent(viewer, attempt.studentId);

    const isStaff =
      viewer.role === 'teacher' || viewer.role === 'admin' || viewer.role === 'super_admin';
    const isOwner = viewer.id === attempt.studentId;
    // Students may review correct answers only AFTER grading completes
    // (never mid-exam or while manual grading is pending — prevents leaks).
    // Writing/Speaking stay manual-only (no correctAnswer).
    const showCorrect = isStaff || (isOwner && attempt.status === 'completed');
    const answerByQ = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const qMap = new Map(attempt.test.questions.map((qq) => [qq.id, qq]));
    const order = attempt.questionOrder as string[];

    const questions = order
      .map((qid, i) => {
        const question = qMap.get(qid);
        if (!question) return null;
        const ans = answerByQ.get(qid);
        const qAny = question as any;
        const isAuto = !MANUAL_SECTIONS.includes(question.section);
        const correct =
          showCorrect && isAuto && question.correctAnswer
            ? this.isCorrect(ans?.answer ?? '', question.correctAnswer)
            : null;
        return {
          order: i + 1,
          questionId: qid,
          section: question.section,
          type: question.type,
          prompt: question.prompt,
          options: question.options,
          maxScore: question.maxScore,
          // Comfortable testing fields — grading view also needs them
          passageText: qAny.passageText ?? null,
          instructions: qAny.instructions ?? null,
          hasAudio: !!qAny.audioUrl,
          audioUrl: qAny.audioUrl ? `/v1/tests/questions/${qid}/audio` : null,
          ...(showCorrect && isAuto ? { correctAnswer: question.correctAnswer } : {}),
          ...(correct != null ? { isCorrect: correct } : {}),
          // Exam-time reading aids — owner + staff only (same visibility as answers).
          ...((isOwner || isStaff)
            ? {
                highlights: Array.isArray(ans?.highlights)
                  ? (ans.highlights as unknown[]).filter((h): h is string => typeof h === 'string')
                  : [],
                note: ans?.note ?? null,
              }
            : {}),
          answer: ans?.answer ?? null,
          score: ans?.score ?? null,
          isGraded: ans?.isGraded ?? false,
          comment: ans?.comment ?? null,
        };
      })
      .filter(Boolean);

    return {
      ...this.attemptSummary(attempt),
      questions,
      ...(isStaff
        ? { cheatEvents: attempt.cheatEvents.map((e) => ({ event: e.event, date: e.createdAt })) }
        : {}),
    };
  }

  /** Sertifikat uchun ma'lumot: bo'limlar kesimida ball */
  async certificateData(viewer: AuthUser, attemptId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        answers: true,
        test: { include: { questions: true } },
        student: { include: { user: { select: { name: true } } } },
      },
    });
    if (!attempt) throw new AppException('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    await this.access.assertCanViewStudent(viewer, attempt.studentId);
    if (attempt.status !== 'completed') {
      throw new AppException('ATTEMPT_NOT_COMPLETED', 'Natija hali tayyor emas', 400);
    }

    const answerByQ = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const qMap = new Map(attempt.test.questions.map((qq) => [qq.id, qq]));
    const order = attempt.questionOrder as string[];

    const agg = new Map<string, { score: number; maxScore: number }>();
    for (const qid of order) {
      const question = qMap.get(qid);
      if (!question) continue;
      const entry = agg.get(question.section) ?? { score: 0, maxScore: 0 };
      entry.maxScore += question.maxScore;
      entry.score += answerByQ.get(qid)?.score ?? 0;
      agg.set(question.section, entry);
    }

    const sections = [...agg.entries()].map(([section, v]) => ({
      section,
      score: v.score,
      maxScore: v.maxScore,
    }));
    const totalMax = sections.reduce((s, x) => s + x.maxScore, 0);

    return {
      studentName: attempt.student.user.name,
      testTitle: attempt.test.title,
      testType: attempt.test.type,
      level: attempt.test.level,
      finishedAt: attempt.finishedAt ?? new Date(),
      attemptId: attempt.id,
      sections,
      totalScore: attempt.totalScore ?? 0,
      totalMax,
    };
  }

  private attemptSummary(a: AttemptWithRefs) {
    return {
      id: a.id,
      studentId: a.studentId,
      studentName: a.student?.user.name,
      testId: a.testId,
      testTitle: a.test?.title,
      testType: a.test?.type,
      status: a.status,
      autoScore: a.autoScore,
      manualScore: a.manualScore,
      totalScore: a.totalScore,
      antiCheatCount: a.antiCheatCount,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
    };
  }
}
