// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const en = (await import("../../../messages/en.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), en);
  return { useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
    const found = lookup(`${ns}.${key}`);
    return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")) : key;
  } };
});

import { CbtSectionStepper, matchesNavigatorFilter, requestQuestionJump } from "./cbt-section-stepper";
import { SubmitConfirmModal } from "./submit-confirm-modal";
import { submitReview } from "@/lib/submit-review";
import type { MockSection } from "@/lib/types";

const q = (n: number, type = "note_completion") => ({ id: `q-${n}`, number: n, type, prompt: `Gap ${n}`, options: null, points: 1 });
const groups = [
  { id: "g1", title: "Part 1", questions: [1, 2, 3].map((n) => q(n)) },
  { id: "g2", title: "Part 2", questions: [4, 5].map((n) => q(n)) },
] as unknown as MockSection["groups"];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("smart navigator", () => {
  it("keeps answer, flag and save states independent", () => {
    const answeredFlagged = { answered: true, flagged: true, pending: false };
    expect(matchesNavigatorFilter("answered", answeredFlagged)).toBe(true);
    expect(matchesNavigatorFilter("flagged", answeredFlagged)).toBe(true);
    expect(matchesNavigatorFilter("unanswered", answeredFlagged)).toBe(false);
    expect(matchesNavigatorFilter("pending", { answered: true, flagged: false, pending: true })).toBe(true);
    expect(matchesNavigatorFilter("all", { answered: false, flagged: false, pending: false })).toBe(true);
  });

  it("filters the overview, opens it with O and jumps on request", async () => {
    const onActive = vi.fn();
    await act(async () => root.render(React.createElement(CbtSectionStepper, {
      skill: "listening", groups, answers: { "q-2": "a", "q-4": "b" }, audioSet: new Set<string>(),
      flaggedQuestions: new Set(["q-2", "q-5"]), unconfirmedQuestions: new Set(["q-4"]),
      onActiveQuestionChange: onActive, renderGroupBlock: () => null,
    })));
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "o" })); });
    const palette = () => [...document.querySelectorAll<HTMLButtonElement>("[data-testid=question-palette] button[data-qid]")].map((b) => b.dataset.qid);
    expect(palette()).toEqual(["q-1", "q-2", "q-3", "q-4", "q-5"]);
    const pick = (name: string) => act(async () => { document.querySelector<HTMLButtonElement>(`[data-filter=${name}]`)!.click(); });
    await pick("unanswered");
    expect(palette()).toEqual(["q-1", "q-3", "q-5"]);
    await pick("flagged");
    expect(palette()).toEqual(["q-2", "q-5"]);
    await pick("pending");
    expect(palette()).toEqual(["q-4"]);
    expect(document.querySelector("[data-filter=answered]")!.textContent).toContain("2");

    vi.useFakeTimers();
    await act(async () => { requestQuestionJump("q-5"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(document.querySelector("[data-testid=question-palette]")).toBeNull();
    expect(onActive).toHaveBeenLastCalledWith(5);
  });
});

describe("submission review", () => {
  const sections = [
    { id: "s1", skill: "listening", title: "Listening", groups: [{ id: "g1", questions: [q(1), q(2)] }] },
    { id: "s2", skill: "writing", title: "Writing", groups: [{ id: "g2", questions: [q(41, "essay_task1"), q(42, "essay_task2")] }] },
    { id: "s3", skill: "speaking", title: "Speaking", groups: [{ id: "g3", questions: [q(43, "speaking_task")] }] },
  ] as unknown as MockSection[];

  it("lists only open sections and counts recordings the server holds", () => {
    const review = submitReview(sections, new Set(["writing", "speaking"]), { "q-41": "essay text" }, new Set(["q-43"]), new Set(["q-1", "q-41"]), (s) => s.title ?? s.skill);
    expect(review.unanswered.map((item) => item.id)).toEqual(["q-42"]);
    expect(review.flagged.map((item) => item.id)).toEqual(["q-41"]);
    expect(review.writing).toEqual({ required: 2, done: 1 });
    expect(review.speaking).toEqual({ required: 1, done: 1 });
  });

  it("warns about unsynchronised answers and jumps to a listed question", async () => {
    const onJump = vi.fn();
    await act(async () => root.render(React.createElement(SubmitConfirmModal, {
      open: true, onOpenChange: () => undefined, onConfirm: () => undefined, isSubmitting: false, answered: 3, total: 5,
      unansweredItems: [{ id: "q-4", label: "4" }], flaggedItems: [{ id: "q-2", label: "2" }], pendingSaves: 2, offline: true, onJump,
    })));
    expect(document.querySelector("[data-testid=review-pending]")!.textContent).toContain("kept only on this device");
    await act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent === "4")!.click(); });
    expect(onJump).toHaveBeenCalledWith({ id: "q-4", label: "4" });
  });
});
