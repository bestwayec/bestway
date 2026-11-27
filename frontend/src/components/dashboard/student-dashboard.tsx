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
  Play,
  Plus,
  Trophy,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { NamePromptCard } from "@/components/dashboard/name-prompt-card";
import { LiveExamPinCard } from "@/components/mock/live-exam-pin-card";
import { StudentAssignmentsWidget } from "@/components/dashboard/StudentAssignmentsWidget";
import { TodayCard } from "@/components/dashboard/today-card";
import { useGroups } from "@/hooks/use-groups";
import { useMe } from "@/hooks/use-me";
import { apiClient } from "@/lib/api-client";
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
  const tu = useTranslations("uiText");
  const inviteText = useTranslations("classroomInvitation");
  const queryClient = useQueryClient();

  const { data: me, isLoading: meLoading, refetch } = useMe();
  const { data: myGroups = [] } = useGroups();
  const { data: attempts, isError: attemptsFailed } = useMyMockAttempts();
  const { data: mockExams, isPending: examsLoading, isError: examsFailed, refetch: refetchExams } = useMockExams();
  const { data: prediction } = useStudentScorePrediction();

  const firstName = me?.user.name.split(" ")[0] ?? "";
  const profile =
    me?.profile && "linkCode" in me.profile ? (me.profile as StudentSelfProfile) : null;

  const [copied, setCopied] = React.useState(false);
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [joinCode, setJoinCode] = React.useState("");
  const [joinPreview, setJoinPreview] = React.useState<{ groupName: string; requiresApproval: boolean } | null>(null);
  const [joinBusy, setJoinBusy] = React.useState(false);

  const activeGroups = React.useMemo(
    () => myGroups.filter((g) => !g.archived),
    [myGroups],
  );
  const headerGroupSummary = React.useMemo(() => {
    if (activeGroups.length > 0) return activeGroups.map((g) => g.name).join(" · ");
    return profile?.groupName ?? ts("noGroup");
  }, [activeGroups, profile?.groupName, ts]);

  async function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      toast.error(tu("assignments.codeRequired"));
      return;
    }
    setJoinBusy(true);
    try {
      if (code.startsWith("BW5-")) {
        if (!joinPreview) {
          setJoinPreview(
            await apiClient.post<{ groupName: string; requiresApproval: boolean }>(
              "/classroom-invitations/join",
              { code, preview: true },
            ),
          );
          return;
        }
        const joined = await apiClient.post<{ groupName: string; status: "active" | "pending" | "rejected" }>(
          "/classroom-invitations/join",
          { code, preview: false },
        );
        if (joined.status === "active") toast.success(tu("assignments.joined", { name: joined.groupName }));
        else toast.info(inviteText(joined.status === "pending" ? "pendingStudent" : "rejectedStudent", { name: joined.groupName }));
      } else {
        const legacy = await apiClient.post<{ cohort_name: string }>("/student/join-cohort", { invite_code: code });
        toast.success(tu("assignments.joined", { name: legacy.cohort_name }));
      }
      setJoinPreview(null);
      setJoinCode("");
      setJoinOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["groups"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["student", "my-assignments"] }),
      ]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tu("assignments.codeInvalid"));
    } finally {
      setJoinBusy(false);
    }
  }

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
    if (!attempts) return "—";
    return attempts.filter((a) => a.status === "completed").length;
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

  if (meLoading) {
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
      <PageHeader title={t("greeting", { name: firstName })} description={headerGroupSummary}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={() => setJoinOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {ts("joinGroup")}
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/vocabulary"><BookOpen aria-hidden />{tn("vocabulary")}</Link>
            </Button>
          </div>
        }
      />

      {!profile.isApproved && (
        <div className="flex items-start gap-3 rounded-card border border-warning-border bg-warning-bg/40 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" />
          <p className="font-medium text-fg">{ts("notApproved")}</p>
        </div>
      )}

      {activeGroups.length > 0 && (
        <Card className="rounded-card border border-border bg-surface p-4" data-testid="student-active-groups">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-brand" aria-hidden />
              <h2 className="text-sm font-semibold text-fg">{ts("activeGroups")}</h2>
              <Badge variant="neutral">{ts("groupsSummary", { count: activeGroups.length })}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedGroupId(null)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedGroupId === null
                    ? "bg-brand text-brand-fg"
                    : "border border-border bg-bg-subtle text-fg-muted hover:text-fg"
                }`}
              >
                {ts("allGroupsFilter")}
              </button>
              {activeGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGroupId((cur) => (cur === g.id ? null : g.id))}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    selectedGroupId === g.id
                      ? "bg-brand text-brand-fg"
                      : "border border-border bg-bg-subtle text-fg-muted hover:text-fg"
                  }`}
                >
                  {g.name}
                  {g.teacherName ? ` · ${g.teacherName}` : ""}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      <NamePromptCard />

      {/* 2. Today's plan first: continue the open exam, homework, words to review, latest result */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3"><TodayCard /></div>
        <div id="assignments" className="min-w-0 scroll-mt-20 lg:col-span-2">
          <StudentAssignmentsWidget
            groupName={activeGroups[0]?.name ?? profile.groupName ?? null}
            cohortFilterId={selectedGroupId}
          />
        </div>
      </div>

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
        <StatTile label={ts("completedTests")} value={attemptsFailed ? "—" : completedCount}
          hint={attemptsFailed ? tc("unknownError") : undefined} icon={CheckCircle2} />
      </div>

      {examsLoading ? <Skeleton className="h-32 rounded-card" /> : examsFailed ? (
        <ErrorState title={tc("unknownError")} action={<Button variant="outline" onClick={() => void refetchExams()}>{tc("retry")}</Button>} />
      ) : recommendedExam ? (
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
                <p className="flex items-center gap-2 text-sm font-medium text-fg"><Users className="size-4" aria-hidden />{tc("group")}</p>
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

      <Dialog open={joinOpen} onOpenChange={(next) => { setJoinOpen(next); if (!next) setJoinPreview(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tu("assignments.joinGroup")}</DialogTitle>
            <DialogDescription>{tu("assignments.joinHint")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleJoinSubmit(e)} className="space-y-4">
            <Input
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase());
                setJoinPreview(null);
              }}
              placeholder={tu("assignments.codePlaceholder")}
              autoFocus
            />
            {joinPreview && (
              <div className="rounded-control border border-border bg-bg-subtle p-3 text-xs text-fg">
                <p className="font-semibold">{joinPreview.groupName}</p>
                <p className="mt-0.5 text-fg-muted">
                  {joinPreview.requiresApproval ? inviteText("approvalNeeded") : inviteText("instantJoin")}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setJoinOpen(false); setJoinPreview(null); }}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={joinBusy}>
                {joinPreview ? inviteText("confirmJoin") : tu("assignments.joinButton")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
