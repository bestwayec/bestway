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
import { ExamToolbar, helpTypeOf } from "./exam-toolbar";
import { DEFAULT_EXAM_SETTINGS, EXAM_VOLUME_EVENT, type ExamSettings } from "@/lib/exam-settings";

let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn<(s: ExamSettings) => void>();
const text = () => document.body.textContent ?? "";
const button = (name: string) => [...document.body.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name || b.textContent?.trim() === name) as HTMLButtonElement;
async function mount(types: string[] = ["true_false_notgiven", "sentence_completion"], timeLeft: string | null = "12:34") {
  await act(async () => root.render(React.createElement(ExamToolbar, { settings: DEFAULT_EXAM_SETTINGS, onChange, questionTypes: types, timeLeft })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  onChange.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

describe("ExamToolbar", () => {
  it("Settings changes text size and colours and shares the volume with every player", async () => {
    await mount();
    await act(async () => button("Settings").click());
    await act(async () => button("Large").click());
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_EXAM_SETTINGS, textSize: "large" });
    await act(async () => button("Yellow on black").click());
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_EXAM_SETTINGS, colours: "yellow_on_black" });
    const heard: number[] = [];
    window.addEventListener(EXAM_VOLUME_EVENT, (e) => heard.push(Number((e as CustomEvent<number>).detail)));
    const slider = document.body.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "0.3");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(heard).toEqual([0.3]);
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_EXAM_SETTINGS, volume: 0.3 });
    expect([...document.body.querySelectorAll('[role="radio"]')].filter((r) => r.getAttribute("aria-checked") === "true").length).toBe(2);
  });

  it("Help explains only the question types of this section", async () => {
    await mount(["true_false_notgiven", "note_completion", "short_answer"]);
    await act(async () => button("Help").click());
    const types = [...document.body.querySelectorAll("[data-help-type]")].map((s) => s.getAttribute("data-help-type"));
    expect(types).toEqual(["true_false_notgiven", "completion"]);
    expect(text()).toContain("NO MORE THAN TWO WORDS AND/OR A NUMBER");
    expect(text()).not.toContain("Matching headings");
  });

  it("Hide covers the questions, shows that time keeps running, and Resume brings them back", async () => {
    await mount();
    await act(async () => button("Hide screen").click());
    const overlay = document.body.querySelector('[data-testid="exam-hidden"]')!;
    expect(overlay.textContent).toContain("The time keeps running");
    expect(overlay.textContent).toContain("Time left: 12:34");
    expect(document.activeElement?.textContent).toBe("Resume test");
    await act(async () => button("Resume test").click());
    expect(document.body.querySelector('[data-testid="exam-hidden"]')).toBeNull();
  });

  it("maps stored question types to help entries", () => {
    expect(helpTypeOf("table_completion")).toBe("completion");
    expect(helpTypeOf("essay_task2")).toBe("essay");
    expect(helpTypeOf("unknown")).toBeNull();
  });
});
