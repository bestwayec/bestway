import type { MockAttemptSummary } from "@/lib/types";
import type { StudentAssignmentItem } from "./StudentAssignmentsWidget";

/** One actionable line of the student's "Today" card. Built only from real API data. */
export type TodayItem =
  | { kind: "resume"; href: string; title: string; skill: string | null }
  | { kind: "homework"; href: string; count: number; overdue: number; nextTitle: string }
  | { kind: "words"; href: string; count: number }
  | { kind: "result"; href: string; title: string; pending: boolean };

const OPEN_HOMEWORK = new Set(["pending", "overdue"]);

export function buildTodayItems({
  attempts,
  assignments,
  weakWords,
}: {
  attempts?: MockAttemptSummary[] | null;
  assignments?: StudentAssignmentItem[] | null;
  weakWords?: number | null;
}): TodayItem[] {
  const items: TodayItem[] = [];
  const list = attempts ?? [];
  const inProgress = list.find((a) => a.status === "in_progress");
  if (inProgress) {
    items.push({ kind: "resume", href: `/mock/attempt/${inProgress.id}`, title: inProgress.examTitle ?? "", skill: inProgress.currentSkill ?? null });
  }
  const open = (assignments ?? [])
    .filter((a) => !a.is_submitted && OPEN_HOMEWORK.has(a.status))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (open.length) {
    items.push({ kind: "homework", href: "/dashboard#assignments", count: open.length, overdue: open.filter((a) => a.is_overdue || a.status === "overdue").length, nextTitle: open[0].exam_title || open[0].title });
  }
  if (weakWords && weakWords > 0) items.push({ kind: "words", href: "/vocabulary/srs", count: weakWords });
  const latest = list.find((a) => a.status === "completed" || a.status === "grading");
  if (latest) items.push({ kind: "result", href: `/mock/attempt/${latest.id}`, title: latest.examTitle ?? "", pending: latest.status === "grading" });
  return items;
}
