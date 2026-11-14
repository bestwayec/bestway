"use client";

import * as React from "react";
import { ArrowRight, Award, Check, CheckCircle2, Link2, Loader2, Pencil, Play, Send, Unlink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { useMe, useUpdateMe } from "@/hooks/use-me";
import { useMyMockAttempts } from "@/hooks/use-mock";
import {
  useTelegramLinkToken,
  useTelegramStatus,
  useUnlinkTelegram,
} from "@/hooks/use-telegram";
import { ApiError } from "@/lib/api-client";
import { formatPhone, isSafeHref } from "@/lib/utils";
import { ExamTrackSelector } from './exam-track-selector';
import { ScorePredictionCard } from "@/components/dashboard/score-prediction-card";
import { ResultsProgressCard } from "@/components/profile/results-progress-card";
import { isFinished } from "@/lib/results-progress";
import { AttemptScoreSummary } from "@/components/mock/attempt-score-summary";

export function ProfileView() {
  const t = useTranslations("profile");
  const tRecent = useTranslations("profile.recent");
  const tMonths = useTranslations("monthsShort");
  const tMonthsLong = useTranslations("months");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const format = useFormatter();
  const { data: me, isLoading } = useMe();
  const attemptsQ = useMyMockAttempts();
  const attempts = React.useMemo(() => attemptsQ.data ?? [], [attemptsQ.data]);
  // Finished = submitted (#133 rule): attempts the server closed without a submission do not count.
  const completedCount = React.useMemo(() => attempts.filter(isFinished).length, [attempts]);
  const statusQ = useTelegramStatus();
  const linkToken = useTelegramLinkToken();
  const unlink = useUnlinkTelegram();
  const updateMe = useUpdateMe();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);

  function onLink() {
    linkToken.mutate(undefined, {
      onSuccess: (res) => {
        // Backend'dan kelgan URL — sxemani tekshiramiz (javascript: va sh.k. bloklanadi)
        if (!isSafeHref(res.url)) {
          toast.error(tc("unknownError"));
          return;
        }
        window.open(res.url, "_blank", "noopener,noreferrer");
        toast.success(t("telegramHint"));
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
    });
  }

  function onUnlink() {
    unlink.mutate(undefined, {
      onSuccess: () => toast.success(t("telegramNotLinked")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  function startEdit() {
    if (!me || updateMe.isPending) return;
    setName(me.user.name);
    setNameError(null);
    setEditing(true);
  }

  function cancelEdit() {
    if (!me || updateMe.isPending) return;
    setName(me.user.name);
    setNameError(null);
    setEditing(false);
  }

  function saveName() {
    const normalized = name.trim().replace(/\s+/g, " ");
    if (normalized.length < 2 || normalized.length > 100) {
      setNameError(t("nameError"));
      return;
    }
    setNameError(null);
    if (me && normalized === me.user.name) {
      setEditing(false);
      return;
    }
    updateMe.mutate(
      { name: normalized },
      {
        onSuccess: () => {
          toast.success(t("nameUpdated"));
          setEditing(false);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
      },
    );
  }

  if (isLoading || !me) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t("title")} />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const linked = statusQ.data?.linked ?? me.telegramLinked;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("title")} />

      {me.user.role === 'student' && (
        <>
          <ExamTrackSelector />
          <ScorePredictionCard attempts={attempts} />
          <ResultsProgressCard attempts={attempts} loading={attemptsQ.isLoading} />

          {/* Student Stats & Recent Mock Results */}
          <Card className="rounded-[12px] border border-border bg-surface p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
              <div>
                <h3 className="text-lg font-bold text-fg flex items-center gap-2">
                  <Award className="size-5 text-brand" />
                  {t("recentResults")}
                </h3>
                <p className="text-xs text-fg-muted mt-0.5">
                  {t("completedTests")}: <strong className="font-semibold text-fg tabular-nums">{completedCount}</strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-brand/40 text-brand bg-brand-subtle font-semibold px-2.5 py-1">
                  <CheckCircle2 className="size-3.5 mr-1" />
                  {completedCount} {t("completedTests").toLowerCase()}
                </Badge>
                <Button asChild size="sm" variant="outline" className="text-xs h-8">
                  <Link href="/mock">
                    {t("browseExams")}
                    <ArrowRight className="size-3.5 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="mt-4">
              {attemptsQ.isLoading ? (
                <div className="space-y-2.5 py-2">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              ) : attempts.length === 0 ? (
                <div className="text-center py-8">
                  <Award className="mx-auto size-10 text-fg-muted/60 mb-2" />
                  <p className="text-sm font-medium text-fg">{t("noResultsYet")}</p>
                  <p className="text-xs text-fg-muted mt-1 max-w-sm mx-auto">
                    {tRecent("emptyHint")}
                  </p>
                  <Button asChild size="sm" className="mt-4 bg-brand hover:bg-brand-hover text-brand-fg">
                    <Link href="/mock">
                      <Play className="size-3.5 mr-1.5 fill-current" />
                      {t("browseExams")}
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-fg-muted font-medium">
                        <th className="pb-2.5 font-medium">{tRecent("colExam")}</th>
                        <th className="pb-2.5 font-medium">{tRecent("colStatus")}</th>
                        <th className="pb-2.5 font-medium text-center">{tRecent("colResult")}</th>
                        <th className="pb-2.5 font-medium text-right">{tRecent("colAction")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {attempts.slice(0, 5).map((a) => (
                        <tr key={a.id} className="group hover:bg-surface-hover/60 transition-colors">
                          <td className="py-3 pr-3">
                            <p className="font-semibold text-fg text-sm">{a.examTitle ?? tRecent("untitled")}</p>
                            <p className="text-xs text-fg-muted">
                              {a.finishedAt || a.startedAt
                                ? (() => {
                                    // Month names from messages: browsers print "M11" for short Uzbek months.
                                    const d = new Date(a.finishedAt || a.startedAt);
                                    return `${d.getDate()} ${tMonths(String(d.getMonth() + 1))}, ${format.dateTime(d, { hour: "2-digit", minute: "2-digit" })}`;
                                  })()
                                : "—"}{" "}
                              ·{" "}
                              <span className="font-medium">
                                {a.flowMode === "full_test" ? tRecent("kindFull") : tRecent("kindPractice")}
                              </span>
                            </p>
                          </td>
                          <td className="py-3 pr-3 whitespace-nowrap">
                            <Badge
                              variant={
                                a.status === "in_progress"
                                  ? "info"
                                  : !isFinished(a)
                                  ? "neutral"
                                  : a.status === "grading"
                                  ? "warning"
                                  : "success"
                              }
                              className="text-xs"
                            >
                              {a.status === "in_progress"
                                ? tRecent("statusInProgress")
                                : !isFinished(a)
                                ? tRecent("statusClosed")
                                : a.status === "grading"
                                ? tRecent("statusChecking")
                                : tRecent("statusCompleted")}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <AttemptScoreSummary attempt={a} />
                          </td>
                          <td className="py-3 pl-3 text-right whitespace-nowrap">
                            <Button asChild size="sm" variant="outline" className="h-8 px-2.5 text-xs">
                              <Link
                                href={`/mock/attempt/${a.id}${
                                  a.status !== "in_progress" ? "#assessment-feedback" : ""
                                }`}
                              >
                                {a.status === "in_progress" ? t("continueExam") : t("details")}
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("account")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar name={me.user.name} size="lg" />
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-2">
                <Field label={tc("name")} error={nameError ?? undefined} htmlFor="profile-name">
                  <Input
                    id="profile-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    maxLength={100}
                    autoFocus
                    disabled={updateMe.isPending}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button size="sm" loading={updateMe.isPending} onClick={saveName}>
                    {tc("save")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={cancelEdit}
                    disabled={updateMe.isPending}
                  >
                    {tc("cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold text-fg">{me.user.name}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={startEdit}
                  aria-label={t("editName")}
                  title={t("editName")}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
            )}
            {!editing && (
              <>
                <p className="text-sm text-fg-muted">{formatPhone(me.user.phone)}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant="brand">{tr(me.user.role)}</Badge>
                  <span className="text-xs text-fg-subtle">
                    {(() => {
                      const d = new Date(me.user.createdAt);
                      return `${d.getDate()} ${tMonthsLong(String(d.getMonth() + 1))} ${d.getFullYear()}`;
                    })()}
                  </span>
                </div>
              </>
            )}
            {editing && (
              <p className="mt-2 text-sm text-fg-muted">{formatPhone(me.user.phone)}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Send className="size-4 text-info" />
            {t("telegram")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-fg-muted">{t("telegramHint")}</p>
          {linked ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-success">
                <Check className="size-4" />
                {t("telegramLinked")}
              </span>
              <Button variant="outline" size="sm" loading={unlink.isPending} onClick={onUnlink}>
                <Unlink />
                {t("unlinkTelegram")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-fg-muted">{t("telegramNotLinked")}</span>
              <Button
                size="sm"
                loading={linkToken.isPending}
                onClick={onLink}
                className="min-h-[44px] bg-brand hover:bg-brand-hover text-brand-fg font-medium"
              >
                {linkToken.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
                {t("linkTelegram")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
