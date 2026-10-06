import { MockSkill } from '@prisma/client';
import { speakingProfileTiming } from './multilevel-speaking-profile';

/**
 * Revision 1 (historical, immutable): Speaking Part 1.2 carried a short
 * official preparation of 15/5/5 seconds. Exams already stamped with this
 * version keep this exact behaviour forever.
 */
export const MULTILEVEL_VERSION_V1 = 'UZBMB_MULTILEVEL_EN_2026_V1';
/**
 * Revision 2 (current): Speaking Part 1.2 has NO official preparation; each of
 * the three responses is answered immediately. Responses stay 45/30/30.
 * Every other section, part count, scale and conversion table is unchanged.
 */
export const MULTILEVEL_VERSION_V2 = 'UZBMB_MULTILEVEL_EN_2026_V2';

/** The revision newly created / cloned / imported Multilevel exams receive. */
export const MULTILEVEL_CURRENT_VERSION = MULTILEVEL_VERSION_V2;

/** Every revision a stored exam or attempt may still legally be on. */
export const MULTILEVEL_VERSIONS = [MULTILEVEL_VERSION_V1, MULTILEVEL_VERSION_V2] as const;
export type MultilevelVersion = (typeof MULTILEVEL_VERSIONS)[number];

/**
 * Retained name. Call sites that mean "stamp the newest revision" keep reading
 * as before; call sites that mean "is a supported versioned Multilevel" must use
 * `multilevelIsSupportedVersion`, otherwise historical V1 exams would silently
 * stop being readable once the current version moves on.
 */
export const MULTILEVEL_VERSION = MULTILEVEL_CURRENT_VERSION;

/**
 * Scoring contract version. The V1 -> V2 revision changed Speaking *timing*
 * only, so the estimate anchors and conversion tables are byte-identical and
 * the recorded score version must not drift with the blueprint version.
 */
export const ESTIMATE_VERSION = `${MULTILEVEL_VERSION_V1}_ESTIMATE_V1`;
export type MultilevelLevel = 'C1' | 'B2' | 'B1' | 'BELOW_B1';
export type ScoreMethod = 'ESTIMATED' | 'OFFICIAL_CALIBRATED';

export interface PartSpecification {
  key: string;
  count: number;
  types: readonly string[];
  rawMax?: number;
  wordMin?: number;
  wordMax?: number;
  options?: number;
  prepSeconds?: readonly number[];
  responseSeconds?: readonly number[];
}
interface SectionSpecification {
  durationSeconds: number;
  parts: readonly PartSpecification[];
}
const part = (key: string, count: number, types: string[], rest: Partial<PartSpecification> = {}): PartSpecification =>
  ({ key, count, types, ...rest });

/** Immutable version: changes to format, timing or scales require a NEW version. */
function specification(part12PrepSeconds: readonly number[]): Readonly<Record<MockSkill, SectionSpecification>> {
  return {
    listening: { durationSeconds: 45 * 60, parts: [
      part('1', 8, ['multiple_choice'], { options: 3 }),
      part('2', 6, ['short_answer', 'note_completion']),
      part('3', 4, ['matching'], { options: 6 }),
      part('4', 5, ['matching'], { options: 8 }),
      part('5', 6, ['multiple_choice'], { options: 3 }),
      part('6', 6, ['short_answer', 'note_completion']),
    ] },
    reading: { durationSeconds: 60 * 60, parts: [
      part('1', 6, ['short_answer', 'sentence_completion']),
      part('2', 8, ['matching'], { options: 10 }),
      part('3', 6, ['matching_headings'], { options: 8 }),
      part('4', 9, ['multiple_choice', 'true_false_notgiven']),
      part('5', 6, ['short_answer', 'summary_completion', 'multiple_choice']),
    ] },
    writing: { durationSeconds: 60 * 60, parts: [
      part('informal_email', 1, ['essay_task1'], { rawMax: 5, wordMin: 50, wordMax: 50 }),
      part('formal_email', 1, ['essay_task1'], { rawMax: 5, wordMin: 120, wordMax: 150 }),
      part('publication', 1, ['essay_task2'], { rawMax: 6, wordMin: 180, wordMax: 200 }),
    ] },
    speaking: { durationSeconds: 11 * 60, parts: [
      part('1.1', 3, ['speaking_task'], { rawMax: 5, prepSeconds: [0, 0, 0], responseSeconds: [30, 30, 30] }),
      part('1.2', 3, ['speaking_task'], { rawMax: 5, prepSeconds: part12PrepSeconds, responseSeconds: [45, 30, 30] }),
      part('2', 1, ['speaking_task'], { rawMax: 5, prepSeconds: [60], responseSeconds: [120] }),
      part('3', 1, ['speaking_task'], { rawMax: 6, prepSeconds: [60], responseSeconds: [120] }),
    ] },
  };
}

/** The immutable blueprint of every supported revision, keyed by version. */
export const MULTILEVEL_SPECIFICATIONS: Readonly<Record<MultilevelVersion, Readonly<Record<MockSkill, SectionSpecification>>>> = Object.freeze({
  [MULTILEVEL_VERSION_V1]: Object.freeze(specification([15, 5, 5])),
  [MULTILEVEL_VERSION_V2]: Object.freeze(specification([0, 0, 0])),
});

/** Current revision blueprint — for anything that only ever renders the newest. */
export const MULTILEVEL_SPECIFICATION: Readonly<Record<MockSkill, SectionSpecification>> =
  MULTILEVEL_SPECIFICATIONS[MULTILEVEL_CURRENT_VERSION];

export const MULTILEVEL_AUDIO = { playLimit: 2, previewSeconds: 20, reviewSeconds: 0 } as const;

/** True for every revision that is still allowed to start, resume and grade. */
export function multilevelIsSupportedVersion(version: string | null | undefined): boolean {
  return typeof version === 'string' && (MULTILEVEL_VERSIONS as readonly string[]).includes(version);
}

/** True only for the revision newly authored exams are stamped with. */
export function multilevelIsCurrentVersion(version: string | null | undefined): boolean {
  return version === MULTILEVEL_CURRENT_VERSION;
}

/** Blueprint of a stored revision; `undefined` means unsupported/absent. */
export function multilevelSpecification(version: string | null | undefined): Readonly<Record<MockSkill, SectionSpecification>> | undefined {
  return multilevelIsSupportedVersion(version) ? MULTILEVEL_SPECIFICATIONS[version as MultilevelVersion] : undefined;
}

/** Canonical "no official preparation" representation in this domain. */
export const NO_PREP_SECONDS = [0, 0, 0] as const;

// Ascending raw half-points (index / 2) -> standard scores from supplied target specification.
export const WRITING_CONVERSION = [0,10,14,17,21,25,28,31,33,35,37,38,40,41,43,45,47,48,50,51,53,55,57,59,61,62,63,64,65,67,69,72,75] as const;
export const SPEAKING_CONVERSION = [0,10,11,13,15,17,19,21,23,24,26,27,29,30,32,33,35,37,38,39,40,42,43,45,46,47,49,50,51,52,54,56,57,59,61,63,64,65,67,69,71,73,75] as const;
export function convertExpertScore(skill: 'writing' | 'speaking', raw: number): number {
  const table = skill === 'writing' ? WRITING_CONVERSION : SPEAKING_CONVERSION;
  if (!Number.isFinite(raw) || raw < 0 || raw * 2 !== Math.round(raw * 2) || raw * 2 >= table.length) {
    throw new RangeError('Expert raw score must be within range in half-point increments');
  }
  return table[raw * 2];
}
export function multilevelLevel(score: number): MultilevelLevel {
  if (!Number.isFinite(score) || score < 0 || score > 75) throw new RangeError('Standard score must be 0..75');
  return score >= 65 ? 'C1' : score >= 51 ? 'B2' : score >= 38 ? 'B1' : 'BELOW_B1';
}

/** Practice estimate only, NOT Rasch. Interpolate within approximate raw bands.
 * Endpoints 0->0, 9->37; 10->38, 17->50; 18->51, 27->64; 28->65, 35->75.
 * Short section practices are normalized to /35 and remain explicitly estimated.
 */
export function estimateObjective(rawCorrect: number, questionCount: number) {
  if (!Number.isInteger(questionCount) || questionCount < 1 || !Number.isFinite(rawCorrect) || rawCorrect < 0 || rawCorrect > questionCount) {
    throw new RangeError('Invalid objective score');
  }
  const scaled = rawCorrect * 35 / questionCount;
  const anchors = [[0,0], [9,37], [10,38], [17,50], [18,51], [27,64], [28,65], [35,75]];
  const right = anchors.findIndex(([raw]) => raw >= scaled);
  const [x1,y1] = anchors[Math.max(0, right - 1)];
  const [x2,y2] = anchors[right];
  const estimatedStandardScore = Math.round((x2 === x1 ? y1 : y1 + (scaled-x1)*(y2-y1)/(x2-x1)) * 100) / 100;
  return { rawCorrect, questionCount, estimatedStandardScore, scoreMethod: 'ESTIMATED' as const, scoreVersion: ESTIMATE_VERSION, isOfficial: false as const };
}
export function multilevelOverall(scores: Partial<Record<MockSkill, number>>): number | null {
  const skills: MockSkill[] = ['listening','reading','writing','speaking'];
  if (!skills.every((s) => scores[s] != null)) return null;
  return skills.reduce((sum, skill) => sum + scores[skill]!, 0) / 4;
}

/**
 * Per-question guidance for a stored revision. `specificationVersion` selects
 * the immutable blueprint (timing differs between revisions), while
 * `speakingProfileVersion` may still override timing with the product profile.
 */
export function taskGuidance(
  skill: MockSkill,
  partIndex: number,
  questionIndex: number,
  speakingProfileVersion?: string | null,
  specificationVersion?: string | null,
) {
  const spec = multilevelSpecification(specificationVersion) ?? MULTILEVEL_SPECIFICATION;
  const p = spec[skill].parts[partIndex];
  if (!p) return undefined;
  const displayLabel = skill === 'writing'
    ? ({ informal_email: 'Task 1.1 — Informal Letter', formal_email: 'Task 1.2 — Formal Letter', publication: 'Task 2 — Publication' } as Record<string, string>)[p.key]
    : `Part ${p.key}`;
  return { taskKey: p.key, displayLabel, wordMin: p.wordMin, wordMax: p.wordMax,
    rawMax: p.rawMax,
    ...(skill === 'speaking' ? { speakingProfileVersion: speakingProfileVersion ?? null, profileLabel: speakingProfileVersion ? 'BestWay product timing profile' : 'Historical Multilevel timing profile' } : {}),
    prepSeconds: p.prepSeconds?.[questionIndex], responseSeconds: p.responseSeconds?.[questionIndex],
    ...(skill === 'speaking' ? speakingProfileTiming(speakingProfileVersion, partIndex, questionIndex) : {}) };
}

export interface BlueprintSection {
  skill: MockSkill;
  groups: Array<{ sortOrder: number; partNumber?: number | null; passageText?: string | null; audioKey?: string | null; audioDurationSec?: number | null; imageKey?: string | null;
    maxScore?: number | null; stimulusRef?: string | null;
    questions: Array<{ type: string; points: number; options?: unknown; wordLimit?: number | null; sortOrder?: number | null }> }>;
}

/**
 * The blueprint maps parts and question formats by authored position, so the
 * persisted order must never depend on physical row order. Callers that load
 * questions without an explicit order still get the authored sequence.
 */
function inAuthoredOrder<T extends { sortOrder?: number | null }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.sortOrder ?? a.index) - (b.item.sortOrder ?? b.index) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * The exact contract used before a new Multilevel attempt may start.
 * Catalogue and authoring review consume this too, so a displayed `ready`
 * state always means the saved definition can clear Start's blueprint gate.
 * A historical-but-supported revision is validated against ITS OWN blueprint.
 */
export function multilevelStartReadiness(exam: {
  specificationVersion?: string | null;
  profile?: string | null;
  sections: BlueprintSection[];
}) {
  const supported = multilevelIsSupportedVersion(exam.specificationVersion);
  return {
    supported,
    issues: supported
      ? multilevelBlueprintIssues(exam.sections, exam.profile === 'full_mock', exam.specificationVersion)
      : ['Unsupported Multilevel specification'],
  };
}

/** Shared publication/start validation. No synthetic production success. */
export function multilevelBlueprintIssues(sections: BlueprintSection[], full: boolean, specificationVersion?: string | null): string[] {
  const issues: string[] = [];
  const spec = multilevelSpecification(specificationVersion) ?? MULTILEVEL_SPECIFICATION;
  if (full && sections.length !== 4) issues.push('Full Multilevel mock requires all four sections');
  for (const section of sections) {
    const sectionSpec = spec[section.skill];
    const groups = inAuthoredOrder(section.groups);
    if (groups.length !== sectionSpec.parts.length) issues.push(`${section.skill}: requires ${sectionSpec.parts.length} parts`);
    // The source is a durable authoring relationship, not string equality. Two
    // tasks may phrase their prompts differently while referring to one source
    // situation. Legacy drafts receive this field through draft reconciliation.
    if (section.skill === 'writing' && (!groups[0]?.stimulusRef?.trim() || groups[0]?.stimulusRef !== groups[1]?.stimulusRef)) issues.push('writing: informal and formal emails must share the same source stimulus');
    groups.forEach((group, index) => {
      const p = sectionSpec.parts[index];
      if (!p) return;
      const at = `${section.skill} ${p.key}`;
      if (group.questions.length !== p.count) issues.push(`${at}: requires ${p.count} responses/questions`);
      if (section.skill === 'listening' && (!group.audioKey || group.partNumber !== index + 1)) issues.push(`${at}: audio and matching part number required`);
      if (section.skill === 'listening' && (!group.audioDurationSec || !Number.isFinite(group.audioDurationSec) || group.audioDurationSec <= 0)) issues.push(`${at}: positive audio duration required`);
      if (section.skill === 'speaking' && p.key === '1.2' && !group.imageKey) issues.push(`${at}: two-picture asset required`);
      if ((section.skill === 'writing' || section.skill === 'speaking') && group.maxScore !== p.rawMax) {
        issues.push(`${at}: points must be ${p.rawMax}`);
      }
      inAuthoredOrder(group.questions).forEach((q, qi) => {
        let types = p.types;
        if (section.skill === 'reading' && p.key === '4') types = qi < 4 ? ['multiple_choice'] : ['true_false_notgiven'];
        if (section.skill === 'reading' && p.key === '5') types = qi < 4 ? ['short_answer','summary_completion'] : ['multiple_choice'];
        if (!types.includes(q.type)) issues.push(`${at} question ${qi+1}: invalid type`);
        // Writing tasks and Speaking parts are holistically scored once at the
        // group level. Objective sections remain question-oriented.
        if (section.skill !== 'writing' && section.skill !== 'speaking' && q.points !== (p.rawMax ?? 1)) issues.push(`${at}: points must be ${p.rawMax ?? 1}`);
        const optionCount = p.options ?? (section.skill === 'reading' && q.type === 'multiple_choice' ? 4 : undefined);
        if (optionCount && (!Array.isArray(q.options) || q.options.length !== optionCount)) issues.push(`${at}: requires ${optionCount} options`);
        if (['short_answer','note_completion','sentence_completion','summary_completion'].includes(q.type) && q.wordLimit !== 1) issues.push(`${at}: one-word/number answer required`);
      });
    });
  }
  return issues;
}
