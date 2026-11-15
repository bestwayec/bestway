"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Lock } from "lucide-react";
import { useExamPrograms, useSetExamPrograms, type ExamProgram } from "@/hooks/use-exam-programs";
import { Skeleton } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

/**
 * The catalogue's track switch: one segmented control, IELTS | Multi-Level. A track the student is
 * not enrolled in (staff-assigned centres) is shown locked. The profile page keeps the full cards.
 */
export function ExamTrackSwitch() {
  const t = useTranslations("examTrack");
  const state = useExamPrograms();
  const save = useSetExamPrograms();

  if (state.isPending) return <Skeleton className="h-11 w-72 rounded-[10px]" aria-label={t("loading")} />;
  if (!state.data) {
    return <p role="alert" className="text-sm text-danger">{t("loadError")}</p>;
  }
  const current = state.data;
  const selfSelect = (current.accessPolicy ?? "SELF_SELECT") === "SELF_SELECT";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label={t("title")} className="inline-flex rounded-[10px] border border-border bg-bg-subtle p-1">
        {(["IELTS", "MULTILEVEL"] as ExamProgram[]).map((program) => {
          const name = program === "IELTS" ? t("ieltsName") : t("multilevelName");
          const active = current.activeProgram === program;
          const selectable = current.availablePrograms.includes(program) || selfSelect;
          const pending = save.isPending && save.variables?.activeProgram === program;
          return (
            // The test id matches the profile cards, so one selector finds the track either way.
            <span key={program} data-testid={`exam-track-card-${program}`} aria-current={active ? "true" : undefined}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={active ? name : selectable ? t("switchTo", { program: name }) : `${name} — ${t("locked")}`}
                disabled={!selectable || save.isPending}
                onClick={() => { if (!active) save.mutate({ ...current, activeProgram: program }); }}
                className={cn(
                  "inline-flex min-h-[36px] items-center gap-1.5 rounded-[8px] px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
                  active ? "bg-brand text-brand-fg shadow-sm" : "text-fg-muted hover:text-fg disabled:opacity-60",
                )}
              >
                {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {!selectable && <Lock className="size-3.5" aria-hidden />}
                {name}
              </button>
            </span>
          );
        })}
      </div>
      <p className="text-xs text-fg-muted">{t(selfSelect ? "subtitleSelfSelect" : "subtitleStaffAssigned")}</p>
      {save.isError && <p role="alert" className="w-full text-xs text-danger">{save.error.message}</p>}
    </div>
  );
}
