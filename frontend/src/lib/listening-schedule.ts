/**
 * Where an IELTS Listening part is on the server clock. The server records the start once
 * (`POST mock/attempts/:id/listening/:group/start`): reading time for the questions, then the
 * recording, played once. After a reload or a lost connection the player resumes from here.
 */
export interface ListeningSchedule {
  startedAt: string;
  readingEndsAt: string;
  readingSeconds: number;
  durationSec: number | null;
  serverTime?: string;
}

export type ListeningPosition =
  | { phase: "reading"; readingLeft: number }
  | { phase: "playing"; offsetSec: number }
  | { phase: "ended"; secondsSinceEnd: number };

/** `nowMs` on the server clock; `durationSec` from the schedule or the loaded recording. */
export function listeningPosition(schedule: ListeningSchedule, nowMs: number, durationSec: number | null): ListeningPosition {
  const readingEnd = Date.parse(schedule.readingEndsAt);
  if (nowMs < readingEnd) return { phase: "reading", readingLeft: Math.ceil((readingEnd - nowMs) / 1000) };
  const elapsed = (nowMs - readingEnd) / 1000;
  const length = schedule.durationSec ?? durationSec;
  if (length != null && elapsed >= length) return { phase: "ended", secondsSinceEnd: elapsed - length };
  return { phase: "playing", offsetSec: elapsed };
}

/** Seconds left of the 2-minute check after the last part, on the server clock. */
export function reviewSecondsLeft(position: ListeningPosition, reviewSeconds: number): number {
  if (position.phase !== "ended") return reviewSeconds;
  return Math.max(0, Math.ceil(reviewSeconds - position.secondsSinceEnd));
}
