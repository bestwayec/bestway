import { describe, expect, it } from "vitest";
import { examContentUnits } from "./exam-content-units";

describe("canonical exam content units", () => {
  it("finds an explicit source after a continuation and keeps identical passages distinct", () => {
    const gaps = { id: "gaps", stimulusRef: "first" };
    const other = { id: "other", stimulusRef: "second", passageText: "Same text" };
    const source = { id: "source", stimulusRef: "first", passageText: "Same text" };
    const units = examContentUnits([gaps, other, source], "reading");
    expect(units.map((unit) => [unit.source.id, unit.groups.map((g) => g.id)]))
      .toEqual([["source", ["gaps", "source"]], ["other", ["other"]]]);
  });

  it("clusters only consecutive non-empty legacy text and leaves unresolved groups separate", () => {
    const groups = ["Source one", " Source  one ", "", "Source one"].map((passageText) => ({ passageText }));
    expect(examContentUnits(groups, "reading").map((unit) => unit.groups.length)).toEqual([2, 1, 1]);
  });

  it("keeps numbered legacy passages distinct even if their text is identical", () => {
    const groups = ["Passage 1", "Questions 5–8", "Passage 2", "Passage 3"]
      .map((title) => ({ title, passageText: "Same text" }));
    expect(examContentUnits(groups, "reading").map((unit) => unit.groups.length)).toEqual([2, 1, 1]);
  });

  it("keeps IELTS task order while selecting the audio owner and preserves legacy Multilevel groups", () => {
    const groups = [{ id: "second", partNumber: 2 }, { id: "task", partNumber: 1 },
      { id: "audio", partNumber: 1, hasAudio: true }];
    const units = examContentUnits(groups, "listening");
    expect(units.map((unit) => unit.source.id)).toEqual(["audio", "second"]);
    expect(units[0].groups.map((group) => group.id)).toEqual(["task", "audio"]);
    expect(examContentUnits(groups, "listening", false)).toHaveLength(3);
  });
});
