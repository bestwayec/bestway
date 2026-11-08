"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useExamPrograms, useSetExamPrograms, type ExamProgram } from "@/hooks/use-exam-programs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { ExamTrackCard } from "@/components/exam-track/exam-track-card";
import { PageHeader } from "@/components/app/page-header";

export function ExamTrackPage() {
  const t = useTranslations("examTrack");
  const state = useExamPrograms();
  const save = useSetExamPrograms();

  if (state.isPending) {
    return (
      <div className="mx-auto max-w-xl space-y-4" aria-busy="true">
        <PageHeader title={t("title")} />
        <p className="sr-only" role="status">{t("loading")}</p>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t("title")} />
        <Card>
          <CardContent className="py-8 text-center">
            <p role="alert">{t("loadError")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const current = state.data;
  const accessPolicy = current.accessPolicy ?? "SELF_SELECT";
  const isSelfSelect = accessPolicy === "SELF_SELECT";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        title={t("title")}
        description={isSelfSelect ? t("subtitleSelfSelect") : t("subtitleStaffAssigned")}
      />

      <div className="grid grid-cols-2 items-stretch gap-3">
        {(["IELTS", "MULTILEVEL"] as ExamProgram[]).map((program) => {
          const available = current.availablePrograms.includes(program);
          return (
            <ExamTrackCard
              key={program}
              program={program}
              isActive={current.activeProgram === program}
              selectable={available || isSelfSelect}
              pending={save.isPending && save.variables?.activeProgram === program}
              onSelect={() => save.mutate({ ...current, activeProgram: program })}
            />
          );
        })}
      </div>

      {save.isError && (
        <div role="alert" className="rounded-[8px] border border-danger bg-danger-bg/50 p-3 text-sm text-danger">
          {save.error.message}
        </div>
      )}
    </div>
  );
}