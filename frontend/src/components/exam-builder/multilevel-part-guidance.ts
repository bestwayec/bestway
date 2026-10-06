"use client";

import type { MockSkill } from "@/lib/types";

/**
 * Display mirror of the authoritative backend Multilevel blueprint
 * (`backend/src/mock/multilevel-specification.ts`). The backend remains the
 * only source of truth for validation, readiness and scoring; this copy exists
 * so the Exam Builder can show an admin what a part still needs.
 *
 * Human labels deliberately avoid legacy enum wording such as "email".
 */
export interface MultilevelPartDisplay {
  key: string;
  label: string;
  count: number;
  rawMax: number;
  /** Human wording for the response/task expectation. */
  expectation: string;
  timing?: string;
  requiresTwoPictureAsset?: boolean;
  requiresAudio?: boolean;
  requiresContext?: boolean;
}

const WRITING: MultilevelPartDisplay[] = [
  { key: "informal_email", label: "Task 1.1 — Informal Letter", count: 1, rawMax: 5, expectation: "about 50 words" },
  { key: "formal_email", label: "Task 1.2 — Formal Letter", count: 1, rawMax: 5, expectation: "120–150 words" },
  { key: "publication", label: "Task 2 — Publication", count: 1, rawMax: 6, expectation: "180–200 words" },
];

const SPEAKING: MultilevelPartDisplay[] = [
  { key: "1.1", label: "Part 1.1", count: 3, rawMax: 5, expectation: "3 personal questions", timing: "no prep · 30s each" },
  { key: "1.2", label: "Part 1.2", count: 3, rawMax: 5, expectation: "3 responses about two pictures", timing: "no official prep · 45s · 30s · 30s", requiresTwoPictureAsset: true },
  { key: "2", label: "Part 2", count: 1, rawMax: 5, expectation: "one long turn", timing: "60s prep · 120s response", requiresContext: true },
  { key: "3", label: "Part 3", count: 1, rawMax: 6, expectation: "discussion: for and against", timing: "60s prep · 120s response" },
];

const OBJECTIVE: Record<"listening" | "reading", Array<{ key: string; count: number }>> = {
  listening: [
    { key: "1", count: 8 }, { key: "2", count: 6 }, { key: "3", count: 4 },
    { key: "4", count: 5 }, { key: "5", count: 6 }, { key: "6", count: 6 },
  ],
  reading: [{ key: "1", count: 6 }, { key: "2", count: 8 }, { key: "3", count: 6 }, { key: "4", count: 9 }, { key: "5", count: 6 }],
};

/** Every Multilevel part of a skill, in authored order. */
export function multilevelPartsFor(skill: MockSkill): MultilevelPartDisplay[] {
  if (skill === "writing") return WRITING;
  if (skill === "speaking") return SPEAKING;
  return OBJECTIVE[skill].map((part) => ({
    key: part.key,
    label: `Part ${part.key}`,
    count: part.count,
    rawMax: 0, // objective parts are one mark per question; group caps do not apply
    expectation: `${part.count} questions`,
    requiresAudio: skill === "listening",
  }));
}

export function multilevelPartAt(skill: MockSkill, partIndex: number): MultilevelPartDisplay | undefined {
  return multilevelPartsFor(skill)[partIndex];
}

/** Total questions a complete Multilevel full mock must contain. */
export const MULTILEVEL_REQUIRED_QUESTIONS: Record<MockSkill, number> = {
  listening: 35,
  reading: 35,
  writing: 3,
  speaking: 8,
};

export interface PartState {
  questionCount: number;
  hasAudio: boolean;
  hasImage: boolean;
  hasMaterial: boolean;
  hasPrompts: boolean;
}

export interface PartSummaryRow {
  label: string;
  value: string;
  ok: boolean;
}

export interface PartSummary {
  heading: string;
  rows: PartSummaryRow[];
  ready: boolean;
}

/**
 * What the admin still has to supply for one part. Mirrors the backend
 * blueprint closely enough to explain a Review failure before publishing.
 */
export function multilevelPartSummary(
  skill: MockSkill,
  partIndex: number,
  state: PartState,
): PartSummary | null {
  const part = multilevelPartAt(skill, partIndex);
  if (!part) return null;
  const rows: PartSummaryRow[] = [
    { label: "Questions", value: `${state.questionCount} / ${part.count}`, ok: state.questionCount === part.count },
  ];
  if (part.requiresTwoPictureAsset) {
    rows.push({ label: "Two-picture asset", value: state.hasImage ? "1 / 1" : "0 / 1", ok: state.hasImage });
  }
  if (part.requiresContext) {
    rows.push({ label: "Context image", value: state.hasImage ? "1 / 1" : "0 / 1", ok: state.hasImage });
  }
  if (part.requiresAudio) {
    rows.push({ label: "Audio", value: state.hasAudio ? "attached" : "missing", ok: state.hasAudio });
  }
  if (part.rawMax > 0) {
    rows.push({ label: "Score", value: `/${part.rawMax}`, ok: true });
  }
  if (part.expectation) {
    rows.push({ label: "Task", value: part.expectation, ok: state.hasPrompts });
  }
  if (part.timing) rows.push({ label: "Timing", value: part.timing, ok: true });
  if (skill === "writing" && part.key !== "publication") {
    rows.push({ label: "Source stimulus", value: state.hasMaterial ? "shared Task 1 material" : "missing", ok: state.hasMaterial });
  }
  return { heading: part.label, rows, ready: rows.every((row) => row.ok) };
}
