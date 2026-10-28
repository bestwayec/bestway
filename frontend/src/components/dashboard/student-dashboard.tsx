"use client";

import * as React from "react";
import { ExamTrackSelector } from '@/components/profile/exam-track-selector';
import { ExamTrackDashboard } from '@/components/mock/exam-track-dashboard';
import { LiveExamPinCard } from "@/components/mock/live-exam-pin-card";
import { ScorePredictionCard } from "@/components/dashboard/score-prediction-card";
import { AdaptiveStudyPlan } from "@/components/dashboard/adaptive-study-plan";
import { MistakeVault } from "@/components/dashboard/mistake-vault";
import { StudentAssignmentsWidget } from "@/components/dashboard/StudentAssignmentsWidget";
import { AlertCircle, BookOpen, Check, Copy, Star, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { useMe } from "@/hooks/use-me";
import type { StudentSelfProfile } from "@/lib/types";

export function StudentDashboard() {
  const t = useTranslations("dashboard");
  const ts = useTranslations("student");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const { data: me, isLoading } = useMe();
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
          toast.success("🎉 Express Placement Test natijangiz profilingizga bog'landi!");
        }
      })
      .catch(() => {});
  }, [me?.user]);

  if (isLoading || !profile) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={t("greeting", { name: firstName })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("greeting", { name: firstName })} />

      <LiveExamPinCard />
      <div className="mt-4 mb-4"><StudentAssignmentsWidget /></div>
      <ScorePredictionCard />
      <AdaptiveStudyPlan className="mt-4 mb-4" />
      <MistakeVault className="mt-4 mb-4" />
      <ExamTrackSelector />
      <ExamTrackDashboard />

      {!profile.isApproved && (
        <div className="mb-4 flex items-start gap-3 rounded-[12px] border border-warning-border bg-warning-bg/50 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-fg">{ts("notApproved")}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label={ts("myPoints")} value={profile.currentPoints} icon={Star} tone="brand" />
        <StatCard
          label={tc("group")}
          value={profile.groupName ?? "—"}
          hint={profile.groupName ? undefined : ts("noGroup")}
          icon={BookOpen}
        />
      </div>

      {/* Bog'lash kodi — ota-ona shu kod bilan bog'lanadi */}
      <Card className="mt-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-fg">{ts("linkCode")}</p>
            <p className="mt-1 max-w-md text-sm text-fg-muted">{ts("linkCodeHint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="rounded-[8px] border border-border bg-bg-subtle px-3 py-2 text-lg font-bold tracking-[0.2em] text-fg tabular-nums">
              {profile.linkCode}
            </code>
            <Button variant="outline" size="icon" onClick={copyCode} aria-label={ts("copyCode")}>
              {copied ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <Button asChild variant="outline">
          <Link href="/leaderboard">
            <Trophy />
            {tn("leaderboard")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
