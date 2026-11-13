// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    const template: string = namespace.split(".").reduce((node: any, part) => node?.[part], en as any)?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ""));
  },
}));
import { CbtSectionStepper } from "./cbt-section-stepper";
import type { MockSection } from "@/lib/types";

const question = (n: number) => ({ id: `q${n}`, number: n, type: "short_answer", prompt: `Question text ${n}`, options: null, points: 1 });
const groups = [
  { id: "g1", title: "Passage 1", questions: [1, 2, 3].map(question) },
  { id: "g2", title: "Passage 2", questions: [4, 5].map(question) },
] as unknown as MockSection["groups"];

let host: HTMLDivElement;
let root: Root;
const palette = () => host.querySelector<HTMLElement>('[role="toolbar"]')!;
const buttons = () => [...palette().querySelectorAll<HTMLButtonElement>("button")];
const key = (k: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(CbtSectionStepper, {
    skill: "reading", groups, answers: { q2: "x" }, audioSet: new Set<string>(),
    renderGroupBlock: (group: MockSection["groups"][number]) => React.createElement("div", null,
      group.questions.map((q) => React.createElement("div", { key: q.id, id: `q-${q.id}` }, React.createElement("input", { "aria-label": `answer ${q.number}` })))),
  })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("question navigator with the keyboard", () => {
  it("is a named navigation landmark and one tab stop", () => {
    expect(host.querySelector('nav[aria-label="Question navigation"]')).not.toBeNull();
    expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });

  it("moves with the arrows, Home and End, keeping a single tab stop", async () => {
    buttons()[0].focus();
    await key("ArrowRight");
    expect(document.activeElement).toBe(buttons()[1]);
    await key("End");
    expect(document.activeElement).toBe(buttons()[4]);
    await key("ArrowDown");
    expect(document.activeElement).toBe(buttons()[4]);   // stays on the last one
    await key("Home");
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons().filter((b) => b.tabIndex === 0)).toEqual([buttons()[0]]);
  });

  it("opening a question moves the focus to its answer, across parts, and announces it", async () => {
    buttons()[3].focus();
    await act(async () => buttons()[3].click());
    await act(async () => { vi.advanceTimersByTime(60); });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("answer 4");
    const live = host.querySelector('nav [aria-live="polite"]')!.textContent;
    expect(live).toBe("Question 4 of 5, not answered");
  });

  it("announces the answered state", async () => {
    await act(async () => buttons()[1].click());
    expect(host.querySelector('nav [aria-live="polite"]')!.textContent).toBe("Question 2 of 5, answered");
  });
});
