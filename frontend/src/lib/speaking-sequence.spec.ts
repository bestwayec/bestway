import { describe, expect, it } from "vitest";
import { canSelectSpeakingPart, nextSpeakingTarget, takeSpeakingAutoStart, requestSpeakingAutoStart } from "./speaking-sequence";

const groups = [{ questions: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] }, { questions: [{ id: "b1" }] }, { questions: [] }, { questions: [{ id: "c1" }] }];

describe("timed Multilevel Speaking sequence", () => {
  it("opens the next question in the same part, then the first question of the next part", () => {
    expect(nextSpeakingTarget(groups, "a1")).toEqual({ groupIndex: 0, questionId: "a2" });
    expect(nextSpeakingTarget(groups, "a3")).toEqual({ groupIndex: 1, questionId: "b1" });
    expect(nextSpeakingTarget(groups, "b1")).toEqual({ groupIndex: 3, questionId: "c1" });
  });
  it("stops after the last question and ignores unknown ids", () => {
    expect(nextSpeakingTarget(groups, "c1")).toBeNull();
    expect(nextSpeakingTarget(groups, "zz")).toBeNull();
  });
  it("keeps earlier parts closed only in the timed exam", () => {
    expect(canSelectSpeakingPart(true, 2, 1)).toBe(false);
    expect(canSelectSpeakingPart(true, 2, 2)).toBe(true);
    expect(canSelectSpeakingPart(true, 2, 3)).toBe(true);
    expect(canSelectSpeakingPart(false, 2, 0)).toBe(true);
  });
  it("hands an auto-start request to exactly one recorder, once", () => {
    requestSpeakingAutoStart("att", "b1");
    expect(takeSpeakingAutoStart("att", "a2")).toBe(false);
    expect(takeSpeakingAutoStart("att", "b1")).toBe(true);
    expect(takeSpeakingAutoStart("att", "b1")).toBe(false);
  });
});
