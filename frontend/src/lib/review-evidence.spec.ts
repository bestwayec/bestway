import { describe, expect, it } from "vitest";
import { formatClock, locateEvidence, parseClock, splitAtEvidence } from "./review-evidence";

const PASSAGE = "The bridge was built in 1890.\nIt was repaired\n  in 1920 after a flood.";

describe("locateEvidence (same rule as the server)", () => {
  it("finds exact text and text copied with other spacing, returning it as it stands", () => {
    expect(locateEvidence("built in 1890", PASSAGE)).toEqual({ text: "built in 1890", offset: PASSAGE.indexOf("built") });
    const loose = locateEvidence("repaired in 1920", PASSAGE)!;
    expect(loose.text).toBe("repaired\n  in 1920");
    expect(PASSAGE.slice(loose.offset, loose.offset + loose.text.length)).toBe(loose.text);
  });
  it("finds nothing for words that are not in the text, or with no text", () => {
    expect(locateEvidence("built in 1891", PASSAGE)).toBeNull();
    expect(locateEvidence("  ", PASSAGE)).toBeNull();
    expect(locateEvidence("bridge", "")).toBeNull();
    expect(locateEvidence("a(b", "x a(b y")).toEqual({ text: "a(b", offset: 2 });
  });
});

describe("clock", () => {
  it("reads m:ss and seconds, and refuses anything else", () => {
    expect(parseClock("1:05")).toBe(65);
    expect(parseClock("42")).toBe(42);
    expect(parseClock("")).toBeNull();
    expect(parseClock("1:xx")).toBeNaN();
    expect(formatClock(65.9)).toBe("1:05");
    expect(formatClock(null)).toBe("");
  });
});

describe("splitAtEvidence", () => {
  it("splits only when the evidence still matches the text at its offset", () => {
    expect(splitAtEvidence("abc def ghi", { text: "def", offset: 4 })).toEqual(["abc ", "def", " ghi"]);
    expect(splitAtEvidence("abc def ghi", { text: "def", offset: 3 })).toBeNull();
    expect(splitAtEvidence("abc", null)).toBeNull();
  });
});
