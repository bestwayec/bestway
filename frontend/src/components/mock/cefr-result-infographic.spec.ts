import { describe, expect, it } from "vitest";
import { skillMeter } from "./cefr-result-infographic";

describe("skillMeter", () => {
  it("IELTS uses the backend band on the 0-9 scale", () => {
    expect(skillMeter({ skill: "reading", band: 7, score: 30, max: 40 }, true)).toMatchObject({ kind: "band", value: 7, max: 9 });
  });
  it("Multilevel uses the standard score on the 0-75 scale, never the raw count", () => {
    const meter = skillMeter({ skill: "listening", standardScore: 60, score: 20, max: 35 }, false);
    expect(meter).toMatchObject({ kind: "standard", value: 60, max: 75 });
    expect(meter.percent).toBeCloseTo(80);
  });
  it("falls back to the raw count only when there is no band / standard score", () => {
    expect(skillMeter({ skill: "listening", score: 20, max: 40 }, true)).toMatchObject({ kind: "raw", percent: 50 });
  });
  it("never invents a number for an unscored skill", () => {
    expect(skillMeter({ skill: "writing" }, true)).toEqual({ percent: null, max: 0, value: null, kind: "pending" });
    expect(skillMeter({ skill: "speaking", score: 0, max: 0 }, false).kind).toBe("pending");
  });
});
