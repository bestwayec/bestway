"use client";

import * as React from "react";
import { Loader2, Square, Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PAUSE_MS,
  getPronunciationEngine,
  type AccentPreference,
  type PlayOutcome,
  type PronunciationState,
  type RepeatCount,
  type Speed,
} from "./engine";

export interface PronunciationSettings {
  enabled: boolean;
  repeat: RepeatCount;
  speed: Speed;
  accent: AccentPreference;
}

export const DEFAULT_SETTINGS: PronunciationSettings = { enabled: true, repeat: 2, speed: "normal", accent: "auto" };
const KEY = "bestway.pronunciation.v1";

export function parseSettings(raw: string | null): PronunciationSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<PronunciationSettings>;
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled,
      repeat: value.repeat === 1 || value.repeat === 2 || value.repeat === 3 ? value.repeat : DEFAULT_SETTINGS.repeat,
      speed: value.speed === "slow" ? "slow" : "normal",
      accent: value.accent === "en-GB" || value.accent === "en-US" ? value.accent : "auto",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const settingsListeners = new Set<() => void>();
let cachedSettings: PronunciationSettings | null = null;

function readSettings(): PronunciationSettings {
  if (cachedSettings) return cachedSettings;
  try {
    cachedSettings = parseSettings(typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null);
  } catch {
    cachedSettings = DEFAULT_SETTINGS; // storage blocked (private mode): defaults, nothing persisted
  }
  return cachedSettings;
}

/** Per-learner playback preferences (this browser only; a convenience, not a record). */
export function usePronunciationSettings(): [PronunciationSettings, (patch: Partial<PronunciationSettings>) => void] {
  const settings = React.useSyncExternalStore(
    (fn) => {
      settingsListeners.add(fn);
      return () => settingsListeners.delete(fn);
    },
    readSettings,
    () => DEFAULT_SETTINGS,
  );
  const update = React.useCallback((patch: Partial<PronunciationSettings>) => {
    cachedSettings = { ...readSettings(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(cachedSettings));
    } catch {
      /* not persisted */
    }
    settingsListeners.forEach((fn) => fn());
  }, []);
  return [settings, update];
}

let ownerSeq = 0;

/**
 * Play/stop pronunciation from a component. Playback started here stops when the component
 * unmounts or `resetKey` changes (e.g. the next question), so a previous word can never keep
 * playing over the new one.
 */
export function usePronunciation(resetKey?: unknown) {
  const engine = getPronunciationEngine();
  const owner = React.useMemo(() => `owner-${++ownerSeq}`, []);
  const state = React.useSyncExternalStore(
    (fn) => engine.subscribe(fn),
    () => engine.getState(),
    () => engine.getState(),
  );
  const [settings] = usePronunciationSettings();

  React.useEffect(() => () => engine.stop(owner), [engine, owner, resetKey]);

  const play = React.useCallback(
    (text: string, audioUrl?: string | null, overrides: Partial<PronunciationSettings> = {}): Promise<PlayOutcome> => {
      const s = { ...settings, ...overrides };
      return engine.play({ text, audioUrl, repeat: s.repeat, speed: s.speed, accent: s.accent, pauseMs: DEFAULT_PAUSE_MS, owner });
    },
    [engine, owner, settings],
  );
  const stop = React.useCallback(() => engine.stop(owner), [engine, owner]);
  const mine: PronunciationState | null = state.owner === owner ? state : null;
  return { state: mine, play, stop, settings, supported: engine.supported };
}

/**
 * Speaker button: plays the word (default twice) or stops it. Shows loading, "1/2" progress,
 * blocked (needs a tap), error and unsupported states. `hiddenText` keeps listening questions
 * from showing the word in the label.
 */
export function PronounceButton({
  text,
  audioUrl,
  resetKey,
  label,
  size = "md",
  className,
  autoPlay = false,
  onOutcome,
}: {
  text: string;
  audioUrl?: string | null;
  resetKey?: unknown;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Play once mounted / when resetKey changes — only after the learner already interacted. */
  autoPlay?: boolean;
  onOutcome?: (outcome: PlayOutcome) => void;
}) {
  const t = useTranslations("pronunciation");
  const { state, play, stop, settings, supported } = usePronunciation(resetKey);
  const active = state && (state.status === "loading" || state.status === "playing" || state.status === "pausing");

  React.useEffect(() => {
    if (!autoPlay || !settings.enabled || !text) return;
    void play(text, audioUrl).then((o) => onOutcome?.(o));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play once per word, not per settings change
  }, [autoPlay, resetKey]);

  if (!supported) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-fg-muted", className)} role="status">
        <VolumeX className="size-4" aria-hidden />
        {t("unsupported")}
      </span>
    );
  }
  const sizes = { sm: "size-8", md: "size-10", lg: "size-14" } as const;
  const icon = { sm: "size-4", md: "size-5", lg: "size-7" } as const;
  const name = label ?? t("play");
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => (active ? stop() : void play(text, audioUrl).then((o) => onOutcome?.(o)))}
        aria-label={active ? t("stop") : name}
        aria-pressed={active ? true : undefined}
        data-testid="pronounce-button"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          sizes[size],
          active ? "border-brand bg-brand text-white" : "border-border bg-surface text-brand hover:bg-surface-hover",
        )}
      >
        {state?.status === "loading" ? (
          <Loader2 className={cn(icon[size], "animate-spin")} aria-hidden />
        ) : active ? (
          <Square className={icon[size]} aria-hidden />
        ) : (
          <Volume2 className={icon[size]} aria-hidden />
        )}
      </button>
      <span className="text-xs text-fg-muted tabular-nums" aria-live="polite" data-testid="pronounce-status">
        {state?.status === "playing" || state?.status === "pausing"
          ? t("progress", { play: state.play, total: state.total })
          : state?.status === "blocked"
            ? t("blocked")
            : state?.status === "error"
              ? t("error")
              : state?.status === "unsupported"
                ? t("unsupported")
                : ""}
        {state?.accentFallback && state.voiceLang ? ` · ${t("accentUsed", { lang: state.voiceLang })}` : ""}
      </span>
    </span>
  );
}

/** Repeat / speed / accent / on-off controls for the learner. */
export function PronunciationSettingsBar({ className }: { className?: string }) {
  const t = useTranslations("pronunciation");
  const [settings, update] = usePronunciationSettings();
  const select = "h-8 rounded-field border border-border bg-bg px-2 text-xs";
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)} role="group" aria-label={t("settings")}>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        {t("autoPlay")}
      </label>
      <label className="inline-flex items-center gap-1">
        {t("repeat")}
        <select className={select} value={settings.repeat} onChange={(e) => update({ repeat: Number(e.target.value) as RepeatCount })}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={3}>3×</option>
        </select>
      </label>
      <label className="inline-flex items-center gap-1">
        {t("speed")}
        <select className={select} value={settings.speed} onChange={(e) => update({ speed: e.target.value as Speed })}>
          <option value="normal">{t("speedNormal")}</option>
          <option value="slow">{t("speedSlow")}</option>
        </select>
      </label>
      <label className="inline-flex items-center gap-1">
        {t("accent")}
        <select className={select} value={settings.accent} onChange={(e) => update({ accent: e.target.value as AccentPreference })}>
          <option value="auto">{t("accentAuto")}</option>
          <option value="en-GB">{t("accentGB")}</option>
          <option value="en-US">{t("accentUS")}</option>
        </select>
      </label>
    </div>
  );
}
