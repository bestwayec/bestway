// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }));
import { ListeningAudio } from "./listening-engine";
import type { ListeningSchedule } from "@/lib/listening-schedule";

let host: HTMLDivElement;
let root: Root;
let paused = true;
let playMock: ReturnType<typeof vi.fn>;
const T0 = Date.parse("2026-11-13T10:00:00.000Z");
const schedule = (startedAtSec: number): ListeningSchedule => ({
  startedAt: new Date(T0 + startedAtSec * 1000).toISOString(),
  readingEndsAt: new Date(T0 + (startedAtSec + 30) * 1000).toISOString(),
  readingSeconds: 30, durationSec: 60, serverTime: new Date(T0).toISOString(),
});
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const audio = () => host.querySelector("audio");
const text = () => host.textContent ?? "";
async function mount(props: Partial<React.ComponentProps<typeof ListeningAudio>>) {
  await act(async () => root.render(React.createElement(ListeningAudio, { src: "/audio.wav", strict: true, ...props })));
  await tick(0);
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  localStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  paused = true;
  playMock = vi.fn(async () => { paused = false; });
  HTMLMediaElement.prototype.play = playMock as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.pause = vi.fn(() => { paused = true; });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => paused });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["wav"]), { status: 200 })));
  URL.createObjectURL = vi.fn(() => "blob:part-1");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("timed IELTS Listening on the server schedule", () => {
  it("Play records the start, gives reading time, then plays the recording from the beginning", async () => {
    const start = vi.fn(async () => schedule(0));
    await mount({ startSchedule: start, reviewAtEnd: false });
    expect(audio()).toBeNull();                       // nothing fetched before the start is recorded
    expect(text()).toContain("listeningRulesScheduled");
    await act(async () => host.querySelector("button")!.click());
    await tick(300);
    expect(start).toHaveBeenCalledTimes(1);
    expect(text()).toContain('listeningReading:{"time":"00:30"}');
    expect(playMock).not.toHaveBeenCalled();
    await tick(30_000);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(audio()!.currentTime).toBeLessThan(1);
  });

  it("after a reload in the middle of the recording it continues from the server clock, not from the start", async () => {
    vi.setSystemTime(T0 + 75_000);                     // 30 s reading + 45 s of the recording
    await mount({ startSchedule: vi.fn(), schedule: schedule(0), reviewAtEnd: false });
    await tick(300);
    expect(playMock).toHaveBeenCalled();
    expect(audio()!.currentTime).toBeGreaterThanOrEqual(45);
    expect(audio()!.currentTime).toBeLessThan(46);
  });

  it("when the browser needs a click before sound after a reload, 'Continue listening' resumes at the right point", async () => {
    vi.setSystemTime(T0 + 50_000);
    playMock.mockImplementationOnce(async () => { throw new DOMException("NotAllowedError"); });
    await mount({ startSchedule: vi.fn(), schedule: schedule(0), reviewAtEnd: false });
    await tick(300);
    expect(text()).toContain("listeningInterrupted");
    const resume = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("listeningResume"))!;
    await tick(5_000);
    await act(async () => resume.click());
    expect(audio()!.currentTime).toBeGreaterThanOrEqual(25);
    expect(paused).toBe(false);
  });

  it("the last part's 2-minute check after a reload gives back only the time that is left", async () => {
    vi.setSystemTime(T0 + (90 + 45) * 1000);           // recording ended 45 s ago
    const done = vi.fn();
    await mount({ startSchedule: vi.fn(), schedule: schedule(0), reviewAtEnd: true, onReviewComplete: done });
    await tick(300);
    expect(text()).toContain('listeningReview:{"time":"01:15"}');
    for (let i = 0; i < 75; i++) await tick(1_000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(playMock).not.toHaveBeenCalled();           // an ended recording is never played again
  });

  it("a failed start says so and keeps the Play button", async () => {
    await mount({ startSchedule: vi.fn(async () => { throw new Error("offline"); }) });
    await act(async () => host.querySelector("button")!.click());
    await tick(300);
    expect(text()).toContain("listeningStartFailed");
    expect(host.querySelector("button")!.disabled).toBe(false);
  });
});
