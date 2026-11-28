import { describe, expect, it } from "vitest";
import { scoreCell, type ExamReportRow } from "./exam-result-center";

const row = (over: Partial<ExamReportRow>): ExamReportRow => ({
  studentId: "s", name: "Student 01", attemptId: "a", participation: "submitted", grading: "partially_graded",
  scores: { listening: 7, reading: 6.5, writing: null, speaking: 0 }, overall: null, cefr: null, rank: null,
  rawScore: null, rawMax: null, growth: null, pendingSkills: ["writing"], submittedAt: null, ...over,
});

describe("Result Center score cells", () => {
  it("shows a pending subjective grade as a status, never as 0", () => {
    expect(scoreCell(row({}), "writing", "Awaiting teacher assessment")).toBe("Awaiting teacher assessment");
  });
  it("keeps a genuine zero", () => {
    expect(scoreCell(row({}), "speaking", "pending")).toBe("0");
  });
  it("shows a dash for a skill with no score and nothing pending", () => {
    expect(scoreCell(row({ scores: { listening: null, reading: 6, writing: null, speaking: null }, pendingSkills: [] }), "listening", "p")).toBe("—");
  });
});

import { isStale } from "./exam-result-center";
import { chartRows } from "./exam-progress-charts";

describe("monitor freshness and progress rows", () => {
  it("marks missing or old confirmed activity as stale", () => {
    const now = Date.parse("2026-11-28T10:00:00Z");
    expect(isStale(null, now)).toBe(true);
    expect(isStale("2026-11-28T09:50:00Z", now)).toBe(true);
    expect(isStale("2026-11-28T09:58:00Z", now)).toBe(false);
  });
  it("keeps missing skill scores as null, never 0", () => {
    const rows = chartRows([{ attemptId: "a", examTitle: "Mock", date: "2026-11-01T00:00:00Z", overall: 6.5,
      skills: { listening: 7, reading: null, writing: 6, speaking: null } }]);
    expect(rows[0].reading).toBeNull();
    expect(rows[0].overall).toBe(6.5);
  });
});

import { overallCell } from "./exam-result-center";

describe("overall cell", () => {
  const base = { studentId: "s", name: "n", attemptId: null, scores: { listening: null, reading: null, writing: null, speaking: null },
    overall: null, cefr: null, rank: null, rawScore: null, rawMax: null, growth: null, pendingSkills: [] as string[], submittedAt: null };
  it("does not label a never-started student as awaiting assessment", () => {
    expect(overallCell({ ...base, participation: "not_started", grading: "none" }, "pending")).toBe("—");
  });
  it("labels an awaited subjective grade as pending and shows a final value", () => {
    expect(overallCell({ ...base, participation: "submitted", grading: "awaiting_teacher_review" }, "pending")).toBe("pending");
    expect(overallCell({ ...base, participation: "submitted", grading: "finalized", overall: 6.5 }, "pending")).toBe("6.5");
  });
});
