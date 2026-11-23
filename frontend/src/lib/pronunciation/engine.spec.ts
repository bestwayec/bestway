import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PronunciationEngine,
  chooseVoice,
  type AudioLike,
  type PronunciationEnvironment,
  type SpeechLike,
  type UtteranceLike,
  type VoiceLike,
} from "./engine";

/** A log of what actually reached the speakers, in order. */
let log: string[];

class FakeAudio implements AudioLike {
  src = "";
  currentTime = 0;
  playbackRate = 1;
  preservesPitch = true;
  private handlers: Record<string, Set<() => void>> = { ended: new Set(), error: new Set() };
  static mode: "ok" | "error" | "blocked" = "ok";
  static durationMs = 400;
  static instances: FakeAudio[] = [];
  playing = false;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play() {
    if (FakeAudio.mode === "blocked") return Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
    log.push(`audio:start:${this.src}@${this.playbackRate}`);
    this.playing = true;
    const src = this.src;
    setTimeout(() => {
      if (!this.playing || this.src !== src) return;
      this.playing = false;
      if (FakeAudio.mode === "error") {
        this.handlers.error.forEach((fn) => fn());
        return;
      }
      log.push(`audio:end:${src}`);
      this.handlers.ended.forEach((fn) => fn());
    }, FakeAudio.durationMs);
    return Promise.resolve();
  }
  pause() {
    if (this.playing) log.push(`audio:pause:${this.src}`);
    this.playing = false;
  }
  addEventListener(type: "ended" | "error", fn: () => void) {
    this.handlers[type].add(fn);
  }
  removeEventListener(type: "ended" | "error", fn: () => void) {
    this.handlers[type].delete(fn);
  }
}

function fakeSpeech(voices: VoiceLike[] = [{ lang: "en-US", name: "US" }], opts: { silentEnd?: boolean; notAllowed?: boolean } = {}): SpeechLike {
  let current: UtteranceLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    getVoices: () => voices,
    createUtterance: (text) => ({ text, lang: "", rate: 1, voice: null, onend: null, onerror: null }),
    speak(u) {
      if (opts.notAllowed) {
        setTimeout(() => u.onerror?.({ error: "not-allowed" }), 0);
        return;
      }
      current = u;
      log.push(`speech:start:${u.text}@${u.rate}:${u.lang}`);
      timer = setTimeout(() => {
        if (current !== u) return;
        current = null;
        if (opts.silentEnd) return; // engine never fires `end`
        log.push(`speech:end:${u.text}`);
        u.onend?.();
      }, 300);
    },
    cancel() {
      if (current) {
        const u = current;
        current = null;
        if (timer) clearTimeout(timer);
        log.push(`speech:cancel:${u.text}`);
        u.onerror?.({ error: "interrupted" });
      }
    },
  };
}

function env(over: Partial<PronunciationEnvironment> = {}): PronunciationEnvironment {
  return {
    createAudio: () => new FakeAudio(),
    speech: fakeSpeech(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  log = [];
  FakeAudio.mode = "ok";
  FakeAudio.durationMs = 400;
  FakeAudio.instances = [];
});
afterEach(() => vi.useRealTimers());

describe("two-play pronunciation", () => {
  it("plays stored audio exactly twice, the second only after the first ended plus the pause", async () => {
    const engine = new PronunciationEngine(env());
    const done = engine.play({ text: "achievement", audioUrl: "/a.mp3", pauseMs: 650 });
    await vi.advanceTimersByTimeAsync(400);
    expect(log).toEqual(["audio:start:/a.mp3@1", "audio:end:/a.mp3"]);
    await vi.advanceTimersByTimeAsync(649);
    expect(log.filter((l) => l.startsWith("audio:start"))).toHaveLength(1); // still pausing
    await vi.advanceTimersByTimeAsync(1 + 400);
    expect(await done).toBe("completed");
    expect(log).toEqual(["audio:start:/a.mp3@1", "audio:end:/a.mp3", "audio:start:/a.mp3@1", "audio:end:/a.mp3"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(log.filter((l) => l.startsWith("audio:start"))).toHaveLength(2); // never a third
    expect(engine.getState().status).toBe("idle");
  });

  it("uses speech when no audio is stored, with the same strict sequence", async () => {
    const engine = new PronunciationEngine(env());
    const done = engine.play({ text: "decline" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await done).toBe("completed");
    expect(log).toEqual(["speech:start:decline@0.95:en-US", "speech:end:decline", "speech:start:decline@0.95:en-US", "speech:end:decline"]);
  });

  it("supports 1 or 3 repeats and the slow speed", async () => {
    const engine = new PronunciationEngine(env());
    const one = engine.play({ text: "x", audioUrl: "/x.mp3", repeat: 1, speed: "slow" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await one).toBe("completed");
    expect(log).toEqual(["audio:start:/x.mp3@0.75", "audio:end:/x.mp3"]);
    log = [];
    const three = engine.play({ text: "y", repeat: 3, speed: "slow" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await three).toBe("completed");
    expect(log.filter((l) => l.startsWith("speech:start:y@0.6"))).toHaveLength(3);
  });
});

describe("cancellation", () => {
  it("stop() during the first play prevents the second", async () => {
    const engine = new PronunciationEngine(env());
    const done = engine.play({ text: "a", audioUrl: "/a.mp3" });
    await vi.advanceTimersByTimeAsync(100);
    engine.stop();
    expect(await done).toBe("cancelled");
    await vi.advanceTimersByTimeAsync(5000);
    expect(log).toEqual(["audio:start:/a.mp3@1", "audio:pause:/a.mp3"]);
  });

  it("a new word cancels the old one; no stale callback replays the old word", async () => {
    const engine = new PronunciationEngine(env());
    const first = engine.play({ text: "old", audioUrl: "/old.mp3" });
    await vi.advanceTimersByTimeAsync(500); // first play of "old" ended, now pausing
    const second = engine.play({ text: "new", audioUrl: "/new.mp3" });
    expect(await first).toBe("cancelled");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await second).toBe("completed");
    expect(log.filter((l) => l.includes("/old.mp3") && l.startsWith("audio:start"))).toHaveLength(1);
    expect(log.filter((l) => l.includes("/new.mp3") && l.startsWith("audio:start"))).toHaveLength(2);
  });

  it("repeated clicks never overlap: only the latest sequence plays", async () => {
    const engine = new PronunciationEngine(env());
    const runs = [engine.play({ text: "w" }), engine.play({ text: "w" }), engine.play({ text: "w" })];
    await vi.advanceTimersByTimeAsync(5000);
    expect(await Promise.all(runs)).toEqual(["cancelled", "cancelled", "completed"]);
    // No two `start`s without an end/cancel between them.
    let open = 0;
    for (const line of log) {
      if (line.startsWith("speech:start")) open++;
      if (line.startsWith("speech:end") || line.startsWith("speech:cancel")) open--;
      expect(open).toBeLessThanOrEqual(1);
    }
  });

  it("stop(owner) only stops that owner's playback", async () => {
    const engine = new PronunciationEngine(env());
    const run = engine.play({ text: "w", owner: "quiz" });
    engine.stop("flashcards");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run).toBe("completed");
  });
});

describe("failures and browser limits", () => {
  it("falls back to speech when stored audio fails to load", async () => {
    FakeAudio.mode = "error";
    const engine = new PronunciationEngine(env());
    const done = engine.play({ text: "career", audioUrl: "/missing.mp3" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await done).toBe("completed");
    expect(log.filter((l) => l.startsWith("speech:start:career"))).toHaveLength(2);
    expect(engine.getState().status).toBe("idle");
  });

  it("reports an error when audio fails and no speech engine exists", async () => {
    FakeAudio.mode = "error";
    const engine = new PronunciationEngine(env({ speech: null }));
    const done = engine.play({ text: "career", audioUrl: "/missing.mp3" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBe("failed");
    expect(engine.getState().status).toBe("error");
  });

  it("reports unsupported without audio or speech", async () => {
    const engine = new PronunciationEngine(env({ speech: null }));
    expect(await engine.play({ text: "x" })).toBe("unsupported");
    expect(engine.getState().status).toBe("unsupported");
  });

  it("reports a blocked start (autoplay policy) instead of bypassing it", async () => {
    FakeAudio.mode = "blocked";
    const engine = new PronunciationEngine(env());
    const done = engine.play({ text: "x", audioUrl: "/x.mp3" });
    await vi.advanceTimersByTimeAsync(10);
    expect(await done).toBe("blocked");
    expect(engine.getState().status).toBe("blocked");
    const speechBlocked = new PronunciationEngine(env({ speech: fakeSpeech(undefined, { notAllowed: true }) }));
    const run = speechBlocked.play({ text: "x" });
    await vi.advanceTimersByTimeAsync(10);
    expect(await run).toBe("blocked");
  });

  it("does not hang when the speech engine never fires `end`", async () => {
    const engine = new PronunciationEngine(env({ speech: fakeSpeech(undefined, { silentEnd: true }) }));
    const done = engine.play({ text: "hi" });
    await vi.advanceTimersByTimeAsync(20000);
    expect(await done).toBe("completed");
    expect(log.filter((l) => l.startsWith("speech:start"))).toHaveLength(2);
  });
});

describe("voice choice", () => {
  const gb = { lang: "en-GB", name: "GB" };
  const us = { lang: "en_US", name: "US" };
  it("uses the requested accent when present", () => {
    expect(chooseVoice([us, gb], "en-GB")).toMatchObject({ voice: gb, lang: "en-GB", fallback: false });
  });
  it("never claims British when only American is available", () => {
    expect(chooseVoice([us], "en-GB")).toMatchObject({ voice: us, lang: "en-US", fallback: true });
  });
  it("ignores non-English voices", () => {
    expect(chooseVoice([{ lang: "uz-UZ", name: "UZ" }], "auto")).toMatchObject({ voice: null, fallback: false });
  });
});
