import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BuilderQuestion } from "./types";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { buildSwitchedQuestion, QuestionFieldSet } from "./QuestionEditor";

function question(overrides: Partial<BuilderQuestion> = {}): BuilderQuestion {
  return {
    clientId: "q1", savedQuestionId: "saved-q1", number: 7, type: "short_answer",
    prompt: "Complete the answer.", options: [], correctAnswers: ["colour"],
    acceptedVariants: ["color"], points: 1, wordLimit: 2, answerRule: "ONE_WORD",
    ...overrides,
  };
}

describe("question type changes", () => {
  it("preserves an authored text rule, keys and identity when changing completion type", () => {
    const original = question();
    const changed = buildSwitchedQuestion(original, "note_completion");
    expect(changed).toEqual({ ...original, type: "note_completion" });
    expect(original.type).toBe("short_answer");
  });

  it("clears text metadata when changing to choices without losing the prompt or saved identity", () => {
    const changed = buildSwitchedQuestion(question(), "multiple_choice");
    expect(changed).toMatchObject({ clientId: "q1", savedQuestionId: "saved-q1", number: 7,
      prompt: "Complete the answer.", type: "multiple_choice", options: [],
      correctAnswers: [], acceptedVariants: [], answerRule: null });
    expect(changed.wordLimit).toBeUndefined();
  });

  it("resolves a legacy letter key against the unchanged bank when switching choice to matching", () => {
    const original = question({ type: "multiple_choice", options: ["A. River", "B. Station"],
      correctAnswers: ["B"], acceptedVariants: [], wordLimit: undefined, answerRule: null });
    const changed = buildSwitchedQuestion(original, "matching");
    expect(changed.options).toEqual(original.options);
    expect(changed.correctAnswers).toEqual(["B. Station"]);
    expect(original.correctAnswers).toEqual(["B"]);
  });

  it("keeps all distinct selected keys for multi-select and reduces them to one for single choice", () => {
    const original = question({ type: "matching", options: ["North, east", "South", "West"],
      correctAnswers: ["A", "South", "A"], answerRule: null, wordLimit: undefined });
    const multiple = buildSwitchedQuestion(original, "multi_select");
    expect(multiple.options).toEqual(original.options);
    expect(multiple.correctAnswers).toEqual(["North, east", "South"]);
    expect(buildSwitchedQuestion(multiple, "multiple_choice").correctAnswers).toEqual(["North, east"]);
  });

  it("keeps legacy text questions without an explicit rule unchanged", () => {
    const original = question({ answerRule: null });
    expect(buildSwitchedQuestion(original, "sentence_completion").answerRule).toBeNull();
  });
});

describe("question answer-rule control", () => {
  function render(q: BuilderQuestion): string {
    return renderToStaticMarkup(React.createElement(QuestionFieldSet, {
      question: q, skill: "reading", allowedTypes: [q.type], onChange: () => {},
    }));
  }

  it("offers both explicit rules on text questions with the saved rule selected", () => {
    const html = render(question({ answerRule: "ONE_WORD_AND_OR_NUMBER" }));
    expect(html).toContain('for="qe-q1-answerrule"');
    expect(html).toContain('<option value="ONE_WORD_AND_OR_NUMBER" selected="">');
    expect(html).toContain('<option value="word_limit">');
    expect(html).toContain('<option value="ONE_WORD">');
    expect(html).not.toContain('id="qe-q1-wordlimit-mode"');
  });

  it("keeps word-limit mode selected for legacy text and omits the rule selector for choices", () => {
    const legacy = render(question({ answerRule: null, wordLimit: 4 }));
    expect(legacy).toContain('<option value="word_limit" selected="">');
    expect(legacy).toContain('id="qe-q1-wordlimit-mode"');
    expect(legacy).toContain('value="4"');
    expect(render(question({ type: "multiple_choice", options: ["A", "B"], correctAnswers: ["A"] })))
      .not.toContain('id="qe-q1-answerrule"');
  });
});
