"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Flame,
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
import { StatCard } from "@/components/dashboard/stat-card";
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
import type { MockAttemptSummary, StudentSelfProfile } from "@/lib/types";

function calculateStreak(attempts?: MockAttemptSummary[]): number {
  if (typeof window === "undefined") return 1;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const stored = localStorage.getItem("bw_study_streak");
    const lastDate = localStorage.getItem("bw_last_active_date");

    if (lastDate === today && stored) {
      return Math.max(1, parseInt(stored, 10));
    }

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let streak = 1;
    if (lastDate === yesterday && stored) {
      streak = parseInt(stored, 10) + 1;
    } else if (attempts && attempts.length > 0) {
      streak = Math.min(Math.max(1, attempts.length), 7);
    }
    localStorage.setItem("bw_study_streak", String(streak));
    localStorage.setItem("bw_last_active_date", today);
    return streak;
  } catch {
    return 1;
  }
}

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
    if (prediction?.ielts?.cefrLevel) return prediction.ielts.cefrLevel;
    if (prediction?.multilevel?.cefrLevel) return prediction.multilevel.cefrLevel;
    if (prediction?.ielts?.currentBand) return `Band ${prediction.ielts.currentBand}`;
    if (attempts && attempts.length > 0) {
      const scored = attempts.find((a) => a.cefrLevel || a.overallBand);
      if (scored?.cefrLevel) return scored.cefrLevel;
      if (scored?.overallBand) return `Band ${scored.overallBand}`;
    }
    return "—";
  }, [prediction, attempts]);

  const streakDays = React.useMemo(() => calculateStreak(attempts), [attempts]);

  if (meLoading || attemptsLoading || examsLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title={t("greeting", { name: firstName || "..." })} />
        <Skeleton className="h-44 w-full rounded-[12px]" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28 rounded-[12px]" />
          <Skeleton className="h-28 rounded-[12px]" />
          <Skeleton className="h-28 rounded-[12px]" />
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
        <div className="flex items-start gap-3 rounded-[12px] border border-warning-border bg-warning-bg/40 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" />
          <p className="font-medium text-fg">{ts("notApproved")}</p>
        </div>
      )}

      <NamePromptCard />

      {/* 2. BITTA katta "Davom etish" kartasi */}
      {unfinishedAttempt ? (
        <Card className="rounded-[12px] border border-border bg-surface p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="text-sm border-brand text-brand">
                {ts("unfinishedExam")}
              </Badge>
              <h2 className="text-2xl font-bold tracking-tight text-fg">
                {unfinishedAttempt.examTitle ?? ts("unfinishedExam")}
              </h2>
              <p className="text-base text-fg-muted">
                {unfinishedAttempt.currentSkill
                  ? ts("sectionInProgress", { skill: tm(`skills.${unfinishedAttempt.currentSkill}`) })
                  : ts("resumeWhereLeft")}
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="min-h-[44px] shrink-0 bg-brand hover:bg-brand/90 text-brand-fg font-medium px-6 text-base"
            >
              <Link href={`/mock/attempt/${unfinishedAttempt.id}`}>
                <Play className="mr-2 size-4 fill-current" />
                {ts("continueExam")}
              </Link>
            </Button>
          </div>
        </Card>
      ) : recommendedExam ? (
        <Card className="rounded-[12px] border border-border bg-surface p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="text-sm">
                {ts("recommendedExam")}
              </Badge>
              <h2 className="text-2xl font-bold tracking-tight text-fg">
                {recommendedExam.title}
              </h2>
              <p className="text-base text-fg-muted">
                {[recommendedExam.type, recommendedExam.durationMinutes ? ts("minutes", { count: recommendedExam.durationMinutes }) : null].filter(Boolean).join(" • ")}
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="min-h-[44px] shrink-0 bg-brand hover:bg-brand/90 text-brand-fg font-medium px-6 text-base"
            >
              <Link href={`/mock/${recommendedExam.id}`}>
                <Play className="mr-2 size-4 fill-current" />
                {ts("startTest")}
              </Link>
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="rounded-[12px] border border-border bg-surface p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="text-sm">
                {ts("recommendedExam")}
              </Badge>
              <h2 className="text-2xl font-bold tracking-tight text-fg">
                {ts("startFirstTest")}
              </h2>
              <p className="text-base text-fg-muted">{ts("noTestsYet")}</p>
            </div>
            <Button
              asChild
              size="lg"
              className="min-h-[44px] shrink-0 bg-brand hover:bg-brand/90 text-brand-fg font-medium px-6 text-base"
            >
              <Link href="/mock">
                <ArrowRight className="mr-2 size-4" />
                {ts("browseExams")}
              </Link>
            </Button>
          </div>
        </Card>
      )}

      {/* Today: real next actions (homework, words due, latest result); resume lives in the card above */}
      <TodayCard skipResume />

      {/* 3. Pastida 3 ta oddiy raqam */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={ts("estimatedLevel")}
          value={estimatedLevel}
          icon={Award}
          tone="brand"
        />
        <StatCard
          label={ts("completedTests")}
          value={completedCount}
          icon={CheckCircle2}
        />
        <StatCard
          label={ts("dayStreak")}
          value={streakDays}
          hint={ts("daysCount", { count: streakDays })}
          icon={Flame}
        />
      </div>

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
          <Card className="rounded-[12px] border border-border bg-surface p-5">
            <div className="flex flex-col justify-between h-full gap-3">
              <div>
                <p className="text-sm font-medium text-fg">{ts("linkCode")}</p>
                <p className="mt-1 text-sm text-fg-muted">{ts("linkCodeHint")}</p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <code className="rounded-[8px] border border-border bg-surface-elevated px-3 py-2 text-lg font-bold tracking-[0.2em] text-fg tabular-nums">
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
          <Card className="rounded-[12px] border border-border bg-surface p-5">
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
