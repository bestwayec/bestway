"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Layers } from "lucide-react";
import { useExamPrograms, useSetExamPrograms, type ExamProgram } from "@/hooks/use-exam-programs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ExamTrackSelector({ studentId }: { studentId?: string }) {
  const t = useTranslations("examTrack");
  const state = useExamPrograms(studentId);
  const save = useSetExamPrograms(studentId);

  if (state.isPending) {
    return (
      <div className="my-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400 animate-pulse">
        {t("loading")}
      </div>
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
    <Card className="my-4 border-slate-800 bg-[#0B0F17]/90 backdrop-blur-md p-5 shadow-xl transition-all">
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
          Faol Yo&apos;nalish: {current.activeProgram ?? "IELTS"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["IELTS", "MULTILEVEL"] as ExamProgram[]).map((program) => {
          const isActive = current.activeProgram === program;
          const available = current.availablePrograms.includes(program);
          const selectable = available || (!manage && accessPolicy === "SELF_SELECT");

          return (
            <div
              key={program}
              className={cn(
                "relative flex flex-col justify-between rounded-xl border p-4 transition-all",
                isActive
                  ? "border-emerald-500/50 bg-gradient-to-br from-emerald-950/40 via-slate-900/90 to-slate-900 shadow-lg shadow-emerald-950/20 ring-1 ring-emerald-500/30"
                  : "border-slate-800/80 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90"
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-extrabold text-white tracking-tight">
                      {program === "IELTS" ? "IELTS Academic" : "Multi-Level (CEFR)"}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="size-3" />
                        Faol
                      </span>
                    )}
                  </div>
                  <Badge variant={isActive ? "success" : available ? "brand" : "neutral"} className="text-[11px]">
                    {t(isActive ? "active" : available ? "enrolled" : selectable ? "available" : "locked")}
                  </Badge>
                </div>

                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  {t(program === "IELTS" ? "ieltsDescription" : "multilevelDescription")}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={!selectable || save.isPending || isActive}
                  onClick={() => save.mutate({ ...current, activeProgram: program })}
                  className={cn(
                    "w-full text-xs font-bold transition-all",
                    isActive
                      ? "bg-emerald-600 text-white shadow-lg cursor-default hover:bg-emerald-600"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  )}
                >
                  {isActive ? (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5" />
                      {t("active")}
                    </span>
                  ) : (
                    `${t("select")} ${program}`
                  )}
                </Button>

                {manage && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={save.isPending}
                    className="shrink-0 text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
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
                )}
              </div>
            </div>
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
