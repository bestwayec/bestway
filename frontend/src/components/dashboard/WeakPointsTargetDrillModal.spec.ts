// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const uz = (await import("../../../messages/uz.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), uz);
  return { useTranslations: (ns: string) => (key: string) => { const found = lookup(`${ns}.${key}`); return typeof found === "string" ? found : key; } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiClient: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) } }));

import { WeakPointsTargetDrillModal } from "./WeakPointsTargetDrillModal";

const QUESTIONS = [
  { id: "q1", questionNumber: 1, prompt: "First prompt", options: ["A) alpha", "B) beta"] },
  { id: "q2", questionNumber: 2, prompt: "Second prompt", options: ["A) gamma", "B) delta"] },
];

describe("WeakPointsTargetDrillModal", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onCompleted = vi.fn();
  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    apiGet.mockReset(); apiPost.mockReset(); onCompleted.mockReset();
    apiGet.mockResolvedValue({ practiceId: "p-1", categoryId: "headings", categoryTitle: "Headings", questionCount: 2, questions: QUESTIONS });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(React.createElement(WeakPointsTargetDrillModal, { isOpen: true, onClose: () => {}, moduleTitle: "Headings", categoryId: "headings", onCompleted })));
    await act(async () => { await Promise.resolve(); });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const text = () => document.body.textContent ?? "";
  const button = (label: string) => [...document.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label)) as HTMLButtonElement;
  const click = async (label: string) => { await act(async () => { button(label).click(); await Promise.resolve(); await Promise.resolve(); }); };

  async function answer(option: string, check: { isCorrect: boolean; correctAnswer: string; explanation: string }) {
    apiPost.mockResolvedValueOnce(check);
    await click(option);
    await click("Tekshirish");
  }

  it("shows a question without any key and asks the server to check the answer", async () => {
    expect(text()).toContain("First prompt");
    expect(text()).not.toContain("Server explanation");
    await answer("B) beta", { isCorrect: false, correctAnswer: "A) alpha", explanation: "Server explanation one" });
    expect(apiPost).toHaveBeenCalledWith("/api/v1/study-plan/targeted-practice/answer", { practiceId: "p-1", questionId: "q1", selectedAnswer: "B) beta" });
    expect(text()).toContain("Server explanation one");
    expect(button("A) alpha").className).toContain("border-brand/80");     // the server's key is highlighted
    expect(button("B) beta").className).toContain("line-through");
  });

  it("finishes with the server's own score and the points it reports", async () => {
    await answer("A) alpha", { isCorrect: true, correctAnswer: "A) alpha", explanation: "one" });
    await click("Keyingi Savol");
    await answer("A) gamma", { isCorrect: false, correctAnswer: "B) delta", explanation: "two" });
    apiPost.mockResolvedValueOnce({ correctCount: 1, totalQuestions: 2, pointsAwarded: 50, dailyCapReached: false });
    await click("Natijani Ko'rish");
    expect(apiPost).toHaveBeenLastCalledWith("/api/v1/study-plan/targeted-practice/submit", { practiceId: "p-1" });
    expect(text()).toContain("50%");
    expect(text()).toContain("+50 XP");
    expect(document.body.querySelector('[data-testid="drill-daily-cap"]')).toBeNull();
    expect(onCompleted).toHaveBeenCalledWith({ correctCount: 1, pointsAwarded: 50 });
  });

  it("claims no points when the server gave none and says when the daily limit is reached", async () => {
    await answer("A) alpha", { isCorrect: true, correctAnswer: "A) alpha", explanation: "one" });
    await click("Keyingi Savol");
    await answer("B) delta", { isCorrect: true, correctAnswer: "B) delta", explanation: "two" });
    apiPost.mockResolvedValueOnce({ correctCount: 2, totalQuestions: 2, pointsAwarded: 0, dailyCapReached: true });
    await click("Natijani Ko'rish");
    expect(text()).toContain("100%");
    expect(text()).not.toMatch(/\+\d+ XP/);
    expect(text()).toContain("Bugungi mashq ballari chegarasiga yetdingiz");
  });

  it("shows no score at all when the result could not be saved", async () => {
    await answer("A) alpha", { isCorrect: true, correctAnswer: "A) alpha", explanation: "one" });
    await click("Keyingi Savol");
    await answer("B) delta", { isCorrect: true, correctAnswer: "B) delta", explanation: "two" });
    apiPost.mockRejectedValueOnce(new Error("offline"));
    await click("Natijani Ko'rish");
    expect(text()).not.toMatch(/\d+%/);
    expect(text()).not.toMatch(/\+\d+ XP/);
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
