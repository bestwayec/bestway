import { describe, expect, it, vi } from 'vitest';
import { TestsService } from './tests.service';

function setup() {
  const tx = {
    test: { findUnique: vi.fn().mockResolvedValue({ id: 'test-1' }) },
    question: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = { $transaction: vi.fn(async (callback) => callback(tx)) };
  const audit = { log: vi.fn() };
  const service = new TestsService(prisma as never, audit as never, {} as never);
  return { service, prisma, tx, audit };
}

describe('TestsService bulk import', () => {
  const input = {
    text: `[READING]
1. Select the answer
A) Wrong
B) Correct
2. Complete the sentence: It is ___.
ANSWER KEY
1: B
2: ready`,
  };

  it('uses one transaction and one createMany operation for the complete batch', async () => {
    const { service, prisma, tx, audit } = setup();
    const result = await service.importQuestions({ id: 'admin' } as never, 'test-1', input);
    expect(result).toEqual({ added: 2, sectionCounts: { reading: 2 } });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.question.createMany).toHaveBeenCalledOnce();
    const rows = tx.question.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ testId: 'test-1', correctAnswer: 'Correct' });
    expect(rows[1]).toMatchObject({ testId: 'test-1', correctAnswer: 'ready' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'questions.import' }));
  });

  it('does not open a transaction when preview validation fails', async () => {
    const { service, prisma } = setup();
    await expect(service.importQuestions({ id: 'admin' } as never, 'test-1', {
      text: '[READING]\n1. Missing answer',
    })).rejects.toMatchObject({ code: 'TEST_IMPORT_INVALID' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not audit when the database write fails', async () => {
    const { service, prisma, audit } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('database failed'));
    await expect(service.importQuestions({ id: 'admin' } as never, 'test-1', input)).rejects.toThrow('database failed');
    expect(audit.log).not.toHaveBeenCalled();
  });
});
