// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }));
import { ListeningAudio } from "./listening-engine";
import { broadcastVolume } from "@/lib/exam-settings";

let host: HTMLDivElement;
let root: Root;
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
async function mount(props: Partial<React.ComponentProps<typeof ListeningAudio>>) {
  await act(async () => root.render(React.createElement(ListeningAudio, { src: "/audio.wav", strict: true, ...props })));
}
const audio = () => host.querySelector("audio")!;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("ListeningAudio in exam mode", () => {
  it("plays once: no native controls, the button is disabled after starting", async () => {
    await mount({});
    expect(audio().hasAttribute("controls")).toBe(false);
    const play = host.querySelector("button")!;
    await act(async () => play.click());
    expect(host.querySelector("button")!.disabled).toBe(true);
    expect(host.textContent).toContain("listeningPlaying");
  });

  it("an earlier part ends without the 2-minute check and never hands the section in", async () => {
    const done = vi.fn();
    await mount({ reviewAtEnd: false, onReviewComplete: done });
    await act(async () => host.querySelector("button")!.click());
    await act(async () => audio().dispatchEvent(new Event("ended")));
    expect(host.textContent).toContain("listeningNextPart");
    expect(host.textContent).not.toContain("listeningReview:");
    for (let i = 0; i < 130; i++) await tick(1_000);
    expect(done).not.toHaveBeenCalled();
  });

  it("the last part ends with exactly two minutes to check answers, then moves on once", async () => {
    const done = vi.fn();
    await mount({ reviewAtEnd: true, onReviewComplete: done });
    await act(async () => host.querySelector("button")!.click());
    await act(async () => audio().dispatchEvent(new Event("ended")));
    expect(host.textContent).toContain('listeningReview:{"time":"02:00"}');
    for (let i = 0; i < 119; i++) await tick(1_000);
    expect(done).not.toHaveBeenCalled();
    expect(host.textContent).toContain('listeningReview:{"time":"00:01"}');
    await tick(1_000);
    expect(done).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) await tick(1_000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("follows the exam volume setting", async () => {
    await mount({});
    await act(async () => broadcastVolume(0.25));
    expect(audio().volume).toBe(0.25);
    expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe("0.25");
  });
});
