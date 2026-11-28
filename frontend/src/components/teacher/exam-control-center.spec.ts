import { describe, expect, it } from "vitest";
import { minutesSince, monitorAttention, pendingAssessmentRows, type ExamReportRow } from "./exam-result-helpers";
import { filterReviewRows } from "@/components/mock/result-review-table";
import type { MockAttemptQuestion } from "@/lib/types";

const row = (over: Partial<ExamReportRow>): ExamReportRow => ({
  studentId: "s", name: "S", attemptId: "a", participation: "submitted", grading: "finalized",
  scores: { listening: null, reading: null, writing: null, speaking: null }, overall: null, cefr: null, rank: null,
  rawScore: null, rawMax: null, growth: null, pendingSkills: [], submittedAt: null, ...over,
});

describe("teacher control center helpers", () => {
  it("queues only handed-in attempts that still need a teacher grade", () => {
    const rows = [
      row({ studentId: "1", grading: "awaiting_teacher_review" }),
      row({ studentId: "2", grading: "finalized" }),
      row({ studentId: "3", grading: "partially_graded", participation: "in_progress" }),
      row({ studentId: "4", grading: "awaiting_assessment", attemptId: null }),
      row({ studentId: "5", grading: "partially_graded", participation: "auto_submitted" }),
    ];
    expect(pendingAssessmentRows(rows).map((r) => r.studentId)).toEqual(["1", "5"]);
  });

  it("flags quiet or incident rows without calling them disconnected", () => {
    const now = Date.parse("2026-11-28T10:00:00Z");
    const recent = row({ participation: "in_progress", monitor: { currentSkill: "reading", confirmedAnswers: 3, lastConfirmedAt: "2026-11-28T09:59:00Z", deadlineAt: null, incidents: 0 } });
    const quiet = row({ participation: "in_progress", monitor: { currentSkill: "reading", confirmedAnswers: 3, lastConfirmedAt: "2026-11-28T09:40:00Z", deadlineAt: null, incidents: 2 } });
    expect(monitorAttention(recent, now)).toEqual({ stale: false, incidents: false });
    expect(monitorAttention(quiet, now)).toEqual({ stale: true, incidents: true });
    expect(minutesSince("2026-11-28T09:40:00Z", now)).toBe(20);
    expect(minutesSince(null, now)).toBeNull();
  });
});

describe("personal mistake review", () => {
  const q = (id: string, over: Partial<MockAttemptQuestion>) => ({ id, number: 1, type: "short_answer", response: "x", isCorrect: null, isGraded: true, ...over }) as unknown as MockAttemptQuestion;
  it("lists wrong and unanswered answers, never pending marks or correct ones", () => {
    const rows = [q("c", { isCorrect: true }), q("w", { isCorrect: false }), q("u", { response: "" }), q("p", { isGraded: false, isCorrect: null })];
    expect(filterReviewRows(rows, "mistakes").map((r) => r.id)).toEqual(["w", "u"]);
  });
});
