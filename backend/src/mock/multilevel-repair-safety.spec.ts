import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MockAuthoringService } from './mock-authoring.service';
import { MockController } from './mock.controller';
import { ROLES_KEY } from '../common/decorators';
import { multilevelFixture } from './multilevel.fixture';
import { MULTILEVEL_VERSION } from './multilevel-specification';

const LEGACY_VERSION = 'UZBMB_MULTILEVEL_EN_LEGACY';

/** Fully-formed rows in the shape Prisma returns for an exam with sections. */
function buildSections() {
  const fixture = multilevelFixture();
  const groups = fixture.flatMap((section) =>
    section.groups.map((group, index) => ({
      ...group,
      id: `${section.skill}-${index}`,
      sectionId: `${section.skill}-section`,
      title: null as string | null,
      instructions: null as string | null,
      contentHtml: null as string | null,
      audioScript: null as string | null,
      contentLayout: null as string | null,
      optionsReusable: null as boolean | null,
      audioPlayLimit: 2,
      questions: group.questions.map((question, questionIndex) => ({
        ...question,
        id: `${section.skill}-${index}-${questionIndex}`,
        number: questionIndex + 1,
        sortOrder: questionIndex,
        correctAnswers: [] as string[],
        acceptedVariants: [] as string[],
        answerRule: null as string | null,
      })),
    })),
  );
  const sections = fixture.map((section, sectionIndex) => {
    const sectionId = `${section.skill}-section`;
    return {
      id: sectionId,
      skill: section.skill,
      sortOrder: sectionIndex,
      title: null as string | null,
      durationMinutes: null as number | null,
      instructions: null as string | null,
      groups: groups.filter((group) => group.sectionId === sectionId),
    };
  });
  return {
    groups,
    sections,
    writing: groups.filter((group) => group.sectionId === 'writing-section'),
    speaking: groups.filter((group) => group.sectionId === 'speaking-section'),
  };
}

/** A legacy "cefr c1"-shaped exam: wrong caps and two different writing stimuli. */
function buildExam(specificationVersion: string | null = MULTILEVEL_VERSION) {
  const { groups, sections, writing, speaking } = buildSections();
  writing[0].maxScore = 1;
  writing[1].maxScore = 2;
  writing[0].stimulusRef = 'legacy-a';
  writing[1].stimulusRef = 'legacy-b';
  speaking.forEach((group) => {
    group.maxScore = 1;
  });
  const exam = {
    id: 'cefr-c1',
    type: 'multilevel',
    title: 'cefr c1',
    profile: 'full_mock',
    specificationVersion,
    isPublished: true,
    contentVersion: 21,
    sections,
  };
  return { exam, groups, writing, speaking };
}

interface HistoryCounts {
  attempts?: number;
  active?: number;
  completed?: number;
  submissions?: number;
  results?: number;
}

function makeService(state: ReturnType<typeof buildExam>, counts: HistoryCounts = {}) {
  const { exam } = state;
  const attemptCount = counts.attempts ?? 0;
  const prisma = {
    mockExam: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === exam.id ? exam : null)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        for (const [key, value] of Object.entries(data)) {
          if (key !== 'contentVersion') (exam as unknown as Record<string, unknown>)[key] = value;
        }
        const increment = (data.contentVersion as { increment?: number } | undefined)?.increment;
        if (increment) exam.contentVersion += increment;
        return { contentVersion: exam.contentVersion };
      }),
    },
    mockAttempt: {
      count: vi.fn(async ({ where }: { where: { status?: string; submittedAt?: unknown } }) => {
        if (where.status === 'in_progress') return counts.active ?? attemptCount;
        if (where.status === 'completed') return counts.completed ?? 0;
        if (where.submittedAt) return counts.submissions ?? 0;
        return attemptCount;
      }),
    },
    assessmentJob: { count: vi.fn(async () => counts.results ?? 0) },
    mockSection: {
      findMany: vi.fn(async ({ where }: { where: { examId: string; skill: { in: string[] } } }) =>
        exam.sections.filter((section) => where.examId === exam.id && where.skill.in.includes(section.skill))),
    },
    mockQuestionGroup: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const group = state.groups.find((candidate) => candidate.id === where.id)!;
        Object.assign(group, data);
        return group;
      }),
    },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(prisma)),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new MockAuthoringService(
    prisma as never,
    audit as never,
    { exists: () => true } as never,
    {} as never,
    { get: () => undefined } as never,
  );
  const admin = { id: 'admin', role: 'admin' } as never;
  return { service, prisma, audit, admin, ...state };
}

describe('Multilevel legacy repair safety gate', () => {
  it('allows an explicit repair only on an unused current-version exam, and inspection never mutates', async () => {
    const state = buildExam();
    const { service, prisma, admin, exam, writing, speaking } = makeService(state, { attempts: 0 });
    const before = JSON.parse(JSON.stringify(exam)) as unknown;

    const inspection = await service.multilevelRepairInspection(admin, exam.id);
    expect(inspection).toMatchObject({
      attempts: { attemptCount: 0, activeAttemptCount: 0, completedAttemptCount: 0, submissionCount: 0, resultCount: 0 },
      safeRepairAllowed: true,
      historyExists: false,
      currentVersion: true,
      requiresUnpublish: true,
      recommendedAction: 'REPAIR_DRAFT_THEN_REVIEW',
    });
    expect(inspection.proposedChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'Writing informal_email maxScore', to: 5 }),
      expect.objectContaining({ field: 'Speaking 3 maxScore', to: 6 }),
    ]));

    // Opening the inspection must be a pure read, even though repair is offered.
    expect(prisma.mockExam.update).not.toHaveBeenCalled();
    expect(prisma.mockQuestionGroup.update).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(exam))).toEqual(before);

    await expect(service.applyMultilevelSafeRepair(admin, exam.id, false)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(exam.isPublished).toBe(true);

    await expect(service.applyMultilevelSafeRepair(admin, exam.id, true)).resolves.toMatchObject({
      unpublished: true,
      versionUpgraded: false,
      status: 'DRAFT_REQUIRES_REVIEW',
    });
    expect(exam.isPublished).toBe(false);
    expect(exam.contentVersion).toBe(22);
    expect(writing.map((group) => group.maxScore)).toEqual([5, 5, 6]);
    expect(writing[0].stimulusRef).toBe(writing[1].stimulusRef);
    expect(speaking.map((group) => group.maxScore)).toEqual([5, 5, 5, 6]);
  });

  it('upgrades a zero-history legacy definition to the current specification, still as a draft', async () => {
    const { service, admin, exam } = makeService(buildExam(LEGACY_VERSION), { attempts: 0 });
    const inspection = await service.multilevelRepairInspection(admin, exam.id);
    expect(inspection).toMatchObject({ safeRepairAllowed: true, currentVersion: false, historyExists: false });

    await expect(service.applyMultilevelSafeRepair(admin, exam.id, true)).resolves.toMatchObject({
      versionUpgraded: true,
      unpublished: true,
      status: 'DRAFT_REQUIRES_REVIEW',
    });
    expect(exam.specificationVersion).toBe(MULTILEVEL_VERSION);
    expect(exam.isPublished).toBe(false);
  });

  it('preserves an attempted original and requires a corrected clone', async () => {
    const { service, admin, exam } = makeService(buildExam(), { attempts: 1 });
    const inspection = await service.multilevelRepairInspection(admin, exam.id);
    expect(inspection).toMatchObject({ historyExists: true, safeRepairAllowed: false, recommendedAction: 'CREATE_CORRECTED_COPY' });

    await expect(service.applyMultilevelSafeRepair(admin, exam.id, true)).rejects.toMatchObject({ code: 'EXAM_VERSION_IN_USE' });
    const clone = vi.spyOn(service, 'cloneExam').mockResolvedValue({ id: 'corrected-copy' } as never);
    await expect(service.cloneCorrectedMultilevel(admin, exam.id)).resolves.toEqual({
      id: 'corrected-copy',
      status: 'DRAFT_REQUIRES_REVIEW',
      sourcePreserved: true,
    });
    expect(clone).toHaveBeenCalledWith(admin, exam.id);
    expect(exam.isPublished).toBe(true);
    expect(exam.contentVersion).toBe(21);
  });

  it('denies in-place repair when only submissions or results exist, even with zero attempts', async () => {
    const { service, admin, exam } = makeService(buildExam(), { attempts: 0, submissions: 2, results: 1 });
    const inspection = await service.multilevelRepairInspection(admin, exam.id);
    expect(inspection.attempts).toMatchObject({ attemptCount: 0, submissionCount: 2, resultCount: 1 });
    expect(inspection).toMatchObject({ historyExists: true, safeRepairAllowed: false, recommendedAction: 'CREATE_CORRECTED_COPY' });

    await expect(service.applyMultilevelSafeRepair(admin, exam.id, true)).rejects.toMatchObject({ code: 'EXAM_VERSION_IN_USE' });
    expect(exam.isPublished).toBe(true);
    expect(exam.contentVersion).toBe(21);

    const clone = vi.spyOn(service, 'cloneExam').mockResolvedValue({ id: 'copy' } as never);
    await expect(service.cloneCorrectedMultilevel(admin, exam.id)).resolves.toMatchObject({ id: 'copy', sourcePreserved: true });
    expect(clone).toHaveBeenCalled();
  });

  it('rejects students and teachers from inspecting, repairing and cloning', async () => {
    const { service, exam } = makeService(buildExam(), { attempts: 1 });
    const student = { id: 'student', role: 'student' } as never;
    const teacher = { id: 'teacher', role: 'teacher' } as never;

    await expect(service.multilevelRepairInspection(student, exam.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.applyMultilevelSafeRepair(student, exam.id, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.applyMultilevelSafeRepair(teacher, exam.id, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.cloneCorrectedMultilevel(teacher, exam.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(exam.isPublished).toBe(true);
  });

  it('guards the HTTP routes with admin-only roles', () => {
    const routes = ['multilevelRepairInspection', 'applyMultilevelSafeRepair', 'cloneCorrectedMultilevel'];
    for (const route of routes) {
      const handler = (MockController.prototype as unknown as Record<string, object>)[route];
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['admin', 'super_admin']);
    }
  });
});

describe('corrected Multilevel clone', () => {
  /** In-memory stand-in for the clone transaction; deliberately has no attempt or answer delegate. */
  function cloneHarness() {
    const { groups, sections, writing, speaking } = buildSections();
    writing[0].maxScore = 1;
    writing[1].maxScore = 2;
    writing[0].stimulusRef = 'legacy-a';
    writing[1].stimulusRef = 'legacy-b';
    speaking.forEach((group) => {
      group.maxScore = 1;
    });
    const source = {
      id: 'src-exam',
      type: 'multilevel',
      specificationVersion: LEGACY_VERSION,
      speakingProfileVersion: null as string | null,
      assessmentPolicy: null as string | null,
      profile: 'full_mock',
      title: 'cefr c1',
      description: null as string | null,
      level: null as string | null,
      practiceLevel: null as string | null,
      isPublished: true,
      isDemo: false,
      price: null as number | null,
      isFreeForApproved: false,
      createdById: 'owner',
      sections,
    };
    void groups;

    const created = {
      exams: [] as Array<Record<string, unknown>>,
      sections: [] as Array<Record<string, unknown>>,
      groups: [] as Array<Record<string, unknown>>,
      questions: [] as Array<Record<string, unknown>>,
    };
    const tx = {
      mockExam: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: 'copy-exam', ...data };
          created.exams.push(row);
          return row;
        }),
      },
      mockSection: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `copy-section-${created.sections.length}`, ...data };
          created.sections.push(row);
          return row;
        }),
        findMany: vi.fn(async ({ where }: { where: { examId: string; skill: { in: string[] } } }) =>
          created.sections
            .filter((section) => section.examId === where.examId && where.skill.in.includes(String(section.skill)))
            .map((section) => ({
              ...section,
              groups: created.groups.filter((group) => group.sectionId === section.id),
            }))),
      },
      mockQuestionGroup: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `copy-group-${created.groups.length}`, ...data, questions: [] };
          created.groups.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const group = created.groups.find((candidate) => candidate.id === where.id)!;
          Object.assign(group, data);
          return group;
        }),
      },
      mockQuestion: {
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          created.questions.push(...data);
          return { count: data.length };
        }),
      },
    };
    const prisma = {
      // Only the history lookup reads the source exam; the clone never touches it.
      mockExam: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === source.id ? source : null)) },
      mockAttempt: {
        count: vi.fn(async ({ where }: { where: { status?: string; submittedAt?: unknown } }) =>
          where.status || where.submittedAt ? 0 : 4),
      },
      assessmentJob: { count: vi.fn(async () => 3) },
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const audit = { log: vi.fn(async () => undefined) };
    const service = new MockAuthoringService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
      { get: () => undefined } as never,
    );
    const admin = { id: 'admin-2', role: 'admin' } as never;
    return { service, admin, source, created, prisma, audit };
  }

  it('keeps the original intact, creates a reconciled draft and copies media references without attempts', async () => {
    const { service, admin, source, created } = cloneHarness();
    const before = JSON.parse(JSON.stringify(source)) as unknown;

    const result = await service.cloneCorrectedMultilevel(admin, source.id);
    expect(result).toEqual({ id: 'copy-exam', status: 'DRAFT_REQUIRES_REVIEW', sourcePreserved: true });

    // The historical source — including its legacy caps and stimuli — is untouched.
    expect(JSON.parse(JSON.stringify(source))).toEqual(before);

    // New identity, always a private draft owned by the cloning admin, never inheriting history.
    expect(created.exams).toHaveLength(1);
    expect(created.exams[0]).toMatchObject({
      id: 'copy-exam',
      title: 'cefr c1 (copy)',
      isPublished: false,
      createdById: 'admin-2',
      specificationVersion: MULTILEVEL_VERSION,
    });
    expect(created.exams[0]).not.toHaveProperty('attempts');

    // Authored content travels with the clone.
    expect(created.questions).toHaveLength(81);

    const listeningSection = created.sections.find((section) => section.skill === 'listening')!;
    const listeningGroups = created.groups.filter((group) => group.sectionId === listeningSection.id);
    expect(listeningGroups[0]).toMatchObject({ audioKey: 'test-only/community-0.wav', audioDurationSec: 60, partNumber: 1 });

    const speakingSection = created.sections.find((section) => section.skill === 'speaking')!;
    const speakingGroups = created.groups.filter((group) => group.sectionId === speakingSection.id);
    expect(speakingGroups[1]).toMatchObject({ imageKey: 'test-only/community-pictures.png' });

    // The copy alone is reconciled to the current blueprint.
    const writingSection = created.sections.find((section) => section.skill === 'writing')!;
    const writingGroups = created.groups.filter((group) => group.sectionId === writingSection.id);
    expect(writingGroups.map((group) => group.maxScore)).toEqual([5, 5, 6]);
    expect(writingGroups[0].stimulusRef).toBe(writingGroups[1].stimulusRef);
    expect(speakingGroups.map((group) => group.maxScore)).toEqual([5, 5, 5, 6]);
  });

  it('refuses to clone an exam that has no history, pointing at in-place repair instead', async () => {
    const { service, admin, source, prisma } = cloneHarness();
    prisma.mockAttempt.count = vi.fn(async () => 0);
    prisma.assessmentJob.count = vi.fn(async () => 0);

    await expect(service.cloneCorrectedMultilevel(admin, source.id)).rejects.toMatchObject({ code: 'SAFE_REPAIR_AVAILABLE' });
  });
});
