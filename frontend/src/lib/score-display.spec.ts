import { describe, expect, it } from "vitest";
import { mayShowSectionBand } from "./score-display";

describe("band display rule", () => {
  it("hides bands for short objective sets", () => {
    expect(mayShowSectionBand("ielts_academic", "reading", 1)).toBe(false);
    expect(mayShowSectionBand("multilevel", "listening", 6)).toBe(false);
  });
  it("allows bands for official full sections", () => {
    expect(mayShowSectionBand("ielts_general", "listening", 40)).toBe(true);
    expect(mayShowSectionBand("multilevel", "reading", 35)).toBe(true);
  });
  it("leaves expert-graded skills to their own rules", () => {
    expect(mayShowSectionBand("ielts_academic", "writing", 2)).toBe(true);
  });
});
