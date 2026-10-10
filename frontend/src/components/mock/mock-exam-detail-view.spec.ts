// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockExamDetail } from "@/lib/types";

const fixture = vi.hoisted(() => ({ exam: {} as MockExamDetail, role: "student", start: vi.fn(), push: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/use-me", () => ({ useMe: () => ({ data: { user: { role: fixture.role } } }) }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: fixture.push }),
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => React.createElement("a", { href, ...props }, children),
}));
vi.mock("@/hooks/use-mock", () => ({
  useMockExam: () => ({ data: fixture.exam }),
  useMyMockAttempts: () => ({ data: [] }),
  useStartMock: () => ({ mutate: fixture.start, isPending: false }),
  usePurchaseMock: () => ({ mutate: vi.fn(), isPending: false }),
}));
import { MockExamDetailView } from "./mock-exam-detail-view";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.role = "student";
  fixture.start.mockClear();
  fixture.exam = {
    id: "partial", type: "multilevel", title: "cefr c1", ready: false, practiceReady: true,
    practiceSkills: ["writing", "speaking"], practiceQuestionCount: 6,
    isDemo: true, access: "granted", price: 0, sections: [], questionCount: 7,
  } as unknown as MockExamDetail;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

describe("practice start on an incomplete Multilevel definition", () => {
  it("starts only explicitly selected authored skills while keeping the full start disabled", async () => {
    await React.act(async () => root.render(React.createElement(MockExamDetailView, { examId: "partial" })));
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.find((button) => button.textContent?.includes("Start Exam"))?.disabled).toBe(true);
    const choices = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(choices).toHaveLength(2);
    await React.act(async () => choices[1].click());
    const start = buttons.find((button) => button.textContent?.includes("startSelectedPractice"))!;
    await React.act(async () => start.click());
    expect(fixture.start).toHaveBeenCalledWith({ examId: "partial", mode: "practice", skills: ["writing"] }, expect.any(Object));
    await React.act(async () => choices[0].click());
    expect(start.disabled).toBe(true);
  });

  it.each(["locked", "pending"])("does not offer selected practice without granted access (%s)", async (access) => {
    fixture.exam.access = access as MockExamDetail["access"];
    await React.act(async () => root.render(React.createElement(MockExamDetailView, { examId: "partial" })));
    expect(container.textContent).not.toContain("startSelectedPractice");
  });

  it("directs staff to authoring instead of offering a student-only start", async () => {
    fixture.role = "super_admin";
    await React.act(async () => root.render(React.createElement(MockExamDetailView, { examId: "partial" })));
    expect(container.textContent).not.toContain("startSelectedPractice");
    expect(container.querySelector('a[href="/exam-builder/partial"]')).not.toBeNull();
  });
});
