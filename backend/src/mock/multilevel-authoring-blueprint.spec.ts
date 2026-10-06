import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MockAuthoringService } from './mock-authoring.service';
import { multilevelFixture } from './multilevel.fixture';
import {
  MULTILEVEL_SPECIFICATION,
  MULTILEVEL_VERSION,
  multilevelBlueprintIssues,
  taskGuidance,
} from './multilevel-specification';

const MANUAL = new Set(['essay_task1', 'essay_task2', 'speaking_task']);

/**
 * The fixture shaped the way Prisma returns authored rows: every question has a
 * resolvable key, objective parts have one mark each, and the Multilevel group
 * caps/stimuli/media come from the specification.
 */
function blueprint() {
  return multilevelFixture().map((section) => {
    let number = 0;
    return {
      ...section,
      groups: section.groups.map((group, gi) => ({
        ...group,
        maxScore: MULTILEVEL_SPECIFICATION[section.skill].parts[gi].rawMax ?? null,
        passageText: section.skill === 'reading' ? `Disposable passage for reading part ${gi + 1}.` : group.passageText,
        questions: group.questions.map((question) => {
          number += 1;
          const type = String(question.type);
          const options = Array.isArray(question.options) ? (question.options as string[]) : [];
          return {
            ...question,
            number,
            options,
            wordLimit: MANUAL.has(type) ? null : 1,
            correctAnswers: MANUAL.has(type)
              ? []
              : type === 'true_false_notgiven'
                ? ['TRUE']
                : options.length
                  ? [options[0]]
                  : ['answer'],
          };
        }),
      })),
    };
  });
}

type Sections = ReturnType<typeof blueprint>;

const countOf = (sections: Sections, skill: string) =>
  sections.find((s) => s.skill === skill)!.groups.reduce((n, g) => n + g.questions.length, 0);
const groupOf = (sections: Sections, skill: string, index: number) =>
  sections.find((s) => s.skill === skill)!.groups[index];

function readinessService(exam: unknown, storageExists = true) {
  const prisma = {
    mockExam: { findUnique: vi.fn(async () => exam) },
    mockImportReviewIssue: { count: vi.fn(async () => 0) },
  };
  const storage = { exists: vi.fn(() => storageExists) };
  return new MockAuthoringService(
    prisma as never,
    { log: vi.fn(async () => undefined) } as never,
    storage as never,
    {} as never,
    { get: () => undefined } as never,
  );
}

function examRow(sections: Sections, profile = 'full_mock') {
  return {
    id: 'phase2-exam', type: 'multilevel', title: 'Phase 2 disposable', description: null,
    profile, specificationVersion: MULTILEVEL_VERSION, speakingProfileVersion: null,
    isPublished: false, sections,
  };
}

describe('Multilevel authoring blueprint', () => {
  it('accepts a complete current-format full mock', () => {
    const sections = blueprint();
    expect(multilevelBlueprintIssues(sections, true)).toEqual([]);
    expect(countOf(sections, 'listening')).toBe(35);
    expect(countOf(sections, 'reading')).toBe(35);
    expect(countOf(sections, 'writing')).toBe(3);
    expect(countOf(sections, 'speaking')).toBe(8);
  });

  it('enforces the Listening structure: 6 parts, 35 questions, per-part formats', () => {
    const missingPart = blueprint();
    missingPart.find((s) => s.skill === 'listening')!.groups.pop();
    expect(multilevelBlueprintIssues(missingPart, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('listening: requires 6 parts')]),
    );

    const noAudio = blueprint();
    groupOf(noAudio, 'listening', 0).audioKey = null;
    expect(multilevelBlueprintIssues(noAudio, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('listening 1: audio and matching part number required')]),
    );

    const noDuration = blueprint();
    groupOf(noDuration, 'listening', 0).audioDurationSec = null;
    expect(multilevelBlueprintIssues(noDuration, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('listening 1: positive audio duration required')]),
    );

    const wrongCount = blueprint();
    groupOf(wrongCount, 'listening', 1).questions.pop();
    expect(multilevelBlueprintIssues(wrongCount, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('listening 2: requires 6 responses/questions')]),
    );

    const wrongType = blueprint();
    groupOf(wrongType, 'listening', 2).questions[0].type = 'multiple_choice';
    expect(multilevelBlueprintIssues(wrongType, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('listening 3 question 1: invalid type')]),
    );

    const wrongBank = blueprint();
    groupOf(wrongBank, 'listening', 3).questions.forEach((q) => { (q as { options?: unknown }).options = ['one', 'two']; });
    expect(multilevelBlueprintIssues(wrongBank, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('listening 4: requires 8 options')]),
    );
  });

  it('enforces the Reading structure: 5 parts, 35 questions, per-part formats', () => {
    const missingPart = blueprint();
    missingPart.find((s) => s.skill === 'reading')!.groups.pop();
    expect(multilevelBlueprintIssues(missingPart, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('reading: requires 5 parts')]),
    );

    // Part 4 mixes 4 MCQ with 5 TRUE/FALSE/NOT GIVEN.
    const mixedType = blueprint();
    groupOf(mixedType, 'reading', 3).questions[0].type = 'true_false_notgiven';
    expect(multilevelBlueprintIssues(mixedType, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('reading 4 question 1: invalid type')]),
    );

    // Part 5 is 4 gap-fills then 2 MCQ.
    const mixedType5 = blueprint();
    groupOf(mixedType5, 'reading', 4).questions[4].type = 'short_answer';
    expect(multilevelBlueprintIssues(mixedType5, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('reading 5 question 5: invalid type')]),
    );

    const headings = blueprint();
    groupOf(headings, 'reading', 2).questions.forEach((q) => { (q as { options?: unknown }).options = ['a', 'b']; });
    expect(multilevelBlueprintIssues(headings, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('reading 3: requires 8 options')]),
    );

    const oneWord = blueprint();
    groupOf(oneWord, 'reading', 0).questions[0].wordLimit = 2;
    expect(multilevelBlueprintIssues(oneWord, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('one-word/number answer required')]),
    );
  });

  it('enforces Writing at TASK level: three tasks, /5 /5 /6 and one shared stimulus', () => {
    const sections = blueprint();
    expect(groupOf(sections, 'writing', 0).maxScore).toBe(5);
    expect(groupOf(sections, 'writing', 1).maxScore).toBe(5);
    expect(groupOf(sections, 'writing', 2).maxScore).toBe(6);

    const badCap = blueprint();
    groupOf(badCap, 'writing', 1).maxScore = 9;
    expect(multilevelBlueprintIssues(badCap, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('writing formal_email: points must be 5')]),
    );

    const splitStimulus = blueprint();
    groupOf(splitStimulus, 'writing', 1).stimulusRef = 'a-different-situation';
    expect(multilevelBlueprintIssues(splitStimulus, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('informal and formal emails must share the same source stimulus')]),
    );

    const missingTask = blueprint();
    missingTask.find((s) => s.skill === 'writing')!.groups.pop();
    expect(multilevelBlueprintIssues(missingTask, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('writing: requires 3 parts')]),
    );
  });

  it('enforces Speaking at PART level: counts, two-picture asset and /5 /5 /5 /6', () => {
    const sections = blueprint();
    const speaking = sections.find((s) => s.skill === 'speaking')!;
    expect(speaking.groups.map((g) => g.questions.length)).toEqual([3, 3, 1, 1]);
    expect(speaking.groups.map((g) => g.maxScore)).toEqual([5, 5, 5, 6]);

    const noPictures = blueprint();
    groupOf(noPictures, 'speaking', 1).imageKey = null;
    expect(multilevelBlueprintIssues(noPictures, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('speaking 1.2: two-picture asset required')]),
    );

    const badCap = blueprint();
    groupOf(badCap, 'speaking', 3).maxScore = 5;
    expect(multilevelBlueprintIssues(badCap, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('speaking 3: points must be 6')]),
    );

    const wrongCount = blueprint();
    groupOf(wrongCount, 'speaking', 0).questions.pop();
    expect(multilevelBlueprintIssues(wrongCount, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('speaking 1.1: requires 3 responses/questions')]),
    );
  });

  it('exposes the official part timing metadata the part panel displays', () => {
    expect(taskGuidance('speaking', 0, 0)).toMatchObject({ prepSeconds: 0, responseSeconds: 30 });
    expect(taskGuidance('speaking', 1, 0)).toMatchObject({ prepSeconds: 15, responseSeconds: 45 });
    expect(taskGuidance('speaking', 1, 2)).toMatchObject({ prepSeconds: 5, responseSeconds: 30 });
    expect(taskGuidance('speaking', 2, 0)).toMatchObject({ prepSeconds: 60, responseSeconds: 120 });
    expect(taskGuidance('speaking', 3, 0)).toMatchObject({ prepSeconds: 60, responseSeconds: 120 });
    expect(taskGuidance('writing', 0, 0)).toMatchObject({ rawMax: 5, wordMin: 50, wordMax: 50, displayLabel: 'Task 1.1 — Informal Letter' });
    expect(taskGuidance('writing', 2, 0)).toMatchObject({ rawMax: 6, wordMin: 180, wordMax: 200, displayLabel: 'Task 2 — Publication' });
  });

  it('cannot be published until the structure is complete', () => {
    // The publish gate consumes exactly this verdict, so an incomplete exam
    // produces a non-empty issue list (Review not ready → PATCH isPublished).
    const incomplete = blueprint();
    incomplete.find((s) => s.skill === 'speaking')!.groups.pop();
    const issues = multilevelBlueprintIssues(incomplete, true);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('; ')).toContain('speaking: requires 4 parts');
  });

  it('reads authored order, not physical row order, through the real readiness path', async () => {
    const sections = blueprint();
    // Simulate a database returning rows in a different physical order while
    // the authored sequence survives in sortOrder.
    for (const section of sections) {
      for (const group of section.groups) {
        group.questions.forEach((question, index) => { (question as { sortOrder?: number }).sortOrder = index; });
        if (section.skill === 'reading' || section.skill === 'listening') group.questions.reverse();
      }
    }
    const service = readinessService(examRow(sections));
    const result = await service.readiness({ id: 'admin', role: 'admin' } as never, 'phase2-exam');
    expect(result.ready).toBe(true);
    expect(result.items.filter((i) => !i.ok)).toEqual([]);
  });

  it('still fails readiness when the authored order itself is wrong', async () => {
    const sections = blueprint();
    const reading4 = groupOf(sections, 'reading', 3);
    reading4.questions.forEach((question, index) => { (question as { sortOrder?: number }).sortOrder = index; });
    // Genuinely move a NOT GIVEN item into the MCQ slots.
    const first = reading4.questions[0];
    reading4.questions[0] = reading4.questions[4];
    reading4.questions[4] = first;
    (reading4.questions[0] as { sortOrder?: number }).sortOrder = 0;
    (reading4.questions[4] as { sortOrder?: number }).sortOrder = 4;

    const service = readinessService(examRow(sections));
    const result = await service.readiness({ id: 'admin', role: 'admin' } as never, 'phase2-exam');
    expect(result.ready).toBe(false);
    expect(result.items.some((i) => !i.ok && i.detail.includes('reading 4 question 1: invalid type'))).toBe(true);
  });

  it('fails readiness when referenced media is unavailable', async () => {
    const service = readinessService(examRow(blueprint()), false);
    const result = await service.readiness({ id: 'admin', role: 'admin' } as never, 'phase2-exam');
    expect(result.ready).toBe(false);
    expect(result.items.find((i) => i.key === 'media_assets')?.ok).toBe(false);
  });
});
