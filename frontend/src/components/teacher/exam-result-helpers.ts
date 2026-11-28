/** Pure Result Center helpers (unit-tested without the Next runtime). */
export type Skill = "listening" | "reading" | "writing" | "speaking";
export type ExamReportRow = {
  studentId: string; name: string; attemptId: string | null;
  participation: "not_started" | "in_progress" | "submitted" | "auto_submitted" | "not_submitted";
  grading: "none" | "awaiting_assessment" | "awaiting_teacher_review" | "partially_graded" | "finalized";
  scores: Record<Skill, number | null>; overall: number | null; cefr: string | null; rank: number | null;
  rawScore: number | null; rawMax: number | null; growth: number | null; pendingSkills: string[]; submittedAt: string | null;
  monitor?: { currentSkill: string | null; confirmedAnswers: number; lastConfirmedAt: string | null; deadlineAt: string | null; incidents: number } | null;
};
export type ExamReport = {
  assignmentId: string; title: string; examTitle: string; groupName: string; groupId: string | null; scale: "ielts" | "multilevel" | "raw";
  stage: "open" | "preliminary" | "final"; deadline: string; opensAt: string | null; timingPolicy: string; generatedAt: string;
  counts: Record<"eligible" | "notStarted" | "inProgress" | "submitted" | "autoSubmitted" | "notSubmitted" | "handedIn" | "awaitingGrading" | "finalized", number>;
  stats: { average: number | null; median: number | null; highest: number | null; sample: number };
  rows: ExamReportRow[]; pagination: { page: number; limit: number; total: number };
  delivery: { preliminaryAt: string | null; finalAt: string | null; finalVersion: number; messages: Array<{ key: string; status: string; error: string | null }> };
};

export const SKILLS: Skill[] = ["listening", "reading", "writing", "speaking"];
export const SORTS = ["rank", "overall", "name", "growth", "submitted"] as const;
export const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
export const tashkent = (iso: string) => new Date(iso).toLocaleString(undefined, { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" });

/** A pending subjective grade is a status, never a number: only server-confirmed values are shown. */
export function scoreCell(row: ExamReportRow, skill: Skill, pendingLabel: string): string {
  const value = row.scores[skill];
  if (value !== null) return String(value);
  return row.pendingSkills.includes(skill) ? pendingLabel : "—";
}

/** Overall is shown only when final; "pending" only while a subjective grade is awaited. */
export function overallCell(row: ExamReportRow, pendingLabel: string): string {
  if (row.overall !== null) return String(row.overall);
  return ["awaiting_assessment", "awaiting_teacher_review", "partially_graded"].includes(row.grading) ? pendingLabel : "—";
}

const STALE_MS = 5 * 60_000;
/** Last confirmed server activity only; nothing about unsent client state is inferred. */
export function isStale(lastConfirmedAt: string | null, now: number): boolean {
  return lastConfirmedAt === null || now - new Date(lastConfirmedAt).getTime() > STALE_MS;
}

/** Share of eligible students who handed in, or null when nobody is eligible. */
export function completionRate(counts: ExamReport["counts"]): number | null {
  return counts.eligible ? Math.round((100 * counts.handedIn) / counts.eligible) : null;
}

