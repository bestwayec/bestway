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
