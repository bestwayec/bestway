"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";
import { ExamTrackCard } from "@/components/exam-track/exam-track-card";
import { useExamPrograms, useSetExamPrograms, type ExamProgram } from "@/hooks/use-exam-programs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";

export function ExamTrackSelector({ studentId }: { studentId?: string }) {
  const t = useTranslations("examTrack");
  const state = useExamPrograms(studentId);
  const save = useSetExamPrograms(studentId);

  if (state.isPending) {
    // Same footprint as the loaded card so nothing below jumps when data arrives (O3).
    return (
      <Card className="my-4 border-slate-800 bg-bg-subtle/90 p-5" aria-busy="true" aria-label={t("loading")} data-testid="exam-track-skeleton">
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </Card>
    );
  }
  if (!state.data) {
    return (
      <div role="alert" className="my-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-300">
        {t("loadError")}
      </div>
    );
  }

  const current = state.data;
  const accessPolicy = current.accessPolicy ?? "SELF_SELECT";
  const manage = !!studentId;

  return (
    <Card className="my-4 border-slate-800 bg-bg-subtle/90 backdrop-blur-md p-5 shadow-xl transition-all">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3 mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <Layers className="size-4 text-emerald-400" />
            {t(manage ? "manage" : "title")}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {t(accessPolicy === "SELF_SELECT" ? "subtitleSelfSelect" : "subtitleStaffAssigned")}
          </p>
        </div>
        <Badge variant="neutral" className="border border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs">
          {t("activeBadge", { program: current.activeProgram ? t(current.activeProgram === "IELTS" ? "ieltsName" : "multilevelName") : "—" })}
        </Badge>
      </div>

      <div className="grid grid-cols-2 items-stretch gap-3">
        {(["IELTS", "MULTILEVEL"] as ExamProgram[]).map((program) => {
          const isActive = current.activeProgram === program;
          const available = current.availablePrograms.includes(program);
          const selectable = available || (!manage && accessPolicy === "SELF_SELECT");
          return (
            <ExamTrackCard
              key={program}
              program={program}
              isActive={isActive}
              selectable={selectable}
              pending={save.isPending && save.variables?.activeProgram === program}
              onSelect={() => save.mutate({ ...current, activeProgram: program })}
              extraAction={
                manage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={save.isPending}
                    className="text-xs"
                    onClick={() => {
                      const programs = available
                        ? current.availablePrograms.filter((p) => p !== program)
                        : [...current.availablePrograms, program];
                      save.mutate({
                        availablePrograms: programs,
                        activeProgram:
                          current.activeProgram && programs.includes(current.activeProgram)
                            ? current.activeProgram
                            : programs[0] ?? null,
                      });
                    }}
                  >
                    {t(available ? "remove" : "assign")}
                  </Button>
                ) : undefined
              }
            />
          );
        })}
      </div>

      {save.isError && (
        <p role="alert" className="mt-3 text-xs text-rose-400">
          {save.error.message}
        </p>
      )}
    </Card>
  );
}
