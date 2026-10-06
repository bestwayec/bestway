import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ExamProgramService } from '../common/exam-program.service';
import { MockAccessService } from './mock-access.service';
import { MockAttemptService } from './mock-attempt.service';
import { MockAuthoringService } from './mock-authoring.service';
import { multilevelFixture } from './multilevel.fixture';
import { MULTILEVEL_VERSION } from './multilevel-specification';

/**
 * This is deliberately a service-boundary test rather than a component test.
 * It uses one in-memory persistence facade to prove that the published
 * Multilevel definition accepted by authoring is the one exposed in the
 * student catalogue and accepted by attempt start.
 */
function setup() {
  const fixture = multilevelFixture();
  const exam = {
    id: 'multilevel-completion',
    type: 'multilevel',
    profile: 'full_mock',
    title: 'Multilevel completion verification',
    description: 'A complete test definition for the release candidate.',
    level: null,
    practiceLevel: null,
    assessmentPolicy: 'MANUAL_ONLY',
    specificationVersion: MULTILEVEL_VERSION,
    speakingProfileVersion: null,
    contentVersion: 1,
    createdById: 'teacher',
    isPublished: false,
    isDemo: false,
    price: 0,
    isFreeForApproved: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    sections: fixture.map((section, sectionIndex) => {
      let number = 0;
      return {
        ...section,
        id: `section-${section.skill}`,
        sortOrder: sectionIndex,
        title: null,
        instructions: null,
        durationMinutes: section.skill === 'listening' ? 45 : section.skill === 'reading' || section.skill === 'writing' ? 60 : 11,
        groups: section.groups.map((group, groupIndex) => ({
          ...group,
          id: `group-${section.skill}-${groupIndex}`,
          title: null,
          instructions: null,
          passageText: section.skill === 'reading' ? `Verified reading passage ${groupIndex + 1}.` : group.passageText ?? null,
          contentHtml: null,
          audioScript: null,
          contentLayout: null,
          optionsReusable: false,
          audioPlayLimit: 2,
          _count: { questions: group.questions.length },
          questions: group.questions.map((question, questionIndex) => {
            const objective = section.skill === 'listening' || section.skill === 'reading';
            const options = Array.isArray(question.options) ? question.options as string[] : [];
            const decision = question.type === 'true_false_notgiven' || question.type === 'yes_no_notgiven';
            return {
              ...question,
              id: `question-${section.skill}-${groupIndex}-${questionIndex}`,
              number: ++number,
              sortOrder: questionIndex,
              prompt: `Verified ${section.skill} question ${number}.`,
              options: objective ? options : [],
              correctAnswers: objective ? [decision ? 'TRUE' : options[questionIndex % options.length] ?? 'library'] : [],
              acceptedVariants: [],
              wordLimit: objective ? question.wordLimit : null,
              answerRule: null,
            };
          }),
        })),
      };
    }),
  };
  const attempts: Array<Record<string, unknown>> = [];
  const studentProfile = { availablePrograms: ['MULTILEVEL'], activeProgram: 'MULTILEVEL', isApproved: true };
  const transaction = {
    $queryRaw: vi.fn(async () => [{ contentVersion: exam.contentVersion, isPublished: exam.isPublished, isDemo: exam.isDemo }]),
    mockExam: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(exam, data)),
    },
    mockAttempt: {
      findFirst: vi.fn(async ({ where }: { where: { studentId: string; examId: string; status: string } }) =>
        attempts.find((attempt) => attempt.studentId === where.studentId && attempt.examId === where.examId && attempt.status === where.status) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const attempt = { id: `attempt-${attempts.length + 1}`, status: 'in_progress', startedAt: new Date(), answers: [], ...data };
        attempts.push(attempt);
        return attempt;
      }),
    },
  };
  const prisma = {
    mockExam: {
      findUnique: vi.fn(async () => exam),
      findMany: vi.fn(async () => [exam]),
    },
    mockAttempt: { count: vi.fn(async () => 0) },
    mockPurchase: { findMany: vi.fn(async () => []) },
    mockExamImport: { findMany: vi.fn(async () => []) },
    mockImportReviewIssue: { count: vi.fn(async () => 0) },
    studentProfile: { findUnique: vi.fn(async () => studentProfile) },
    $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) => work(transaction)),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const storage = { exists: vi.fn(() => true) };
  const programs = new ExamProgramService(prisma as never);
  const access = new MockAccessService(prisma as never, audit as never, {} as never, programs);
  const authoring = new MockAuthoringService(prisma as never, audit as never, storage as never, access, { get: () => undefined } as never);
  const attemptsService = new MockAttemptService(prisma as never, access, storage as never, { get: () => undefined } as never);
  const teacher = { id: 'teacher', role: 'teacher' } as never;
  const student = { id: 'student', role: 'student', studentProfile: { isApproved: true } } as never;
  return { authoring, attemptsService, teacher, student, exam, attempts };
}

describe('Multilevel publication-to-start journey', () => {
  it('publishes one ready blueprint, exposes it to an eligible student, and creates a full-test attempt', async () => {
    const { authoring, attemptsService, teacher, student, exam, attempts } = setup();

    const review = await authoring.readiness(teacher, exam.id);
    expect(review.ready).toBe(true);
    expect(review.items.find((item) => item.key === 'multilevel_blueprint')).toMatchObject({ ok: true });

    await authoring.updateExam(teacher, exam.id, { isPublished: true } as never);
    expect(exam.isPublished).toBe(true);

    const catalogue = await authoring.listExams(student, {} as never);
    expect(catalogue).toEqual([expect.objectContaining({
      id: exam.id, type: 'multilevel', isPublished: true, ready: true, access: 'granted', questionCount: 81,
    })]);

    const started = await attemptsService.start(student, exam.id, { flow: 'full_test' } as never);
    expect(started).toMatchObject({
      resumed: false, flowMode: 'full_test', currentSkill: 'listening',
      exam: { specificationVersion: MULTILEVEL_VERSION, questionCount: 81 },
    });
    expect(attempts).toHaveLength(1);
  });

  it('keeps Review, catalogue, and Start aligned when the persisted version is not startable', async () => {
    const { authoring, attemptsService, teacher, student, exam } = setup();
    exam.specificationVersion = 'LEGACY_MULTILEVEL_SPECIFICATION';
    exam.isPublished = true;

    const review = await authoring.readiness(teacher, exam.id);
    expect(review.ready).toBe(false);
    expect(review.items.find((item) => item.key === 'multilevel_start')).toMatchObject({ ok: false });

    const catalogue = await authoring.listExams(student, {} as never);
    expect(catalogue[0]).toMatchObject({ id: exam.id, ready: false });
    await expect(attemptsService.start(student, exam.id, { flow: 'full_test' } as never))
      .rejects.toMatchObject({ code: 'SPECIFICATION_UNSUPPORTED' });
  });
});
