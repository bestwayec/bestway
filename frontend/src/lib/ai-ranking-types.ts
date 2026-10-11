import type { PracticeGrade } from "./assessment-types";

export type AiRankingSkill = "writing" | "speaking";

export interface GroupAiRankingRow {
  studentId: string;
  name: string;
  attemptId: string | null;
  jobId: string | null;
  aiScore: number | null;
  aiRawScore: number | null;
  teacherScore: number | null;
  finalScore: number | null;
  finalScoreSource: string | null;
  finalScoreScaleMax: number | null;
  finalPracticeGrade?: PracticeGrade | null;
  practiceGrade?: PracticeGrade | null;
  confidence: number | null;
  reviewRequired: boolean;
  eligible: boolean;
  rank: number | null;
  status: string;
}

export interface GroupAiRankingCohort {
  id: string;
  label: string;
  isPartial: boolean;
  rawMax: number;
  scaleMax: number;
  questionCount: number;
  specificationVersion: string | null;
  rubricVersion: string;
  promptVersion: string;
  gradingPolicyId: string | null;
  parts: { id: string; max: number; questionIds: string[]; taskVersion: string }[];
  rows: GroupAiRankingRow[];
}

export interface GroupAiRankingData {
  group: { id: string; name: string };
  skill: AiRankingSkill;
  exams: { id: string; title: string; type: "multilevel" }[];
  selectedExamId: string | null;
  cohorts: GroupAiRankingCohort[];
  unranked: GroupAiRankingRow[];
}

/** A missing result stays empty; zero is a valid persisted rubric score. */
export function rankingScoreLabel(score: number | null | undefined, maximum?: number | null): string {
  if (score == null || !Number.isFinite(score)) return "—";
  const value = Number.isInteger(score) ? String(score) : score.toFixed(1);
  return maximum != null && Number.isFinite(maximum) ? `${value} / ${maximum}` : value;
}

export function rankingStatusKey(row: GroupAiRankingRow): string {
  if (row.status === "NO_ATTEMPT") return "notAttempted";
  if (row.status === "IN_PROGRESS") return "inProgress";
  if (["PENDING", "PROCESSING", "RETRY"].includes(row.status)) return "pending";
  if (row.status === "FAILED") return "failed";
  if (row.status === "NO_ASSESSMENT") return "notAssessed";
  if (row.status === "INVALID_SCOPE") return "invalidScope";
  return row.reviewRequired || !row.eligible ? "reviewRequired" : "graded";
}
