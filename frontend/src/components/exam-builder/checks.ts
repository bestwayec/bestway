"use client";

import type { MockGroup, MockQuestion, MockSection, MockSkill } from "@/lib/types";
import type { Selection } from "./types";

export interface Check {
  level: "error" | "warning";
  /** Short label, e.g. "Part 2 — audio missing". */
  label: string;
  detail?: string;
  target: Selection;
}

const OPTION_TYPES: ReadonlySet<string> = new Set([
  "multiple_choice",
  "multi_select",
  "matching",
  "matching_headings",
]);

const AUTO_SKILLS: ReadonlySet<MockSkill> = new Set(["listening", "reading"]);

function isAuto(q: MockQuestion, skill: MockSkill): boolean {
  if (q.type === "essay_task1" || q.type === "essay_task2" || q.type === "speaking_task")
    return false;
  return AUTO_SKILLS.has(skill);
}

/** Per-question problems (empty prompt, options, answer keys, word limit). */
export function questionIssues(q: MockQuestion, skill: MockSkill): string[] {
  const out: string[] = [];
  if (!q.prompt.trim()) out.push(`Q${q.number}: question text is empty`);
  if (OPTION_TYPES.has(q.type)) {
    const opts = (q.options ?? []).filter((o) => o.trim() !== "");
    if (opts.length < 2) out.push(`Q${q.number}: choice questions need at least 2 options`);
  }
  if (isAuto(q, skill)) {
    const keys = (q.correctAnswers ?? []).filter((a) => a.trim() !== "");
    if (keys.length === 0) out.push(`Q${q.number}: answer key is missing`);
  }
  if (q.wordLimit != null && (!Number.isFinite(q.wordLimit) || q.wordLimit < 1)) {
    out.push(`Q${q.number}: word limit must be 1 or more`);
  }
  return out;
}

export function groupIssueCount(group: MockGroup, skill: MockSkill): number {
  let n = 0;
  if (group.questions.length === 0) n += 1;
  for (const q of group.questions) n += questionIssues(q, skill).length;
  if (skill === "listening" && group.questions.length > 0 && !group.hasAudio) n += 1;
  if (skill === "reading" && group.questions.length > 0 && !group.passageText?.trim()) n += 1;
  return n;
}

/**
 * Exam-wide client checks. Server readiness (authoritative for structure) is merged in ReviewPanel.
 * Full Mock task rules (writing task 1+2) apply only to full_mock; practice checks existing content only.
 */
export function examClientChecks(sections: MockSection[], profile = "practice", type = "ielts_academic"): Check[] {
  const checks: Check[] = [];
  if (sections.length === 0) {
    checks.push({
      level: "error",
      label: "No sections yet",
      detail: "Add Listening, Reading, Writing and Speaking from the sidebar.",
      target: { kind: "overview" },
    });
    return checks;
  }
  const numbers = new Map<number, string>();
  for (const s of sections) {
    if (type === "multilevel") numbers.clear();
    if (!s.groups || s.groups.length === 0) {
      checks.push({
        level: "error",
        label: `${cap(s.skill)} has no ${s.skill === "listening" ? "parts" : s.skill === "reading" ? "passages" : "tasks"}`,
        detail: "Add at least one block to this section.",
        target: { kind: "section", sectionId: s.id },
      });
      continue;
    }
    // Timed listening needs no duration (audio-derived) and speaking is
    // untimed — only reading/writing warn when unset.
    if ((s.skill === "reading" || s.skill === "writing") && s.durationMinutes == null) {
      checks.push({
        level: "warning",
        label: `${cap(s.skill)} has no duration`,
        detail: "Timed mode needs per-section durations.",
        target: { kind: "section", sectionId: s.id },
      });
    }
    for (const g of s.groups) {
      const gLabel = g.title?.trim() || `Block ${g.sortOrder + 1}`;
      if (g.questions.length === 0) {
        checks.push({
          level: "error",
          label: `${cap(s.skill)} · ${gLabel} has no questions`,
          target: { kind: "group", groupId: g.id },
        });
      }
      if (s.skill === "listening" && g.questions.length > 0 && !g.hasAudio) {
        checks.push({
          level: "error",
          label: `${gLabel} — audio missing`,
          detail: "Each listening part needs its audio file.",
          target: { kind: "group", groupId: g.id },
        });
      }
      if (s.skill === "reading" && g.questions.length > 0 && !g.passageText?.trim()) {
        checks.push({
          level: "error",
          label: `${gLabel} — passage text missing`,
          detail: "Reading questions must sit under their passage.",
          target: { kind: "group", groupId: g.id },
        });
      }
      for (const q of g.questions) {
        for (const issue of questionIssues(q, s.skill)) {
          checks.push({
            level: "error",
            label: `${gLabel} · ${issue}`,
            target: { kind: "group", groupId: g.id },
          });
        }
        if (numbers.has(q.number)) {
          checks.push({
            level: "error",
            label: `Duplicate question number ${q.number}`,
            detail: `Also used in ${numbers.get(q.number)}. IELTS numbers run 1–40 without repeats.`,
            target: { kind: "group", groupId: g.id },
          });
        } else {
          numbers.set(q.number, gLabel);
        }
      }
    }
  }
  const writing = sections.find((s) => s.skill === "writing");
  if (writing && writing.groups.length > 0 && profile === "full_mock") {
    const types = new Set(writing.groups.flatMap((g) => g.questions.map((q) => q.type)));
    if (!types.has("essay_task1"))
      checks.push({
        level: "error",
        label: "Writing is missing Task 1",
        target: { kind: "section", sectionId: writing.id },
      });
    if (!types.has("essay_task2"))
      checks.push({
        level: "error",
        label: "Writing is missing Task 2",
        target: { kind: "section", sectionId: writing.id },
      });
  }
  const speaking = sections.find((s) => s.skill === "speaking");
  if (speaking && speaking.groups.length > 0) {
    const n = speaking.groups.reduce((a, g) => a + g.questions.length, 0);
    if (n === 0)
      checks.push({
        level: "error",
        label: "Speaking has no tasks",
        target: { kind: "section", sectionId: speaking.id },
      });
  }
  return checks;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Exam-wide duplicate-number errors for a locally edited (possibly unsaved)
 * question set. Works on plain numbers so editors can validate before save.
 * Backend readiness stays authoritative at publish time.
 */
export function duplicateNumberErrors(
  sections: MockSection[],
  groupId: string,
  numbers: number[],
): string[] {
  const usedElsewhere = new Set<number>();
  for (const s of sections)
    for (const g of s.groups) {
      if (g.id === groupId) continue;
      for (const q of g.questions) usedElsewhere.add(q.number);
    }
  const errs: string[] = [];
  const local = new Map<number, number>();
  for (const n of numbers) {
    local.set(n, (local.get(n) ?? 0) + 1);
    if (usedElsewhere.has(n)) {
      errs.push(`Question ${n}: this number is already used in another part — numbers must not repeat.`);
    }
  }
  for (const [n, c] of local) {
    if (c > 1) errs.push(`Question ${n}: used ${c} times in this part — each number must be unique.`);
  }
  return errs;
}

export function isDuplicateNumber(
  sections: MockSection[],
  groupId: string,
  numbers: number[],
  n: number,
): boolean {
  for (const s of sections)
    for (const g of s.groups) {
      if (g.id === groupId) continue;
      if (g.questions.some((x) => x.number === n)) return true;
    }
  return numbers.filter((x) => x === n).length > 1;
}
