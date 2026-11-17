"use client";

import * as React from "react";
import { Square, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A countdown as a ring: the arc is the share of the time still left. `total` is the whole
 * phase (preparation or response) in seconds, `left` what remains; the number stays readable.
 */
export function CountdownRing({ left, total, label, tone = "brand", size = 88 }: {
  left: number; total: number; label: string; tone?: "brand" | "danger"; size?: number;
}) {
  const tc = useTranslations("common");
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
  return (
    <div className="flex flex-col items-center gap-1" data-testid="countdown-ring" data-left={left} data-total={total}>
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-border" />
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)}
            className={cn("transition-[stroke-dashoffset] duration-200 ease-linear", tone === "danger" ? "stroke-danger" : "stroke-brand")}
          />
        </svg>
        <span role="timer" aria-label={`${label}: ${tc("secondsLeft", { count: left })}`} className="absolute text-2xl font-bold tabular-nums text-fg">{left}</span>
      </div>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
    </div>
  );
}

/** The microphone's real input level (0–1) as bars; with no level, nothing moves. */
export function InputLevelBars({ level, label }: { level: number; label: string }) {
  // Bars rise from the outside in, so a quiet voice lights the first ones only.
  const weights = [0.35, 0.65, 1, 0.65, 0.35];
  const value = Math.min(1, Math.max(0, level * 2.2));
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-6 items-end gap-1" aria-hidden data-testid="input-level-bars">
        {weights.map((weight, index) => (
          <span key={index} className="w-1.5 rounded-full bg-danger transition-[height] duration-75" style={{ height: `${Math.max(12, Math.round(value * weight * 100))}%` }} />
        ))}
      </div>
      <meter className="sr-only" aria-label={label} min={0} max={1} value={Math.min(1, level)} />
    </div>
  );
}

/**
 * Reads the question aloud with the browser's own voice (Web Speech API). Nothing is shown when
 * the browser has no voice. `silence` stops it — the recorder sets it while recording, so the
 * voice never ends up in the student's answer.
 */
export function ReadPromptButton({ text, silence }: { text: string; silence: boolean }) {
  const t = useTranslations("mock.runnerUx");
  const [speaking, setSpeaking] = React.useState(false);
  const supported = React.useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined",
    () => false,
  );
  // Recording started: stop the voice so it is not in the answer. `speaking` then reads false.
  React.useEffect(() => {
    if (silence && supported) window.speechSynthesis?.cancel();
  }, [silence, supported]);
  React.useEffect(() => () => { if (supported) window.speechSynthesis?.cancel(); }, [supported]);
  if (!supported || !text.trim()) return null;
  const active = speaking && !silence;
  const toggle = () => {
    const synth = window.speechSynthesis;
    if (active) { synth.cancel(); setSpeaking(false); return; }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = synth.getVoices().find((v) => /^en(-|_)GB/i.test(v.lang)) ?? synth.getVoices().find((v) => /^en/i.test(v.lang));
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-GB";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" className="min-h-[40px]" aria-pressed={active} disabled={silence} onClick={toggle} data-testid="read-prompt">
        {active ? <Square className="mr-1.5 size-4 fill-current" aria-hidden /> : <Volume2 className="mr-1.5 size-4" aria-hidden />}
        {t(active ? "readPromptStop" : "readPrompt")}
      </Button>
      <span className="text-xs text-fg-subtle">{t("readPromptNote")}</span>
    </div>
  );
}
