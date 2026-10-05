import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MockAttemptService } from './mock-attempt.service';
import { multilevelFixture } from './multilevel.fixture';
import { BlueprintSection, MULTILEVEL_VERSION } from './multilevel-specification';

function setup(type: 'ielts_academic' | 'multilevel', profile = 'practice') {
  const skeleton: BlueprintSection[] = type === 'multilevel' ? multilevelFixture() : [{ skill: 'reading', groups: [{ sortOrder: 0, passageText: 'Original passage.', questions: [{ type: 'short_answer', points: 1, options: [], wordLimit: 1 }] }] }];
  const exam = {
    id: 'exam', type, profile, contentVersion: 1, isPublished: false, isDemo: true,
    specificationVersion: type === 'multilevel' ? MULTILEVEL_VERSION : null,
    speakingProfileVersion: null, title: 'Original exam', description: null, level: null,
    createdAt: new Date(), updatedAt: new Date(),
    sections: skeleton.map((section, index) => ({ ...section, id: `section-${index}`, sortOrder: index, title: null, instructions: null, durationMinutes: null,
      groups: section.groups.map((group, gi) => ({ ...group, id: `group-${index}-${gi}`, title: null, instructions: null, passageText: group.passageText ?? null,
        contentHtml: null, audioScript: null, contentLayout: null, audioKey: group.audioKey ?? null, imageKey: group.imageKey ?? null,
        partNumber: group.partNumber ?? null, audioDurationSec: group.audioDurationSec ?? null, audioPlayLimit: 1,
        questions: group.questions.map((question, qi) => ({ ...question, id: `question-${index}-${gi}-${qi}`, number: qi + 1, sortOrder: qi,
          prompt: 'Original question.', correctAnswers: ['original'], acceptedVariants: [] })),
      })),
    })),
  };
  const current = { contentVersion: 1, isPublished: false, isDemo: true };
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async () => [{ ...current }]),
    mockAttempt: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'attempt', status: 'in_progress', startedAt: new Date(), answers: [], ...data })),
    },
  };
  const prisma = {
    mockExam: { findUnique: vi.fn().mockImplementation(async () => structuredClone(exam)) },
    $transaction: vi.fn().mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const service = new MockAttemptService(prisma as never, { assertCanStart: vi.fn() } as never, {} as never, { get: () => undefined } as never);
  const student = { id: 'student', role: 'student', studentProfile: { isApproved: true } } as never;
  const raced = { id: 'winning-attempt', studentId: 'student', examId: 'exam', status: 'in_progress', mode: 'practice', startedAt: new Date(),
    specificationVersion: exam.specificationVersion, speakingProfileVersion: null, answers: [{ questionId: 'saved-question', response: 'saved response' }] };
  return { service, student, exam, current, tx, prisma, raced };
}

describe.each(['ielts_academic', 'multilevel'] as const)('%s exam definition handoff', (type) => {
  it('rejects an edited demo definition before creating an attempt', async () => {
    const { service, student, current, tx } = setup(type);
    current.contentVersion = 2;
    await expect(service.start(student, 'exam', { mode: 'practice' })).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT', status: 409 });
    expect(tx.mockAttempt.create).not.toHaveBeenCalled();
  });

  it('rejects changes between initial validation and insertion rather than resuming an old shape', async () => {
    const { service, student, tx, raced } = setup(type);
    tx.$queryRaw.mockResolvedValueOnce([{ contentVersion: 1, isPublished: false, isDemo: true }])
      .mockResolvedValueOnce([{ contentVersion: 2, isPublished: false, isDemo: true }]);
    tx.mockAttempt.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(raced);
    await expect(service.start(student, 'exam', { mode: 'practice' })).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT' });
    expect(tx.mockAttempt.create).not.toHaveBeenCalled();
  });

  it('retains the full-test flow and each program timing after a stable handoff', async () => {
    const { service, student } = setup(type, 'full_mock');
    const result = await service.start(student, 'exam', { flow: 'full_test' });
    expect(result).toMatchObject({ attemptId: 'attempt', resumed: false, mode: 'timed', flowMode: 'full_test', currentSkill: 'listening' });
    expect(result.exam.contentVersion).toBe(1);
    expect(Boolean((result.sectionDeadlines as Record<string, string>).speaking)).toBe(type === 'multilevel');
  });

  it('resumes the winner of a simultaneous start with the same definition and saved answers', async () => {
    const { service, student, tx, raced } = setup(type);
    tx.mockAttempt.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(raced);
    const result = await service.start(student, 'exam', { mode: 'practice' });
    expect(result).toMatchObject({ attemptId: 'winning-attempt', resumed: true, savedAnswers: { 'saved-question': 'saved response' } });
    expect(tx.mockAttempt.create).not.toHaveBeenCalled();
  });

  it('denies content whose demo visibility was withdrawn after loading', async () => {
    const { service, student, current, tx } = setup(type);
    current.isDemo = false;
    await expect(service.start(student, 'exam', { mode: 'practice' })).rejects.toMatchObject({ code: 'MOCK_EXAM_NOT_PUBLISHED' });
    expect(tx.mockAttempt.create).not.toHaveBeenCalled();
  });
});

describe('start conflict handling and historical resume', () => {
  it('preserves the original Multilevel attempt contract when resuming a historical attempt', async () => {
    const { service, student, exam, tx, raced } = setup('multilevel');
    exam.specificationVersion = null;
    tx.mockAttempt.findFirst.mockResolvedValue({ ...raced, specificationVersion: null });
    const result = await service.start(student, 'exam', { mode: 'practice' });
    expect(result).toMatchObject({ resumed: true, savedAnswers: { 'saved-question': 'saved response' } });
    expect(tx.mockAttempt.create).not.toHaveBeenCalled();
  });

  it.each([
    new Prisma.PrismaClientKnownRequestError('Transaction conflict', { code: 'P2034', clientVersion: '5.22.0' }),
    new Prisma.PrismaClientKnownRequestError('Snapshot conflict', { code: 'P2010', clientVersion: '5.22.0', meta: { code: '40001' } }),
  ])('returns a reload conflict for database serialization failures', async (error) => {
    const { service, student, prisma, tx } = setup('ielts_academic');
    prisma.$transaction.mockRejectedValueOnce(error);
    await expect(service.start(student, 'exam', { mode: 'practice' })).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT', status: 409 });
    expect(tx.mockAttempt.create).not.toHaveBeenCalled();
  });
});
