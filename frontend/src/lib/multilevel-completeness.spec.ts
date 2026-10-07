import { describe, expect, it } from "vitest";
import {
  multilevelMissingWork,
  multilevelMissingWorkMessage,
  type CompletenessSection,
} from "./multilevel-completeness";

/**
 * Mirror of `backend/src/mock/multilevel-completeness.spec.ts` over the same
 * fixture table. If one side changes the rule, this table fails on the other.
 */
const sections: CompletenessSection[] = [
  { skill: "listening", groups: [{ questions: [{ id: "l1", type: "multiple_choice" }, { id: "l2", type: "multiple_choice" }] }] },
  { skill: "reading", groups: [{ questions: [{ id: "r1", type: "true_false_notgiven" }, { id: "r2", type: "summary_completion" }] }] },
  { skill: "writing", groups: [{ questions: [{ id: "w1", type: "essay_task1" }] }] },
  { skill: "speaking", groups: [{ questions: [{ id: "s1", type: "speaking_task" }] }] },
];

const completeAnswers: Record<string, string> = { l1: "library", l2: "library", r1: "TRUE", r2: "library", w1: "Dear friend," };
const completeRecorded = new Set(["s1"]);
const NOW = new Date("2026-10-07T10:00:00Z");

function work(
  answers: Record<string, string> = completeAnswers,
  recorded: ReadonlySet<string> = completeRecorded,
  state: Parameters<typeof multilevelMissingWork>[3] = {},
) {
  return multilevelMissingWork(sections, answers, recorded, state, NOW);
}

describe("Multilevel pre-submit completeness (browser mirror)", () => {
  it("accepts an exam with every required section answered", () => {
    const result = work();
    expect(result).toMatchObject({ complete: true, missing: 0, total: 6, timeExpired: false, timed: false });
    expect(result.requiredSections).toEqual(["listening", "reading", "writing", "speaking"]);
    expect(multilevelMissingWorkMessage(result)).toBe("Every required section is complete.");
  });

  it("reports a blank objective answer as unfinished work in that section", () => {
    const result = work({ ...completeAnswers, r2: "   " });
    expect(result.complete).toBe(false);
    expect(result.unfinished.map((section) => section.skill)).toEqual(["reading"]);
    expect(result.missing).toBe(1);
    expect(multilevelMissingWorkMessage(result)).toContain("Reading 1 of 2 unanswered");
  });

  it("counts a speaking prompt as answered only when a recording exists", () => {
    const result = work(completeAnswers, new Set());
    expect(result.unfinished.map((section) => section.skill)).toEqual(["speaking"]);
    expect(result.sections.find((section) => section.skill === "speaking")).toMatchObject({ spoken: true, recordings: 0, missing: 1 });
    expect(multilevelMissingWorkMessage(result)).toContain("Speaking 1 of 1 not recorded");
  });

  it("ignores a section whose own clock has run out and keeps a running one required", () => {
    const blank = { ...completeAnswers, r1: "", r2: "" };
    const expired = work(blank, completeRecorded, { sectionDeadlines: { reading: "2026-10-07T09:59:00Z" } });
    expect(expired.complete).toBe(true);
    expect(expired.expiredSections).toEqual(["reading"]);
    expect(expired.requiredSections).toEqual(["listening", "writing", "speaking"]);

    const running = work(blank, completeRecorded, { sectionDeadlines: { reading: "2026-10-07T10:30:00Z" } });
    expect(running.complete).toBe(false);
    expect(running.requiredSections).toContain("reading");
  });

  it("accepts a partial exam once the whole attempt has run out of time", () => {
    const result = work({ l1: "library" }, new Set(), { overallDeadlineAt: "2026-10-07T09:59:00Z" });
    expect(result).toMatchObject({ complete: true, timeExpired: true, timed: true, missing: 0, total: 0 });
  });

  it("requires only the live section of a full-test attempt", () => {
    const live = work({ w1: "Dear friend," }, new Set(), { flowMode: "full_test", currentSkill: "writing" });
    expect(live.complete).toBe(true);
    expect(live.requiredSections).toEqual(["writing"]);

    const unfinished = work({}, new Set(), { flowMode: "full_test", currentSkill: "writing" });
    expect(unfinished.complete).toBe(false);
    expect(unfinished.unfinished.map((section) => section.skill)).toEqual(["writing"]);
    expect(multilevelMissingWorkMessage(unfinished)).toContain("Writing 1 of 1 unanswered");
  });

  it("falls back to the section deadline as the attempt clock and tolerates junk", () => {
    expect(work({ l1: "library" }, new Set(), { deadlineAt: "2026-10-07T09:00:00Z" })).toMatchObject({ timeExpired: true, complete: true });
    for (const value of [null, undefined, "nonsense", 42, [], { reading: 7 }, { reading: "not-a-date" }]) {
      expect(work(completeAnswers, completeRecorded, { sectionDeadlines: value as never })).toMatchObject({ complete: true, timed: false });
    }
  });
});
