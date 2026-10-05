import { Injectable } from '@nestjs/common';
import { Prisma, Question, TestSection } from '@prisma/client';
import { randomInt } from 'crypto';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { Paginated } from '../common/pagination';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { ExamProgramService } from '../common/exam-program.service';
import { DemoSubmitDto, CreateQuestionDto, CreateTestDto, ImportQuestionsDto, QueryTestsDto, SubmitAnswerDto, FlagCheatDto, SaveMarksDto, UpdateQuestionDto, UpdateTestDto } from './dto/tests.dto';
import { deleteTestAudio, streamTestAudio, testAudioExists } from './tests-storage';
import { parseTestImport } from './test-import-parser';

export const MANUAL_SECTIONS: TestSection[] = ['writing', 'speaking'];
export const SECTION_ORDER: TestSection[] = ['listening', 'reading', 'writing', 'speaking'];

@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly programs: ExamProgramService,
  ) {}

  // ---------------- Savollar bazasi CRUD (admin) ----------------

  async createTest(actor: AuthUser, dto: CreateTestDto) {
    const test = await this.prisma.test.create({
      data: {
        type: dto.type,
        title: dto.title,
        level: dto.level,
        isDemo: dto.isDemo ?? false,
        durationMinutes: dto.durationMinutes,
        sectionQuestionCounts: dto.sectionQuestionCounts
          ? (dto.sectionQuestionCounts as Prisma.InputJsonValue)
          : undefined,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'test.create',
      entity: 'test',
      entityId: test.id,
      newValue: { title: test.title, type: test.type },
    });
    return test;
  }

  async updateTest(actor: AuthUser, id: string, dto: UpdateTestDto) {
    const test = await this.prisma.test.findUnique({ where: { id } });
    if (!test) throw new AppException('TEST_NOT_FOUND', 'Test topilmadi', 404);
    const updated = await this.prisma.test.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.level !== undefined ? { level: dto.level } : {}),
        ...(dto.isDemo !== undefined ? { isDemo: dto.isDemo } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
        ...(dto.sectionQuestionCounts !== undefined
          ? { sectionQuestionCounts: dto.sectionQuestionCounts as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'test.update',
      entity: 'test',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async addQuestion(actor: AuthUser, testId: string, dto: CreateQuestionDto) {
    const test = await this.prisma.test.findUnique({ where: { id: testId } });
    if (!test) throw new AppException('TEST_NOT_FOUND', 'Test topilmadi', 404);

    const isManual = MANUAL_SECTIONS.includes(dto.section);
    if (!isManual && !dto.correctAnswer) {
      throw new AppException(
        'CORRECT_ANSWER_REQUIRED',
        "Listening/Reading savollari uchun to'g'ri javob majburiy (avtomatik baholash)",
        400,
      );
    }
    if (dto.type === 'multiple_choice' && (!dto.options || dto.options.length < 2)) {
      throw new AppException('OPTIONS_REQUIRED', "Variantlar kamida 2 ta bo'lsin", 400);
    }

    const question = await this.prisma.question.create({
      data: {
        testId,
        section: dto.section,
        type: dto.type,
        prompt: dto.prompt,
        options: dto.options ? (dto.options as Prisma.InputJsonValue) : undefined,
        correctAnswer: dto.correctAnswer,
        maxScore: dto.maxScore ?? 1,
        // New comfortable testing fields (nullable — safe for old DB)
        ...(dto.passageText !== undefined ? { passageText: dto.passageText } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
        ...(dto.audioUrl !== undefined ? { audioUrl: dto.audioUrl } : {}),
      } as any,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'question.create',
      entity: 'question',
      entityId: question.id,
      newValue: { testId, section: dto.section },
    });
    return question;
  }

  previewQuestionImport(dto: ImportQuestionsDto) {
    return parseTestImport(dto.text, dto.defaultSection);
  }

  async importQuestions(actor: AuthUser, testId: string, dto: ImportQuestionsDto) {
    const parsed = parseTestImport(dto.text, dto.defaultSection);
    if (parsed.errors.length) {
      throw new AppException('TEST_IMPORT_INVALID', parsed.errors[0].message, 400);
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const test = await tx.test.findUnique({ where: { id: testId }, select: { id: true } });
      if (!test) throw new AppException('TEST_NOT_FOUND', 'Test topilmadi', 404);
      await tx.question.createMany({
        data: parsed.questions.map(({ number: _number, line: _line, options, ...question }) => ({
          ...question,
          testId,
          options: options ? (options as Prisma.InputJsonValue) : undefined,
        })),
      });
      return { added: parsed.questions.length, sectionCounts: parsed.sectionCounts };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.audit.log({
      userId: actor.id,
      action: 'questions.import',
      entity: 'test',
      entityId: testId,
      newValue: result,
    });
    return result;
  }

  async updateQuestion(actor: AuthUser, questionId: string, dto: UpdateQuestionDto) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw new AppException('QUESTION_NOT_FOUND', 'Savol topilmadi', 404);
    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        ...(dto.section !== undefined ? { section: dto.section } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.prompt !== undefined ? { prompt: dto.prompt } : {}),
        ...(dto.options !== undefined
          ? { options: dto.options as Prisma.InputJsonValue }
          : {}),
        ...(dto.correctAnswer !== undefined ? { correctAnswer: dto.correctAnswer } : {}),
        ...(dto.maxScore !== undefined ? { maxScore: dto.maxScore } : {}),
        ...(dto.passageText !== undefined ? { passageText: dto.passageText } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
        ...(dto.audioUrl !== undefined ? { audioUrl: dto.audioUrl } : {}),
      } as any,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'question.update',
      entity: 'question',
      entityId: questionId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async deleteQuestion(actor: AuthUser, questionId: string) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw new AppException('QUESTION_NOT_FOUND', 'Savol topilmadi', 404);
    // Delete associated audio file if exists (best-effort)
    const qAny = question as any;
    if (qAny.audioUrl) {
      try {
        deleteTestAudio(qAny.audioUrl);
      } catch {}
    }
    await this.prisma.question.delete({ where: { id: questionId } });
    await this.audit.log({
      userId: actor.id,
      action: 'question.delete',
      entity: 'question',
      entityId: questionId,
      oldValue: { testId: question.testId, prompt: question.prompt },
    });
    return { deleted: true };
  }

  // ---------------- Media: Question audio ----------------

  async setQuestionAudio(actor: AuthUser, questionId: string, file: Express.Multer.File) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw new AppException('QUESTION_NOT_FOUND', 'Savol topilmadi', 404);
    if (!file) throw new AppException('NO_FILE', 'Audio fayl yuklanmadi', 400);
    const qAny = question as any;
    if (qAny.audioUrl) {
      try {
        deleteTestAudio(qAny.audioUrl);
      } catch {}
    }
    const key = `tests/${file.filename}`;
    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: { audioUrl: key } as any,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'question.audio.upload',
      entity: 'question',
      entityId: questionId,
      newValue: { audioUrl: key },
    });
    return {
      id: updated.id,
      audioUrl: (updated as any).audioUrl,
      audioEndpoint: `/v1/tests/questions/${questionId}/audio`,
      hasAudio: true,
    };
  }

  async streamQuestionAudio(questionId: string, req: Request, res: Response) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { test: { select: { isDemo: true, isActive: true } } },
    });
    if (!question) throw new AppException('QUESTION_NOT_FOUND', 'Savol topilmadi', 404);
    const qAny = question as any;
    const key: string | null | undefined = qAny.audioUrl;
    if (!key || !testAudioExists(key)) {
      throw new AppException('FILE_NOT_FOUND', 'Audio topilmadi', 404);
    }
    // Demo test audio is public; non-demo still streams but via same endpoint (auth handled by guard if needed)
    streamTestAudio(key, req, res);
  }

  // ---------------- Ro'yxat / tafsilot ----------------

  /** Mehmon va ota-ona faqat demo testlarni ko'radi; xodimlar hammasini — endi paginated */
  async list(viewer: AuthUser | undefined, q: QueryTestsDto) {
    const isStaff =
      viewer && (viewer.role === 'admin' || viewer.role === 'super_admin' || viewer.role === 'teacher');
    const where: Prisma.TestWhereInput = {
      ...(q.type ? { type: q.type } : {}),
      ...(isStaff ? {} : { isActive: true }),
      ...(!viewer || viewer.role === 'parent' ? { isDemo: true } : {}),
    };
    if (viewer?.role === 'student') {
      const active = await this.programs.active(viewer.id, q.program);
      where.AND = [{ type: active === 'MULTILEVEL' ? 'multilevel' : active === 'IELTS' ? 'ielts' : { in: [] } }];
    }
    const [total, tests] = await Promise.all([
      this.prisma.test.count({ where }),
      this.prisma.test.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.limit,
        include: { _count: { select: { questions: true } } },
      }),
    ]);

    const sections = tests.length
      ? await this.prisma.question.groupBy({
          by: ['testId', 'section'],
          where: { testId: { in: tests.map((t) => t.id) } },
        })
      : [];
    const secMap = new Map<string, TestSection[]>();
    for (const s of sections) {
      const arr = secMap.get(s.testId) ?? [];
      arr.push(s.section);
      secMap.set(s.testId, arr);
    }

    const items = tests.map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      level: t.level,
      isDemo: t.isDemo,
      isActive: t.isActive,
      durationMinutes: t.durationMinutes,
      questionCount: t._count.questions,
      sections: SECTION_ORDER.filter((s) => (secMap.get(t.id) ?? []).includes(s)),
    }));
    return new Paginated(items, { page: q.page, limit: q.limit, total });
  }

  /** Demo testlar ro'yxati — faqat isDemo && isActive, guest-friendly */
  async listDemo(q: QueryTestsDto) {
    const where: Prisma.TestWhereInput = {
      isDemo: true,
      isActive: true,
      ...(q.type ? { type: q.type } : {}),
    };
    const [total, tests] = await Promise.all([
      this.prisma.test.count({ where }),
      this.prisma.test.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.limit,
        include: { _count: { select: { questions: true } } },
      }),
    ]);
    const sections = tests.length
      ? await this.prisma.question.groupBy({
          by: ['testId', 'section'],
          where: { testId: { in: tests.map((t) => t.id) } },
        })
      : [];
    const secMap = new Map<string, TestSection[]>();
    for (const s of sections) {
      const arr = secMap.get(s.testId) ?? [];
      arr.push(s.section);
      secMap.set(s.testId, arr);
    }
    const items = tests.map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      level: t.level,
      isDemo: t.isDemo,
      isActive: t.isActive,
      durationMinutes: t.durationMinutes,
      questionCount: t._count.questions,
      sections: SECTION_ORDER.filter((s) => (secMap.get(t.id) ?? []).includes(s)),
    }));
    return new Paginated(items, { page: q.page, limit: q.limit, total });
  }

  /** Demo test tafsiloti — savollar audio/passage bilan, lekin correctAnswer siz */
  async getDemo(id: string) {
    const test = await this.prisma.test.findUnique({
      where: { id },
      include: { questions: { orderBy: [{ section: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!test || !test.isDemo || !test.isActive) throw new AppException('TEST_NOT_FOUND', 'Test topilmadi', 404);

    const meta = {
      id: test.id,
      type: test.type,
      title: test.title,
      level: test.level,
      isDemo: test.isDemo,
      isActive: test.isActive,
      durationMinutes: test.durationMinutes,
      sectionQuestionCounts: test.sectionQuestionCounts,
      questionCount: test.questions.length,
    };
    // For comfortable testing (Survey passage etc) we bundle questions via sanitize with new fields
    const questions = test.questions.map((q) => this.sanitize(q));
    // Also provide section overview
    const sections = SECTION_ORDER.filter((s) => test.questions.some((qq) => qq.section === s));
    return { ...meta, sections, questions };
  }

  /**
   * Guest demo scoring — DB yozmaydi, faqat autoScore hisoblaydi.
   * isCorrect mantig'i grading.service bilan bir xil: normalize + pipe split.
   */
  async scoreDemo(id: string, dto: DemoSubmitDto) {
    const test = await this.prisma.test.findUnique({
      where: { id },
      include: { questions: true },
    });
    if (!test || !test.isDemo || !test.isActive) throw new AppException('TEST_NOT_FOUND', 'Test topilmadi', 404);

    const answers = (dto.answers ?? {}) as Record<string, string>;
    let autoScore = 0;
    let totalMax = 0;
    let autoMax = 0;
    const perQuestion: Array<{
      questionId: string;
      section: string;
      isCorrect: boolean | null;
      score: number;
      maxScore: number;
      isGraded: boolean;
    }> = [];

    for (const q of test.questions) {
      totalMax += q.maxScore;
      const isManual = MANUAL_SECTIONS.includes(q.section as TestSection);
      if (isManual) {
        perQuestion.push({
          questionId: q.id,
          section: q.section,
          isCorrect: null,
          score: 0,
          maxScore: q.maxScore,
          isGraded: false,
        });
        continue;
      }
      autoMax += q.maxScore;
      const raw = answers[q.id] ?? '';
      const correct = q.correctAnswer ? this.isCorrect(String(raw), q.correctAnswer) : false;
      const score = correct ? q.maxScore : 0;
      autoScore += score;
      perQuestion.push({
        questionId: q.id,
        section: q.section,
        isCorrect: correct,
        score,
        maxScore: q.maxScore,
        isGraded: true,
      });
    }

    const correctCount = perQuestion.filter((p) => p.isCorrect === true).length;
    const autoCount = perQuestion.filter((p) => p.isGraded).length;
    return {
      testId: id,
      autoScore,
      totalScore: autoScore,
      totalMax,
      autoMax,
      correctCount,
      autoCount,
      perQuestion,
      // Bo'lim kesimida ham qulay
      bySection: SECTION_ORDER.filter((s) => perQuestion.some((p) => p.section === s)).map((sec) => {
        const slice = perQuestion.filter((p) => p.section === sec);
        const score = slice.reduce((sum, p) => sum + p.score, 0);
        const max = slice.reduce((sum, p) => sum + p.maxScore, 0);
        return { section: sec, score, max, count: slice.length };
      }),
    };
  }

  /** Xodimlar savollarni to'liq (javoblari bilan) ko'radi; o'quvchi faqat meta */
  async getOne(viewer: AuthUser, id: string) {
    const test = await this.prisma.test.findUnique({
      where: { id },
      include: { questions: { orderBy: [{ section: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!test) throw new AppException('TEST_NOT_FOUND', 'Test topilmadi', 404);

    const meta = {
      id: test.id,
      type: test.type,
      title: test.title,
      level: test.level,
      isDemo: test.isDemo,
      isActive: test.isActive,
      durationMinutes: test.durationMinutes,
      sectionQuestionCounts: test.sectionQuestionCounts,
      questionCount: test.questions.length,
    };
    const isStaff =
      viewer.role === 'admin' || viewer.role === 'super_admin' || viewer.role === 'teacher';
    if (!isStaff) return meta;
    return { ...meta, questions: test.questions };
  }

  // ---------------- O'quvchi oqimi ----------------

  /**
   * POST /tests/:id/start — savollar RANDOM tanlanadi va aralashtiriladi
   * (nusxa ko'chirishning oldini olish). Tugallanmagan urinish bo'lsa davom etadi.
   */
  async start(student: AuthUser, testId: string) {
    if (!student.studentProfile) {
      throw new AppException('NOT_A_STUDENT', "Faqat o'quvchi test topshira oladi", 403);
    }
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: { questions: true },
    });
    if (!test || !test.isActive) throw new AppException('TEST_NOT_FOUND', 'Test topilmadi', 404);
    await this.programs.assertAccess(student.id, test.type);

    // Resume: tugallanmagan urinish bor bo'lsa, o'sha savollar bilan davom ettiramiz
    const existing = await this.prisma.testAttempt.findFirst({
      where: { studentId: student.id, testId, status: 'in_progress' },
    });
    if (existing) {
      const order = existing.questionOrder as string[];
      const qMap = new Map(test.questions.map((q) => [q.id, q]));
      const questions = order
        .map((qid) => qMap.get(qid))
        .filter((q): q is Question => Boolean(q))
        .map((q) => this.sanitize(q));
      const answers = await this.prisma.answer.findMany({ where: { attemptId: existing.id } });
      return {
        attemptId: existing.id,
        resumed: true,
        durationMinutes: test.durationMinutes,
        startedAt: existing.startedAt,
        questions,
        savedAnswers: Object.fromEntries(answers.map((a) => [a.questionId, a.answer])),
        savedMarks: this.shapeMarks(answers),
      };
    }

    const counts = (test.sectionQuestionCounts ?? {}) as Record<string, number>;
    const chosen: Question[] = [];
    for (const section of SECTION_ORDER) {
      const pool = test.questions.filter((q) => q.section === section);
      if (pool.length === 0) continue;
      const shuffled = this.shuffle(pool);
      const limit = counts[section];
      const take = limit && limit > 0 ? Math.min(limit, shuffled.length) : shuffled.length;
      chosen.push(...shuffled.slice(0, take));
    }
    if (chosen.length === 0) {
      throw new AppException('TEST_EMPTY', "Bu testda hali savollar yo'q", 400);
    }

    const attempt = await this.prisma.testAttempt.create({
      data: {
        studentId: student.id,
        testId,
        questionOrder: chosen.map((q) => q.id),
      },
    });

    return {
      attemptId: attempt.id,
      resumed: false,
      durationMinutes: test.durationMinutes,
      startedAt: attempt.startedAt,
      questions: chosen.map((q) => this.sanitize(q)),
    };
  }

  /** POST /tests/attempts/:attemptId/answer — javobni saqlash (upsert) */
  async answer(student: AuthUser, attemptId: string, dto: SubmitAnswerDto) {
    const attempt = await this.ownAttempt(student, attemptId);
    if (attempt.status !== 'in_progress') {
      throw new AppException('ATTEMPT_FINISHED', 'Bu urinish allaqachon yakunlangan', 400);
    }
    this.assertNotTimedOut(attempt);
    const order = attempt.questionOrder as string[];
    if (!order.includes(dto.questionId)) {
      throw new AppException('QUESTION_NOT_IN_ATTEMPT', 'Savol bu urinishga tegishli emas', 400);
    }
    await this.prisma.answer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      update: { answer: dto.answer },
      create: { attemptId, questionId: dto.questionId, answer: dto.answer },
    });
    return { saved: true };
  }

  /**
   * POST /tests/attempts/:attemptId/marks — reading highlight + shaxsiy eslatma.
   * Javob matniga tegmaydi (answer upsert'dagi kabi saqlanib qoladi).
   * Faqat imtihon vaqtida (in_progress) — topshirilgach review read-only.
   */
  async saveMarks(student: AuthUser, attemptId: string, dto: SaveMarksDto) {
    const attempt = await this.ownAttempt(student, attemptId);
    if (attempt.status !== 'in_progress') {
      throw new AppException('ATTEMPT_FINISHED', 'Bu urinish allaqachon yakunlangan', 400);
    }
    this.assertNotTimedOut(attempt);
    const order = attempt.questionOrder as string[];
    if (!order.includes(dto.questionId)) {
      throw new AppException('QUESTION_NOT_IN_ATTEMPT', 'Savol bu urinishga tegishli emas', 400);
    }
    const highlights = (dto.highlights ?? [])
      .filter((h) => typeof h === 'string')
      .map((h) => h.trim())
      .filter((h) => h.length >= 2)
      .slice(0, 50)
      .map((h) => h.slice(0, 300));
    const data: { highlights: Prisma.InputJsonValue; note?: string | null } = {
      highlights: highlights as Prisma.InputJsonValue,
    };
    if (dto.note !== undefined) {
      data.note = dto.note.trim().slice(0, 2000) || null;
    }
    await this.prisma.answer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      update: data,
      create: { attemptId, questionId: dto.questionId, answer: '', ...data },
    });
    return { saved: true };
  }

  /** POST /tests/attempts/:attemptId/flag-cheat — tab almashtirish signali */
  async flagCheat(student: AuthUser, attemptId: string, dto: FlagCheatDto) {
    const attempt = await this.ownAttempt(student, attemptId);
    if (attempt.status !== 'in_progress') return { saved: true };
    // Flood himoyasi: urinishiga ko'pi bilan 50 ta signal
    const count = await this.prisma.antiCheatEvent.count({ where: { attemptId } });
    if (count >= 50) return { saved: true };
    await this.prisma.$transaction([
      this.prisma.antiCheatEvent.create({ data: { attemptId, event: dto.event } }),
      this.prisma.testAttempt.update({
        where: { id: attemptId },
        data: { antiCheatCount: { increment: 1 } },
      }),
    ]);
    return { saved: true };
  }

  // ---------------- Yordamchilar ----------------

  /** savedMarks: questionId -> {highlights, note} (faqat bo'sh bo'lmaganlar) */
  private shapeMarks(
    answers: { questionId: string; highlights: unknown; note: string | null }[],
  ): Record<string, { highlights: string[]; note: string | null }> {
    const out: Record<string, { highlights: string[]; note: string | null }> = {};
    for (const a of answers) {
      const highlights = Array.isArray(a.highlights)
        ? (a.highlights as unknown[]).filter((h): h is string => typeof h === 'string')
        : [];
      if (highlights.length === 0 && !a.note) continue;
      out[a.questionId] = { highlights, note: a.note };
    }
    return out;
  }

  private async ownAttempt(student: AuthUser, attemptId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: { test: { select: { durationMinutes: true } } },
    });
    if (!attempt || attempt.studentId !== student.id) {
      throw new AppException('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404);
    }
    return attempt;
  }

  /** Vaqtli testda muddat o'tgan bo'lsa javob qabul qilinmaydi (yakunlang) */
  private assertNotTimedOut(attempt: {
    startedAt: Date;
    test: { durationMinutes: number | null };
  }): void {
    const minutes = attempt.test.durationMinutes;
    if (!minutes || minutes <= 0) return;
    const deadline = attempt.startedAt.getTime() + minutes * 60_000;
    if (Date.now() > deadline) {
      throw new AppException('TEST_TIME_UP', 'Vaqt tugadi — imtihonni yakunlang', 400);
    }
  }

  private normalize(s: string): string {
    return s.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /** To'g'ri javob variantlari "|" bilan ajratiladi: "1987|nineteen eighty seven" */
  private isCorrect(answer: string, correctAnswer: string): boolean {
    const norm = this.normalize(answer);
    if (!norm) return false;
    return correctAnswer.split('|').some((v) => this.normalize(v) === norm);
  }

  /** Kriptografik random bilan aralashtirish (Fisher-Yates) */
  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** O'quvchiga yuboriladigan savol — to'g'ri javobsiz, lekin comfortable testing maydonlari bilan */
  private sanitize(q: Question) {
    const qAny = q as any;
    return {
      id: q.id,
      section: q.section,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      maxScore: q.maxScore,
      // Comfortable testing: passage/instructions har doim jo'natiladi (audioda URL bermaymiz — endpoint orqali)
      passageText: qAny.passageText ?? null,
      instructions: qAny.instructions ?? null,
      audioUrl: qAny.audioUrl ? `/v1/tests/questions/${q.id}/audio` : null,
      hasAudio: !!qAny.audioUrl,
    };
  }
}
