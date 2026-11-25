import type { MockExamDetail, MockGroup, MockSection } from "@/lib/types";
import { groupSourceStatuses, questionIssues, type GroupSourceStatus } from "./checks";
import type { Selection } from "./types";

/**
 * The guided path through the Exam Builder. Every step is a view onto the existing editors and checks
 * (nothing here changes what is saved), so the payloads, drafts, uploaded media and question numbering are untouched.
 */
export type StepId = "info" | "track" | "questions" | "material" | "keys" | "preview" | "publish";

export const STEP_ORDER: StepId[] = ["info", "track", "questions", "material", "keys", "preview", "publish"];

export type StepStatus = "done" | "attention" | "todo";

export type StepTarget = { kind: "select"; selection: Selection } | { kind: "preview" };

export interface BuilderStep {
  id: StepId;
  status: StepStatus;
  /** Open problems this step would fix (0 when done). */
  issues: number;
  /** Where "go to this step" leads: the first block that needs the step's work, else the first block. */
  target: StepTarget;
}

type Located = { section: MockSection; group: MockGroup };

function groupsOf(detail: MockExamDetail): Located[] {
  return detail.sections.flatMap((section) => (section.groups ?? []).map((group) => ({ section, group })));
}

const KEY_ISSUE = /answer key is missing|choice questions need|word limit/;
const TEXT_ISSUE = /question text is empty/;

/** Problems per concern, derived from the same per-question rules the Review panel uses. */
export function groupConcerns(section: MockSection, group: MockGroup, source?: GroupSourceStatus) {
  const issues = group.questions.flatMap((q) => questionIssues(q, section.skill));
  return {
    questions: (group.questions.length === 0 && !source?.sourceOnly ? 1 : 0) + issues.filter((i) => TEXT_ISSUE.test(i)).length,
    material: group.questions.length > 0 && source?.missingSource ? 1 : 0,
    keys: issues.filter((i) => KEY_ISSUE.test(i)).length,
  };
}

const select = (selection: Selection): StepTarget => ({ kind: "select", selection });
const groupTarget = (found: Located | undefined, fallback: Selection): StepTarget =>
  found ? select({ kind: "group", groupId: found.group.id }) : select(fallback);

/**
 * `previewed` — the author has opened the student preview in this session; `blockers` — the same readiness
 * number the toolbar shows (client errors + server readiness + import issues).
 */
export function builderSteps(detail: MockExamDetail, opts: { previewed: boolean; blockers: number }): BuilderStep[] {
  const located = groupsOf(detail);
  const sources = new Map(detail.sections.map((section) => [
    section.id, groupSourceStatuses(section.groups ?? [], section.skill, detail.type !== "multilevel"),
  ]));
  const concerns = located.map((item) => ({
    item, ...groupConcerns(item.section, item.group, sources.get(item.section.id)?.get(item.group.id)),
  }));
  const total = (key: "questions" | "material" | "keys") => concerns.reduce((sum, c) => sum + c[key], 0);
  const firstWith = (key: "questions" | "material" | "keys") => concerns.find((c) => c[key] > 0)?.item;
  const first = located[0];
  const hasContent = detail.questionCount > 0;

  const infoIssues = detail.title.trim() ? 0 : 1;
  const trackIssues = detail.sections.length === 0 ? 1 : detail.sections.filter((s) => !s.groups || s.groups.length === 0).length;
  const questionIssuesTotal = detail.sections.length === 0 ? 1 : total("questions");
  const status = (issues: number, started: boolean): StepStatus => (issues > 0 ? "attention" : started ? "done" : "todo");

  return [
    { id: "info", status: status(infoIssues, true), issues: infoIssues, target: select({ kind: "overview" }) },
    {
      id: "track",
      status: status(trackIssues, detail.sections.length > 0),
      issues: trackIssues,
      target: select(detail.sections[0] ? { kind: "section", sectionId: (detail.sections.find((s) => !s.groups?.length) ?? detail.sections[0]).id } : { kind: "overview" }),
    },
    { id: "questions", status: status(questionIssuesTotal, hasContent), issues: questionIssuesTotal, target: groupTarget(firstWith("questions") ?? first, { kind: "overview" }) },
    { id: "material", status: status(total("material"), hasContent), issues: total("material"), target: groupTarget(firstWith("material") ?? first, { kind: "overview" }) },
    { id: "keys", status: status(total("keys"), hasContent), issues: total("keys"), target: groupTarget(firstWith("keys") ?? first, { kind: "overview" }) },
    { id: "preview", status: opts.previewed ? "done" : "todo", issues: 0, target: { kind: "preview" } },
    {
      id: "publish",
      status: detail.isPublished && opts.blockers === 0 ? "done" : opts.blockers > 0 ? "attention" : "todo",
      issues: opts.blockers,
      target: select({ kind: "publish" }),
    },
  ];
}

/** The step a selection belongs to when the author has not picked one explicitly. */
export function stepForSelection(selection: Selection, current: StepId | null): StepId {
  switch (selection.kind) {
    case "overview":
      return "info";
    case "section":
      return "track";
    case "group":
      return current === "material" || current === "keys" ? current : "questions";
    case "review":
    case "publish":
      return "publish";
  }
}

/** Neighbouring step, clamped at both ends (no wrap-around). */
export function neighbourStep(id: StepId, direction: 1 | -1): StepId {
  const index = STEP_ORDER.indexOf(id) + direction;
  return STEP_ORDER[Math.min(Math.max(index, 0), STEP_ORDER.length - 1)];
}
