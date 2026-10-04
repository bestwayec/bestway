import type { AssessmentJobView, AssessmentReviewInput, AssessmentStatus, AttemptAssessments } from "./assessment-types";

export const ASSESSMENT_POLL_INTERVAL_MS = 15_000;
export const ASSESSMENT_POLL_LIMIT = 20;
export const ASSESSMENT_POLL_WINDOW_MS = 5 * 60_000;

const ACTIVE: ReadonlySet<AssessmentStatus> = new Set(["PENDING", "PROCESSING", "RETRY"]);
export const hasActiveAssessments = (data?: AttemptAssessments) =>
  data?.assessments.some((job) => ACTIVE.has(job.status)) ?? false;

export function assessmentPollingInterval(data: AttemptAssessments | undefined, requests: number, elapsedMs: number, hasError: boolean): number | false {
  return !hasError && requests < ASSESSMENT_POLL_LIMIT && elapsedMs < ASSESSMENT_POLL_WINDOW_MS && hasActiveAssessments(data)
    ? ASSESSMENT_POLL_INTERVAL_MS : false;
}

export function assessmentStatusKey(job: AssessmentJobView): string {
  if (job.status === "SUCCEEDED" && job.finalScoreSource === "TEACHER") return "reviewed";
  return { PENDING: "queued", PROCESSING: "processing", RETRY: "retrying", SUCCEEDED: "aiGraded", FAILED: "failed", NEEDS_REVIEW: "needsReview" }[job.status];
}

export function canAcceptAssessment(job: AssessmentJobView): boolean {
  const result = job.evaluation?.result;
  return !ACTIVE.has(job.status) && job.status !== "FAILED" && job.aiScore != null && !!result &&
    job.parts.length > 0 && job.parts.every((part) => {
      const score = result.parts.find((candidate) => candidate.id === part.id);
      if (!score || score.rawScore == null) return false;
      return job.program === "MULTILEVEL" || criterionKeys(job).every((key) => score.criteria[key] != null);
    });
}

export function criterionKeys(job: AssessmentJobView): string[] {
  return job.skill === "writing" ? ["ta", "cc", "lr", "gra"] : ["fluency", "lexical", "grammar", "pronunciation"];
}

/** Validate teacher inputs only; scoring/conversion happens exclusively on the backend. */
export function overrideParts(job: AssessmentJobView, values: Record<string, Record<string, string>>): NonNullable<AssessmentReviewInput["parts"]> {
  return job.parts.map((part) => {
    const fields = job.program === "MULTILEVEL" ? ["rawScore"] : criterionKeys(job);
    const scores = Object.fromEntries(fields.map((key) => {
      const raw = values[part.id]?.[key]?.trim();
      const score = raw ? Number(raw) : NaN;
      const max = job.program === "MULTILEVEL" ? part.max : 9;
      if (!Number.isFinite(score) || score < 0 || score > max || !Number.isInteger(score * 2)) throw new Error("INVALID_ASSESSMENT_SCORE");
      return [key, score];
    }));
    return job.program === "MULTILEVEL" ? { id: part.id, rawScore: scores.rawScore } : { id: part.id, criteria: scores };
  });
}

/** Always use the authorized same-origin media proxy, never an arbitrary provider URL. */
export function assessmentAudioPath(attemptId: string, questionId: string): string {
  return `/api/backend/mock/attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(questionId)}/audio`;
}

export function splitFeedbackLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
