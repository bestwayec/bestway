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
const post = vi.fn();
vi.mock("@/lib/api-client", () => ({ api: { post: (...a: unknown[]) => post(...a) } }));
import { AudioScriptToggle, PracticeAudioControls, RevealAnswer } from "./practice-tools";
import { partMinutes } from "./section-start-dialog";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  post.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (label: RegExp) => [...host.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""))!;

describe("practice tools", () => {
  it("reveal asks the server and shows the key and where it is", async () => {
    post.mockResolvedValue({ correctAnswers: ["At nine"], evidence: { text: "opens at nine", offset: 4 } });
    await act(async () => root.render(React.createElement(RevealAnswer, { attemptId: "a1", questionId: "q1" })));
    await act(async () => { button(/Show answer/).click(); await Promise.resolve(); });
    expect(post).toHaveBeenCalledWith("/mock/attempts/a1/reveal", { questionId: "q1" });
    expect(host.textContent).toContain("Answer: At nine");
    expect(host.textContent).toContain("“opens at nine”");
  });

  it("speed and ±10 s act on the audio, within the recording", async () => {
    const audio = { currentTime: 5, duration: 30, playbackRate: 1 } as unknown as HTMLAudioElement;
    await act(async () => root.render(React.createElement(PracticeAudioControls, { audio: { current: audio } })));
    await act(async () => button(/−10 s/).click());
    expect(audio.currentTime).toBe(0);
    await act(async () => { button(/\+10 s/).click(); button(/\+10 s/).click(); button(/\+10 s/).click(); button(/\+10 s/).click(); });
    expect(audio.currentTime).toBe(30);
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "1.25"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(audio.playbackRate).toBe(1.25);
  });

  it("the audioscript stays hidden until asked for, and there is nothing to show without one", async () => {
    await act(async () => root.render(React.createElement(AudioScriptToggle, { script: "Woman: hello." })));
    expect(host.textContent).not.toContain("Woman: hello.");
    await act(async () => button(/Show the audioscript/).click());
    expect(host.textContent).toContain("Woman: hello.");
    await act(async () => root.render(React.createElement(AudioScriptToggle, { script: "" })));
    expect(host.querySelector("button")).toBeNull();
  });

  it("a part timer is its share of the section time, like the server", () => {
    expect(partMinutes(60, 13, 40)).toBe(20);
    expect(partMinutes(60, 1, 400)).toBe(1);
  });
});
