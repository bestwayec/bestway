/**
 * A teacher's unsent grade (score + comment) is kept in this browser until it is saved, so a
 * reload or a lost connection does not lose it. Only the teacher's own input is stored; the
 * server stays the source of every saved grade.
 */
export interface GradeDraft { score: string; feedback: string }

export const gradeDraftKey = (attemptId: string, questionId: string) => `bw_grade_draft_${attemptId}_${questionId}`;

export function readGradeDraft(storage: Pick<Storage, "getItem"> | null | undefined, key: string): GradeDraft | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GradeDraft>;
    if (typeof value?.score !== "string" || typeof value?.feedback !== "string") return null;
    return { score: value.score, feedback: value.feedback };
  } catch { return null; }
}

/** Stores the draft when it differs from what the server holds, removes it otherwise. */
export function writeGradeDraft(storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined, key: string, draft: GradeDraft, saved: GradeDraft) {
  try {
    if (draft.score === saved.score && draft.feedback === saved.feedback) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(draft));
  } catch { /* storage full or blocked: the form still works, only the draft is not kept */ }
}

/** Index of the grade field to move to with Alt+ArrowDown / Alt+ArrowUp, or -1. */
export function nextGradeIndex(count: number, current: number, key: string, altKey: boolean): number {
  if (!altKey || current < 0) return -1;
  if (key === "ArrowDown") return current + 1 < count ? current + 1 : -1;
  if (key === "ArrowUp") return current > 0 ? current - 1 : -1;
  return -1;
}

/**
 * IELTS criteria → task score: the mean of the complete criteria, to the nearest half band.
 * Used to fill the score field while the teacher has not typed a score of their own, so entering
 * only the four criteria never leaves a stale score (for example the 0 a missing answer got at hand-in).
 */
export function criteriaScore(values: (string | undefined)[], count: number): number | null {
  if (count === 0 || values.length !== count) return null;
  const numbers = values.map((v) => (v === undefined || v.trim() === "" ? NaN : Number(v)));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0 || n > 9)) return null;
  return Math.round((numbers.reduce((a, b) => a + b, 0) / count) * 2) / 2;
}
