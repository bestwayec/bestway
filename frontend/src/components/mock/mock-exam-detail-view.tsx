"use client";

import * as React from "react";
import {
  ArrowLeft,
  BookOpenText,
  Clock,
  FileQuestion,
  Headphones,
  Lock,
  Mic,
  PenLine,
  Play,
  RefreshCw,
  ShoppingCart,
  Timer,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import {
  useMockExam,
  useMyMockAttempts,
  usePurchaseMock,
  useStartMock,
} from "@/hooks/use-mock";
import type { MockAttemptMode, MockSkill } from "@/lib/types";
import { displayTotalMinutes } from "@/lib/mock-timing";
import { formatMoney } from "@/lib/utils";

const SKILL_ICON: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

export function MockExamDetailView({ examId }: { examId: string }) {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const router = useRouter();
  const examQ = useMockExam(examId);
  const attemptsQ = useMyMockAttempts();
  const start = useStartMock();
  const purchase = usePurchaseMock();

  const exam = examQ.data;
  const attempts = (attemptsQ.data ?? []).filter((a) => a.examId === examId);
  const inProgress = attempts.find((a) => a.status === "in_progress");

  function onStart(mode: MockAttemptMode) {
    start.mutate(
      { examId, mode },
      {
        onSuccess: (res) => router.push(`/mock/attempt/${res.attemptId}`),
        onError: (e) => toast.error(e.message || tc("unknownError")),
      },
    );
  }

  function onBuy() {
    purchase.mutate(examId, {
      onSuccess: () => toast.success(t("requestSent")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  if (examQ.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => examQ.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (examQ.isLoading || !exam) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const locked = exam.access === "locked";
  const pending = exam.access === "pending";

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/mock"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        {t("title")}
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">{t(`types.${exam.type}`)}</Badge>
          {exam.isDemo && <Badge variant="neutral">{t("demo")}</Badge>}
          {exam.level && <span className="text-sm text-fg-subtle">{exam.level}</span>}
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-fg">{exam.title}</h1>
        {exam.description && <p className="mt-2 text-fg-muted">{exam.description}</p>}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-fg-muted">
          <span className="flex items-center gap-1.5">
            <FileQuestion className="size-4" />
            {exam.questionCount} {t("questions")}
          </span>
          {displayTotalMinutes(exam.sections) != null && (
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" />
              {displayTotalMinutes(exam.sections)} {t("minutes")}
            </span>
          )}
        </div>

        {/* Bo'limlar */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {exam.sections.map((sec) => {
            const Icon = SKILL_ICON[sec.skill];
            const qCount = sec.groups.reduce((g, grp) => g + grp.questions.length, 0);
            return (
              <div
                key={sec.id}
                className="flex items-center gap-3 rounded-[10px] border border-border bg-bg-subtle px-3 py-2.5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-subtle-fg">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{t(`skills.${sec.skill}`)}</p>
                  <p className="text-xs text-fg-muted">
                    {qCount} {t("questions")}
                    {sec.skill !== "listening" && sec.durationMinutes
                      ? ` · ${sec.durationMinutes} ${t("minutes")}`
                      : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Boshlash / sotib olish */}
        <div className="mt-6 border-t border-border pt-5">
          {locked ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Lock className="size-4" />
                {exam.price > 0 && (
                  <span className="font-semibold text-fg tabular-nums">
                    {formatMoney(exam.price)} {tc("sum")}
                  </span>
                )}
              </p>
              <Button loading={purchase.isPending} onClick={onBuy}>
                <ShoppingCart />
                {t("buy")}
              </Button>
            </div>
          ) : pending ? (
            <Badge variant="warning" className="w-full justify-center py-2">
              <Clock /> {t("pending")}
            </Badge>
          ) : inProgress ? (
            <Button
              className="w-full"
              loading={start.isPending}
              onClick={() => router.push(`/mock/attempt/${inProgress.id}`)}
            >
              <RefreshCw />
              {t("resume")}
            </Button>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1"
                variant="outline"
                loading={start.isPending && start.variables?.mode === "practice"}
                onClick={() => onStart("practice")}
              >
                <Play className="fill-current" />
                {t("practice")}
              </Button>
              <Button
                className="flex-1"
                loading={start.isPending && start.variables?.mode === "timed"}
                onClick={() => onStart("timed")}
              >
                <Timer />
                {t("timed")}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Oldingi urinishlar */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t("myResults")}</h2>
        {attemptsQ.isLoading ? (
          <Skeleton className="h-16" />
        ) : attempts.filter((a) => a.status !== "in_progress").length === 0 ? (
          <EmptyState icon={FileQuestion} title={t("noAttempts")} />
        ) : (
          <div className="space-y-2">
            {attempts
              .filter((a) => a.status !== "in_progress")
              .map((a) => (
                <Link key={a.id} href={`/mock/attempt/${a.id}#assessment-feedback`}>
                  <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-surface-hover">
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={a.status === "completed" ? "success" : "warning"}
                      >
                        {t(`status.${a.status}`)}
                      </Badge>
                      <span className="text-sm text-fg-muted">
                        {new Date(a.startedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-right">
                      {a.overallBand != null ? (
                        <span className="font-bold text-brand tabular-nums">
                          {t("overallBand")}: {a.overallBand}
                        </span>
                      ) : a.cefrLevel ? (
                        <span className="font-bold text-brand">{a.cefrLevel}</span>
                      ) : (
                        <span className="text-sm text-fg-subtle">—</span>
                      )}
                    </div>
                  </Card>
                </Link>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
