import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import type { MockAttemptDetail } from "@/lib/types";

vi.mock("next-intl", () => ({ useTranslations: (namespace: string) => (key: string) => {
  const source = namespace === "mock" ? en.mock : en.common;
  return key.split(".").reduce<unknown>((value, field) => value && typeof value === "object" ? (value as Record<string, unknown>)[field] : undefined, source) ?? key;
} }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children) }));
vi.mock("@/hooks/use-me", () => ({ useMe: () => ({ data: { user: { role: "teacher" } } }) }));
vi.mock("@/hooks/use-mock", () => {
  const useMutation = () => ({ isPending: false, mutate: vi.fn() });
  return Object.fromEntries(["useGradeMock", "useDeleteMockAttempt", "useExtendMockDeadline", "useForceSubmitMock", "useReopenMock"].map((name) => [name, useMutation]));
});
vi.mock("./assessment-panel", () => ({ AssessmentPanel: () => null }));
import { MockResultView, MultilevelResultBreakdown } from "./mock-result-view";

const attempt = (partial = true) => ({
  id: "attempt-1", examTitle: "Selected work", examType: "multilevel", status: "completed",
  flowMode: partial ? "partial_practice" : "single_skill", specificationVersion: "UZBMB_MULTILEVEL_EN_2026_V2",
  overallScore: null, cefrLevel: null, scoreMethod: "PRACTICE_PARTIAL",
  sections: [{ id: "speaking", skill: "speaking", score: 4, max: 5, standardScore: null, band: null, groups: [{ id: "part-1", title: "Personal questions", questions: [3, 4, 5].map((score, index) => ({
    id: `q-${index}`, number: index + 1, type: "speaking_task", prompt: "Describe your day", points: 9,
    guidance: { taskKey: "1.1", displayLabel: "Part 1.1", rawMax: 5 }, isGraded: true, score,
    response: "", feedback: null, rubricScores: null, audioUrl: null, hasAudio: false,
  })) }] }],
} as MockAttemptDetail);

describe("partial teacher result presentation", () => {
  it("shows observed raw results without a fabricated overall, CEFR or certificate link", () => {
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: attempt() }));
    expect(html).toContain("Selected task practice result");
    expect(html).toContain("no overall Multilevel score");
    expect(html).toContain("4/5");
    expect(html).not.toContain(" /75");
    expect(html).not.toContain("/certificate");
    expect(html).toContain('max="5"');
    expect(html).not.toContain('max="9"');
  });
  it("shows one mean Speaking part score rather than the first response or summed responses", () => {
    const html = renderToStaticMarkup(React.createElement(MultilevelResultBreakdown, { attempt: attempt() }));
    expect(html).toContain("4 / 5");
    expect(html).not.toContain("3 / 5");
    expect(html).not.toContain("12 / 5");
    expect(html).not.toContain("Standardized");
  });
  it("preserves the full-result certificate flow", () => {
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: attempt(false) }));
    expect(html).toContain("/mock/attempts/attempt-1/certificate");
    expect(html).toContain("Estimated Multilevel Result");
  });
});
