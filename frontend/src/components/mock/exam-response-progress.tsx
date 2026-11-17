"use client";

import * as React from "react";
import { countParagraphs, countWords } from "@/lib/writing-rules";
import { CheckCircle2, Clock, Pilcrow, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Response progress is separate from correctness, grading and server save state. */
export function ResponseProgress({ answered, total }: { answered: number; total: number }) {
  const t = useTranslations("mock.runnerUx");
  if (total <= 0) return null;
  const completed = Math.max(0, Math.min(answered, total));
  return <div className="mt-3 space-y-1.5">
    <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
      <span>{t("responseProgress")}</span>
      <span className="tabular-nums">{completed} / {total}</span>
    </div>
    <progress aria-label={t("responseProgress")} value={completed} max={total} className="block h-1.5 w-full overflow-hidden rounded-full accent-brand [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-brand [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-brand" />
    <p className="hidden text-xs text-fg-subtle sm:block">{t("responseProgressHint")}</p>
  </div>;
}

/**
 * Time spent on one writing task in this browser: counted only while the task is on screen and the
 * page is visible, kept across reloads (sessionStorage). It is the student's own pace, not the exam clock.
 */
export function useTimeOnTask(key: string | null): number {
  const storageKey = key ? `bw_task_time:${key}` : null;
  const [seconds, setSeconds] = React.useState(() => {
    if (!storageKey) return 0;
    try { return Number(sessionStorage.getItem(storageKey)) || 0; } catch { return 0; }
  });
  React.useEffect(() => {
    if (!storageKey) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setSeconds((value) => {
        const next = value + 1;
        try { sessionStorage.setItem(storageKey, String(next)); } catch { /* storage off: still counts on screen */ }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [storageKey]);
  return seconds;
}

export function WritingResponseGuide({ value, minimum = 0, maximum, taskKey = null, suggestedMinutes = null }: {
  value: string; minimum?: number; maximum?: number;
  /** attempt + question: enables the time-on-task count. */
  taskKey?: string | null;
  /** The test's advice for this task (IELTS: 20 / 40 minutes), if any. */
  suggestedMinutes?: number | null;
}) {
  const t = useTranslations("mock.runnerUx");
  const words = countWords(value);
  const paragraphs = countParagraphs(value);
  const spent = useTimeOnTask(taskKey);
  const minutes = Math.floor(spent / 60);
  const hasTarget = minimum > 0;
  // An approximate single-value target is guidance, not a hard upper limit.
  const overTarget = maximum != null && maximum > minimum && words > maximum;
  const reached = hasTarget && words >= minimum && !overTarget;
  const target = maximum != null
    ? minimum === maximum ? `~${minimum}` : `${minimum}–${maximum}`
    : hasTarget ? `${minimum}+` : null;
  const remaining = Math.max(0, minimum - words);
  return <div className="space-y-2 rounded-control border border-border bg-bg-subtle p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="inline-flex items-center gap-1.5 text-sm font-medium text-fg">
        {reached ? <CheckCircle2 className="size-4 text-success" /> : <PenLine className="size-4 text-brand" />}
        <span className="tabular-nums">{t("wordCount", { count: words })}</span>
      </p>
      {target && <span className={cn("text-xs tabular-nums", overTarget ? "text-warning" : "text-fg-muted")}>{t("wordTarget", { target })}</span>}
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted" data-testid="writing-stats">
      <span className="inline-flex items-center gap-1 tabular-nums"><Pilcrow className="size-3.5" aria-hidden />{t("paragraphCount", { count: paragraphs })}</span>
      {taskKey && (
        <span className={cn("inline-flex items-center gap-1 tabular-nums", suggestedMinutes != null && minutes > suggestedMinutes && "text-warning")}>
          <Clock className="size-3.5" aria-hidden />
          {suggestedMinutes != null ? t("timeOnTaskOf", { minutes, suggested: suggestedMinutes }) : t("timeOnTask", { minutes })}
        </span>
      )}
    </div>
    {hasTarget && <progress aria-label={t("wordTargetProgress")} value={Math.min(words, minimum)} max={minimum} className="block h-1.5 w-full overflow-hidden rounded-full accent-brand [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-brand [&::-moz-progress-bar]:bg-brand" />}
    <p className={cn("text-xs", overTarget ? "text-warning" : reached ? "text-success" : "text-fg-muted")}>
      {overTarget ? t("aboveTarget") : reached ? t("targetReached") : hasTarget && words > 0 ? t("wordsRemaining", { count: remaining }) : t("writingStartHint")}
    </p>
    <p className="text-xs text-fg-subtle">{t("writingReviewHint")}</p>
  </div>;
}
