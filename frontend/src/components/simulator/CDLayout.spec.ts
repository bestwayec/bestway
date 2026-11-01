// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { normalizeExamPayload } from "@/lib/normalize-exam";
import { flattenGroups } from "./CDLayout";
import { StrictErrorBoundary } from "@/components/common/StrictErrorBoundary";

describe("CDLayout Data Pipeline & Normalization", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    React.act(() => root.unmount());
    container.remove();
  });

  it("normalizes a full active CD exam payload with 81 questions into 4 sections", () => {
    const rawPayload = {
      success: true,
      data: {
        exam: {
          id: "mock-1",
          code: "MOCK-RECORD-01",
          title: "Multi-Level (CEFR) Mock Test 1",
          durationMinutes: 150,
          sections: [
            {
              id: "sec-l",
              skill: "listening",
              title: "Listening",
              timeLimit: 45,
              parts: [
                {
                  id: "p1",
                  title: "Part 1",
                  partNumber: 1,
                  questions: Array.from({ length: 8 }, (_, i) => ({
                    id: `ql-${i + 1}`,
                    prompt: `Sentence ${i + 1}`,
                    options: ["A", "B", "C"],
                  })),
                },
                {
                  id: "p2",
                  title: "Part 2",
                  partNumber: 2,
                  questions: Array.from({ length: 27 }, (_, i) => ({
                    id: `ql-${i + 9}`,
                    prompt: `Note ${i + 9}`,
                  })),
                },
              ],
            },
            {
              id: "sec-r",
              skill: "reading",
              title: "Reading",
              timeLimit: 60,
              parts: [
                {
                  id: "r1",
                  title: "Part 1",
                  partNumber: 1,
                  questions: Array.from({ length: 35 }, (_, i) => ({
                    id: `qr-${i + 1}`,
                    prompt: `Reading Q${i + 1}`,
                  })),
                },
              ],
            },
            {
              id: "sec-w",
              skill: "writing",
              title: "Writing",
              timeLimit: 45,
              parts: [
                {
                  id: "w1",
                  title: "Part 1",
                  partNumber: 1,
                  questions: [
                    { id: "qw-1", prompt: "Task 1.1" },
                    { id: "qw-2", prompt: "Task 1.2" },
                    { id: "qw-3", prompt: "Task 2" },
                  ],
                },
              ],
            },
            {
              id: "sec-s",
              skill: "speaking",
              title: "Speaking",
              timeLimit: 15,
              parts: [
                {
                  id: "s1",
                  title: "Part 1",
                  partNumber: 1,
                  questions: Array.from({ length: 8 }, (_, i) => ({
                    id: `qs-${i + 1}`,
                    prompt: `Speaking Q${i + 1}`,
                  })),
                },
              ],
            },
          ],
        },
      },
    };

    const normalized = normalizeExamPayload(rawPayload);
    expect(normalized).not.toBeNull();
    expect(normalized?.questionCount).toBe(81);
    expect(normalized?.totalQuestions).toBe(81);
    expect(normalized?.sections.length).toBe(4);
    expect(normalized?.durationMinutes).toBe(150);

    const parts = flattenGroups(normalized);
    expect(parts.length).toBe(5);
    const totalFlattenedQuestions = parts.reduce((sum, p) => sum + p.group.questions.length, 0);
    expect(totalFlattenedQuestions).toBe(81);
  });

  it("handles alternative payload shapes like flat questions or root sections defensively", () => {
    const flatPayload = {
      questions: [
        { id: "q1", text: "Flat Question 1", type: "single_choice" },
        { id: "q2", prompt: "Flat Question 2", type: "single_choice" },
      ],
    };
    const normalized = normalizeExamPayload(flatPayload);
    expect(normalized?.questionCount).toBe(2);
    expect(normalized?.sections[0].groups[0].questions.length).toBe(2);
    expect(normalized?.durationMinutes).toBe(150);
  });

  it("returns null or empty question warning for invalid or empty payloads", () => {
    const emptyPayload = { success: true, data: { exam: { id: "empty" }, sections: [] } };
    const normalized = normalizeExamPayload(emptyPayload);
    expect(normalized?.questionCount).toBe(0);
  });

  it("StrictErrorBoundary catches component exceptions and renders diagnostic trace in white box", async () => {
    const boundary = new StrictErrorBoundary({ fallbackTitle: "Test Render Crash" });
    const mockError = new Error("Simulated React render crash: cannot read properties of undefined (reading 'map')");
    mockError.stack = "Error: Simulated React render crash\n    at Component.render";

    const derivedState = StrictErrorBoundary.getDerivedStateFromError(mockError);
    expect(derivedState.hasError).toBe(true);
    expect(derivedState.error).toBe(mockError);

    boundary.state = {
      hasError: true,
      error: mockError,
      errorInfo: { componentStack: "\n    in BombComponent\n    in StrictErrorBoundary" },
    };

    const rendered = boundary.render() as React.ReactElement;
    await React.act(async () => {
      root.render(rendered);
    });

    expect(container.textContent).toContain("Test Render Crash");
    expect(container.textContent).toContain("Simulated React render crash");
    expect(container.innerHTML).toContain("bg-white");
    expect(container.textContent).toContain("Sahifani qayta yuklash (Reload)");
  });
});
