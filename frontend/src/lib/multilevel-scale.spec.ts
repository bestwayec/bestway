import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MULTILEVEL_CEFR_BANDS, multilevelBandFor, multilevelLevelFromScore } from "./multilevel-scale";

// The backend blueprint holds the one level table; this copy must match it exactly.
const blueprint = readFileSync(join(__dirname, "..", "..", "..", "backend-django", "apps", "core", "exam_blueprint.py"), "utf8");
const table = blueprint.slice(blueprint.indexOf("MULTILEVEL_LEVELS = ("), blueprint.indexOf(")\n", blueprint.indexOf("MULTILEVEL_LEVELS = (")));
const backendLevels = [...table.matchAll(/"level": "(\w+)", "min": (\d+), "max": (\d+)/g)].map(([, level, min, max]) => ({ level, min: Number(min), max: Number(max) }));

describe("Multilevel level scale", () => {
  it("is the blueprint's level table (agency criteria)", () => {
    expect(backendLevels).toHaveLength(4);
    const web = MULTILEVEL_CEFR_BANDS.map(({ level, min, max }) => ({ level, min, max }));
    expect(web).toEqual([...backendLevels].reverse());
  });

  it.each([
    [0, "BELOW_B1"], [37, "BELOW_B1"], [37.9, "BELOW_B1"], [38, "B1"], [50, "B1"], [50.9, "B1"],
    [51, "B2"], [64, "B2"], [64.9, "B2"], [65, "C1"], [75, "C1"],
  ])("score %s is %s", (score, level) => {
    expect(multilevelLevelFromScore(score)).toBe(level);
  });

  it("finds the band of a stored level and treats anything else as below B1", () => {
    expect(multilevelBandFor("C1")).toMatchObject({ min: 65, max: 75 });
    expect(multilevelBandFor("b2")).toMatchObject({ min: 51, max: 64 });
    expect(multilevelBandFor("A2").level).toBe("BELOW_B1");
  });
});
