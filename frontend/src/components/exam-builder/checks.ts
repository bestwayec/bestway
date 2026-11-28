"use client";

import type { MockGroup, MockQuestion, MockSection, MockSkill } from "@/lib/types";
import { examContentUnits } from "@/lib/exam-content-units";
import type { Selection } from "./types";
import { gapNumbersIn } from "./reading-preview-model";

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

export interface GroupSourceStatus {
  missingSource: boolean;
  sourceOnly: boolean;
}

export function groupSourceStatuses(groups: MockGroup[], skill: MockSkill, canonicalListening = true) {
  if (skill !== "reading" && skill !== "listening") return new Map<string, GroupSourceStatus>();
  const hasSource = (group: MockGroup) => skill === "reading" ? Boolean(group.passageText?.trim()) : group.hasAudio;
  const ordered = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  return new Map(examContentUnits(ordered, skill, canonicalListening).flatMap((unit) => {
    const missingSource = !hasSource(unit.source);
    const populated = unit.groups.some((group) => group.questions.length > 0);
    return unit.groups.map((group) => {
      const ref = skill === "reading" ? group.stimulusRef : group.partNumber;
      return [group.id, {
        missingSource, sourceOnly: Boolean(ref) && populated && !group.questions.length && hasSource(group),
      }] as const;
    });
  }));
}

export function groupIssueCount(group: MockGroup, skill: MockSkill, source?: GroupSourceStatus): number {
  let n = 0;
  if (group.questions.length === 0 && !source?.sourceOnly) n += 1;
  for (const q of group.questions) n += questionIssues(q, skill).length;
  const missing = source?.missingSource ??
    ((skill === "listening" && !group.hasAudio) || (skill === "reading" && !group.passageText?.trim()));
  if (group.questions.length > 0 && missing) n += 1;
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
    numbers.clear(); // every section starts at 1 (IELTS papers and Multilevel)
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
    const sources = groupSourceStatuses(s.groups, s.skill, type !== "multilevel");
    for (const g of s.groups) {
      const source = sources.get(g.id);
      const gLabel = g.title?.trim() || `Block ${g.sortOrder + 1}`;
      if (g.questions.length === 0 && !source?.sourceOnly) {
        checks.push({
          level: "error",
          label: `${cap(s.skill)} · ${gLabel} has no questions`,
          target: { kind: "group", groupId: g.id },
        });
      }
      if (s.skill === "listening" && g.questions.length > 0 && source?.missingSource) {
        checks.push({
          level: "error",
          label: `${gLabel} — audio missing`,
          detail: "Each listening part needs its audio file.",
          target: { kind: "group", groupId: g.id },
        });
      }
      if (s.skill === "reading" && g.questions.length > 0 && source?.missingSource) {
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
            detail: `Also used in ${numbers.get(q.number)}. Numbers run 1–40 within a section without repeats.`,
            target: { kind: "group", groupId: g.id },
          });
        } else {
          numbers.set(q.number, gLabel);
        }
      }
    }
  }
  checks.push(...publicationChecks(sections, type));
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

/** Same matching as the scorer (mock_rules.choice_index): option text, or a letter within the options. */
export function keyMatchesOption(key: string, options: string[]): boolean {
  const norm = (value: string) => value.normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  const value = norm(key);
  if (options.some((option) => norm(option) === value)) return true;
  if (/^[a-z]$/.test(value)) return value.charCodeAt(0) - 97 < options.length;
  return false;
}

const DECISIONS: Record<string, ReadonlySet<string>> = {
  true_false_notgiven: new Set(["TRUE", "FALSE", "NOT_GIVEN"]),
  yes_no_notgiven: new Set(["YES", "NO", "NOT_GIVEN"]),
};
/** Same canonical form as the scorer (mock_rules.canonical_decision). */
export function canonicalDecision(value: string): string {
  const token = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return token === "NOT_GIVEN" || token === "NO_INFORMATION" ? "NOT_GIVEN" : token;
}
const GAPPED_TYPES: ReadonlySet<string> = new Set(["sentence_completion", "note_completion", "summary_completion", "table_completion", "short_answer", "form_completion", "flowchart_completion"]);

/**
 * Pre-publication checks added in CBT 2.0. Each one points at the block to fix and never invents
 * content: duplicate identifiers, answer keys the scorer could not match, broken gap placeholders,
 * numbering gaps, missing instructions and a Task 1 without its visual.
 */
export function publicationChecks(sections: MockSection[], type = "ielts_academic"): Check[] {
  const checks: Check[] = [];
  const ids = new Map<string, string>();
  for (const s of sections) {
    const numbers: number[] = [];
    for (const g of s.groups ?? []) {
      const gLabel = g.title?.trim() || `Block ${g.sortOrder + 1}`;
      const target: Selection = { kind: "group", groupId: g.id };
      for (const q of g.questions) {
        if (ids.has(q.id)) checks.push({ level: "error", label: `${gLabel} · Q${q.number}: duplicate question identifier`, detail: `The same identifier is used in ${ids.get(q.id)}. Re-import or re-create one of them.`, target });
        else ids.set(q.id, gLabel);
        numbers.push(q.number);
        const keys = (q.correctAnswers ?? []).filter((a) => a.trim() !== "");
        const options = (q.options ?? []).filter((o) => o.trim() !== "");
        if ((q.type === "multiple_choice" || q.type === "multi_select") && options.length >= 2) {
          const bad = keys.filter((key) => !keyMatchesOption(key, options));
          if (bad.length) checks.push({ level: "error", label: `${gLabel} · Q${q.number}: answer key is not one of the options`, detail: `“${bad.join("”, “")}” does not match an option text or letter, so it could never be marked correct.`, target });
        }
        const allowed = DECISIONS[q.type];
        if (allowed) {
          const bad = keys.filter((key) => !allowed.has(canonicalDecision(key)));
          if (bad.length) checks.push({ level: "error", label: `${gLabel} · Q${q.number}: answer key must be ${[...allowed].join(" / ").replace("NOT_GIVEN", "NOT GIVEN")}`, detail: `Found “${bad.join("”, “")}”.`, target });
        }
        if (q.type === "multi_select" && options.length >= 2 && keys.length > options.length) {
          checks.push({ level: "error", label: `${gLabel} · Q${q.number}: more answers than options`, target });
        }
      }
      // A gapped document and its questions must agree, or a gap shows no box (or a box has no question).
      if (g.contentHtml && g.questions.length > 0) {
        const gaps = gapNumbersIn(g.contentHtml);
        if (gaps.length > 0) {
          const questionNumbers = new Set(g.questions.map((q) => q.number));
          const missing = [...new Set(gaps)].filter((n) => !questionNumbers.has(n));
          const unplaced = g.questions.filter((q) => GAPPED_TYPES.has(q.type) && !gaps.includes(q.number)).map((q) => q.number);
          const repeated = gaps.filter((n, i) => gaps.indexOf(n) !== i);
          if (missing.length) checks.push({ level: "error", label: `${gLabel}: gap placeholder without a question`, detail: `Gap ${missing.join(", ")} in the text has no question with that number.`, target });
          if (unplaced.length) checks.push({ level: "warning", label: `${gLabel}: question without a gap in the text`, detail: `Q${unplaced.join(", Q")} will be listed below the text instead of inline.`, target });
          if (repeated.length) checks.push({ level: "error", label: `${gLabel}: gap placeholder used twice`, detail: `Gap ${[...new Set(repeated)].join(", ")} appears more than once.`, target });
        }
      }
      const objective = s.skill === "listening" || s.skill === "reading";
      if (objective && g.questions.length > 0 && !g.instructions?.trim() && !g.contentHtml?.trim()) {
        checks.push({ level: "warning", label: `${gLabel}: no instructions`, detail: "Students see no task instruction (e.g. “Write NO MORE THAN TWO WORDS”).", target });
      }
      if (s.skill === "writing" && type !== "multilevel" && g.questions.some((q) => q.type === "essay_task1") && !g.imageUrl) {
        checks.push({ level: "warning", label: `${gLabel}: Task 1 has no chart, map or diagram`, detail: "Academic Task 1 normally describes a visual. Upload it, or ignore this for General Training letters.", target });
      }
    }
    if (s.skill === "listening" || s.skill === "reading") {
      const sorted = [...new Set(numbers)].sort((a, b) => a - b);
      const holes: number[] = [];
      for (let i = 1; i < sorted.length; i += 1) for (let n = sorted[i - 1] + 1; n < sorted[i] && holes.length < 10; n += 1) holes.push(n);
      if (holes.length) checks.push({ level: "warning", label: `${cap(s.skill)}: question numbers skip ${holes.join(", ")}`, detail: "Students will see a gap in the numbering. Check that no question is missing.", target: { kind: "section", sectionId: s.id } });
    }
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
  // Numbers repeat only across sections, never within one.
  const usedElsewhere = new Set<number>();
  const own = sections.find((s) => s.groups.some((g) => g.id === groupId));
  for (const s of own ? [own] : sections)
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
  // Like duplicateNumberErrors: only the block's own section counts (every section starts at 1).
  const own = sections.find((s) => s.groups.some((g) => g.id === groupId));
  for (const s of own ? [own] : sections)
    for (const g of s.groups) {
      if (g.id === groupId) continue;
      if (g.questions.some((x) => x.number === n)) return true;
    }
  return numbers.filter((x) => x === n).length > 1;
}
