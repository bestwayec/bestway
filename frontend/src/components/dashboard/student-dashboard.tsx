"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  Award,
  Check,
  CheckCircle2,
  Copy,
  Play,
  Trophy,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { NamePromptCard } from "@/components/dashboard/name-prompt-card";
import { LiveExamPinCard } from "@/components/mock/live-exam-pin-card";
import { StudentAssignmentsWidget } from "@/components/dashboard/StudentAssignmentsWidget";
import { TodayCard } from "@/components/dashboard/today-card";
import { useMe } from "@/hooks/use-me";
import {
  useMockExams,
  useMyMockAttempts,
  useStudentScorePrediction,
} from "@/hooks/use-mock";
import type { StudentSelfProfile } from "@/lib/types";
import { multilevelLevelText } from "@/lib/multilevel-scale";

export function StudentDashboard() {
  const t = useTranslations("dashboard");
  const ts = useTranslations("student");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const tm = useTranslations("mock");

  const { data: me, isLoading: meLoading, refetch } = useMe();
  const { data: attempts, isLoading: attemptsLoading } = useMyMockAttempts();
  const { data: mockExams, isLoading: examsLoading } = useMockExams();
  const { data: prediction } = useStudentScorePrediction();

  const [copied, setCopied] = React.useState(false);

  const firstName = me?.user.name.split(" ")[0] ?? "";
  const profile =
    me?.profile && "linkCode" in me.profile ? (me.profile as StudentSelfProfile) : null;

  async function copyCode() {
    if (!profile?.linkCode) return;
    try {
      await navigator.clipboard.writeText(profile.linkCode);
      setCopied(true);
      toast.success(ts("codeCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tc("unknownError"));
    }
  }

  // Auto-migrate guest placement test result to student profile
  React.useEffect(() => {
    if (typeof window === "undefined" || !me?.user) return;
    const token = localStorage.getItem("bestway_placement_result_token");
    if (!token) return;

    fetch("/api/backend/placement-test/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ result_token: token }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json?.success) {
          localStorage.removeItem("bestway_placement_result_token");
          toast.success(ts("placementLinked"));
        }
      })
      .catch(() => {});
  }, [me?.user]);

  const unfinishedAttempt = React.useMemo(() => {
    return attempts?.find((a) => a.status === "in_progress");
  }, [attempts]);

  const recommendedExam = React.useMemo(() => {
    if (!mockExams || mockExams.length === 0) return null;
    return mockExams[0];
  }, [mockExams]);

  const completedCount = React.useMemo(() => {
    if (!attempts) return 0;
    return attempts.filter((a) => a.status === "completed" || a.status === "grading").length;
  }, [attempts]);

  const estimatedLevel = React.useMemo(() => {
    if (prediction?.ielts?.cefrLevel) return multilevelLevelText(prediction.ielts.cefrLevel, tm("levelBelowB1"));
    if (prediction?.multilevel?.cefrLevel) return multilevelLevelText(prediction.multilevel.cefrLevel, tm("levelBelowB1"));
    if (prediction?.ielts?.currentBand) return `Band ${prediction.ielts.currentBand}`;
    if (attempts && attempts.length > 0) {
      const scored = attempts.find((a) => a.cefrLevel || a.overallBand);
      if (scored?.cefrLevel) return multilevelLevelText(scored.cefrLevel, tm("levelBelowB1"));
      if (scored?.overallBand) return `Band ${scored.overallBand}`;
    }
    return "—";
  }, [prediction, attempts, tm]);

  // The latest released full result (no practice sections): the number students look for first.
  const latestResult = React.useMemo(() => {
    const done = (attempts ?? []).filter((a) => a.status === "completed" && a.flowMode !== "single_skill" && a.flowMode !== "partial_practice" && (a.overallBand != null || a.overallScore != null || a.cefrLevel));
    return done.sort((x, y) => (y.submittedAt ?? y.startedAt).localeCompare(x.submittedAt ?? x.startedAt))[0] ?? null;
  }, [attempts]);
  const latestValue = latestResult
    ? latestResult.examType === "multilevel"
      ? latestResult.overallScore != null ? `${latestResult.overallScore} /75` : multilevelLevelText(latestResult.cefrLevel ?? "", tm("levelBelowB1"))
      : latestResult.overallBand != null ? latestResult.overallBand.toFixed(1) : "—"
    : "—";

  if (meLoading || attemptsLoading || examsLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title={t("greeting", { name: firstName || "..." })} />
        <Skeleton className="h-44 w-full rounded-card" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title={t("greeting", { name: firstName })} />
        <ErrorState
          title={tc("unknownError")}
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* 1. Yuqorida "Salom, {ism}" */}
      <PageHeader title={t("greeting", { name: firstName })} />

      {!profile.isApproved && (
        <div className="flex items-start gap-3 rounded-card border border-warning-border bg-warning-bg/40 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" />
          <p className="font-medium text-fg">{ts("notApproved")}</p>
        </div>
      )}

      <NamePromptCard />

      {/* 2. Today's plan first: continue the open exam, homework, words to review, latest result */}
      <TodayCard />

      {/* Three real numbers: latest result, estimated level, completed tests */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label={ts("latestResult")}
          value={latestValue}
          hint={latestResult ? latestResult.examTitle : ts("noResultYet")}
          href={latestResult ? `/mock/attempt/${latestResult.id}` : undefined}
          icon={Trophy}
        />
        <StatTile label={ts("estimatedLevel")} value={estimatedLevel} icon={Award} />
        <StatTile label={ts("completedTests")} value={completedCount} icon={CheckCircle2} />
      </div>

      {recommendedExam ? (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Badge variant="outline">
                {ts("recommendedExam")}
              </Badge>
              <h2 className="text-lg font-semibold text-fg sm:text-xl">
                {recommendedExam.title}
              </h2>
              <p className="text-base text-fg-muted">
                {[tm(`types.${recommendedExam.type}`), recommendedExam.durationMinutes ? ts("minutes", { count: recommendedExam.durationMinutes }) : null].filter(Boolean).join(" • ")}
              </p>
            </div>
            <Button
              asChild
              variant={unfinishedAttempt ? "outline" : "primary"}
              className="shrink-0 px-5"
            >
              <Link href={`/mock/${recommendedExam.id}`}>
                <Play className="mr-2 size-4 fill-current" />
                {ts("startTest")}
              </Link>
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Badge variant="outline">
                {ts("recommendedExam")}
              </Badge>
              <h2 className="text-lg font-semibold text-fg sm:text-xl">
                {ts("startFirstTest")}
              </h2>
              <p className="text-base text-fg-muted">{ts("noTestsYet")}</p>
            </div>
            <Button
              asChild
              variant={unfinishedAttempt ? "outline" : "primary"}
              className="shrink-0 px-5"
            >
              <Link href="/mock">
                <ArrowRight className="mr-2 size-4" />
                {ts("browseExams")}
              </Link>
            </Button>
          </div>
        </Card>
      )}


      {/* 4. Qolgan bloklar (pastroqqa joylashtirilgan) */}
      <div className="space-y-6 pt-4 border-t border-border">
        <h3 className="text-xl font-bold text-fg">{ts("moreTools")}</h3>

        {/* Live Exam Room PIN */}
        <LiveExamPinCard />

        {/* O'qituvchi topshiriqlari */}
        <div id="assignments" className="scroll-mt-20">
        <StudentAssignmentsWidget />
      </div>

        {/* Guruh, ballar va ota-ona bog'lash kodi */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Bog'lash kodi */}
          <Card className="rounded-card border border-border bg-surface p-5">
            <div className="flex flex-col justify-between h-full gap-3">
              <div>
                <p className="text-sm font-medium text-fg">{ts("linkCode")}</p>
                <p className="mt-1 text-sm text-fg-muted">{ts("linkCodeHint")}</p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <code className="rounded-field border border-border bg-surface-elevated px-3 py-2 text-lg font-bold tracking-[0.2em] text-fg tabular-nums">
                  {profile.linkCode}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="min-h-[44px] min-w-[44px]"
                  onClick={copyCode}
                  aria-label={ts("copyCode")}
                >
                  {copied ? <Check className="text-success" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
          </Card>

          {/* Guruh va ballar */}
          <Card className="rounded-card border border-border bg-surface p-5">
            <div className="flex flex-col justify-between h-full gap-3">
              <div>
                <p className="text-sm font-medium text-fg">{tc("group")}</p>
                <p className="mt-1 text-sm text-fg-muted">
                  {profile.groupName ?? ts("noGroup")}
                </p>
                <p className="mt-2 text-2xl font-bold text-fg tabular-nums">
                  {profile.currentPoints}{" "}
                  <span className="text-sm font-normal text-fg-muted">
                    {ts("myPoints").toLowerCase()}
                  </span>
                </p>
              </div>
              <div className="pt-2">
                <Button asChild variant="outline" className="w-full min-h-[44px]">
                  <Link href="/leaderboard">
                    <Trophy className="mr-2 size-4" />
                    {tn("leaderboard")}
                  </Link>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
