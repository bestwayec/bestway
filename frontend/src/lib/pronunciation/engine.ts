/**
 * Shared vocabulary pronunciation engine (BestWay Learning 3.0).
 *
 * Plays a word N times (default 2) in strict sequence: play 1 must finish, then a short pause,
 * then play 2 — never two at once. Sources, in order:
 *   1. the word's stored, teacher-provided audio (`audioUrl`);
 *   2. the browser's Web Speech API (fallback, or when no audio is stored).
 * No paid TTS provider is called.
 *
 * Exactly one sequence runs app-wide: starting a new one, `stop()`, or the owning component
 * unmounting / changing question cancels the previous one. Every callback checks the sequence
 * token, so a late `ended` event of an old word can never trigger a play of that word again.
 *
 * Browsers block audio before a user gesture; a blocked start is reported as `blocked` so the
 * UI can show an explicit "Play" control instead of trying to bypass the restriction.
 */

export type Speed = "normal" | "slow";
export type AccentPreference = "auto" | "en-GB" | "en-US";
export type RepeatCount = 1 | 2 | 3;

export interface PronunciationRequest {
  text: string;
  audioUrl?: string | null;
  repeat?: RepeatCount;
  pauseMs?: number;
  speed?: Speed;
  accent?: AccentPreference;
  /** Identifies the caller (component) so it can cancel only its own playback. */
  owner?: string;
}

export type PronunciationStatus = "idle" | "loading" | "playing" | "pausing" | "blocked" | "error" | "unsupported";

export interface PronunciationState {
  status: PronunciationStatus;
  /** 1-based index of the current play, 0 when idle. */
  play: number;
  total: number;
  source: "audio" | "speech" | null;
  /** The language of the voice actually used (e.g. "en-US"); null for stored audio. */
  voiceLang: string | null;
  /** True when the requested accent was not available and another English voice was used. */
  accentFallback: boolean;
  owner: string | null;
  text: string | null;
  error: string | null;
}

export type PlayOutcome = "completed" | "cancelled" | "blocked" | "failed" | "unsupported";

/* ── Adapters (real browser objects in production, fakes in tests) ─────────────────────────── */

export interface AudioLike {
  src: string;
  currentTime: number;
  playbackRate: number;
  preservesPitch?: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "error", fn: () => void): void;
  removeEventListener(type: "ended" | "error", fn: () => void): void;
}

export interface VoiceLike {
  lang: string;
  name: string;
  localService?: boolean;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

export interface SpeechLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
  createUtterance(text: string): UtteranceLike;
}

export interface PronunciationEnvironment {
  createAudio: (() => AudioLike) | null;
  speech: SpeechLike | null;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export const DEFAULT_PAUSE_MS = 650;
const SPEECH_RATE: Record<Speed, number> = { normal: 0.95, slow: 0.6 };
const AUDIO_RATE: Record<Speed, number> = { normal: 1, slow: 0.75 };

/** Pick an English voice for the preference; report the language actually used. */
export function chooseVoice(voices: VoiceLike[], accent: AccentPreference): { voice: VoiceLike | null; lang: string; fallback: boolean } {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const norm = (lang: string) => lang.replace("_", "-").toLowerCase();
  const order: string[] = accent === "en-GB" ? ["en-gb", "en-us"] : accent === "en-US" ? ["en-us", "en-gb"] : ["en-us", "en-gb"];
  for (const wanted of order) {
    const match = english.find((v) => norm(v.lang) === wanted);
    if (match) return { voice: match, lang: match.lang.replace("_", "-"), fallback: accent !== "auto" && wanted !== accent.toLowerCase() };
  }
  if (english.length) return { voice: english[0], lang: english[0].lang.replace("_", "-"), fallback: accent !== "auto" };
  // No English voice listed (voices may still be loading): let the engine pick its default for "en".
  return { voice: null, lang: accent === "en-GB" ? "en-GB" : "en-US", fallback: false };
}

const IDLE: PronunciationState = {
  status: "idle", play: 0, total: 0, source: null, voiceLang: null, accentFallback: false, owner: null, text: null, error: null,
};

export class PronunciationEngine {
  private env: PronunciationEnvironment;
  private token = 0;
  private timers = new Set<unknown>();
  private audio: AudioLike | null = null;
  private cleanup: Array<() => void> = [];
  private listeners = new Set<(s: PronunciationState) => void>();
  private state: PronunciationState = IDLE;

  constructor(env: PronunciationEnvironment) {
    this.env = env;
  }

  get supported(): boolean {
    return !!this.env.speech || !!this.env.createAudio;
  }

  getState(): PronunciationState {
    return this.state;
  }

  subscribe(listener: (s: PronunciationState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<PronunciationState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  /** Cancel the running sequence (all owners, or only `owner`'s). */
  stop(owner?: string) {
    if (owner && this.state.owner && this.state.owner !== owner) return;
    this.token++;
    this.halt();
    if (this.state.status !== "idle") this.set({ ...IDLE });
  }

  private halt() {
    for (const handle of this.timers) this.env.clearTimeout(handle);
    this.timers.clear();
    for (const fn of this.cleanup.splice(0)) fn();
    if (this.audio) {
      try {
        this.audio.pause();
      } catch {
        /* already stopped */
      }
    }
    try {
      this.env.speech?.cancel();
    } catch {
      /* engine not ready */
    }
  }

  private wait(ms: number, token: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const handle = this.env.setTimeout(() => {
        this.timers.delete(handle);
        settle(token === this.token);
      }, ms);
      this.timers.add(handle);
      // A cancelled pause must settle too, or the cancelled play() would never return.
      this.cleanup.push(() => settle(false));
    });
  }

  async play(request: PronunciationRequest): Promise<PlayOutcome> {
    const text = (request.text || "").trim();
    const repeat = request.repeat ?? 2;
    const pauseMs = request.pauseMs ?? DEFAULT_PAUSE_MS;
    const speed = request.speed ?? "normal";
    // A new sequence always replaces the previous one: no overlap, no stale callbacks.
    this.token++;
    this.halt();
    const token = this.token;
    const owner = request.owner ?? null;
    if (!text && !request.audioUrl) return "failed";
    let source: "audio" | "speech" | null = request.audioUrl && this.env.createAudio ? "audio" : this.env.speech ? "speech" : null;
    if (!source) {
      this.set({ ...IDLE, status: "unsupported", owner, text, total: repeat, error: "No audio and no speech engine available" });
      return "unsupported";
    }
    this.set({ ...IDLE, status: "loading", owner, text, total: repeat, source });
    for (let index = 1; index <= repeat; index++) {
      if (token !== this.token) return "cancelled";
      this.set({ status: "playing", play: index, source });
      let result = source === "audio" ? await this.playAudio(request.audioUrl!, speed, token) : await this.speak(text, speed, request.accent ?? "auto", token);
      if (token !== this.token) return "cancelled";
      if (result === "failed" && source === "audio" && this.env.speech && text) {
        // Stored file missing or unplayable: fall back to the speech engine for this and later plays.
        source = "speech";
        this.set({ source });
        result = await this.speak(text, speed, request.accent ?? "auto", token);
        if (token !== this.token) return "cancelled";
      }
      if (result === "blocked") {
        this.set({ status: "blocked", error: "Playback needs a tap or click first" });
        return "blocked";
      }
      if (result === "failed") {
        this.set({ status: "error", error: "The pronunciation could not be played" });
        return "failed";
      }
      if (index < repeat) {
        this.set({ status: "pausing" });
        if (!(await this.wait(pauseMs, token))) return "cancelled";
      }
    }
    if (token !== this.token) return "cancelled";
    this.set({ ...IDLE, owner: null });
    return "completed";
  }

  private playAudio(url: string, speed: Speed, token: number): Promise<"ok" | "failed" | "blocked"> {
    return new Promise((resolve) => {
      if (!this.env.createAudio) return resolve("failed");
      if (!this.audio) this.audio = this.env.createAudio();
      const audio = this.audio;
      let settled = false;
      const finish = (value: "ok" | "failed" | "blocked") => {
        if (settled) return;
        settled = true;
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        resolve(value);
      };
      const onEnded = () => finish(token === this.token ? "ok" : "ok");
      const onError = () => finish("failed");
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      this.cleanup.push(() => finish("ok"));
      if (audio.src !== url) audio.src = url;
      audio.currentTime = 0;
      audio.playbackRate = AUDIO_RATE[speed];
      audio.preservesPitch = true;
      audio.play().catch((error: unknown) => {
        const name = (error as { name?: string })?.name;
        finish(name === "NotAllowedError" ? "blocked" : "failed");
      });
    });
  }

  private speak(text: string, speed: Speed, accent: AccentPreference, token: number): Promise<"ok" | "failed" | "blocked"> {
    return new Promise((resolve) => {
      const speech = this.env.speech;
      if (!speech) return resolve("failed");
      const { voice, lang, fallback } = chooseVoice(speech.getVoices(), accent);
      this.set({ voiceLang: lang, accentFallback: fallback });
      const utterance = speech.createUtterance(text);
      utterance.lang = lang;
      utterance.voice = voice;
      utterance.rate = SPEECH_RATE[speed];
      let settled = false;
      // Some engines never fire `end` (long-standing Chrome bug): a generous watchdog keeps the
      // sequence from hanging; it only resolves this play, it never starts another one.
      const watchdog = this.env.setTimeout(() => finish("ok"), Math.max(4000, text.length * 450));
      this.timers.add(watchdog);
      const finish = (value: "ok" | "failed" | "blocked") => {
        if (settled) return;
        settled = true;
        this.env.clearTimeout(watchdog);
        this.timers.delete(watchdog);
        utterance.onend = null;
        utterance.onerror = null;
        resolve(value);
      };
      utterance.onend = () => finish("ok");
      utterance.onerror = (event) => {
        const code = event?.error;
        if (code === "interrupted" || code === "canceled") return finish("ok"); // our own cancel()
        finish(code === "not-allowed" ? "blocked" : "failed");
      };
      this.cleanup.push(() => finish("ok"));
      if (token !== this.token) return finish("ok");
      speech.speak(utterance);
    });
  }
}

/* ── Browser binding ───────────────────────────────────────────────────────────────────────── */

function browserEnvironment(): PronunciationEnvironment {
  const w = typeof window !== "undefined" ? window : undefined;
  const synth = w && "speechSynthesis" in w && typeof w.SpeechSynthesisUtterance === "function" ? w.speechSynthesis : null;
  return {
    createAudio: w && typeof w.Audio === "function" ? () => new w.Audio() as unknown as AudioLike : null,
    speech: synth
      ? {
          speak: (u) => synth.speak(u as unknown as SpeechSynthesisUtterance),
          cancel: () => synth.cancel(),
          getVoices: () => synth.getVoices(),
          createUtterance: (text) => new w!.SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
        }
      : null,
    setTimeout: (fn, ms) => (w ?? globalThis).setTimeout(fn, ms),
    clearTimeout: (handle) => (w ?? globalThis).clearTimeout(handle as number),
  };
}

let shared: PronunciationEngine | null = null;

/** The single app-wide engine (one sequence at a time across every component). */
export function getPronunciationEngine(): PronunciationEngine {
  if (!shared) shared = new PronunciationEngine(browserEnvironment());
  return shared;
}
