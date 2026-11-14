import { describe, expect, it } from "vitest";
import { splitBlueprintIssues } from "./readiness-issues";

describe("Multilevel blueprint issues in the review panel", () => {
  it("gives every issue its own row linked to the part it names", () => {
    const rows = splitBlueprintIssues("listening 1: requires 8 responses/questions; listening 1: positive audio duration required; writing formal_email: points must be 5; speaking 1.2: two-picture asset required; reading 4 question 3: invalid type");
    expect(rows).toEqual([
      { skill: "listening", partIndex: 0, part: "Part 1", message: "requires 8 responses/questions" },
      { skill: "listening", partIndex: 0, part: "Part 1", message: "positive audio duration required" },
      { skill: "writing", partIndex: 1, part: "Task 1.2", message: "points must be 5" },
      { skill: "speaking", partIndex: 1, part: "Part 1.2", message: "two-picture asset required" },
      { skill: "reading", partIndex: 3, part: "Part 4", message: "question 3: invalid type" },
    ]);
  });
  it("keeps section-wide and exam-wide issues, drops repeats and blanks", () => {
    expect(splitBlueprintIssues("writing: requires 3 parts; Full Multilevel mock requires all four sections; writing: requires 3 parts; ;")).toEqual([
      { skill: "writing", partIndex: null, part: null, message: "requires 3 parts" },
      { skill: null, partIndex: null, part: null, message: "Full Multilevel mock requires all four sections" },
    ]);
    expect(splitBlueprintIssues(undefined)).toEqual([]);
  });
});
