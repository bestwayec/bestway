import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MockAuthoringService } from './mock-authoring.service';
import { CreateMockExamDto, SaveGroupContentDto } from './dto/mock.dto';
import { starterSections } from './mock-starter';
import { Prisma } from '@prisma/client';
import { multilevelFixture } from './multilevel.fixture';
import { MULTILEVEL_VERSION, multilevelBlueprintIssues } from './multilevel-specification';

function setup() {
  const group = {
    id: 'group', questions: [{ id: 'existing', number: 1 }],
    section: { skill: 'reading', exam: { id: 'exam', type: 'ielts_academic', createdById: 'owner', isPublished: false } },
  };
  const tx = {
    mockExam: { update: vi.fn().mockResolvedValue({ contentVersion: 2 }) },
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

describe('current Multilevel draft reconciliation', () => {
  it('repairs legacy task/part metadata without touching child-response points', async () => {
    const { service } = setup();
    const fixture = multilevelFixture();
    const rows = fixture.filter((section) => section.skill === 'writing' || section.skill === 'speaking').map((section, si) => ({
      skill: section.skill,
      groups: section.groups.map((group, gi) => {
        const legacy = { ...group, id: `${si}-${gi}`, maxScore: null, stimulusRef: null };
        legacy.questions.forEach((question) => { question.points = 9; });
        return legacy;
      }),
    }));
    const byId = new Map(rows.flatMap((section) => section.groups.map((group) => [group.id, group])));
    const tx = {
      mockSection: { findMany: vi.fn().mockResolvedValue(rows) },
      mockQuestionGroup: { update: vi.fn(async ({ where, data }) => Object.assign(byId.get(where.id)!, data)) },
    };
    const changed = await (service as any).reconcileCurrentMultilevelDraft(tx, {
      id: 'draft', type: 'multilevel', specificationVersion: MULTILEVEL_VERSION, isPublished: false,
    });
    fixture[2].groups = rows[0].groups as never;
    fixture[3].groups = rows[1].groups as never;
    expect(changed).toBe(7);
    expect(multilevelBlueprintIssues(fixture, true)).toEqual([]);
    expect(fixture[3].groups[0].questions.map((q) => q.points)).toEqual([9, 9, 9]);
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
      expect.objectContaining({ where: expect.objectContaining({ id: 'exam' }) }),
    );
  });

  it('bumps the version when a legacy client omits its expected version', async () => {
    const { service, tx, actor, dto } = setup();
    const ok = await service.saveGroupContent(actor, 'group', dto);
    expect((ok as { version: number }).version).toBe(2);
    expect(tx.mockExam.update).toHaveBeenCalledWith(expect.objectContaining({ data: { contentVersion: { increment: 1 } } }));
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

  it('blocks generated placeholder content even after import review issues are resolved', async () => {
    const section = readingSection('REPLACE WITH THE COMPLETE TEXT FOR READING PASSAGE 1.');
    const service = serviceFor({ ...base, profile: 'practice', sections: [section] });
    const report = await service.readiness(actor, 'exam');
    expect(report.items.find((item) => item.key === 'import_issues')?.ok).toBe(true);
    expect(report.items.find((item) => item.key === 'template_placeholders')?.ok).toBe(false);
    expect(report.ready).toBe(false);
  });

  it('detects remaining generated question and option markers without blocking legitimate replace prose', async () => {
    const section = readingSection();
    const questions = section.groups[0].questions as any[];
    questions[0].prompt = 'REPLACE - Completion prompt for question 1.';
    const service = serviceFor({ ...base, profile: 'practice', sections: [section] });
    expect((await service.readiness(actor, 'exam')).ready).toBe(false);
    questions[0].prompt = 'What should a worker replace?';
    const report = await service.readiness(actor, 'exam');
    expect(report.ready).toBe(true);
    expect(report.items.find((item) => item.key === 'template_placeholders')?.ok).toBe(true);
  });

  it.each(['title', 'description'])('blocks a known scaffold prefix in the exam %s', async (field) => {
    const service = serviceFor({ ...base, [field]: 'REPLACE — Verified exam content', profile: 'practice', sections: [readingSection()] });
    const report = await service.readiness(actor, 'exam');
    expect(report.items.find((item) => item.key === 'template_placeholders')?.ok).toBe(false);
    expect(report.ready).toBe(false);
  });

  it('keeps template sentinel answer keys blocked after issue resolution until replaced', async () => {
    const section = readingSection();
    section.groups[0].questions[0].correctAnswers = ['REPLACE'];
    const service = serviceFor({ ...base, profile: 'practice', sections: [section] });
    (service as any).prisma.mockImportReviewIssue.count.mockImplementation(async ({ where }: any) => where.status === 'open' ? 0 : 1);
    const report = await service.readiness(actor, 'exam');
    expect(report.items.find((item) => item.key === 'import_issues')?.ok).toBe(true);
    expect(report.items.find((item) => item.key === 'template_placeholders')?.ok).toBe(false);
    section.groups[0].questions[0].correctAnswers = ['word'];
    expect((await service.readiness(actor, 'exam')).ready).toBe(true);
  });

  it('allows legitimate REPLACE answer text when it does not originate in a generated template', async () => {
    const section = readingSection('How workers replace broken parts.');
    section.groups[0].questions[0].correctAnswers = ['REPLACE'];
    const service = serviceFor({ ...base, title: 'Replace worn parts', profile: 'practice', sections: [section] });
    expect((await service.readiness(actor, 'exam')).ready).toBe(true);
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

describe('strict full-mock publication', () => {
  interface FixtureQuestion {
    number: number; type: string; prompt: string; correctAnswers: string[]; points: number;
    options?: string[]; acceptedVariants?: string[];
  }
  interface FixtureGroup {
    id: string; partNumber?: number; audioKey?: string; passageText?: string; questions: FixtureQuestion[];
  }
  interface FixtureExam {
    id: string; createdById: string; type: string; profile: string; isPublished: boolean;
    contentVersion: number;
    sections: Array<{ skill: string; groups: FixtureGroup[] }>;
  }
  function completeIelts(type = 'ielts_academic'): FixtureExam {
    let number = 0;
    const autoQuestions = (count: number) => Array.from({ length: count }, () => ({
      number: ++number, type: 'short_answer', prompt: 'Complete the answer.', options: [],
      correctAnswers: ['word'], acceptedVariants: [], points: 1,
    }));
    return {
      id: 'exam', createdById: 'owner', type, profile: 'full_mock', isPublished: false, contentVersion: 1,
      sections: [
        { skill: 'listening', groups: [1, 2, 3, 4].map((partNumber) => ({
          id: `listening-${partNumber}`, partNumber, audioKey: `mock/part-${partNumber}.mp3`,
          questions: autoQuestions(10),
        })) },
        { skill: 'reading', groups: [14, 13, 13].map((count, index) => ({
          id: `reading-${index}`, passageText: 'A complete passage.', questions: autoQuestions(count),
        })) },
        { skill: 'writing', groups: [{ id: 'writing', questions: ['essay_task1', 'essay_task2'].map((taskType) => ({
          number: ++number, type: taskType, prompt: 'Write a response.', correctAnswers: [], points: 9,
        })) }] },
      ],
    };
  }
  function publicationService(exam: ReturnType<typeof completeIelts>) {
    const mockExam = { findUnique: vi.fn().mockResolvedValue(exam), update: vi.fn().mockResolvedValue(exam) };
    const prisma = {
      mockExam,
      mockAttempt: { count: vi.fn().mockResolvedValue(0) },
      mockImportReviewIssue: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn(async (run: any) => run({ mockExam })),
    };
    const service = new MockAuthoringService(prisma as never, { log: vi.fn() } as never,
      { exists: () => true } as never, {} as never, { get: () => undefined } as never);
    return { service, prisma };
  }
  const actor = { id: 'owner', role: 'teacher' } as never;

  it.each(['ielts_academic', 'ielts_general'])('accepts the complete %s L/R/W full-mock contract', async (type) => {
    const { service } = publicationService(completeIelts(type));
    expect((await service.readiness(actor, 'exam')).ready).toBe(true);
  });

  it('rejects incomplete listening despite four audio parts', async () => {
    const exam = completeIelts();
    exam.sections[0].groups[0].questions.pop();
    const { service, prisma } = publicationService(exam);
    const report = await service.readiness(actor, 'exam');
    expect(report.items.find((item) => item.key === 'listening_questions')?.ok).toBe(false);
    await expect(service.updateExam(actor, 'exam', { isPublished: true })).rejects.toMatchObject({ code: 'MOCK_NOT_READY' });
    expect(prisma.mockExam.update).not.toHaveBeenCalled();
  });

  it('requires the exact listening part identifiers 1 through 4', async () => {
    const exam = completeIelts();
    exam.sections[0].groups[3].partNumber = 6;
    const { service } = publicationService(exam);
    expect((await service.readiness(actor, 'exam')).items.find((item) => item.key === 'listening_parts')?.ok).toBe(false);
  });

  it('requires exactly three reading passages and forty responses', async () => {
    const exam = completeIelts();
    const reading = exam.sections[1];
    const [moved] = reading.groups[2].questions.splice(0, 1);
    reading.groups.push({ id: 'extra-reading', passageText: 'Extra passage.', questions: [moved] });
    const { service } = publicationService(exam);
    expect((await service.readiness(actor, 'exam')).items.find((item) => item.key === 'reading_groups')?.ok).toBe(false);
    reading.groups.pop();
    expect((await service.readiness(actor, 'exam')).items.find((item) => item.key === 'reading_questions')?.ok).toBe(false);
  });

  it('rejects repeated writing tasks rather than accepting their type set', async () => {
    const exam = completeIelts();
    const questions = exam.sections[2].groups[0].questions;
    questions.push({ ...questions[0], number: 83 });
    const { service } = publicationService(exam);
    expect((await service.readiness(actor, 'exam')).items.find((item) => item.key === 'writing_tasks')?.ok).toBe(false);
  });

  it('checks the requested profile before publishing and leaves rejected drafts untouched', async () => {
    const exam = completeIelts();
    exam.profile = 'practice';
    exam.sections = [exam.sections[1]];
    const { service, prisma } = publicationService(exam);
    expect((await service.readiness(actor, 'exam')).ready).toBe(true);
    await expect(service.updateExam(actor, 'exam', { profile: 'full_mock', isPublished: true })).rejects.toMatchObject({ code: 'MOCK_NOT_READY' });
    expect(prisma.mockExam.update).not.toHaveBeenCalled();
    expect(exam.profile).toBe('practice');
    expect(exam.isPublished).toBe(false);
  });

  it('checks profile changes on an already published practice exam', async () => {
    const exam = completeIelts();
    exam.profile = 'practice';
    exam.isPublished = true;
    exam.sections = [exam.sections[1]];
    const { service, prisma } = publicationService(exam);
    await expect(service.updateExam(actor, 'exam', { profile: 'full_mock' })).rejects.toMatchObject({ code: 'MOCK_NOT_READY' });
    expect(prisma.mockExam.update).not.toHaveBeenCalled();
  });

  it('rejects publication if another content mutation wins after readiness', async () => {
    const exam = completeIelts();
    const { service, prisma } = publicationService(exam);
    prisma.mockExam.findUnique.mockImplementation(async () => ({ ...exam }));
    vi.spyOn(service, 'readiness').mockImplementation(async () => {
      exam.contentVersion++;
      return { examId: 'exam', ready: true, items: [] };
    });
    prisma.mockExam.update.mockImplementation(async ({ where }: any) => {
      if (where.contentVersion !== exam.contentVersion) throw new Prisma.PrismaClientKnownRequestError('Concurrent content update', { code: 'P2025', clientVersion: '5.22.0' });
      return exam;
    });
    await expect(service.updateExam(actor, 'exam', { isPublished: true })).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT' });
    expect(prisma.mockExam.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'exam', contentVersion: 1 } }));
    expect(exam.isPublished).toBe(false);
  });

  it.each([{ isPublished: true }, { profile: 'practice' }])('coordinates conditional exam updates with Serializable transactions: %j', async (dto) => {
    const { service, prisma } = publicationService(completeIelts());
    const update = vi.fn().mockResolvedValue({ id: 'exam' });
    prisma.$transaction.mockImplementation(async (run: any) => run({ mockExam: { update } }));
    await service.updateExam(actor, 'exam', dto);
    expect(prisma.mockExam.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 15000 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'exam', contentVersion: 1, ...(dto.profile ? { attempts: { none: {} } } : {}) },
    }));
  });

  it('returns a conflict when a concurrent attempt invalidates the Serializable profile update', async () => {
    const exam = completeIelts();
    const { service, prisma } = publicationService(exam);
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Serialization failure', { code: 'P2034', clientVersion: '5.22.0' }));
    await expect(service.updateExam(actor, 'exam', { profile: 'practice' })).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT', status: 409 });
    expect(prisma.mockExam.update).not.toHaveBeenCalled();
    expect(exam.profile).toBe('full_mock');
    expect(exam.contentVersion).toBe(1);
  });

  it('prevents profile changes after students have started while retaining metadata and unpublish', async () => {
    const exam = completeIelts();
    exam.isPublished = true;
    const { service, prisma } = publicationService(exam);
    prisma.mockAttempt.count.mockResolvedValue(1);
    await expect(service.updateExam(actor, 'exam', { profile: 'practice', isPublished: false })).rejects.toMatchObject({ code: 'EXAM_VERSION_IN_USE' });
    expect(prisma.mockExam.update).not.toHaveBeenCalled();
    await service.updateExam(actor, 'exam', { title: 'Updated title', isPublished: false });
    expect(prisma.mockExam.update).toHaveBeenCalledWith(expect.objectContaining({ data: { title: 'Updated title', isPublished: false } }));
  });
});

describe('content immutability through legacy authoring endpoints', () => {
  const mutations: Array<[string, (service: MockAuthoringService, actor: never) => Promise<unknown>]> = [
    ['create section', (service, actor) => service.createSection(actor, 'exam', { skill: 'reading' })],
    ['update section', (service, actor) => service.updateSection(actor, 'section', {})],
    ['delete section', (service, actor) => service.deleteSection(actor, 'section')],
    ['create group', (service, actor) => service.createGroup(actor, 'section', {})],
    ['update group', (service, actor) => service.updateGroup(actor, 'group', {})],
    ['delete group', (service, actor) => service.deleteGroup(actor, 'group')],
    ['replace media', (service, actor) => service.setGroupMedia(actor, 'group', {})],
    ['import questions', (service, actor) => service.importQuestions(actor, 'group', { text: '1. Question' })],
    ['add questions', (service, actor) => service.addQuestions(actor, 'group', { questions: [] })],
    ['update question', (service, actor) => service.updateQuestion(actor, 'question', {})],
    ['delete question', (service, actor) => service.deleteQuestion(actor, 'question')],
    ['delete exam', (service, actor) => service.deleteExam(actor, 'exam')],
  ];
  function protectedContent(type: string, isPublished: boolean, attempts: number) {
    const exam = { id: 'exam', createdById: 'owner', type, isPublished, sections: [{ groups: [] }] };
    const section = { id: 'section', examId: 'exam', exam, skill: 'reading', groups: [] };
    const group = { id: 'group', sectionId: 'section', section, questions: [] };
    const mutate = vi.fn();
    const table = (record: object) => ({ findUnique: vi.fn().mockResolvedValue(record), update: mutate, create: mutate, delete: mutate, createMany: mutate, deleteMany: mutate });
    const prisma = {
      mockExam: table(exam), mockSection: table(section), mockQuestionGroup: table(group),
      mockQuestion: table({ id: 'question', groupId: 'group', group }),
      mockAttempt: { count: vi.fn().mockResolvedValue(attempts) },
    };
    const storage = { delete: vi.fn() };
    const service = new MockAuthoringService(prisma as never, { log: vi.fn() } as never,
      storage as never, {} as never, { get: () => undefined } as never);
    return { service, mutate, storage };
  }

  it.each(mutations)('blocks %s for published content and used drafts in both programs', async (_name, mutation) => {
    const actor = { id: 'owner', role: 'teacher' } as never;
    for (const type of ['ielts_academic', 'ielts_general', 'multilevel']) {
      for (const state of [{ published: true, attempts: 0, code: 'MOCK_CONTENT_LOCKED' }, { published: false, attempts: 1, code: 'EXAM_VERSION_IN_USE' }]) {
        const { service, mutate, storage } = protectedContent(type, state.published, state.attempts);
        await expect(mutation(service, actor)).rejects.toMatchObject({ code: state.code });
        expect(mutate).not.toHaveBeenCalled();
        expect(storage.delete).not.toHaveBeenCalled();
      }
    }
  });

  it('checks creator ownership before deleting an exam or its files', async () => {
    const { service, mutate, storage } = protectedContent('ielts_academic', false, 0);
    await expect(service.deleteExam({ id: 'other', role: 'teacher' } as never, 'exam')).rejects.toMatchObject({ code: 'MOCK_NOT_OWNER' });
    expect(mutate).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe('draft media visibility', () => {
  it('denies unpublished non-demo assets before purchase or enrollment can grant access', async () => {
    const prisma = { mockQuestionGroup: { findUnique: vi.fn().mockResolvedValue({
      id: 'group', audioKey: 'mock/audio.mp3', imageKey: 'mock/map.png',
      section: { exam: { id: 'exam', type: 'ielts_academic', isPublished: false, isDemo: false, price: 0 } },
    }) } };
    const storage = { exists: vi.fn() };
    const access = { accessFor: vi.fn().mockResolvedValue('granted') };
    const service = new MockAuthoringService(prisma as never, {} as never, storage as never, access as never, { get: () => undefined } as never);
    for (const viewer of [undefined, { id: 'student', role: 'student' } as never]) {
      for (const kind of ['audio', 'image'] as const) {
        await expect(service.streamMedia(viewer, 'group', kind, {} as never, {} as never)).rejects.toMatchObject({ code: 'MOCK_EXAM_NOT_FOUND' });
      }
    }
    expect(storage.exists).not.toHaveBeenCalled();
    expect(access.accessFor).not.toHaveBeenCalled();
  });
});

describe('legacy content version transactions', () => {
  function versionedDraft() {
    const exam = { id: 'exam', createdById: 'owner', type: 'ielts_academic', profile: 'practice', isPublished: false, contentVersion: 1, sections: [{ groups: [] }] };
    const section = { id: 'section', examId: 'exam', exam, skill: 'reading', groups: [] };
    const question = { id: 'existing', groupId: 'group', number: 1, type: 'short_answer', prompt: 'Original question.', options: [], correctAnswers: ['word'], points: 1 };
    const group = { id: 'group', sectionId: 'section', section, questions: [question], contentHtml: null, audioKey: 'mock/old.mp3', imageKey: null };
    const outsideWrite = vi.fn().mockRejectedValue(new Error('Content writes must use the transaction client'));
    const reads = (record: object) => ({ findUnique: vi.fn().mockResolvedValue(record), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) });
    const txTable = (record: object) => ({ ...reads(record),
      create: vi.fn().mockResolvedValue(record), delete: vi.fn().mockResolvedValue(record), createMany: vi.fn(), deleteMany: vi.fn(),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ ...record, ...data })),
    });
    const tx = {
      mockExam: { findUnique: vi.fn().mockImplementation(async () => ({ contentVersion: exam.contentVersion })), delete: vi.fn().mockResolvedValue(exam), updateMany: vi.fn().mockImplementation(async () => {
        if (exam.isPublished) return { count: 0 };
        exam.contentVersion++;
        return { count: 1 };
      }) },
      mockSection: txTable(section), mockQuestionGroup: txTable(group), mockQuestion: txTable({ ...question, group }),
      mockAttempt: { count: vi.fn().mockResolvedValue(0) },
    };
    const sourceTable = (record: object) => ({ ...reads(record), create: outsideWrite, update: outsideWrite, delete: outsideWrite, createMany: outsideWrite });
    const prisma = {
      mockExam: { ...sourceTable(exam), findUnique: vi.fn().mockImplementation(async () => ({ ...exam })) },
      mockSection: { ...sourceTable(section), findUnique: vi.fn().mockImplementation(async ({ where }: any) => where.examId_skill ? null : section) },
      mockQuestionGroup: sourceTable(group), mockQuestion: sourceTable({ ...question, group }),
      mockAttempt: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn().mockImplementation(async (run: any) => run(tx)),
    };
    const storage = { delete: vi.fn() };
    const service = new MockAuthoringService(prisma as never, { log: vi.fn() } as never, storage as never, {} as never, { get: () => undefined } as never);
    const actor = { id: 'owner', role: 'teacher' } as never;
    return { service, actor, exam, tx, prisma, outsideWrite, storage };
  }
  const changes: Array<[string, (service: MockAuthoringService, actor: never) => Promise<unknown>]> = [
    ['create section', (s, a) => s.createSection(a, 'exam', { skill: 'reading' })],
    ['update section', (s, a) => s.updateSection(a, 'section', { title: 'New title' })],
    ['delete section', (s, a) => s.deleteSection(a, 'section')],
    ['create group', (s, a) => s.createGroup(a, 'section', {})],
    ['update group', (s, a) => s.updateGroup(a, 'group', { title: 'New title' })],
    ['delete group', (s, a) => s.deleteGroup(a, 'group')],
    ['replace media', (s, a) => s.setGroupMedia(a, 'group', { audio: [{ filename: 'new.mp3' } as never] })],
    ['import questions', (s, a) => s.importQuestions(a, 'group', { text: '2. Complete the word ____', answers: { '2': 'word' } })],
    ['add questions', (s, a) => s.addQuestions(a, 'group', { questions: [{ number: 2, type: 'short_answer', prompt: 'New question.', correctAnswers: ['word'] }] })],
    ['update question', (s, a) => s.updateQuestion(a, 'existing', { prompt: 'Changed question.' })],
    ['delete question', (s, a) => s.deleteQuestion(a, 'existing')],
    ['delete exam', (s, a) => s.deleteExam(a, 'exam')],
  ];

  it.each(changes)('bumps the version atomically with %s', async (_name, change) => {
    const { service, actor, exam, prisma, tx, outsideWrite } = versionedDraft();
    await change(service, actor);
    expect(exam.contentVersion).toBe(2);
    expect(tx.mockExam.updateMany).toHaveBeenCalledWith({ where: { id: 'exam', isPublished: false, attempts: { none: {} } }, data: { contentVersion: { increment: 1 } } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 15000 });
    expect(outsideWrite).not.toHaveBeenCalled();
  });

  it('rejects a stale batch draft after a legacy edit increments its version', async () => {
    const { service, actor, tx } = versionedDraft();
    await service.updateGroup(actor, 'group', { title: 'A newer edit' });
    await expect(service.saveGroupContent(actor, 'group', {
      title: 'Stale edit', expectedContentVersion: 1, deletedQuestionIds: [],
      questions: [{ id: 'existing', number: 1, type: 'short_answer', prompt: 'Original question.', correctAnswers: ['word'] }],
    })).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT' });
    expect(tx.mockQuestionGroup.update).toHaveBeenCalledTimes(1);
  });

  it('does not mutate content when publication wins before acquiring the exam row', async () => {
    const { service, actor, exam, prisma, tx } = versionedDraft();
    prisma.$transaction.mockImplementation(async (run: any) => {
      exam.isPublished = true;
      return run(tx);
    });
    await expect(service.updateGroup(actor, 'group', { title: 'Too late' })).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT' });
    expect(tx.mockQuestionGroup.update).not.toHaveBeenCalled();
    expect(exam.contentVersion).toBe(1);
  });

  it('retains the old media if the database mutation fails', async () => {
    const { service, actor, tx, storage } = versionedDraft();
    tx.mockQuestionGroup.update.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(service.setGroupMedia(actor, 'group', { audio: [{ filename: 'new.mp3' } as never] })).rejects.toThrow('Database unavailable');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('returns the committed media version so the same editor can advance its draft', async () => {
    const { service, actor } = versionedDraft();
    const saved = await service.setGroupMedia(actor, 'group', { audio: [{ filename: 'new.mp3' } as never] });
    expect(saved.version).toBe(2);
    expect(saved.hasAudio).toBe(true);
  });
});
