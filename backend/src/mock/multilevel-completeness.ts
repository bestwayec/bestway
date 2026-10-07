import { MockQuestionType, MockSkill } from '@prisma/client';

/**
 * Multilevel pre-submit completeness.
 *
 * The student must not be able to hand in an exam that still has unfinished
 * work, but the exam is time-boxed: once a section's clock has run out, its
 * gaps are unrecoverable and must not block submission. That gives the rule:
 *
 *   a section is REQUIRED when it was reached, its own clock has not expired
 *   and the attempt as a whole has not run out of time;
 *   otherwise every missing answer in it is ignored.
 *
 * Reached:
 *   - full_test  → `currentSkill` only. A section the student has already been
 *     advanced past is closed for good (navigation is one-way), so its gaps
 *     must not block a submission the student can no longer repair;
 *   - single_skill → every section of the definition is reachable (the runner
 *     exposes section tabs), so each unexpired section is required.
 *
 * Because an attempt whose whole clock has expired reports `complete`, the
 * timeout auto-submit path keeps working with a partial exam.
 *
 * A single source of truth cannot be shared with the browser bundle, so the
 * frontend mirrors this rule in `frontend/src/lib/multilevel-completeness.ts`
 * and both sides are pinned by tests over the same fixtures.
 */

export const MULTILEVEL_SKILL_ORDER: readonly MockSkill[] = ['listening', 'reading', 'writing', 'speaking'];

export interface CompletenessQuestion {
  id: string;
  type: MockQuestionType;
}

export interface CompletenessSection {
  skill: MockSkill;
  groups: Array<{ questions: CompletenessQuestion[] }>;
}

export interface CompletenessAnswer {
  questionId: string;
  response: string | null;
  audioKey?: string | null;
}

export interface CompletenessState {
  flowMode?: string | null;
  currentSkill?: string | null;
  sectionDeadlines?: unknown;
  overallDeadlineAt?: Date | string | null;
  deadlineAt?: Date | string | null;
}

/** One exam section as the review surface needs it (student-safe: counts only). */
export interface MultilevelSectionWork {
  skill: MockSkill;
  /** Expected questions in the section. */
  total: number;
  /** Answered questions in the section. */
  answered: number;
  /** The section is answered by recordings, not by text. */
  spoken: boolean;
  /** Questions of the section answered with a recording. */
  recordings: number;
  /** Unanswered questions in the section. */
  missing: number;
  /** The section's own clock has already run out — its gaps are ignored. */
  expired: boolean;
  /** Still required at submit time (reached, not expired, time remains). */
  required: boolean;
}

export interface MultilevelMissingWork {
  sections: MultilevelSectionWork[];
  /** Sections still required and unfinished, in exam order. */
  unfinished: MultilevelSectionWork[];
  requiredSections: MockSkill[];
  expiredSections: MockSkill[];
  /** Required questions missing an answer. */
  missing: number;
  /** Required questions in total. */
  total: number;
  /** The attempt's whole clock has run out: the exam submits as-is. */
  timeExpired: boolean;
  /** A clock exists, so an untouched exam still submits by itself. */
  timed: boolean;
  /** Nothing is required, so the submission is accepted. */
  complete: boolean;
}

const SKILL_LABEL: Record<MockSkill, string> = {
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
  speaking: 'Speaking',
};

/** Tolerates the JSON column losing its shape: unknown values mean "no clock". */
export function multilevelSectionDeadlines(raw: unknown): Partial<Record<MockSkill, Date>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const deadlines: Partial<Record<MockSkill, Date>> = {};
  for (const skill of MULTILEVEL_SKILL_ORDER) {
    const value = (raw as Record<string, unknown>)[skill];
    if (typeof value !== 'string' && !(value instanceof Date)) continue;
    const at = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(at.getTime())) deadlines[skill] = at;
  }
  return deadlines;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

function isReached(skill: MockSkill, state: CompletenessState, isFullTest: boolean): boolean {
  if (!isFullTest) return true;
  return state.currentSkill === skill;
}

/** A question counts as answered when it carries non-blank text or a recording. */
export function multilevelQuestionAnswered(question: CompletenessQuestion, answer: CompletenessAnswer | undefined): boolean {
  if (question.type === 'speaking_task') return !!answer?.audioKey;
  return !!answer?.response?.trim();
}

export function multilevelMissingWork(
  sections: CompletenessSection[],
  answers: CompletenessAnswer[],
  state: CompletenessState,
  now: Date = new Date(),
): MultilevelMissingWork {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const deadlines = multilevelSectionDeadlines(state.sectionDeadlines);
  const overall = toTime(state.overallDeadlineAt) ?? toTime(state.deadlineAt);
  const nowMs = now.getTime();
  const timeExpired = overall !== null && overall <= nowMs;
  const isFullTest = state.flowMode === 'full_test';

  const work: MultilevelSectionWork[] = [];
  const requiredSections: MockSkill[] = [];
  const expiredSections: MockSkill[] = [];
  let missing = 0;
  let total = 0;

  for (const section of sections) {
    const questions = section.groups.flatMap((group) => group.questions);
    const deadline = deadlines[section.skill];
    const expired = !!deadline && deadline.getTime() <= nowMs;
    const required = !timeExpired && !expired && isReached(section.skill, state, isFullTest);
    const spoken = questions.some((question) => question.type === 'speaking_task');
    let answered = 0;
    let recordings = 0;
    for (const question of questions) {
      if (!multilevelQuestionAnswered(question, byQuestion.get(question.id))) continue;
      answered += 1;
      if (question.type === 'speaking_task') recordings += 1;
    }
    const sectionMissing = questions.length - answered;
    if (expired) expiredSections.push(section.skill);
    if (required) {
      requiredSections.push(section.skill);
      missing += sectionMissing;
      total += questions.length;
    }
    work.push({ skill: section.skill, total: questions.length, spoken, answered, recordings, missing: sectionMissing, expired, required });
  }

  return {
    sections: work,
    unfinished: work.filter((section) => section.required && section.missing > 0),
    requiredSections,
    expiredSections,
    missing: timeExpired ? 0 : missing,
    total: timeExpired ? 0 : total,
    timeExpired,
    timed: overall !== null,
    complete: timeExpired || missing === 0,
  };
}

/** Student-safe rejection text: section names and counts, never answer content. */
export function multilevelMissingWorkMessage(work: MultilevelMissingWork): string {
  if (work.complete) return 'Every required section is complete.';
  const parts = work.unfinished.map((section) => {
    const label = SKILL_LABEL[section.skill];
    return section.spoken
      ? `${label} ${section.missing} of ${section.total} not recorded`
      : `${label} ${section.missing} of ${section.total} unanswered`;
  });
  return `Finish the remaining work before submitting — ${parts.join('; ')}.`
    + (work.timed ? ' This exam still submits by itself when the timer ends.' : '');
}
