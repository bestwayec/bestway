import type { MockSkill, MockQuestionType } from "./types";

/**
 * Browser mirror of `backend/src/mock/multilevel-completeness.ts`.
 *
 * The pre-submit review surface must recompute while the student types, so it
 * cannot read the server's answer. The rule is mirrored here and both sides are
 * pinned by tests over the same fixtures; the server stays authoritative — a
 * submission the server still considers unfinished is refused with
 * `MOCK_ATTEMPT_INCOMPLETE`.
 */

export const MULTILEVEL_SKILL_ORDER: readonly MockSkill[] = ["listening", "reading", "writing", "speaking"];

export interface CompletenessQuestion {
  id: string;
  type: MockQuestionType;
}

export interface CompletenessSection {
  skill: MockSkill;
  groups: Array<{ questions: CompletenessQuestion[] }>;
}

export interface CompletenessState {
  flowMode?: string | null;
  currentSkill?: MockSkill | null;
  sectionDeadlines?: Partial<Record<string, string>> | null;
  overallDeadlineAt?: string | null;
  deadlineAt?: string | null;
}

export interface MultilevelSectionWork {
  skill: MockSkill;
  total: number;
  /** The section is answered by recordings, not by text. */
  spoken: boolean;
  answered: number;
  recordings: number;
  missing: number;
  expired: boolean;
  required: boolean;
}

export interface MultilevelMissingWork {
  sections: MultilevelSectionWork[];
  unfinished: MultilevelSectionWork[];
  requiredSections: MockSkill[];
  expiredSections: MockSkill[];
  missing: number;
  total: number;
  timeExpired: boolean;
  timed: boolean;
  complete: boolean;
}

const SKILL_LABEL: Record<MockSkill, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
  speaking: "Speaking",
};

export function multilevelSkillLabel(skill: MockSkill): string {
  return SKILL_LABEL[skill];
}

export function multilevelSectionDeadlines(raw: unknown): Partial<Record<MockSkill, Date>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const deadlines: Partial<Record<MockSkill, Date>> = {};
  for (const skill of MULTILEVEL_SKILL_ORDER) {
    const value = (raw as Record<string, unknown>)[skill];
    if (typeof value !== "string") continue;
    const at = new Date(value);
    if (!Number.isNaN(at.getTime())) deadlines[skill] = at;
  }
  return deadlines;
}

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? null : at;
}

export function multilevelQuestionAnswered(
  question: CompletenessQuestion,
  answers: Record<string, string>,
  recorded: ReadonlySet<string>,
): boolean {
  if (question.type === "speaking_task") return recorded.has(question.id);
  return !!answers[question.id]?.trim();
}

/**
 * @param now Server time (`Date.now() + serverOffset`) — deadlines are the
 *   server's, so the comparison must be made on the server's clock.
 */
export function multilevelMissingWork(
  sections: CompletenessSection[],
  answers: Record<string, string>,
  recorded: ReadonlySet<string>,
  state: CompletenessState,
  now: Date = new Date(),
): MultilevelMissingWork {
  const deadlines = multilevelSectionDeadlines(state.sectionDeadlines);
  const overall = toTime(state.overallDeadlineAt) ?? toTime(state.deadlineAt);
  const nowMs = now.getTime();
  const timeExpired = overall !== null && overall <= nowMs;
  const isFullTest = state.flowMode === "full_test";

  const work: MultilevelSectionWork[] = [];
  const requiredSections: MockSkill[] = [];
  const expiredSections: MockSkill[] = [];
  let missing = 0;
  let total = 0;

  for (const section of sections) {
    const questions = section.groups.flatMap((group) => group.questions);
    const deadline = deadlines[section.skill];
    const expired = !!deadline && deadline.getTime() <= nowMs;
    const required = !timeExpired && !expired && (!isFullTest || state.currentSkill === section.skill);
    const spoken = questions.some((question) => question.type === "speaking_task");
    let answered = 0;
    let recordings = 0;
    for (const question of questions) {
      if (!multilevelQuestionAnswered(question, answers, recorded)) continue;
      answered += 1;
      if (question.type === "speaking_task") recordings += 1;
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

export function multilevelMissingWorkMessage(work: MultilevelMissingWork): string {
  if (work.complete) return "Every required section is complete.";
  const parts = work.unfinished.map((section) =>
    section.spoken
      ? `${SKILL_LABEL[section.skill]} ${section.missing} of ${section.total} not recorded`
      : `${SKILL_LABEL[section.skill]} ${section.missing} of ${section.total} unanswered`,
  );
  return `Finish the remaining work before submitting — ${parts.join("; ")}.`
    + (work.timed ? " This exam still submits by itself when the timer ends." : "");
}
