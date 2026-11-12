import { describe, expect, it } from "vitest";
import type { MockAttemptSummary } from "@/lib/types";
import { examProgress, matchesProgressFilter } from "./exam-progress";

const attempt = (over: Partial<MockAttemptSummary>): MockAttemptSummary =>
  ({ id: Math.random().toString(36), examId: "e1", status: "completed", submittedAt: null, startedAt: "2026-11-01T10:00:00Z", ...over }) as MockAttemptSummary;

describe("examProgress", () => {
  it("is not started without attempts, or with attempts of other exams", () => {
    expect(examProgress([], "e1")).toBe("not_started");
    expect(examProgress([attempt({ examId: "e2", status: "in_progress" })], "e1")).toBe("not_started");
  });

  it("an open attempt wins over earlier finished ones", () => {
    const list = [attempt({ status: "completed", submittedAt: "2026-11-02T10:00:00Z" }), attempt({ status: "in_progress" })];
    expect(examProgress(list, "e1")).toBe("in_progress");
  });

  it("uses the latest submitted attempt: grading -> checking, completed -> completed", () => {
    const older = attempt({ status: "completed", submittedAt: "2026-11-01T10:00:00Z" });
    const newer = attempt({ status: "grading", submittedAt: "2026-11-03T10:00:00Z" });
    expect(examProgress([older, newer], "e1")).toBe("checking");
    expect(examProgress([attempt({ status: "grading", submittedAt: "2026-11-01T10:00:00Z" }), attempt({ status: "completed", submittedAt: "2026-11-04T10:00:00Z" })], "e1")).toBe("completed");
  });

  it("an attempt closed by the server without a submission is not 'completed'", () => {
    expect(examProgress([attempt({ status: "completed", submittedAt: null })], "e1")).toBe("not_started");
  });

  it("filters", () => {
    expect(matchesProgressFilter("checking", "done")).toBe(true);
    expect(matchesProgressFilter("completed", "done")).toBe(true);
    expect(matchesProgressFilter("in_progress", "done")).toBe(false);
    expect(matchesProgressFilter("not_started", "not_started")).toBe(true);
    expect(matchesProgressFilter("in_progress", "all")).toBe(true);
  });
});
