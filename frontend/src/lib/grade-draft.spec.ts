import { describe, expect, it } from "vitest";
import { gradeDraftKey, nextGradeIndex, readGradeDraft, writeGradeDraft } from "./grade-draft";

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
}

describe("teacher grade draft", () => {
  const key = gradeDraftKey("att", "q1");
  it("keeps an unsent score and comment and gives them back", () => {
    const s = memory();
    writeGradeDraft(s, key, { score: "3.5", feedback: "Clear plan" }, { score: "", feedback: "" });
    expect(readGradeDraft(s, key)).toEqual({ score: "3.5", feedback: "Clear plan" });
  });
  it("forgets the draft once it matches the saved grade", () => {
    const s = memory();
    writeGradeDraft(s, key, { score: "4", feedback: "" }, { score: "", feedback: "" });
    writeGradeDraft(s, key, { score: "4", feedback: "" }, { score: "4", feedback: "" });
    expect(readGradeDraft(s, key)).toBeNull();
  });
  it("ignores damaged or foreign values", () => {
    const s = memory();
    s.setItem(key, "{not json"); expect(readGradeDraft(s, key)).toBeNull();
    s.setItem(key, JSON.stringify({ score: 4 })); expect(readGradeDraft(s, key)).toBeNull();
    expect(readGradeDraft(null, key)).toBeNull();
  });
  it("moves between grade fields only with Alt + arrow keys and stops at the ends", () => {
    expect(nextGradeIndex(3, 0, "ArrowDown", true)).toBe(1);
    expect(nextGradeIndex(3, 2, "ArrowDown", true)).toBe(-1);
    expect(nextGradeIndex(3, 1, "ArrowUp", true)).toBe(0);
    expect(nextGradeIndex(3, 0, "ArrowUp", true)).toBe(-1);
    expect(nextGradeIndex(3, 0, "ArrowDown", false)).toBe(-1);
    expect(nextGradeIndex(3, 0, "Tab", true)).toBe(-1);
  });
});
