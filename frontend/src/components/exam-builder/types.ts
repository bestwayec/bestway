"use client";

import type { useTranslations } from "next-intl";
import type { MockExamType, MockQuestionType, MockSkill } from "@/lib/types";

/** All UI strings go through this: English fallback, no messages-file churn. */
export function tx(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
): string {
  try {
    const translate = t as unknown as (k: string, v?: Record<string, string | number>) => unknown;
    const v = translate(key, values);
    if (typeof v === "string" && v !== key && !v.endsWith(`.${key}`)) return v;
    return fill(fallback, values);
  } catch {
    return fill(fallback, values);
  }
}

/** Manual `{name}` interpolation for the English fallback (key missing in locale). */
function fill(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return Object.entries(values).reduce(
    (s, [k, val]) => s.split(`{${k}}`).join(String(val)),
    template,
  );
}

export type Selection =
  | { kind: "overview" }
  | { kind: "section"; sectionId: string }
  | { kind: "group"; groupId: string }
  | { kind: "review" }
  | { kind: "publish" };

export function selectionKey(sel: Selection): string {
  switch (sel.kind) {
    case "overview":
      return "overview";
    case "section":
      return `section:${sel.sectionId}`;
    case "group":
      return `group:${sel.groupId}`;
    case "review":
      return "review";
    case "publish":
      return "publish";
  }
}

export const SKILL_ORDER: MockSkill[] = ["listening", "reading", "writing", "speaking"];

/** Content-first labels: parts / passages / tasks — never "groups". */
export const SKILL_META: Record<
  MockSkill,
  { unit: string; units: string; addUnit: string; hint: string }
> = {
  listening: {
    unit: "Part",
    units: "Parts",
    addUnit: "Add Part",
    hint: "4 parts · one audio per part · Questions 1–40",
  },
  reading: {
    unit: "Passage",
    units: "Passages",
    addUnit: "Add Passage",
    hint: "3 passages · each passage holds its text + question sets",
  },
  writing: {
    unit: "Task",
    units: "Tasks",
    addUnit: "Add Task",
    hint: "Task 1 (150+ words) · Task 2 (250+ words) · Teacher graded",
  },
  speaking: {
    unit: "Task",
    units: "Tasks",
    addUnit: "Add Task",
    hint: "Speaking prompts · students record audio answers",
  },
};

export const EXAM_TYPES: MockExamType[] = ["ielts_academic", "ielts_general", "multilevel"];

export const EXAM_TYPE_LABEL: Record<MockExamType, string> = {
  ielts_academic: "IELTS Academic",
  ielts_general: "IELTS General",
  multilevel: "Multilevel",
};

/** Allowed question types per skill — the editor only ever shows these. */
export const TYPES_BY_SKILL: Record<MockSkill, MockQuestionType[]> = {
  listening: [
    "multiple_choice",
    "multi_select",
    "true_false_notgiven",
    "yes_no_notgiven",
    "matching",
    "matching_headings",
    "sentence_completion",
    "note_completion",
    "summary_completion",
    "table_completion",
    "short_answer",
    "map_labelling",
  ],
  reading: [
    "multiple_choice",
    "multi_select",
    "true_false_notgiven",
    "yes_no_notgiven",
    "matching",
    "matching_headings",
    "sentence_completion",
    "note_completion",
    "summary_completion",
    "table_completion",
    "short_answer",
    "map_labelling",
  ],
  writing: ["essay_task1", "essay_task2"],
  speaking: ["speaking_task"],
};

export function defaultUnitTitle(skill: MockSkill, index: number): string {
  const meta = SKILL_META[skill];
  return `${meta.unit} ${index + 1}`;
}

/** Next free global question number across the whole exam (IELTS 1–40). */
/**
 * Next free question number. Numbers run within one section (IELTS papers and Multilevel both
 * restart at 1 in every section), so pass the section's `skill` or `id` as `scope`.
 */
export function nextQuestionNumber(
  sections: Array<{ id?: string; skill?: string; groups: Array<{ questions: Array<{ number: number }> }> }>,
  scope?: { skill?: string; id?: string },
): number {
  let max = 0;
  for (const s of sections) {
    if (scope && s.skill !== scope.skill && s.id !== scope.id) continue;
    for (const g of s.groups) for (const q of g.questions) max = Math.max(max, q.number);
  }
  return max + 1;
}

/** Question numbers already used in one section (import duplicate check). */
export function sectionNumbers(
  sections: Array<{ id?: string; skill?: string; groups: Array<{ questions: Array<{ number: number }> }> }>,
  scope: { skill?: string; id?: string },
): number[] {
  return sections.filter((s) => s.skill === scope.skill || s.id === scope.id).flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => q.number)));
}
