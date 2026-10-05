import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MockExamImportService, resolveIssueSource } from './mock-exam-import.service';
import { canonicalChecksum } from './mock-import-validate';
import { Prisma } from '@prisma/client';

function sample() {
  const p = path.join(__dirname, '..', '..', '..', 'docs', 'ai-test-import', 'example-reading.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function setup() {
  const tx: Record<string, any> = {
    mockExam: { create: vi.fn(async ({ data }: any) => ({ id: 'exam-1', ...data })), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    mockSection: { create: vi.fn(async ({ data }: any) => ({ id: `sec-${data.skill}`, ...data })) },
    mockQuestionGroup: { create: vi.fn(async ({ data }: any) => ({ id: `grp-${data.sortOrder}`, ...data })) },
    mockQuestion: { create: vi.fn(async ({ data }: any) => ({ id: `q-${data.number}`, ...data })), createMany: vi.fn() },
    mockExamImport: { create: vi.fn(async ({ data }: any) => ({ id: 'import-1', ...data })) },
    mockImportSourceMap: { createMany: vi.fn() },
    mockImportReviewIssue: { createMany: vi.fn() },
    mockStagedMedia: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(),
    },
  };
  const prisma: Record<string, any> = {
    ...tx,
    mockExamImport: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
    },
    mockStagedMedia: tx.mockStagedMedia,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const audit = { log: vi.fn() };
  const service = new MockExamImportService(prisma as never, audit as never);
  const actor = { id: 'teacher-1', role: 'teacher' } as never;
  return { service, prisma, tx, audit, actor };
}

describe('mock exam JSON import (RED)', () => {
  it('dry-run validates without persisting anything', async () => {
    const { service, prisma } = setup();
    const report = await service.validateDryRun({ id: 't', role: 'teacher' } as never, sample(), {});
    expect(report.canImport).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('commit creates one unpublished draft atomically', async () => {
    const { service, prisma, actor, audit } = setup();
    const pkg = sample();
    const checksum = canonicalChecksum(pkg);
    const res = await service.commitImport(actor, pkg, {}, checksum);
    expect(res.examId).toBe('exam-1');
    expect(res.replay).toBe(false);
    expect(res.editorUrl).toBe('/exam-builder/exam-1');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    const created = (prisma as any).mockExamImport ?? null;
    void created;
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'mock.exam.import' }));
  });

  it('appends an import to an existing owned draft instead of creating another exam', async () => {
    const { service, tx, actor, audit } = setup();
    const pkg = sample();
    const targetExamId = 'target-exam';
    tx.mockExam.findUnique = vi.fn(async () => ({
      id: targetExamId,
      type: (pkg as any).exam.type,
      createdById: 'teacher-1',
      isPublished: false,
      contentVersion: 4,
      _count: { attempts: 0 },
      sections: [{
        id: 'existing-reading',
        skill: 'reading',
        groups: [{
          id: 'existing-group',
          sortOrder: 2,
          partNumber: null,
          questions: [{ number: 99 }],
        }],
      }],
    }));

    const result = await service.commitImport(
      actor,
      pkg,
      {},
      canonicalChecksum(pkg),
      undefined,
      targetExamId,
    );

    expect(result).toMatchObject({ examId: targetExamId, addedToExisting: true, replay: false });
    expect(tx.mockExam.create).not.toHaveBeenCalled();
    expect(tx.mockSection.create).not.toHaveBeenCalled();
    expect(tx.mockQuestionGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sectionId: 'existing-reading', sortOrder: 3 }) }),
    );
    expect(tx.mockExam.updateMany).toHaveBeenCalledWith({
      where: { id: targetExamId, isPublished: false, attempts: { none: {} }, contentVersion: 4 },
      data: { contentVersion: { increment: 1 } },
    });
    expect(tx.mockExam.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.mockQuestionGroup.create.mock.invocationCallOrder[0]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'mock.exam.import.append' }));
  });

  it('rejects append if publication wins the exam lock before any content is written', async () => {
    const { service, tx, actor, audit } = setup();
    const pkg = sample();
    tx.mockExam.findUnique = vi.fn().mockResolvedValue({
      id: 'target-exam', type: pkg.exam.type, createdById: 'teacher-1', isPublished: false,
      contentVersion: 3, _count: { attempts: 0 }, sections: [],
    });
    tx.mockExam.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.commitImport(actor, pkg, {}, canonicalChecksum(pkg), undefined, 'target-exam')).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT', status: 409 });
    expect(tx.mockSection.create).not.toHaveBeenCalled();
    expect(tx.mockQuestionGroup.create).not.toHaveBeenCalled();
    expect(tx.mockQuestion.create).not.toHaveBeenCalled();
    expect(tx.mockExamImport.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('uses Serializable isolation and exposes retryable database conflicts as 409', async () => {
    const { service, prisma, actor } = setup();
    const pkg = sample();
    prisma.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Concurrent publication', { code: 'P2034', clientVersion: '5.22.0' }));
    await expect(service.commitImport(actor, pkg, {}, canonicalChecksum(pkg))).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT', status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 15000 });
  });

  it('rejects question-number collisions when appending to an existing skill', async () => {
    const { service, tx, actor } = setup();
    const pkg = sample();
    const firstNumber = (pkg as any).exam.sections[0].groups[0].questions[0].number;
    tx.mockExam.findUnique = vi.fn(async () => ({
      id: 'target-exam',
      type: (pkg as any).exam.type,
      createdById: 'teacher-1',
      isPublished: false,
      _count: { attempts: 0 },
      sections: [{
        id: 'existing-reading',
        skill: 'reading',
        groups: [{ sortOrder: 0, partNumber: null, questions: [{ number: firstNumber }] }],
      }],
    }));

    await expect(
      service.commitImport(actor, pkg, {}, canonicalChecksum(pkg), undefined, 'target-exam'),
    ).rejects.toMatchObject({ code: 'MOCK_IMPORT_NUMBER_COLLISION', status: 409 });
    expect(tx.mockExam.create).not.toHaveBeenCalled();
    expect(tx.mockExamImport.create).not.toHaveBeenCalled();
  });

  it('does not allow a teacher to append to another teacher\'s draft', async () => {
    const { service, tx, actor } = setup();
    const pkg = sample();
    tx.mockExam.findUnique = vi.fn(async () => ({
      id: 'target-exam',
      type: (pkg as any).exam.type,
      createdById: 'teacher-2',
      isPublished: false,
      _count: { attempts: 0 },
      sections: [],
    }));

    await expect(
      service.commitImport(actor, pkg, {}, canonicalChecksum(pkg), undefined, 'target-exam'),
    ).rejects.toMatchObject({ code: 'MOCK_NOT_OWNER', status: 403 });
  });

  it('identical replay returns the original exam without creating another', async () => {
    const { service, prisma, actor } = setup();
    const pkg = sample();
    const checksum = canonicalChecksum(pkg);
    prisma.mockExamImport.findUnique.mockResolvedValue({
      id: 'import-1', examId: 'exam-1', normalizedChecksum: checksum, revision: 1,
    });
    const res = await service.commitImport(actor, pkg, {}, checksum);
    expect(res.replay).toBe(true);
    expect(res.examId).toBe('exam-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('same revision with changed content conflicts (409)', async () => {
    const { service, prisma, actor } = setup();
    const pkg = sample();
    prisma.mockExamImport.findUnique.mockResolvedValue({
      id: 'import-1', examId: 'exam-1', normalizedChecksum: 'different', revision: 1,
    });
    await expect(service.commitImport(actor, pkg, {}, canonicalChecksum(pkg))).rejects.toMatchObject({ code: 'MOCK_IMPORT_CONFLICT' });
  });

  it('checksum mismatch fails closed (422)', async () => {
    const { service, actor } = setup();
    await expect(service.commitImport(actor, sample(), {}, 'stale-checksum')).rejects.toMatchObject({ code: 'MOCK_IMPORT_STALE' });
  });

  it('failed writes leave no partial exam (rollback propagates)', async () => {
    const { service, prisma, actor } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.commitImport(actor, sample(), {}, canonicalChecksum(sample())),
    ).rejects.toThrow('db down');
  });

  it('students cannot import', async () => {
    const { service } = setup();
    await expect(
      service.commitImport({ id: 's', role: 'student' } as never, sample(), {}, canonicalChecksum(sample())),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects staged media owned by another user (403) and expired uploads (410)', async () => {
    const { service, prisma, actor } = setup();
    const pkg = sample();
    (pkg as any).media = [{ key: 'm1', kind: 'audio', fileName: 'part-1.mp3', requiredForPublish: false }];
    (pkg as any).exam.sections.push({
      key: 'listening', skill: 'listening', title: 'L', instructions: '',
      groups: [{
        key: 'g-audio', title: 'Part 1', instructions: '', passageText: '', contentHtml: '',
        contentLayout: 'document', audioScript: '', audioRef: 'm1',
        questions: [{ key: 'q1', number: 7, type: 'short_answer', prompt: 'Answer?', options: [], correctAnswers: ['x'], acceptedVariants: [], points: 1, sourceRef: 'p1' }],
      }],
    });
    prisma.mockStagedMedia.findMany.mockResolvedValue([
      { id: 'up-1', ownerId: 'someone-else', kind: 'audio', expiresAt: new Date(Date.now() + 3600_000), storageKey: 'mock/f.mp3' },
    ]);
    await expect(
      service.commitImport(actor, pkg, { m1: 'up-1' }, canonicalChecksum(pkg)),
    ).rejects.toMatchObject({ status: 403 });
    prisma.mockStagedMedia.findMany.mockResolvedValue([
      { id: 'up-1', ownerId: 'teacher-1', kind: 'audio', expiresAt: new Date(Date.now() - 1000), storageKey: 'mock/f.mp3' },
    ]);
    await expect(
      service.commitImport(actor, pkg, { m1: 'up-1' }, canonicalChecksum(pkg)),
    ).rejects.toMatchObject({ status: 410 });
  });

  it('concurrent retry collapses to one draft via unique constraint (P2002 → replay)', async () => {
    const { service, prisma, actor } = setup();
    const pkg = sample();
    const checksum = canonicalChecksum(pkg);
    const conflict = Object.assign(new Error('unique'), { code: 'P2002' });
    prisma.$transaction.mockRejectedValueOnce(conflict);
    prisma.mockExamImport.findUnique.mockResolvedValue({
      id: 'import-1', examId: 'exam-1', normalizedChecksum: checksum, revision: 1,
    });
    const res = await service.commitImport(actor, pkg, {}, checksum);
    expect(res.replay).toBe(true);
    expect(res.examId).toBe('exam-1');
  });

  it('resolves issue pointers to the nearest source (question > group > section)', () => {
    const pkg = sample() as any;
    expect(resolveIssueSource(pkg, '/exam/sections/0/groups/0/questions/1/correctAnswers')).toEqual({
      kind: 'question', key: 'workshop-topic',
    });
    expect(resolveIssueSource(pkg, '/exam/sections/0/groups/0/contentHtml')).toEqual({
      kind: 'group', key: 'library-table',
    });
    expect(resolveIssueSource(pkg, '/exam/sections/0/title')).toEqual({ kind: 'section', key: 'reading' });
    expect(resolveIssueSource(pkg, '/media/0')).toBeNull();
    expect(resolveIssueSource(pkg, 'nope')).toBeNull();
  });

  it('persists issue source keys for editor navigation', async () => {
    const { service, tx, actor } = setup();
    const pkg = sample();
    (pkg as any).reviewIssues = [{
      key: 'ambiguous-one', code: 'AMBIGUOUS_TEXT',
      path: '/exam/sections/0/groups/1/questions/0/prompt',
      message: 'Wording unclear.', sourceRef: 'p1',
    }];
    const created: any[] = [];
    tx.mockImportReviewIssue = { createMany: vi.fn(async ({ data }: any) => { created.push(...data); return { count: data.length }; }) };
    const checksum = canonicalChecksum(pkg);
    await service.commitImport(actor, pkg, {}, checksum);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ sourceKey: 'quiet-room', entityKind: 'question', status: 'open' });
  });

  it('by-exam provenance is owner/admin-only and maps issues to entities', async () => {
    const { service, prisma } = setup();
    (prisma as any).mockExam = { findUnique: vi.fn(async () => ({ id: 'exam-1', createdById: 'teacher-1' })) };
    (prisma as any).mockExamImport.findMany = vi.fn(async () => [
      { id: 'import-1', packageId: 'pkg', revision: 2, profile: 'practice', createdAt: new Date() },
    ]);
    (prisma as any).mockImportReviewIssue = {
      findMany: vi.fn(async () => [
        { id: 'is-1', code: 'OTHER', path: '/exam/sections/0/title', message: 'm', sourceKey: 'reading', entityKind: 'section', status: 'open' },
      ]),
    };
    (prisma as any).mockImportSourceMap = {
      findMany: vi.fn(async () => [{ kind: 'section', sourceKey: 'reading', entityId: 'sec-1' }]),
    };
    const owner = await service.getByExam({ id: 'teacher-1', role: 'teacher' } as never, 'exam-1');
    expect(owner.packageId).toBe('pkg');
    expect(owner.openIssues).toBe(1);
    expect(owner.sourceMaps).toEqual([{ kind: 'section', sourceKey: 'reading', entityId: 'sec-1' }]);
    const admin = await service.getByExam({ id: 'admin-1', role: 'admin' } as never, 'exam-1');
    expect(admin.packageId).toBe('pkg');
    await expect(service.getByExam({ id: 'other', role: 'teacher' } as never, 'exam-1')).rejects.toMatchObject({ status: 404 });
    (prisma as any).mockExamImport.findMany = vi.fn(async () => []);
    await expect(service.getByExam({ id: 'teacher-1', role: 'teacher' } as never, 'exam-1')).rejects.toMatchObject({ status: 404 });
  });

  it('resolveIssue is owner/admin-only and audited', async () => {
    const { service, prisma, audit } = setup();
    (prisma as any).mockImportReviewIssue = {
      findUnique: vi.fn(async () => ({ id: 'is-1', importId: 'import-1', code: 'OTHER', path: '/a', status: 'open' })),
      update: vi.fn(async ({ data }: any) => ({ id: 'is-1', ...data })),
    };
    (prisma as any).mockExamImport.findUnique = vi.fn(async () => ({ id: 'import-1', examId: 'exam-1' }));
    (prisma as any).mockExam = { findUnique: vi.fn(async () => ({ id: 'exam-1', createdById: 'teacher-1' })) };
    const done = await service.resolveIssue({ id: 'teacher-1', role: 'teacher' } as never, 'is-1');
    expect((done as any).status).toBe('resolved');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'mock.exam.import.issue.resolve' }));
    await expect(service.resolveIssue({ id: 'other', role: 'teacher' } as never, 'is-1')).rejects.toMatchObject({ status: 403 });
    (prisma as any).mockImportReviewIssue.findUnique = vi.fn(async () => null);
    await expect(service.resolveIssue({ id: 'teacher-1', role: 'teacher' } as never, 'is-1')).rejects.toMatchObject({ status: 404 });
  });

  it('imported drafts never expose keys/transcripts to students (answer visibility)', async () => {
    const { shapeExam } = await import('./mock-shape');
    const row = {
      id: 'exam-1', type: 'ielts_academic', title: 'T', description: null, level: null,
      isPublished: false, isDemo: false, createdAt: new Date(), updatedAt: new Date(),
      sections: [{
        id: 'sec', skill: 'reading', title: null, sortOrder: 0, durationMinutes: null, instructions: null,
        groups: [{
          id: 'grp', sortOrder: 0, title: null, instructions: null, passageText: 'text',
          contentHtml: null, audioScript: 'secret transcript', contentLayout: 'document',
          audioKey: null, imageKey: null, partNumber: null, audioDurationSec: null, audioPlayLimit: 1,
          questions: [{
            id: 'q', number: 1, sortOrder: 0, type: 'short_answer', prompt: 'Q?',
            options: [], correctAnswers: ['answer'], acceptedVariants: [], points: 1, wordLimit: 1,
          }],
        }],
      }],
    } as never;
    const studentView = shapeExam(row, false, 'http://x/v1') as any;
    const studentQ = studentView.sections[0].groups[0].questions[0];
    expect(studentQ).not.toHaveProperty('correctAnswers');
    expect(studentQ).not.toHaveProperty('acceptedVariants');
    expect(studentView.sections[0].groups[0]).not.toHaveProperty('audioScript');
    const staffView = shapeExam(row, true, 'http://x/v1') as any;
    expect(staffView.sections[0].groups[0].questions[0].correctAnswers).toEqual(['answer']);
    expect(staffView.sections[0].groups[0].audioScript).toBe('secret transcript');
  });
});
