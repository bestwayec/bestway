import { describe, expect, it } from "vitest";
import type { MockAttemptSummary } from "@/lib/types";
import { MAX_POINTS, resultsProgress } from "./results-progress";

let n = 0;
const attempt = (over: Partial<MockAttemptSummary>): MockAttemptSummary =>
  ({
    id: `a${++n}`, examId: "e1", examTitle: "Exam", examType: "ielts_academic", status: "completed",
    flowMode: "partial_practice", submittedAt: "2026-11-01T10:00:00Z", startedAt: "2026-11-01T09:00:00Z",
    rawScores: null, overallBand: null, overallScore: null, cefrLevel: null, ...over,
  }) as MockAttemptSummary;

describe("resultsProgress", () => {
  it("is empty without attempts", () => {
    expect(resultsProgress([])).toEqual({ finished: 0, checking: 0, mocks: { ielts: [], multilevel: [] }, practice: [] });
  });

  it("counts only submitted attempts; a server-closed duplicate is not finished", () => {
    const p = resultsProgress([
      attempt({ status: "completed", submittedAt: null, rawScores: { reading: { score: 5, max: 6 } } }),
      attempt({ status: "in_progress", submittedAt: null }),
      attempt({ status: "grading" }),
    ]);
    expect(p.finished).toBe(1);
    expect(p.checking).toBe(1);
    expect(p.practice).toEqual([]);
  });

  it("practice is raw N/M from Listening + Reading only, never a band", () => {
    const p = resultsProgress([
      attempt({ rawScores: { reading: { score: 5, max: 6 }, listening: { score: 3, max: 4 }, writing: { score: 6, max: 9 } }, overallBand: 9 }),
    ]);
    expect(p.practice).toHaveLength(1);
    expect(p.practice[0]).toMatchObject({ correct: 8, total: 10, percent: 80 });
    expect(p.mocks.ielts).toEqual([]);
  });

  it("expert-graded-only practice has no raw count and is left out", () => {
    expect(resultsProgress([attempt({ rawScores: { writing: { score: 6, max: 9 } } })]).practice).toEqual([]);
  });

  it("full mocks give official-scale points per family, kept apart from practice", () => {
    const p = resultsProgress([
      attempt({ flowMode: "full_test", overallBand: 6.5, cefrLevel: "B2", submittedAt: "2026-11-03T10:00:00Z" }),
      attempt({ flowMode: "full_test", overallBand: 6, submittedAt: "2026-11-02T10:00:00Z" }),
      attempt({ flowMode: "full_test", examType: "multilevel", overallScore: 52, cefrLevel: "B2" }),
      attempt({ flowMode: "full_test", overallBand: null }),
    ]);
    expect(p.mocks.ielts.map((m) => m.value)).toEqual([6, 6.5]);
    expect(p.mocks.multilevel.map((m) => m.value)).toEqual([52]);
    expect(p.practice).toEqual([]);
  });

  it("keeps the latest points only", () => {
    const many = Array.from({ length: MAX_POINTS + 3 }, (_, i) =>
      attempt({ rawScores: { reading: { score: i, max: 20 } }, submittedAt: new Date(Date.UTC(2026, 9, i + 1)).toISOString() }));
    const p = resultsProgress(many);
    expect(p.practice).toHaveLength(MAX_POINTS);
    expect(p.practice[0].correct).toBe(3);
  });
});
