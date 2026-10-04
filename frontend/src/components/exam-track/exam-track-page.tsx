"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useExamPrograms, useSetExamPrograms, type ExamProgram } from "@/hooks/use-exam-programs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";

export function ExamTrackPage() {
  const t = useTranslations("examTrack");
  const state = useExamPrograms();
  const save = useSetExamPrograms();

  if (state.isPending) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t("title")} />
        <Card>
          <CardContent className="py-8 text-center">
            <p role="status">{t("loading")}</p>
          </CardContent>
        </Card>
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

      <Card className="space-y-3">
        <CardContent className="space-y-3 pt-5">
          {(["IELTS", "MULTILEVEL"] as ExamProgram[]).map((program) => {
            const available = current.availablePrograms.includes(program);
            const isActive = current.activeProgram === program;
            const selectable = available || (isSelfSelect && !available);

            return (
              <div
                key={program}
                className={`rounded-[12px] border p-4 transition-all duration-200 ${
                  isActive
                    ? "border-brand bg-brand-subtle"
                    : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-fg">{program}</h3>
                      {isActive && (
                        <span className="inline-flex items-center rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white">
                          {t("active")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-fg-muted">
                      {program === "IELTS" ? t("ieltsDescription") : t("multilevelDescription")}
                    </p>
                    {!isActive && available && (
                      <p className="mt-1 text-sm text-success">{t("enrolled")}</p>
                    )}
                    {!isActive && !available && selectable && (
                      <p className="mt-1 text-sm text-info">{t("available")}</p>
                    )}
                    {!isActive && !available && !selectable && (
                      <p className="mt-1 text-sm text-fg-muted">{t("locked")}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={isActive ? "outline" : "primary"}
                    disabled={!selectable || save.isPending || isActive}
                    onClick={() => save.mutate({ ...current, activeProgram: program })}
                    className="shrink-0"
                  >
                    {save.isPending && current.activeProgram === program
                      ? t("switching")
                      : isActive
                        ? t("active")
                        : `${t("select")} ${program}`}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {save.isError && (
        <div role="alert" className="rounded-[8px] border border-danger bg-danger-bg/50 p-3 text-sm text-danger">
          {save.error.message}
        </div>
      )}
    </div>
  );
}