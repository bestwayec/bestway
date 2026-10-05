import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MockAttemptService } from './mock-attempt.service';

function setup(profile: string) {
  const exam = {
    id: 'exam-1', profile, contentVersion: 1, isPublished: true, isDemo: false, price: 0,
    type: 'ielts_academic', title: 'T', description: null, level: null,
    isDemo2: undefined, createdAt: new Date(), updatedAt: new Date(),
    sections: [{
      id: 'sec', skill: 'listening', title: null, sortOrder: 0,
      durationMinutes: null, instructions: null,
      groups: [{
        id: 'grp', sortOrder: 0, title: null, instructions: null, passageText: null,
        contentHtml: null, audioScript: null, contentLayout: null, audioKey: 'mock/a.mp3',
        imageKey: null, partNumber: 1, audioDurationSec: 60, audioPlayLimit: 1,
        questions: [{
          id: 'q', number: 1, sortOrder: 0, type: 'short_answer', prompt: 'Q?',
          options: [], correctAnswers: ['a'], acceptedVariants: [], points: 1, wordLimit: null,
        }],
      }],
    }],
  };
  const prisma = {
    mockExam: { findUnique: vi.fn().mockResolvedValue(exam) },
    mockAttempt: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: 'attempt-1', startedAt: new Date(), deadlineAt: null,
        overallDeadlineAt: null, sectionDeadlines: null, currentSkill: null, ...data,
      })),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ contentVersion: 1, isPublished: true, isDemo: false }]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma));
  const access = { assertCanStart: vi.fn() };
  const service = new MockAttemptService(prisma as never, access as never, {} as never, { get: () => undefined } as never);
  const student = { id: 'student-1', role: 'student', studentProfile: { isApproved: true } } as never;
  return { service, prisma, student };
}

describe('attempt full_test flow gating', () => {
  it('rejects full_test on practice exams (no forced full-test timing)', async () => {
    const { service, student } = setup('practice');
    await expect(service.start(student, 'exam-1', { flow: 'full_test' } as never))
      .rejects.toMatchObject({ code: 'MOCK_FULL_TEST_UNAVAILABLE', status: 400 });
  });

  it('starts full_test on full_mock exams', async () => {
    const { service, student } = setup('full_mock');
    const res = await service.start(student, 'exam-1', { flow: 'full_test' } as never);
    expect(res.flowMode).toBe('full_test');
    expect(res.attemptId).toBe('attempt-1');
  });

  it('starts single-skill practice on practice exams', async () => {
    const { service, student } = setup('practice');
    const res = await service.start(student, 'exam-1', { mode: 'practice' } as never);
    expect(res.flowMode).toBe('single_skill');
  });
});
