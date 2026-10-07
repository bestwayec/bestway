import { describe, expect, it } from "vitest";
import {
  MULTILEVEL_REQUIRED_QUESTIONS,
  multilevelPartAt,
  multilevelPartSummary,
  multilevelPartsFor,
} from "./multilevel-part-guidance";

const empty = { questionCount: 0, hasAudio: false, hasImage: false, hasMaterial: false, hasPrompts: false };
const complete = { questionCount: 0, hasAudio: true, hasImage: true, hasMaterial: true, hasPrompts: true };

describe("Multilevel part guidance", () => {
  it("matches the authoritative blueprint structure", () => {
    expect(multilevelPartsFor("listening").map((p) => p.count)).toEqual([8, 6, 4, 5, 6, 6]);
    expect(multilevelPartsFor("reading").map((p) => p.count)).toEqual([6, 8, 6, 9, 6]);
    expect(multilevelPartsFor("writing").map((p) => p.rawMax)).toEqual([5, 5, 6]);
    expect(multilevelPartsFor("speaking").map((p) => p.rawMax)).toEqual([5, 5, 5, 6]);
    expect(multilevelPartsFor("speaking").map((p) => p.count)).toEqual([3, 3, 1, 1]);
  });

  it("totals 35 listening and 35 reading questions", () => {
    const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0);
    expect(sum(multilevelPartsFor("listening").map((p) => p.count))).toBe(MULTILEVEL_REQUIRED_QUESTIONS.listening);
    expect(sum(multilevelPartsFor("reading").map((p) => p.count))).toBe(MULTILEVEL_REQUIRED_QUESTIONS.reading);
  });

  it("never exposes legacy email wording", () => {
    for (const skill of ["writing", "speaking"] as const) {
      for (const part of multilevelPartsFor(skill)) {
        expect(part.label.toLowerCase()).not.toContain("email");
      }
    }
    expect(multilevelPartAt("writing", 0)?.label).toBe("Task 1.1 — Informal Letter");
    expect(multilevelPartAt("writing", 1)?.label).toBe("Task 1.2 — Formal Letter");
    expect(multilevelPartAt("writing", 2)?.label).toBe("Task 2 — Publication");
  });

  it("reports what a part still needs", () => {
    const speaking12 = multilevelPartSummary("speaking", 1, { ...empty, questionCount: 3 });
    expect(speaking12?.heading).toBe("Part 1.2");
    expect(speaking12?.ready).toBe(false);
    expect(speaking12?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Questions", value: "3 / 3", ok: true }),
      expect.objectContaining({ label: "Two-picture asset", value: "0 / 1", ok: false }),
      expect.objectContaining({ label: "Score", value: "/5" }),
      expect.objectContaining({ label: "Prep", value: "None", ok: true }),
      expect.objectContaining({ label: "Responses", value: "45s · 30s · 30s", ok: true }),
    ]));

    const ready = multilevelPartSummary("speaking", 1, { ...complete, questionCount: 3 });
    expect(ready?.ready).toBe(true);

    const listening1 = multilevelPartSummary("listening", 0, { ...empty, questionCount: 8 });
    expect(listening1?.ready).toBe(false); // audio still missing
    expect(multilevelPartSummary("listening", 0, { ...complete, questionCount: 8 })?.ready).toBe(true);
  });

  it("never renders the retired speaking preparation for the current revision", () => {
    const speaking = multilevelPartsFor("speaking");
    // Parts 1.1 and 1.2 are answered immediately in the current revision.
    expect(speaking[0].prep).toBe("None");
    expect(speaking[1].prep).toBe("None");
    expect(speaking[1].responses).toBe("45s · 30s · 30s");
    // Only Parts 2 and 3 keep an official preparation, and it is 60 seconds.
    expect(speaking.map((part) => part.prep)).toEqual(["None", "None", "60s", "60s"]);
    // The historical 15/5/5 countdown must not be reachable from this mirror.
    for (const part of speaking) {
      expect(part.prep ?? "").not.toContain("15");
      expect(part.responses ?? "").not.toContain("15");
    }
    for (const part of speaking) {
      const summary = multilevelPartSummary("speaking", speaking.indexOf(part), { ...complete, questionCount: part.count });
      const prep = summary?.rows.find((row) => row.label === "Prep");
      expect(prep?.value ?? "").not.toContain("15");
    }
  });

  it("returns null outside the blueprint", () => {
    expect(multilevelPartSummary("speaking", 9, complete)).toBeNull();
  });
});
