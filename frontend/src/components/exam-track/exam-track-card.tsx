"use client";

import { CheckCircle2, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ExamProgram } from "@/hooks/use-exam-programs";
import { cn } from "@/lib/utils";

/**
 * One exam-track option (U3). Cards in a row share the same height, the active card states
 * its status in one place (badge + footer line, never clipped), and an inactive card shows a
 * single action — no "Enrolled" label next to a "Switch to …" button.
 */
export function ExamTrackCard({
  program,
  isActive,
  selectable,
  pending,
  onSelect,
  extraAction,
}: {
  program: ExamProgram;
  isActive: boolean;
  selectable: boolean;
  pending: boolean;
  onSelect: () => void;
  extraAction?: React.ReactNode;
}) {
  const t = useTranslations("examTrack");
  const name = program === "IELTS" ? t("ieltsName") : t("multilevelName");

  return (
    <div
      data-testid={`exam-track-card-${program}`}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "flex h-full min-w-0 flex-col rounded-[12px] border p-4 transition-colors",
        isActive ? "border-brand bg-brand-subtle ring-1 ring-brand/40" : "border-border bg-surface hover:border-border-strong",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words font-semibold text-fg">{name}</h3>
        {isActive && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-fg">
            <CheckCircle2 className="size-3" aria-hidden />
            {t("active")}
          </span>
        )}
      </div>
      <p className="mt-1 flex-1 text-sm text-fg-muted">
        {program === "IELTS" ? t("ieltsDescription") : t("multilevelDescription")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isActive ? (
          <p className="text-sm font-medium text-brand-subtle-fg">{t("currentTrack")}</p>
        ) : selectable ? (
          <Button size="sm" className="h-auto min-h-9 w-full whitespace-normal py-1.5 text-center sm:w-auto" disabled={pending} loading={pending} onClick={onSelect}>
            {t("switchTo", { program: name })}
          </Button>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
            <Lock className="size-3.5" aria-hidden />
            {t("locked")}
          </p>
        )}
        {extraAction}
      </div>
    </div>
  );
}
