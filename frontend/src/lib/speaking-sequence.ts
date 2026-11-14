/**
 * Timed Multilevel Speaking runs as one sequence, like the official test: when a response is
 * uploaded, the next question opens and starts on its own, and earlier parts stay closed.
 * The server still decides every window (start, preparation, response, previous-upload check);
 * this module only decides which question the exam window opens next.
 */
export interface SpeakingGroupLike { questions?: { id: string }[] | null }

/** The question after `questionId` in exam order, with the index of the part that holds it. */
export function nextSpeakingTarget(groups: SpeakingGroupLike[], questionId: string): { groupIndex: number; questionId: string } | null {
  const order = groups.flatMap((group, groupIndex) => (group?.questions ?? []).map((q) => ({ groupIndex, questionId: q.id })));
  const index = order.findIndex((item) => item.questionId === questionId);
  return index >= 0 && index + 1 < order.length ? order[index + 1] : null;
}

/** In a timed Speaking section the student cannot return to an earlier part. */
export function canSelectSpeakingPart(timed: boolean, current: number, target: number): boolean {
  return !timed || target >= current;
}

const pending = new Map<string, string>();
export const SPEAKING_AUTOSTART_EVENT = "multilevel:speaking-autostart";

/** Ask the recorder of `questionId` to start as soon as it is on screen (it may mount later). */
export function requestSpeakingAutoStart(attemptId: string, questionId: string) {
  pending.set(attemptId, questionId);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SPEAKING_AUTOSTART_EVENT, { detail: { attemptId, questionId } }));
}

/** True once for the recorder that was asked to start; the request is then consumed. */
export function takeSpeakingAutoStart(attemptId: string, questionId: string): boolean {
  if (pending.get(attemptId) !== questionId) return false;
  pending.delete(attemptId);
  return true;
}
