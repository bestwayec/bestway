import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import uz from "../../../messages/uz.json";

const locale = vi.hoisted(() => ({ current: "en" as "en" | "uz" }));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    const messages = (locale.current === "en" ? en : uz) as unknown as Record<string, any>;
    const template: string = namespace.split(".").reduce((node, part) => node?.[part], messages)?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ""));
  },
}));
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

describe("CbtSectionStepper copy", () => {
  it("never calls a Multi-Level (CEFR) palette 'DTM', in either locale or layout mode", () => {
    for (const language of ["uz", "en"] as const) {
      locale.current = language;
      const html = renderToStaticMarkup(
        React.createElement(CbtSectionStepper, { skill: "listening", groups, answers: {}, audioSet: new Set<string>(), simulatorMode: "dtm", renderGroupBlock: () => null }),
      );
      expect(html).not.toMatch(/DTM/i);
      expect(html).toContain(language === "uz" ? "Savollar palitrasi" : "Question palette");
    }
    locale.current = "en";
  });

  it("has no English leftovers on the Uzbek exam screen", () => {
    locale.current = "uz";
    const html = renderToStaticMarkup(
      React.createElement(CbtSectionStepper, { skill: "listening", groups, answers: { "q-9": "x" }, audioSet: new Set<string>(), simulatorMode: "dtm", renderGroupBlock: () => null }),
    );
    for (const english of ["Next Part", "Previous Part", "Flag Question", "Question palette", "Review", "Answered"]) expect(html).not.toContain(english);
    expect(html).toContain("Keyingi qism");
    expect(html).toContain("9-savol");
    locale.current = "en";
  });
});
