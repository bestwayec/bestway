import type { MockAttemptSummary } from "@/lib/types";
import { examFamily } from "@/lib/score-display";

/**
 * Progress points for the Results page, built only from the student's own attempts (GET mock/attempts/mine).
 *
 * Rules (owner decisions):
 * - an attempt counts as finished only with a submittedAt (#133): attempts the server closed without a
 *   submission are ignored;
 * - full mocks (flowMode full_test) carry the official-scale result: IELTS overall band (0-9) or the
 *   Multilevel standard score (0-75). They are never mixed with practice in one chart (#129);
 * - every other attempt is practice and is shown only as raw "N/M correct · %" from the auto-scored
 *   skills (Listening, Reading). Expert-graded Writing/Speaking practice has no raw count and is left out.
 */
export type MockFamily = "ielts" | "multilevel";

export interface MockPoint {
  id: string;
  at: string;
  examTitle: string;
  value: number;
  cefrLevel: string | null;
}

export interface PracticePoint {
  id: string;
  at: string;
  examTitle: string;
  correct: number;
  total: number;
  percent: number;
}

export interface ResultsProgress {
  finished: number;
  checking: number;
  mocks: Record<MockFamily, MockPoint[]>;
  practice: PracticePoint[];
}

export const MOCK_SCALE: Record<MockFamily, number> = { ielts: 9, multilevel: 75 };
export const MAX_POINTS = 12;

const AUTO_SKILLS = ["listening", "reading"] as const;

const byTime = (a: { at: string }, b: { at: string }) => Date.parse(a.at) - Date.parse(b.at);

export function isFinished(a: MockAttemptSummary): boolean {
  return !!a.submittedAt && (a.status === "grading" || a.status === "completed");
}

export function resultsProgress(attempts: MockAttemptSummary[]): ResultsProgress {
  const finished = attempts.filter(isFinished);
  const mocks: Record<MockFamily, MockPoint[]> = { ielts: [], multilevel: [] };
  const practice: PracticePoint[] = [];

  for (const a of finished) {
    if (a.status !== "completed") continue; // still being checked: no number yet
    const at = a.submittedAt as string;
    const examTitle = a.examTitle ?? "";
    if (a.flowMode === "full_test") {
      const family = examFamily(a.examType);
      if (family === "ielts" && a.overallBand != null) {
        mocks.ielts.push({ id: a.id, at, examTitle, value: a.overallBand, cefrLevel: a.cefrLevel ?? null });
      } else if (family === "multilevel" && a.overallScore != null) {
        mocks.multilevel.push({ id: a.id, at, examTitle, value: a.overallScore, cefrLevel: a.cefrLevel ?? null });
      }
      continue;
    }
    let correct = 0;
    let total = 0;
    for (const skill of AUTO_SKILLS) {
      const raw = a.rawScores?.[skill];
      if (raw && raw.max > 0) {
        correct += raw.score;
        total += raw.max;
      }
    }
    if (total > 0) practice.push({ id: a.id, at, examTitle, correct, total, percent: Math.round((correct / total) * 100) });
  }

  return {
    finished: finished.length,
    checking: finished.filter((a) => a.status === "grading").length,
    mocks: { ielts: mocks.ielts.sort(byTime).slice(-MAX_POINTS), multilevel: mocks.multilevel.sort(byTime).slice(-MAX_POINTS) },
    practice: practice.sort(byTime).slice(-MAX_POINTS),
  };
}
