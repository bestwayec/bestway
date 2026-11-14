import { describe, expect, it } from "vitest";
import { listeningPosition, reviewSecondsLeft, type ListeningSchedule } from "./listening-schedule";

const schedule: ListeningSchedule = { startedAt: "2026-11-13T10:00:00.000Z", readingEndsAt: "2026-11-13T10:00:30.000Z", readingSeconds: 30, durationSec: 60 };
const at = (seconds: number) => Date.parse("2026-11-13T10:00:00.000Z") + seconds * 1000;

describe("listeningPosition", () => {
  it.each([
    [0, { phase: "reading", readingLeft: 30 }],
    [29.2, { phase: "reading", readingLeft: 1 }],
    [30, { phase: "playing", offsetSec: 0 }],
    [75, { phase: "playing", offsetSec: 45 }],
    [90, { phase: "ended", secondsSinceEnd: 0 }],
    [100, { phase: "ended", secondsSinceEnd: 10 }],
  ])("at %s s after Play it is %j", (seconds, expected) => {
    expect(listeningPosition(schedule, at(seconds), null)).toEqual(expected);
  });

  it("uses the recording's own length when the server does not know it", () => {
    const unknown = { ...schedule, durationSec: null };
    expect(listeningPosition(unknown, at(80), null)).toEqual({ phase: "playing", offsetSec: 50 });
    expect(listeningPosition(unknown, at(80), 40)).toEqual({ phase: "ended", secondsSinceEnd: 10 });
  });

  it("gives back only the rest of the 2-minute check after a reload", () => {
    expect(reviewSecondsLeft(listeningPosition(schedule, at(90 + 45), null), 120)).toBe(75);
    expect(reviewSecondsLeft(listeningPosition(schedule, at(90 + 500), null), 120)).toBe(0);
    expect(reviewSecondsLeft({ phase: "playing", offsetSec: 3 }, 120)).toBe(120);
  });
});
