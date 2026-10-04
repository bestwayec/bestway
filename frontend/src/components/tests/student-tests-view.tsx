"use client";

import * as React from "react";
import { Clock, FileText, ListChecks, Play } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { useTests, useMyAttempts, useStartTest } from "@/hooks/use-tests";
import { useStudentProgramScope } from "@/hooks/use-exam-programs";
import { ApiError } from "@/lib/api-client";
import { ExamTrackSelector } from '@/components/profile/exam-track-selector';
import { ExamTrackRequired } from '@/components/exam-track/exam-track-required';
import type { AttemptStatus } from "@/lib/types";

const STATUS_TONE: Record<AttemptStatus, "success" | "warning" | "info"> = {
  completed: "success",
  grading: "warning",
  in_progress: "info",
};

export function StudentTestsView() {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [tab, setTab] = React.useState<"available" | "results">("available");

  const testsQ = useTests();
  const attemptsQ = useMyAttempts();
  const start = useStartTest();
  const scope = useStudentProgramScope();
  const [startingId, setStartingId] = React.useState<string | null>(null);

  function onStart(testId: string) {
    setStartingId(testId);
    start.mutate(testId, {
      onSuccess: (res) => router.push(`/tests/attempt/${res.attemptId}`),
      onError: (e) => {
        setStartingId(null);
        toast.error(e instanceof ApiError ? e.message : tc("unknownError"));
      },
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} />
      <ExamTrackSelector />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "available" | "results")} className="mb-4">
        <TabsList>
          <TabsTrigger value="available">{t("available")}</TabsTrigger>
          <TabsTrigger value="results">{t("myResults")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "available" ? (
        scope.needsProgramSelection ? (
          <ExamTrackRequired />
        ) : testsQ.isError ? (
          <ErrorState title={tc("error")} action={<Button variant="outline" size="sm" onClick={() => testsQ.refetch()}>{tc("retry")}</Button>} />
        ) : testsQ.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
          </div>
        ) : (testsQ.data?.length ?? 0) === 0 ? (
          <EmptyState icon={FileText} title={t("noTests")} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {testsQ.data!.map((test) => (
              <Card key={test.id} className="flex flex-col p-5">
                <div className="flex items-center gap-2">
                  <Badge variant="brand">{test.type.toUpperCase()}</Badge>
                  {test.isDemo && <Badge variant="info">{t("demo")}</Badge>}
                  {test.level && <span className="text-xs text-fg-muted">{test.level}</span>}
                </div>
                <h3 className="mt-2 text-base font-semibold text-fg">{test.title}</h3>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span className="flex items-center gap-1">
                    <ListChecks className="size-3.5" />
                    {test.questionCount} {t("questions")}
                  </span>
                  {test.durationMinutes && (
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" />
                      {test.durationMinutes} {t("minutes")}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {test.sections.map((s) => (
                    <span key={s} className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] text-fg-muted">
                      {t(`sections.${s}`)}
                    </span>
                  ))}
                </div>
                <Button
                  className="mt-4"
                  size="sm"
                  loading={start.isPending && startingId === test.id}
                  onClick={() => onStart(test.id)}
                >
                  <Play />
                  {t("start")}
                </Button>
              </Card>
            ))}
          </div>
        )
      ) : scope.needsProgramSelection ? (
        <ExamTrackRequired />
      ) : attemptsQ.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : (attemptsQ.data?.length ?? 0) === 0 ? (
        <EmptyState icon={FileText} title={t("noAttempts")} />
      ) : (
        <div className="space-y-2">
          {attemptsQ.data!.map((a) => (
            <Link key={a.id} href={`/tests/attempt/${a.id}`}>
              <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-border-strong">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{a.testTitle}</p>
                  <p className="text-xs text-fg-subtle">
                    {format.dateTime(new Date(a.startedAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {a.status === "completed" && a.totalScore !== null && (
                    <span className="text-lg font-bold text-fg tabular-nums">{a.totalScore} <span className="text-xs font-normal">{t('practicePoints')}</span></span>
                  )}
                  <Badge variant={STATUS_TONE[a.status]}>{t(`statusLabel.${a.status}`)}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
