import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CbtSectionStepper } from "./cbt-section-stepper";
import type { MockSection } from "@/lib/types";

const question = (n: number) => ({
  id: `q-${n}`, number: n, type: "note_completion", prompt: `Gap ${n}`, options: null, points: 1,
});

// A section whose first authored part is absent: numbering starts at 9.
const groups = [
  { id: "g2", title: "Part 2 — School Trip", partNumber: 2, questions: [9, 10, 11].map(question) },
  { id: "g4", title: "Part 4 — Map", partNumber: 4, questions: [19, 20].map(question) },
] as unknown as MockSection["groups"];

function render(answers: Record<string, string> = {}) {
  return renderToStaticMarkup(
    React.createElement(CbtSectionStepper, {
      skill: "listening",
      groups,
      answers,
      audioSet: new Set<string>(),
      renderGroupBlock: () => null,
    }),
  );
}

describe("CbtSectionStepper palette", () => {
  it("labels palette buttons with the authored question numbers", () => {
    const html = render();
    expect(html).toContain('aria-label="Question 9, Part 2 — School Trip, not answered"');
    expect(html).toContain('aria-label="Question 20, Part 4 — Map, not answered"');
    expect(html).not.toContain('aria-label="Question 1,');
    expect(html).toMatch(/>20<!-- -->|>20</);
  });

  it("marks the answered question by id, not by position", () => {
    const html = render({ "q-20": "C" });
    expect(html).toContain('aria-label="Question 20, Part 4 — Map, answered"');
    expect(html).toContain('aria-label="Question 9, Part 2 — School Trip, not answered"');
  });

  it("uses short part labels on phones and exposes tabs to assistive tech", () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain(">Part 4<");
  });
});
