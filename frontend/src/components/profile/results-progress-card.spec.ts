// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockAttemptSummary } from "@/lib/types";

vi.mock("next-intl", async () => {
  const en = (await import("../../../messages/en.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), en);
  return {
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
      const found = lookup(`${ns}.${key}`);
      return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")) : key;
    },
  };
});

import { ResultsProgressCard } from "./results-progress-card";

let host: HTMLDivElement;
let root: Root;
let n = 0;
const attempt = (over: Partial<MockAttemptSummary>): MockAttemptSummary =>
  ({ id: `a${++n}`, examId: "e1", examTitle: "Mock A", examType: "ielts_academic", status: "completed", flowMode: "partial_practice",
     submittedAt: "2026-11-01T10:00:00Z", startedAt: "2026-11-01T09:00:00Z", rawScores: null, overallBand: null, overallScore: null, cefrLevel: null, ...over }) as MockAttemptSummary;
const render = (attempts: MockAttemptSummary[]) => act(async () => root.render(React.createElement(ResultsProgressCard, { attempts, loading: false })));
const text = () => host.textContent ?? "";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("ResultsProgressCard", () => {
  it("draws nothing without submitted attempts", async () => {
    await render([attempt({ status: "completed", submittedAt: null, rawScores: { reading: { score: 3, max: 4 } } })]);
    expect(text()).toContain("Submit an exam or a practice set");
    expect(host.querySelector("svg polyline")).toBeNull();
    expect(host.querySelectorAll('button[aria-label]')).toHaveLength(0);
  });

  it("waits for checking instead of drawing a point", async () => {
    await render([attempt({ status: "grading" })]);
    expect(text()).toContain("once checking is finished");
  });

  it("practice shows raw correct answers and never a band", async () => {
    await render([attempt({ rawScores: { reading: { score: 5, max: 6 } }, overallBand: 9 })]);
    expect(text()).toContain("Section practice · correct answers");
    expect(text()).toContain("5/6 correct · 83%");
    expect(text()).not.toContain("Band");
    expect(text()).not.toContain("IELTS overall band");
  });

  it("full mocks get their own band chart; one point has no line", async () => {
    await render([attempt({ flowMode: "full_test", overallBand: 6.5, cefrLevel: "B2" })]);
    expect(text()).toContain("IELTS overall band");
    expect(text()).toContain("Band 6.5 · B2");
    expect(host.querySelector("svg polyline")).toBeNull();
    await render([
      attempt({ flowMode: "full_test", overallBand: 6.5 }),
      attempt({ flowMode: "full_test", overallBand: 7, submittedAt: "2026-11-05T10:00:00Z" }),
    ]);
    expect(host.querySelector("svg polyline")).not.toBeNull();
  });

  it("shows a tooltip for a focused mark", async () => {
    await render([attempt({ rawScores: { listening: { score: 8, max: 10 } } })]);
    const mark = host.querySelector<HTMLButtonElement>("button[aria-label]")!;
    expect(mark.getAttribute("aria-label")).toContain("8/10 correct · 80%");
    await act(async () => mark.focus());
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("8/10 correct · 80%");
  });
});
