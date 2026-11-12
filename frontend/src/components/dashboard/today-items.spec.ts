import { describe, expect, it } from "vitest";
import type { MockAttemptSummary } from "@/lib/types";
import type { StudentAssignmentItem } from "./StudentAssignmentsWidget";
import { buildTodayItems } from "./today-items";

const attempt = (id: string, status: string, extra: Partial<MockAttemptSummary> = {}) => ({ id, status, examTitle: `Exam ${id}`, currentSkill: null, ...extra }) as unknown as MockAttemptSummary;
const hw = (id: string, status: StudentAssignmentItem["status"], deadline: string, extra: Partial<StudentAssignmentItem> = {}) =>
  ({ id, status, deadline, title: `HW ${id}`, is_submitted: false, is_overdue: status === "overdue", ...extra }) as StudentAssignmentItem;

describe("student Today items", () => {
  it("is empty without real data (the card shows an honest empty state)", () => {
    expect(buildTodayItems({})).toEqual([]);
    expect(buildTodayItems({ attempts: [], assignments: [], weakWords: 0 })).toEqual([]);
  });

  it("orders resume, homework, words, latest result — all from the API", () => {
    const items = buildTodayItems({
      attempts: [attempt("a", "in_progress", { currentSkill: "reading" }), attempt("b", "grading"), attempt("c", "completed")],
      assignments: [hw("2", "pending", "2026-11-20"), hw("1", "overdue", "2026-11-10"), hw("3", "passed", "2026-11-01"), hw("4", "pending", "2026-11-30", { is_submitted: true })],
      weakWords: 7,
    });
    expect(items.map((i) => i.kind)).toEqual(["resume", "homework", "words", "result"]);
    expect(items[0]).toMatchObject({ href: "/mock/attempt/a", skill: "reading" });
    expect(items[1]).toMatchObject({ count: 2, overdue: 1, nextTitle: "HW 1" });
    expect(items[2]).toMatchObject({ count: 7, href: "/vocabulary/srs" });
    expect(items[3]).toMatchObject({ href: "/mock/attempt/b", pending: true });
  });
});
