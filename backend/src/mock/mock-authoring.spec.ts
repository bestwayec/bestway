import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MockAuthoringService } from './mock-authoring.service';
import { CreateMockExamDto, SaveGroupContentDto } from './dto/mock.dto';
import { starterSections } from './mock-starter';

function setup() {
  const group = {
    id: 'group', questions: [{ id: 'existing', number: 1 }],
    section: { skill: 'reading', exam: { id: 'exam', type: 'ielts_academic', createdById: 'owner', isPublished: false } },
  };
  const tx = {
    mockQuestionGroup: { findUnique: vi.fn().mockResolvedValue(group), update: vi.fn() },
    mockAttempt: { count: vi.fn().mockResolvedValue(0) },
    mockQuestion: {
      findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(),
      update: vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new-id', ...data })),
    },
  };
  const prisma = { ...tx, mockExam: { create: vi.fn().mockResolvedValue({ id: 'exam' }) }, $transaction: vi.fn(async (fn) => fn(tx)) };
  const audit = { log: vi.fn() };
  const service = new MockAuthoringService(prisma as never, audit as never, {} as never, {} as never, { get: () => undefined } as never);
  const actor = { id: 'owner', role: 'teacher' } as never;
  const dto: SaveGroupContentDto = {
    title: 'Passage', deletedQuestionIds: [],
    questions: [{ id: 'existing', number: 1, type: 'short_answer', prompt: 'First question', correctAnswers: ['answer'] }],
  };
  return { service, prisma, tx, group, actor, dto, audit };
}

describe('atomic block authoring', () => {
  it('retains IDs, returns newly created IDs and persists visual ordering in one transaction', async () => {
    const { service, prisma, tx, actor, dto, audit } = setup();
    dto.questions.unshift({ number: 2, type: 'short_answer', prompt: 'New question', correctAnswers: ['new'] });
    const result = await service.saveGroupContent(actor, 'group', dto);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(result.questions.map((q) => q.id)).toEqual(['new-id', 'existing']);
    expect(result.group.id).toBe('group');
    expect(tx.mockQuestion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sortOrder: 1, options: [], wordLimit: null }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mock.group.content.save',
      entityId: 'group',
      newValue: { count: 2 },
    }));
  });

  it('validates the entire batch before changing material or deleting questions', async () => {
    const { service, tx, actor, dto } = setup();
    dto.questions.push({ number: 2, type: 'short_answer', prompt: 'Malformed limit', wordLimit: 0 });
    await expect(service.saveGroupContent(actor, 'group', dto)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(tx.mockQuestionGroup.update).not.toHaveBeenCalled();
    expect(tx.mockQuestion.deleteMany).not.toHaveBeenCalled();
    expect(tx.mockQuestion.update).not.toHaveBeenCalled();
  });

  it('saves incomplete draft questions while retaining structural validation', async () => {
    const { service, tx, actor, dto } = setup();
    dto.questions[0] = { id: 'existing', number: 1, type: 'multiple_choice', prompt: '', options: [], correctAnswers: [] };
    await service.saveGroupContent(actor, 'group', dto);
    expect(tx.mockQuestion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ prompt: '', options: [], correctAnswers: [] }) }));
    expect(await validate(plainToInstance(SaveGroupContentDto, dto))).toEqual([]);
  });

  it('rejects question IDs belonging to another block', async () => {
    const { service, actor, dto } = setup();
    dto.questions[0].id = 'foreign';
    await expect(service.saveGroupContent(actor, 'group', dto)).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT' });
  });

  it('rejects duplicate numbers locally and across the exam', async () => {
    const { service, tx, actor, dto } = setup();
    dto.questions.push({ ...dto.questions[0], id: undefined });
    await expect(service.saveGroupContent(actor, 'group', dto)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    dto.questions.pop();
    tx.mockQuestion.findMany.mockResolvedValue([{ number: 1 }]);
    await expect(service.saveGroupContent(actor, 'group', dto)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('requires explicit deletion and does not erase concurrent additions', async () => {
    const { service, tx, actor, dto } = setup();
    dto.questions = [];
    await expect(service.saveGroupContent(actor, 'group', dto)).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT' });
    dto.deletedQuestionIds = ['existing'];
    await service.saveGroupContent(actor, 'group', dto);
    expect(tx.mockQuestion.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'group', id: { in: ['existing'] } } });
  });

  it('enforces teacher ownership', async () => {
    const { service, group, actor, dto, tx } = setup();
    group.section.exam.createdById = 'another-teacher';
    await expect(service.saveGroupContent(actor, 'group', dto)).rejects.toMatchObject({ code: 'MOCK_NOT_OWNER' });
    expect(tx.mockQuestionGroup.update).not.toHaveBeenCalled();
  });

  it('protects published exams and exams with student attempts', async () => {
    const { service, group, actor, dto, tx } = setup();
    group.section.exam.isPublished = true;
    await expect(service.saveGroupContent(actor, 'group', dto)).rejects.toMatchObject({ code: 'MOCK_CONTENT_LOCKED' });
    group.section.exam.isPublished = false;
    tx.mockAttempt.count.mockResolvedValue(1);
    await expect(service.saveGroupContent(actor, 'group', dto)).rejects.toMatchObject({ code: 'MOCK_CONTENT_LOCKED' });
  });

  it('rejects malformed and oversized HTTP payloads', async () => {
    const invalid = plainToInstance(SaveGroupContentDto, { questions: [{ number: 0, type: 'unknown', prompt: '' }], deletedQuestionIds: [] });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
    invalid.questions = Array(201).fill({ number: 1, type: 'short_answer', prompt: 'Question' });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateMockExamDto, { type: 'ielts_academic', title: 'Example', starterStructure: 'yes' }))).length).toBeGreaterThan(0);
  });
});

describe('import-aware readiness and optimistic save version', () => {
  it('blocks publish while import issues are open', async () => {
    const { service, prisma } = setup();
    (prisma as any).mockExam = {
      ...(prisma as any).mockExam,
      findUnique: vi.fn().mockResolvedValue({ id: 'exam', type: 'multilevel', sections: [] }),
    };
    (prisma as any).mockImportReviewIssue = { count: vi.fn().mockResolvedValue(2) };
    const ready = await (service as any).readiness({ id: 'owner', role: 'teacher' }, 'exam');
    const item = ready.items.find((i: { key: string }) => i.key === 'import_issues');
    expect(item.ok).toBe(false);
    expect(ready.ready).toBe(false);
    (prisma as any).mockImportReviewIssue.count.mockResolvedValue(0);
    const ready2 = await (service as any).readiness({ id: 'owner', role: 'teacher' }, 'exam');
    expect(ready2.items.find((i: { key: string }) => i.key === 'import_issues').ok).toBe(true);
  });

  it('rejects stale versioned saves (409) and bumps the version on success', async () => {
    const { service, tx, actor, dto } = setup();
    (tx as any).mockExam = { update: vi.fn().mockImplementation(async ({ data }: any) => ({ contentVersion: 2 })) };
    (tx as any).mockQuestionGroup.findUnique.mockResolvedValue({
      id: 'group', questions: [{ id: 'existing', number: 1 }],
      section: { skill: 'reading', exam: { id: 'exam', type: 'ielts_academic', createdById: 'owner', isPublished: false, contentVersion: 3 } },
    });
    await expect(
      service.saveGroupContent(actor, 'group', { ...dto, expectedContentVersion: 2 } as never),
    ).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT' });
    expect((tx as any).mockExam.update).not.toHaveBeenCalled();
    const ok = await service.saveGroupContent(actor, 'group', { ...dto, expectedContentVersion: 3 } as never);
    expect((ok as { version: number }).version).toBe(2);
    expect((tx as any).mockExam.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'exam' } }),
    );
  });

  it('leaves the version untouched when the client sends none', async () => {
    const { service, tx, actor, dto } = setup();
    const ok = await service.saveGroupContent(actor, 'group', dto);
    expect((ok as { version: number }).version).toBe(1);
    expect((tx as any).mockExam?.update ?? null).toBeNull();
  });
});

describe('profile-aware readiness (single-skill publish)', () => {
  function autoQ(number: number, key = 'word') {
    return { number, type: 'short_answer', correctAnswers: [key], points: 1 };
  }
  function readingSection(passage = 'Some passage text.', keys = true) {
    return {
      skill: 'reading',
      groups: [{
        partNumber: null, audioKey: null, passageText: passage,
        questions: keys ? [autoQ(1), autoQ(2)] : [{ number: 1, type: 'short_answer', correctAnswers: [], points: 1 }],
      }],
    };
  }
  function listeningSection(withAudio = true) {
    return {
      skill: 'listening',
      groups: [{
        partNumber: 1, audioKey: withAudio ? 'mock/a.mp3' : null, passageText: null,
        questions: [autoQ(1), autoQ(2)],
      }],
    };
  }
  function writingSection() {
    return {
      skill: 'writing',
      groups: [{
        partNumber: null, audioKey: null, passageText: null,
        questions: [{ number: 1, type: 'essay_task1', prompt: 'Describe the chart.', correctAnswers: [], points: 9 }],
      }],
    };
  }
  function speakingSection() {
    return {
      skill: 'speaking',
      groups: [{
        partNumber: null, audioKey: null, passageText: null,
        questions: [{ number: 1, type: 'speaking_task', prompt: 'Talk about your hometown.', correctAnswers: [], points: 9 }],
      }],
    };
  }
  function serviceFor(exam: Record<string, unknown>) {
    const prisma = {
      mockExam: { findUnique: vi.fn().mockResolvedValue(exam) },
      mockImportReviewIssue: { count: vi.fn().mockResolvedValue(0) },
    };
    const audit = { log: vi.fn() };
    const service = new MockAuthoringService(prisma as never, audit as never, { exists: () => true } as never, {} as never, { get: () => undefined } as never);
    return service;
  }
  const base = { id: 'exam', type: 'ielts_academic' };
  const actor = { id: 'owner', role: 'teacher' } as never;
  const keysOf = (report: { items: Array<{ key: string }> }) => report.items.map((i) => i.key);

  it('publishes a reading-only practice exam without demanding other skills', async () => {
    const service = serviceFor({ ...base, profile: 'practice', sections: [readingSection()] });
    const report = await service.readiness(actor, 'exam');
    expect(report.ready).toBe(true);
    expect(keysOf(report)).not.toContain('listening_section');
    expect(keysOf(report)).not.toContain('writing_section');
  });

  it('publishes a listening-only practice exam with audio', async () => {
    const service = serviceFor({ ...base, profile: 'practice', sections: [listeningSection()] });
    const report = await service.readiness(actor, 'exam');
    expect(report.ready).toBe(true);
    expect(keysOf(report)).not.toContain('listening_parts');
  });

  it('publishes writing-only and speaking-only practice exams', async () => {
    const writing = serviceFor({ ...base, profile: 'practice', sections: [writingSection()] });
    expect((await writing.readiness(actor, 'exam')).ready).toBe(true);
    const speaking = serviceFor({ ...base, profile: 'practice', sections: [speakingSection()] });
    expect((await speaking.readiness(actor, 'exam')).ready).toBe(true);
  });

  it('blocks an empty practice exam (no section/group/question)', async () => {
    const service = serviceFor({ ...base, profile: 'practice', sections: [] });
    const report = await service.readiness(actor, 'exam');
    expect(report.ready).toBe(false);
    expect(report.items.find((i) => i.key === 'has_content')?.ok).toBe(false);
  });

  it('blocks reading practice on missing answers or passages', async () => {
    const noKeys = serviceFor({ ...base, profile: 'practice', sections: [readingSection('Text.', false)] });
    const r1 = await noKeys.readiness(actor, 'exam');
    expect(r1.ready).toBe(false);
    expect(r1.items.find((i) => i.key === 'answer_keys')?.ok).toBe(false);
    const noPassage = serviceFor({ ...base, profile: 'practice', sections: [readingSection('   ')] });
    const r2 = await noPassage.readiness(actor, 'exam');
    expect(r2.ready).toBe(false);
    expect(r2.items.find((i) => i.key === 'reading_passage')?.ok).toBe(false);
  });

  it('keeps strict blueprint for full_mock (missing writing blocks)', async () => {
    const service = serviceFor({ ...base, profile: 'full_mock', sections: [readingSection(), listeningSection()] });
    const report = await service.readiness(actor, 'exam');
    expect(report.ready).toBe(false);
    expect(report.items.find((i) => i.key === 'writing_section')?.ok).toBe(false);
  });

  it('stores the chosen profile and starter skills on create', async () => {
    const { service, prisma, actor } = setup();
    await service.createExam(actor, {
      type: 'ielts_academic', title: 'Reading only', profile: 'practice', skills: ['reading'], starterStructure: true,
    } as never);
    const data = (prisma.mockExam.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.profile).toBe('practice');
    expect(data.sections.create).toHaveLength(1);
    expect(data.sections.create[0].skill).toBe('reading');
  });
});

describe('exam starter structure', () => {
  it('creates all IELTS units as empty editable blocks', () => {
    const sections = starterSections('ielts_academic');
    expect(sections.map((s) => (s.groups!.create as unknown[]).length)).toEqual([4, 3, 2, 3]);
    expect(sections[1].durationMinutes).toBe(60);
    expect(JSON.stringify(sections)).not.toContain('correctAnswers');
  });
  it('uses the versioned Multilevel part structure', () => {
    expect(starterSections('multilevel').map((s) => (s.groups!.create as unknown[]).length)).toEqual([6, 5, 3, 4]);
  });
  it('keeps blank creation backward compatible and creates the structure in the same nested write', async () => {
    const { service, prisma, actor } = setup();
    await service.createExam(actor, { type: 'ielts_general', title: 'Blank exam' });
    expect(prisma.mockExam.create.mock.calls[0][0].data.sections).toBeUndefined();
    await service.createExam(actor, { type: 'ielts_general', title: 'Prepared exam', starterStructure: true });
    expect(prisma.mockExam.create.mock.calls[1][0].data.sections.create).toHaveLength(4);
  });
});
