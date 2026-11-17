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
    return template
      .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, name, one, other) =>
        (Number(values?.[name]) === 1 ? one : other).replace("#", String(values?.[name])))
      .replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ""));
  },
}));
import { CountdownRing, InputLevelBars, ReadPromptButton } from "./speaking-visuals";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (element: React.ReactElement) => act(async () => root.render(element));

describe("CountdownRing", () => {
  it("draws the share of time left and announces the seconds", async () => {
    await render(React.createElement(CountdownRing, { left: 15, total: 60, label: "Preparation time" }));
    const arc = host.querySelectorAll("circle")[1];
    const circumference = Number(arc.getAttribute("stroke-dasharray"));
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference * 0.75, 3);
    expect(host.querySelector('[role="timer"]')!.getAttribute("aria-label")).toBe("Preparation time: 15 seconds remaining");
    expect(host.textContent).toContain("15");
  });

  it("an empty or unknown total shows an empty ring, not a full one", async () => {
    await render(React.createElement(CountdownRing, { left: 5, total: 0, label: "Response time" }));
    const arc = host.querySelectorAll("circle")[1];
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(Number(arc.getAttribute("stroke-dasharray")), 3);
  });
});

describe("InputLevelBars", () => {
  const heights = () => [...host.querySelectorAll('[data-testid="input-level-bars"] span')].map((el) => parseInt((el as HTMLElement).style.height, 10));
  it("follows the real level: silence keeps the bars at their floor", async () => {
    await render(React.createElement(InputLevelBars, { level: 0, label: "Microphone input level" }));
    expect(heights()).toEqual([12, 12, 12, 12, 12]);
    await render(React.createElement(InputLevelBars, { level: 0.4, label: "Microphone input level" }));
    const loud = heights();
    expect(loud[2]).toBe(88);
    expect(loud[0]).toBeLessThan(loud[2]);
    expect(host.querySelector("meter")!.getAttribute("aria-label")).toBe("Microphone input level");
  });
});

describe("ReadPromptButton", () => {
  it("is not shown when the browser has no voice", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    // jsdom has no speechSynthesis at all; the stub only makes that explicit.
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    await render(React.createElement(ReadPromptButton, { text: "Describe your town.", silence: false }));
    expect(host.querySelector('[data-testid="read-prompt"]')).toBeNull();
  });

  it("reads the question with an English voice and stops when recording starts", async () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak, cancel, getVoices: () => [{ lang: "en-GB", name: "Test" }] } });
    class Utterance { text: string; lang = ""; rate = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(text: string) { this.text = text; } }
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    await render(React.createElement(ReadPromptButton, { text: "Describe your town.", silence: false }));
    const button = host.querySelector<HTMLButtonElement>('[data-testid="read-prompt"]')!;
    expect(button.textContent).toContain("Listen to the question");
    await act(async () => button.click());
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].text).toBe("Describe your town.");
    expect(speak.mock.calls[0][0].lang).toBe("en-GB");
    expect(button.textContent).toContain("Stop reading");
    cancel.mockClear();
    await render(React.createElement(ReadPromptButton, { text: "Describe your town.", silence: true }));
    expect(cancel).toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('[data-testid="read-prompt"]')!.disabled).toBe(true);
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });
});
