import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MockAuthoringService } from './mock-authoring.service';
import { multilevelFixture } from './multilevel.fixture';
import { shapeSection } from './mock-shape';
import {
  MULTILEVEL_CURRENT_VERSION,
  MULTILEVEL_SPECIFICATION,
  MULTILEVEL_SPECIFICATIONS,
  MULTILEVEL_VERSION,
  MULTILEVEL_VERSION_V1,
  MULTILEVEL_VERSION_V2,
  MULTILEVEL_VERSIONS,
  NO_PREP_SECONDS,
  multilevelBlueprintIssues,
  multilevelIsCurrentVersion,
  multilevelIsSupportedVersion,
  multilevelSpecification,
  multilevelStartReadiness,
  taskGuidance,
} from './multilevel-specification';
import { BESTWAY_MULTILEVEL_CURRENT_SPEAKING_PROFILE, BESTWAY_MULTILEVEL_SPEAKING_2026_V2 } from './multilevel-speaking-profile';

type ShapedSection = { groups: Array<{ questions: Array<{ guidance?: { taskKey?: string; prepSeconds?: number; responseSeconds?: number; rawMax?: number } }> }> };

/** Authored rows carrying explicit sortOrder, like the database returns them. */
function authoredSections() {
  return multilevelFixture().map((section) => ({
    ...section,
    groups: section.groups.map((group, groupIndex) => ({
      ...group,
      sortOrder: group.sortOrder ?? groupIndex,
      questions: group.questions.map((question, questionIndex) => ({ ...question, sortOrder: questionIndex })),
    })),
  }));
}

/** A speaking section row shaped exactly as Prisma hands it to `shapeSection`. */
function speakingSectionRow() {
  const section = multilevelFixture().find((candidate) => candidate.skill === 'speaking')!;
  return {
    id: 'speaking-section',
    skill: 'speaking',
    title: null,
    sortOrder: 3,
    durationMinutes: null,
    instructions: null,
    groups: section.groups.map((group, groupIndex) => ({
      id: `speaking-${groupIndex}`,
      sortOrder: groupIndex,
      title: null,
      instructions: null,
      passageText: null,
      contentHtml: null,
      audioScript: null,
      contentLayout: null,
      optionsReusable: null,
      audioKey: null,
      // Part 1.2 carries the composite two-picture asset.
      imageKey: groupIndex === 1 ? 'test-only/two-pictures.png' : null,
      maxScore: MULTILEVEL_SPECIFICATION.speaking.parts[groupIndex].rawMax ?? null,
      stimulusRef: null,
      partNumber: null,
      audioDurationSec: null,
      audioPlayLimit: 2,
      questions: group.questions.map((question, questionIndex) => ({
        id: `speaking-${groupIndex}-${questionIndex}`,
        number: questionIndex + 1,
        sortOrder: questionIndex,
        type: question.type,
        prompt: `Speaking prompt ${groupIndex}.${questionIndex}`,
        options: null,
        correctAnswers: [],
        acceptedVariants: [],
        points: question.points,
        wordLimit: null,
        answerRule: null,
      })),
    })),
  } as unknown as Parameters<typeof shapeSection>[0];
}

describe('Multilevel specification revisioning', () => {
  it('A. freezes revision 1 with its historical 15/5/5 Speaking Part 1.2 preparation', () => {
    const v1 = MULTILEVEL_SPECIFICATIONS[MULTILEVEL_VERSION_V1];
    expect(v1.speaking.parts[1].prepSeconds).toEqual([15, 5, 5]);
    expect(v1.speaking.parts[1].responseSeconds).toEqual([45, 30, 30]);
    expect(taskGuidance('speaking', 1, 0, null, MULTILEVEL_VERSION_V1)).toMatchObject({ prepSeconds: 15, responseSeconds: 45 });
    expect(taskGuidance('speaking', 1, 2, null, MULTILEVEL_VERSION_V1)).toMatchObject({ prepSeconds: 5, responseSeconds: 30 });
    // Revision 1 keeps its own Speaking 1.1 preparation semantics too.
    expect(v1.speaking.parts[0].prepSeconds).toEqual([0, 0, 0]);
  });

  it('B. gives the current revision NO official Speaking Part 1.2 preparation with 45/30/30 responses', () => {
    const current = MULTILEVEL_SPECIFICATIONS[MULTILEVEL_CURRENT_VERSION];
    expect(current.speaking.parts[1].prepSeconds).toEqual(NO_PREP_SECONDS);
    expect(current.speaking.parts[1].responseSeconds).toEqual([45, 30, 30]);
    expect(taskGuidance('speaking', 1, 0)).toMatchObject({ prepSeconds: 0, responseSeconds: 45 });
    expect(taskGuidance('speaking', 1, 1)).toMatchObject({ prepSeconds: 0, responseSeconds: 30 });
    expect(taskGuidance('speaking', 1, 2)).toMatchObject({ prepSeconds: 0, responseSeconds: 30 });
    // Parts 1.1, 2 and 3 are untouched by the revision.
    expect(current.speaking.parts[0].prepSeconds).toEqual(NO_PREP_SECONDS);
    expect(taskGuidance('speaking', 2, 0)).toMatchObject({ prepSeconds: 60, responseSeconds: 120 });
    expect(taskGuidance('speaking', 3, 0)).toMatchObject({ prepSeconds: 60, responseSeconds: 120 });
    // A revision only differs where it must: the other three sections are identical.
    const v1 = MULTILEVEL_SPECIFICATIONS[MULTILEVEL_VERSION_V1];
    for (const skill of ['listening', 'reading', 'writing'] as const) {
      expect(current[skill]).toEqual(v1[skill]);
    }
  });

  it('exposes exactly two supported revisions and one current revision', () => {
    expect(MULTILEVEL_VERSIONS).toEqual([MULTILEVEL_VERSION_V1, MULTILEVEL_VERSION_V2]);
    expect(MULTILEVEL_VERSION).toBe(MULTILEVEL_CURRENT_VERSION);
    expect(MULTILEVEL_CURRENT_VERSION).toBe(MULTILEVEL_VERSION_V2);
    expect(multilevelIsSupportedVersion(MULTILEVEL_VERSION_V1)).toBe(true);
    expect(multilevelIsSupportedVersion(MULTILEVEL_VERSION_V2)).toBe(true);
    expect(multilevelIsCurrentVersion(MULTILEVEL_VERSION_V1)).toBe(false);
    expect(multilevelIsCurrentVersion(MULTILEVEL_VERSION_V2)).toBe(true);
    for (const unsupported of [null, undefined, '', 'UZBMB_MULTILEVEL_EN_PHASE15_LEGACY']) {
      expect(multilevelIsSupportedVersion(unsupported)).toBe(false);
      expect(multilevelIsCurrentVersion(unsupported)).toBe(false);
      expect(multilevelSpecification(unsupported)).toBeUndefined();
    }
  });

  it('C. stamps a newly created Multilevel exam with the current revision and current speaking profile', async () => {
    const prisma = { mockExam: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-exam', ...data })) } };
    const service = new MockAuthoringService(
      prisma as never, { log: vi.fn() } as never, {} as never, {} as never, { get: () => undefined } as never,
    );
    const created = await service.createExam(
      { id: 'admin', role: 'admin' } as never,
      { type: 'multilevel', title: 'Versioned Multilevel', profile: 'full_mock' } as never,
    );
    expect(prisma.mockExam.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        specificationVersion: MULTILEVEL_CURRENT_VERSION,
        speakingProfileVersion: BESTWAY_MULTILEVEL_CURRENT_SPEAKING_PROFILE,
      }),
    }));
    expect(created).toMatchObject({ specificationVersion: MULTILEVEL_VERSION_V2 });
    // The retired product profile is never stamped on a new exam.
    expect(prisma.mockExam.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ speakingProfileVersion: BESTWAY_MULTILEVEL_SPEAKING_2026_V2 }),
    }));
  });

  it('G. keeps Review, Catalogue, Detail and Start on the same verdict for every supported revision', () => {
    const sections = multilevelFixture();
    for (const version of [MULTILEVEL_VERSION_V1, MULTILEVEL_VERSION_V2]) {
      const blueprint = multilevelBlueprintIssues(sections, true, version);
      const readiness = multilevelStartReadiness({ specificationVersion: version, profile: 'full_mock', sections });
      // Start (`multilevelStartReadiness`) and the publish/Review gate
      // (`multilevelBlueprintIssues`) must be the same verdict...
      expect(readiness).toMatchObject({ supported: true, issues: blueprint });
      expect(blueprint).toEqual([]);
    }
    // ...and the exam Detail payload must serve that same revision's timing,
    // so a student never receives guidance the validator did not approve.
    const current = shapeSection(speakingSectionRow(), false, 'https://api.test/v1', true, null, MULTILEVEL_CURRENT_VERSION) as ShapedSection;
    expect(current.groups[1].questions[0].guidance).toMatchObject({ taskKey: '1.2', prepSeconds: 0, responseSeconds: 45, rawMax: 5 });
    const historical = shapeSection(speakingSectionRow(), false, 'https://api.test/v1', true, null, MULTILEVEL_VERSION_V1) as ShapedSection;
    expect(historical.groups[1].questions[0].guidance).toMatchObject({ taskKey: '1.2', prepSeconds: 15, responseSeconds: 45, rawMax: 5 });
  });

  it('H. keeps semantic readiness stable when database rows arrive in a scrambled physical order', () => {
    const ordered = authoredSections();
    const scrambled = ordered.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({ ...group, questions: [...group.questions].reverse() })),
    }));
    for (const version of [MULTILEVEL_VERSION_V1, MULTILEVEL_VERSION_V2]) {
      expect(multilevelBlueprintIssues(scrambled, true, version)).toEqual(multilevelBlueprintIssues(ordered, true, version));
      expect(multilevelBlueprintIssues(scrambled, true, version)).toEqual([]);
    }
    // A genuine authored-order change is still reported for the current revision.
    const reordered = authoredSections();
    const readingPart4 = reordered[1].groups[3];
    readingPart4.questions.forEach((question, index) => { question.sortOrder = index; });
    const first = readingPart4.questions[0];
    readingPart4.questions[0] = readingPart4.questions[4];
    readingPart4.questions[4] = first;
    readingPart4.questions[0].sortOrder = 0;
    readingPart4.questions[4].sortOrder = 4;
    expect(multilevelBlueprintIssues(reordered, true, MULTILEVEL_CURRENT_VERSION)).toEqual(
      expect.arrayContaining([expect.stringContaining('reading 4 question 1: invalid type')]),
    );
  });
});
