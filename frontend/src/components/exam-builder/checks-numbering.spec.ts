import { describe, expect, it } from "vitest";
import { duplicateNumberErrors, examClientChecks } from "./checks";
import type { MockSection } from "@/lib/types";

const q = (id: string, number: number) => ({ id, number, sortOrder: number, type: "multiple_choice", prompt: `Q${number}`, options: ["a", "b"], correctAnswers: ["a"], points: 1 });
const section = (skill: string, id: string, numbers: number[][]) =>
  ({ id, skill, title: skill, sortOrder: 0, durationMinutes: 60, groups: numbers.map((nums, gi) => ({ id: `${id}-g${gi}`, sortOrder: gi, title: `Part ${gi + 1}`, questions: nums.map((n) => q(`${id}-${n}`, n)) })) }) as unknown as MockSection;

describe("IELTS numbering restarts in every section (owner decision)", () => {
  it("allows Reading 1–2 next to Listening 1–2, refuses a repeat inside one section", () => {
    const ok = examClientChecks([section("listening", "L", [[1, 2]]), section("reading", "R", [[1, 2]])], "practice", "ielts_academic");
    expect(ok.filter((c) => /Duplicate question number/.test(c.label))).toEqual([]);
    const bad = examClientChecks([section("listening", "L", [[1, 2], [2, 3]])], "practice", "ielts_academic");
    expect(bad.filter((c) => /Duplicate question number 2/.test(c.label)).length).toBe(1);
  });
  it("checks an edited block only against its own section", () => {
    const sections = [section("listening", "L", [[1, 2]]), section("reading", "R", [[1, 2], [3]])];
    expect(duplicateNumberErrors(sections, "R-g1", [3, 4])).toEqual([]);
    expect(duplicateNumberErrors(sections, "R-g1", [2])).toHaveLength(1);
  });
});
