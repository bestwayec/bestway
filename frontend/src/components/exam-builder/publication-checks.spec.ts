import { describe, expect, it } from "vitest";
import { canonicalDecision, examClientChecks, keyMatchesOption, publicationChecks } from "./checks";
import type { MockSection } from "@/lib/types";

const q = (id: string, number: number, over: Record<string, unknown> = {}) =>
  ({ id, number, type: "short_answer", prompt: "Where?", options: [], correctAnswers: ["Paris"], points: 1, ...over });
const g = (id: string, questions: unknown[], over: Record<string, unknown> = {}) =>
  ({ id, sortOrder: 0, title: id, hasAudio: true, passageText: "text", instructions: "Write ONE WORD.", contentHtml: null, imageUrl: null, questions, ...over });
const sec = (id: string, skill: string, groups: unknown[]) => ({ id, skill, groups }) as unknown as MockSection;
const labels = (sections: MockSection[], type?: string) => publicationChecks(sections, type).map((c) => `${c.level}:${c.label}`);

describe("publication checks", () => {
  it("matches answer keys like the scorer", () => {
    expect(keyMatchesOption("B", ["cat", "dog"])).toBe(true);
    expect(keyMatchesOption("c", ["cat", "dog"])).toBe(false);
    expect(keyMatchesOption("  Dog ", ["cat", "dog"])).toBe(true);
    expect(canonicalDecision("not given")).toBe("NOT_GIVEN");
    expect(canonicalDecision("No-information")).toBe("NOT_GIVEN");
  });

  it("finds keys the scorer could never match and wrong decision keys", () => {
    const out = labels([sec("r", "reading", [g("P1", [
      q("a", 1, { type: "multiple_choice", options: ["A one", "B two"], correctAnswers: ["E"] }),
      q("b", 2, { type: "true_false_notgiven", correctAnswers: ["yes"] }),
      q("c", 3, { type: "true_false_notgiven", correctAnswers: ["Not Given"] }),
    ])])]);
    expect(out).toContain("error:P1 · Q1: answer key is not one of the options");
    expect(out).toContain("error:P1 · Q2: answer key must be TRUE / FALSE / NOT GIVEN");
    expect(out.some((l) => l.includes("Q3"))).toBe(false);
  });

  it("reports duplicate identifiers, broken gaps and numbering holes", () => {
    const gap = (n: number) => `<span data-gap="${n}"></span>`;
    const html = `<p>Name: ${gap(1)} Date: ${gap(3)} again ${gap(3)}</p>`;
    const out = labels([sec("l", "listening", [
      g("Part 1", [q("x", 1, { type: "note_completion" }), q("y", 2, { type: "note_completion" })], { contentHtml: html }),
      g("Part 2", [q("x", 5)]),
    ])]);
    expect(out).toContain("error:Part 2 · Q5: duplicate question identifier");
    expect(out.some((l) => l.startsWith("error:Part 1: gap placeholder without a question"))).toBe(true);
    expect(out).toContain("warning:Part 1: question without a gap in the text");
    expect(out).toContain("error:Part 1: gap placeholder used twice");
    expect(out).toContain("warning:Listening: question numbers skip 3, 4");
  });

  it("warns on missing instructions and a Task 1 without its visual (IELTS only)", () => {
    const sections = [
      sec("r", "reading", [g("P1", [q("a", 1)], { instructions: "" })]),
      sec("w", "writing", [g("T1", [q("w1", 1, { type: "essay_task1", correctAnswers: [] })])]),
    ];
    expect(labels(sections)).toEqual(expect.arrayContaining(["warning:P1: no instructions", "warning:T1: Task 1 has no chart, map or diagram"]));
    expect(labels(sections, "multilevel")).not.toContain("warning:T1: Task 1 has no chart, map or diagram");
  });

  it("is part of the exam-wide client checks and stays silent on a clean section", () => {
    const clean = [sec("r", "reading", [g("P1", [q("a", 1), q("b", 2)])])];
    expect(publicationChecks(clean)).toEqual([]);
    expect(examClientChecks([sec("r", "reading", [g("P1", [q("a", 1), q("a", 2)])])]).some((c) => c.label.includes("duplicate question identifier"))).toBe(true);
  });
});
