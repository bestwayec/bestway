// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { status: "idle", play: 0, total: 0, source: null, voiceLang: null, accentFallback: false, owner: null, text: null, error: null };
  return {
    state,
    listeners,
    engine: {
      supported: true,
      getState: () => state,
      subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
      play: vi.fn(async (_request: Record<string, unknown>) => "completed"),
      stop: vi.fn((_owner?: string) => undefined),
    },
  };
});
vi.mock("./engine", async (orig) => ({ ...(await orig<typeof import("./engine")>()), getPronunciationEngine: () => fake.engine }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { PronounceButton, parseSettings } from "./react";
import { speakableText } from "@/components/vocabulary/question-types";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  fake.engine.play.mockClear();
  fake.engine.stop.mockClear();
  try { localStorage.clear(); } catch { /* no storage */ }
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("PronounceButton", () => {
  it("plays the word with the default two repeats on click", async () => {
    await act(async () => root.render(React.createElement(PronounceButton, { text: "achievement", audioUrl: "/a.mp3", resetKey: "q1" })));
    await act(async () => (host.querySelector('[data-testid="pronounce-button"]') as HTMLButtonElement).click());
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
    expect(fake.engine.play.mock.calls[0][0]).toMatchObject({ text: "achievement", audioUrl: "/a.mp3", repeat: 2, speed: "normal" });
  });

  it("does not auto-play until allowed, and auto-plays once per question when allowed", async () => {
    await act(async () => root.render(React.createElement(PronounceButton, { text: "a", resetKey: "q1", autoPlay: false })));
    expect(fake.engine.play).not.toHaveBeenCalled();
    await act(async () => root.render(React.createElement(PronounceButton, { text: "b", resetKey: "q2", autoPlay: true })));
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
    expect(fake.engine.play.mock.calls[0][0]).toMatchObject({ text: "b" });
  });

  it("stops its own playback when the question changes and when it unmounts", async () => {
    await act(async () => root.render(React.createElement(PronounceButton, { text: "a", resetKey: "q1" })));
    await act(async () => root.render(React.createElement(PronounceButton, { text: "b", resetKey: "q2" })));
    expect(fake.engine.stop).toHaveBeenCalledTimes(1);
    const owner = fake.engine.stop.mock.calls[0][0];
    expect(owner).toMatch(/^owner-/); // owner-scoped: never stops another component's audio
    act(() => root.unmount());
    root = createRoot(host);
    expect(fake.engine.stop).toHaveBeenCalledTimes(2);
  });
});

describe("settings and answer protection", () => {
  it("parses stored settings defensively", () => {
    expect(parseSettings(null)).toEqual({ enabled: true, repeat: 2, speed: "normal", accent: "auto" });
    expect(parseSettings('{"repeat":3,"speed":"slow","accent":"en-GB","enabled":false}')).toEqual({ enabled: false, repeat: 3, speed: "slow", accent: "en-GB" });
    expect(parseSettings('{"repeat":9,"speed":"x"}')).toMatchObject({ repeat: 2, speed: "normal" });
    expect(parseSettings("not json")).toMatchObject({ repeat: 2 });
  });

  it("never speaks the answer of a question that asks for the English word", () => {
    expect(speakableText({ type: "uzb_eng", prompt: "yutuq", speak: null })).toBeNull();
    expect(speakableText({ type: "spelling", prompt: "yutuq", speak: null })).toBeNull();
    expect(speakableText({ type: "fill_blank", prompt: "It was a great _____.", speak: null })).toBeNull();
    expect(speakableText({ type: "eng_uzb", prompt: "achievement", speak: null })).toBe("achievement");
    expect(speakableText({ type: "listen_type", prompt: "", speak: "achievement" })).toBe("achievement");
  });
});
