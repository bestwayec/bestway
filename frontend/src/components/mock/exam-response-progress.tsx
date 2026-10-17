"use client";

import { CheckCircle2, PenLine } from "lucide-react";
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
    <p className="text-xs text-fg-subtle">{t("responseProgressHint")}</p>
  </div>;
}

export function WritingResponseGuide({ value, minimum = 0, maximum }: { value: string; minimum?: number; maximum?: number }) {
  const t = useTranslations("mock.runnerUx");
  const words = value.trim() ? value.trim().split(/\s+/u).length : 0;
  const hasTarget = minimum > 0;
  // An approximate single-value target is guidance, not a hard upper limit.
  const overTarget = maximum != null && maximum > minimum && words > maximum;
  const reached = hasTarget && words >= minimum && !overTarget;
  const target = maximum != null
    ? minimum === maximum ? `~${minimum}` : `${minimum}–${maximum}`
    : hasTarget ? `${minimum}+` : null;
  const remaining = Math.max(0, minimum - words);
  return <div className="space-y-2 rounded-[10px] border border-border bg-bg-subtle p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="inline-flex items-center gap-1.5 text-sm font-medium text-fg">
        {reached ? <CheckCircle2 className="size-4 text-success" /> : <PenLine className="size-4 text-brand" />}
        <span className="tabular-nums">{t("wordCount", { count: words })}</span>
      </p>
      {target && <span className={cn("text-xs tabular-nums", overTarget ? "text-warning" : "text-fg-muted")}>{t("wordTarget", { target })}</span>}
    </div>
    {hasTarget && <progress aria-label={t("wordTargetProgress")} value={Math.min(words, minimum)} max={minimum} className="block h-1.5 w-full overflow-hidden rounded-full accent-brand [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-brand [&::-moz-progress-bar]:bg-brand" />}
    <p className={cn("text-xs", overTarget ? "text-warning" : reached ? "text-success" : "text-fg-muted")}>
      {overTarget ? t("aboveTarget") : reached ? t("targetReached") : hasTarget && words > 0 ? t("wordsRemaining", { count: remaining }) : t("writingStartHint")}
    </p>
    <p className="text-xs text-fg-subtle">{t("writingReviewHint")}</p>
  </div>;
}
