import { describe, expect, it } from "vitest";
import { parseBulkQuestions } from "./bulk-question-parser";

describe("bulk-question-parser", () => {
  it("parses standard user sample with trailing asterisks for correct answer", () => {
    const raw = `
1. Choose the correct plural form of 'child':
A) childs
B) children*
C) childrens
D) childes

2. She is interested ___ modern art.
A) at
B) on
C) in*
D) with
`;

    const res = parseBulkQuestions(raw);
    expect(res.totalParsed).toBe(2);
    expect(res.questions.length).toBe(2);

    const q1 = res.questions[0];
    expect(q1.number).toBe(1);
    expect(q1.prompt).toBe("Choose the correct plural form of 'child':");
    expect(q1.options).toEqual(["childs", "children", "childrens", "childes"]);
    expect(q1.correctAnswer).toBe("B");
    expect(q1.hasExplicitMarker).toBe(true);

    const q2 = res.questions[1];
    expect(q2.number).toBe(2);
    expect(q2.prompt).toBe("She is interested ___ modern art.");
    expect(q2.options).toEqual(["at", "on", "in", "with"]);
    expect(q2.correctAnswer).toBe("C");
    expect(q2.hasExplicitMarker).toBe(true);
  });

  it("handles [x] bracket markers and leading asterisks", () => {
    const raw = `
1. What is the capital of France?
A) Berlin
B) Madrid
C) Paris [x]
D) Rome

2. Which word is a noun?
*A) Knowledge
B) Quickly
C) Beautiful
D) Under
`;

    const res = parseBulkQuestions(raw);
    expect(res.totalParsed).toBe(2);

    expect(res.questions[0].correctAnswer).toBe("C");
    expect(res.questions[0].options[2]).toBe("Paris");

    expect(res.questions[1].correctAnswer).toBe("A");
    expect(res.questions[1].options[0]).toBe("Knowledge");
  });

  it("handles empty or whitespace inputs gracefully", () => {
    const res = parseBulkQuestions("   \n\n  ");
    expect(res.totalParsed).toBe(0);
    expect(res.questions).toEqual([]);
  });

  it("defaults to option A and provides warning when no answer is marked", () => {
    const raw = `
1. What color is the sky?
A) Blue
B) Green
C) Yellow
D) Purple
`;

    const res = parseBulkQuestions(raw);
    expect(res.totalParsed).toBe(1);
    expect(res.questions[0].correctAnswer).toBe("A");
    expect(res.questions[0].hasExplicitMarker).toBe(false);
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});
