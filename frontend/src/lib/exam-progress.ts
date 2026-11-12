import type { MockAttemptSummary } from "@/lib/types";

/** The student's own progress on one exam, derived only from their attempts as the server returns them. */
export type ExamProgress = "not_started" | "in_progress" | "checking" | "completed";

/**
 * - in_progress: an attempt is open.
 * - checking: the latest submitted attempt is still being graded.
 * - completed: the latest submitted attempt is graded.
 * An attempt the server closed without a submission (e.g. a duplicate open attempt, see mock_attempts.start)
 * has no submittedAt and does not count as finished.
 */
export function examProgress(attempts: MockAttemptSummary[], examId: string): ExamProgress {
  const own = attempts.filter((a) => a.examId === examId);
  if (own.some((a) => a.status === "in_progress")) return "in_progress";
  const submitted = own
    .filter((a) => a.submittedAt && (a.status === "grading" || a.status === "completed"))
    .sort((a, b) => Date.parse(b.submittedAt as string) - Date.parse(a.submittedAt as string));
  if (submitted.length === 0) return "not_started";
  return submitted[0].status === "grading" ? "checking" : "completed";
}

export type ProgressFilter = "all" | "not_started" | "in_progress" | "done";

export function matchesProgressFilter(progress: ExamProgress, filter: ProgressFilter): boolean {
  if (filter === "all") return true;
  if (filter === "done") return progress === "checking" || progress === "completed";
  return progress === filter;
}
