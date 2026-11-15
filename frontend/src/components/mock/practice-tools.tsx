"use client";

import * as React from "react";
import { Eye, FileText, Rewind, FastForward } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

/** Practice only: playback speed and ±10 s for an audio element (never in a timed exam). */
export function PracticeAudioControls({ audio }: { audio: React.RefObject<HTMLAudioElement | null> }) {
  const t = useTranslations("mock.practiceTools");
  const [speed, setSpeed] = React.useState(1);
  const skip = (delta: number) => {
    const element = audio.current;
    if (!element) return;
    const end = Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY;
    element.currentTime = Math.min(end, Math.max(0, element.currentTime + delta));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label={t("audioTools")} data-testid="practice-audio-tools">
      <Button type="button" size="sm" variant="outline" className="min-h-[36px] px-2.5" onClick={() => skip(-10)}>
        <Rewind className="mr-1 size-3.5" aria-hidden />{t("back10")}
      </Button>
      <Button type="button" size="sm" variant="outline" className="min-h-[36px] px-2.5" onClick={() => skip(10)}>
        <FastForward className="mr-1 size-3.5" aria-hidden />{t("forward10")}
      </Button>
      <label className="flex items-center gap-1.5 text-fg-muted">
        {t("speed")}
        <select
          value={speed}
          onChange={(event) => { const value = Number(event.target.value); setSpeed(value); if (audio.current) audio.current.playbackRate = value; }}
          className="h-9 rounded-md border border-border bg-surface px-2 text-xs text-fg"
        >
          {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>
    </div>
  );
}

/** Practice only: the Listening audioscript, hidden until asked for. */
export function AudioScriptToggle({ script }: { script?: string | null }) {
  const t = useTranslations("mock.practiceTools");
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  if (!script?.trim()) return null;
  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <FileText className="mr-1.5 size-4" aria-hidden />{t(open ? "hideScript" : "showScript")}
      </Button>
      {open && (
        <div id={id} role="region" tabIndex={0} aria-label={t("scriptTitle")} className="max-h-60 overflow-y-auto whitespace-pre-line rounded-[8px] border border-border bg-bg-subtle p-3 text-sm leading-relaxed text-fg">
          {script}
        </div>
      )}
    </div>
  );
}

type Revealed = { correctAnswers: string[]; evidence?: { text: string; offset: number } };

/** Practice only: shows the answer of one Listening/Reading question; the attempt records it. */
export function RevealAnswer({ attemptId, questionId, initiallyRevealed = false }: { attemptId: string; questionId: string; initiallyRevealed?: boolean }) {
  const t = useTranslations("mock.practiceTools");
  const [state, setState] = React.useState<"idle" | "loading" | "error">("idle");
  const [value, setValue] = React.useState<Revealed | null>(null);
  const show = () => {
    setState("loading");
    api.post<Revealed>(`/mock/attempts/${attemptId}/reveal`, { questionId })
      .then((data) => { setValue(data); setState("idle"); })
      .catch(() => setState("error"));
  };
  if (value) {
    return (
      <div className="mt-2 rounded-[8px] border border-success-border bg-success-bg px-3 py-2 text-sm" role="status" data-testid="practice-revealed">
        <p className="text-fg"><span className="font-semibold">{t("answerLabel")}:</span> {value.correctAnswers.length ? value.correctAnswers.join(" / ") : "—"}</p>
        {value.evidence && <p className="mt-1 text-xs text-fg-muted">{t("whereLabel")}: “{value.evidence.text}”</p>}
      </div>
    );
  }
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={show}
        disabled={state === "loading"}
        className={cn("inline-flex min-h-[32px] items-center gap-1 rounded-md px-1.5 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-60")}
      >
        <Eye className="size-3.5" aria-hidden />{t(initiallyRevealed ? "showAgain" : "showAnswer")}
      </button>
      {state === "error" && <span className="ml-2 text-xs text-danger" role="alert">{t("revealError")}</span>}
    </div>
  );
}
