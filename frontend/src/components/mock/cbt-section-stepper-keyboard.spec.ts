// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    type Tree = { [key: string]: Tree | string | undefined };
    const node = namespace.split(".").reduce<Tree | undefined>((tree, part) => tree?.[part] as Tree | undefined, en as unknown as Tree);
    const template = typeof node?.[key] === "string" ? (node[key] as string) : key;
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
const toolbar = (name: string) => document.querySelector<HTMLElement>(`[role="toolbar"][aria-label="${name}"]`)!;
const buttonsIn = (name: string) => [...toolbar(name).querySelectorAll<HTMLButtonElement>("button")];
const partButtons = () => buttonsIn("Questions in Passage 1");
const key = (k: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
const control = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const live = () => host.querySelector('nav [aria-live="polite"]')!.textContent;

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
  it("is a named navigation landmark; the open part's questions are one tab stop", () => {
    expect(host.querySelector('nav[aria-label="Question navigation"]')).not.toBeNull();
    expect(partButtons()).toHaveLength(3);
    expect(partButtons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });

  it("moves with the arrows, Home and End, keeping a single tab stop", async () => {
    partButtons()[0].focus();
    await key("ArrowRight");
    expect(document.activeElement).toBe(partButtons()[1]);
    await key("End");
    expect(document.activeElement).toBe(partButtons()[2]);
    await key("ArrowDown");
    expect(document.activeElement).toBe(partButtons()[2]);   // stays on the last one
    await key("Home");
    expect(document.activeElement).toBe(partButtons()[0]);
    expect(partButtons().filter((b) => b.tabIndex === 0)).toEqual([partButtons()[0]]);
  });

  it("the sheet lists every question; opening one moves the focus to its answer, across parts, and announces it", async () => {
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click());
    const all = buttonsIn("Question palette");
    expect(all).toHaveLength(5);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
    await act(async () => all[3].click());
    await act(async () => { vi.advanceTimersByTime(60); });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("answer 4");
    expect(live()).toBe("Question 4 of 5, not answered");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(partButtons).toThrow();                            // Passage 2 is open now
    expect(buttonsIn("Questions in Passage 2")).toHaveLength(2);
  });

  it("next and previous question cross the part boundary", async () => {
    await act(async () => partButtons()[2].click());
    await act(async () => control("Next question").click());
    await act(async () => { vi.advanceTimersByTime(60); });
    expect(live()).toBe("Question 4 of 5, not answered");
    await act(async () => control("Previous question").click());
    await act(async () => { vi.advanceTimersByTime(60); });
    expect(live()).toBe("Question 3 of 5, not answered");
  });

  it("announces the answered state", async () => {
    await act(async () => partButtons()[1].click());
    expect(live()).toBe("Question 2 of 5, answered");
  });
});
