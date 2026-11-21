"use client";

import * as React from "react";
import {
  BookOpen,
  CalendarCheck,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  Printer,
  Trophy,
  Users,
  Wallet,
  Send,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { LiveExamRoomPanel } from "@/components/teacher/live-exam-room-panel";
import { useMe } from "@/hooks/use-me";
import { printGroupAnalyticsPdf, useGroupAnalytics, useGroups } from "@/hooks/use-groups";
import { useDebtors, usePayments } from "@/hooks/use-payments";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { StatTile } from "@/components/ui/stat-tile";
import type { GroupAttendanceSummaryResponse, TeacherGroupSummary, TeacherSelfProfile } from "@/lib/types";

/** Obsidian + zumrad shisha (glass) kartasi */
const GLASS = "relative overflow-hidden rounded-card border border-border bg-surface";

function GlowCorner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("hidden", className)}
    />
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  loading?: boolean;
  tone?: "brand" | "info" | "warning" | "success";
}) {
  return <StatTile label={label} value={value} hint={hint} loading={loading} icon={icon} />;
}

function GroupPerformanceCard({ group }: { group: TeacherGroupSummary }) {
  const t = useTranslations("teacherDash");
  const tc = useTranslations("common");
  const analyticsQ = useGroupAnalytics(group.id);
  const [busy, setBusy] = React.useState(false);
  const analytics = analyticsQ.data;

  const top = React.useMemo(
    () =>
      (analytics?.students ?? [])
        .filter((s) => s.overallBand !== null)
        .sort((a, b) => (b.overallBand ?? 0) - (a.overallBand ?? 0))
        .slice(0, 3),
    [analytics],
  );

  async function downloadExcel() {
    setBusy(true);
    try {
      const { blob, filename } = await api.downloadBlob(`/groups/${group.id}/export/excel`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `${group.name}_results.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("exportOk"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("exportError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(GLASS, "p-4")}>
      <GlowCorner className="-left-12 -top-14" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <Link href={`/attendance?group=${group.id}`} className="group flex min-w-0 items-center gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand-subtle-fg">
            <BookOpen className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-fg group-hover:text-brand">{group.name}</span>
            <span className="flex items-center gap-1 text-xs text-fg-muted">
              <Users className="size-3.5" />
              {group.studentsCount}
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => void downloadExcel()}>
            <FileSpreadsheet />
            {t("excel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!analytics}
            onClick={() => analytics && printGroupAnalyticsPdf(analytics)}
          >
            <Printer />
            {t("pdf")}
          </Button>
        </div>
      </div>

      <div className="relative mt-4 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex gap-3">
          <div className="rounded-xl border border-border/60 bg-bg/40 px-3 py-2">
            <p className="text-[11px] text-fg-muted">{t("avgScore")}</p>
            {analyticsQ.isLoading ? (
              <Skeleton className="mt-1 h-6 w-10" />
            ) : (
              <p className="text-lg font-bold tabular-nums text-brand">{analytics?.averageBandScore ?? "—"}</p>
            )}
          </div>
          <div className="rounded-xl border border-border/60 bg-bg/40 px-3 py-2">
            <p className="text-[11px] text-fg-muted">{t("attempts")}</p>
            {analyticsQ.isLoading ? (
              <Skeleton className="mt-1 h-6 w-10" />
            ) : (
              <p className="text-lg font-bold tabular-nums text-fg">{analytics?.totalCompletedAttempts ?? "—"}</p>
            )}
          </div>
        </div>

        <div className="min-w-0">
          {analyticsQ.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : analyticsQ.isError ? (
            <p className="text-xs text-danger">{tc("unknownError")}</p>
          ) : top.length === 0 ? (
            <p className="text-xs text-fg-subtle">{t("noResults")}</p>
          ) : (
            <ul className="space-y-1">
              {top.map((s, i) => (
                <li key={s.studentId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Trophy className={cn("size-3.5 shrink-0", i === 0 ? "text-warning" : "text-fg-subtle")} />
                    <span className="truncate text-fg">{s.name}</span>
                  </span>
                  <Badge variant="brand">{s.overallBand}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentsWidget() {
  const t = useTranslations("teacherDash");
  const now = React.useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const paymentsQ = usePayments(year);
  const debtorsQ = useDebtors(year, month);

  const failed = paymentsQ.isError && debtorsQ.isError;
  const monthRows = (paymentsQ.data ?? []).filter((r) => r.month === month);
  const paid = monthRows.filter((r) => r.state === "paid").length;
  const debtors = debtorsQ.data?.length ?? monthRows.filter((r) => r.state === "unpaid" || r.state === "partial").length;
  const total = Math.max(monthRows.length, paid + debtors);
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const loading = paymentsQ.isLoading || debtorsQ.isLoading;

  return (
    <div className={cn(GLASS, "p-4")}>
      <GlowCorner />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Wallet className="size-4 text-brand" />
            {t("paymentsTitle")}
          </h2>
          <Link href="/payments" className="text-xs text-brand hover:underline">
            {t("openPayments")}
          </Link>
        </div>

        {loading ? (
          <Skeleton className="mt-4 h-16 w-full" />
        ) : failed ? (
          <p className="mt-4 text-xs text-fg-subtle">{t("paymentsUnavailable")}</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-success/25 bg-success-bg px-3 py-2">
                <p className="text-[11px] text-success">{t("paid")}</p>
                <p className="text-xl font-bold tabular-nums text-success">{paid}</p>
              </div>
              <div className="rounded-xl border border-danger/25 bg-danger-bg px-3 py-2">
                <p className="text-[11px] text-danger">{t("debtors")}</p>
                <p className="text-xl font-bold tabular-nums text-danger">{debtors}</p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-subtle">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-accent" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-fg-muted">{t("paidOf", { paid, total })}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function TeacherDashboard() {
  const t = useTranslations("dashboard");
  const td = useTranslations("teacherDash");
  const ta = useTranslations("attendance");
  const tc = useTranslations("common");
  const ws = useTranslations("workspace");
  const { data: me, isLoading, refetch } = useMe();
  const [isSendingDigest, setIsSendingDigest] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [groupLimit, setGroupLimit] = React.useState(6);
  const pinRef = React.useRef<HTMLDivElement>(null);

  const handleSendParentDigest = async () => {
    setIsSendingDigest(true);
    try {
      const res = await api.post<{ message: string; sentCount: number }>("/v1/parents/send-weekly-digest", {});
      toast.success(res.message || td("digestSent"));
    } catch (err: unknown) {
      toast.error(err instanceof Error && err.message ? err.message : td("digestFailed"));
    } finally {
      setIsSendingDigest(false);
    }
  };

  const firstName = me?.user.name.split(" ")[0] ?? "";
  const profile = me?.profile && "groups" in me.profile ? (me.profile as TeacherSelfProfile) : null;
  // Shares the ["groups"] cache entry with the live-room panel and classroom
  // views (the server lists active groups by default), so the dashboard issues
  // one /groups request instead of two. The cache is cleared on sign-out.
  const groupsQ = useGroups();
  const groups: TeacherGroupSummary[] = profile ? groupsQ.data ?? [] : [];
  const totalStudents = groups.reduce((sum, g) => sum + g.studentsCount, 0);

  const gradingQ = useQuery({
    queryKey: ["teacher-dashboard-review", me?.user.id],
    enabled: Boolean(profile),
    queryFn: () => api.get<{ total: number; items: Array<{
      id: string; attemptId?: string; studentName: string; examTitle: string; skill: "writing" | "speaking";
    }> }>("/teacher/submissions", { limit: 5, withTotal: 1, status: "pending", summary: 1 }),
    staleTime: 30_000,
  });
  const pending = gradingQ.data?.total;
  const filteredGroups = groups.filter((group) =>
    group.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  const attendanceQ = useQuery({
    queryKey: ["attendance", "teacher-today", me?.user.id],
    enabled: Boolean(profile),
    queryFn: () => api.get<Pick<GroupAttendanceSummaryResponse, "presentCount" | "lateCount" | "absentCount">>("/attendance/teacher-today"),
    retry: false,
    staleTime: 30_000,
  });
  const attended = (attendanceQ.data?.presentCount ?? 0) + (attendanceQ.data?.lateCount ?? 0);
  const marked = attended + (attendanceQ.data?.absentCount ?? 0);
  const attendanceFailed = attendanceQ.isError;
  const attendancePct = !attendanceFailed && marked > 0 ? Math.round((attended / marked) * 100) : null;

  if (!isLoading && !profile) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title={t("greeting", { name: firstName })} />
        <ErrorState title={tc("unknownError")} action={<Button variant="outline" onClick={() => void refetch()}>{tc("retry")}</Button>} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("greeting", { name: firstName })} />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={BookOpen} label={td("kpiGroups")} value={groupsQ.isSuccess ? groups.length : "—"} loading={isLoading || groupsQ.isLoading} />
        <KpiCard icon={Users} label={td("kpiStudents")} value={groupsQ.isSuccess ? totalStudents : "—"} loading={isLoading || groupsQ.isLoading} tone="info" />
        <KpiCard
          icon={CalendarCheck}
          label={td("kpiAttendance")}
          value={attendancePct === null ? "—" : `${attendancePct}%`}
          hint={attendanceFailed ? tc("unknownError") : attendancePct === null ? td("kpiAttendanceEmpty") : `${attended} / ${marked}`}
          loading={isLoading || attendanceQ.isLoading}
          tone="success"
        />
        <KpiCard
          icon={ClipboardCheck}
          label={td("kpiReview")}
          value={gradingQ.isError ? "—" : pending ?? "—"}
          hint={gradingQ.isError ? tc("unknownError") : td("kpiReviewHint")}
          loading={gradingQ.isLoading}
          tone="warning"
        />
      </div>

      {/* Quick actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-medium text-fg-muted">{td("quickActions")}</span>
        <Link href="/attendance" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <CalendarCheck />
          {td("takeAttendance")}
        </Link>
        <Link href="/groups" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Users />
          {td("manageGroups")}
        </Link>
        <Button type="button" size="sm" variant="outline" onClick={handleSendParentDigest} loading={isSendingDigest}>
          {!isSendingDigest && <Send aria-hidden />}
          {td("parentDigest")}
        </Button>
      </div>

      {/* Compact live exam */}
      <div ref={pinRef} className="mt-4 scroll-mt-20">
        <LiveExamRoomPanel compact />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Groups performance */}
        <section className="space-y-3 lg:col-span-2">
          <h2 className="text-sm font-semibold text-fg-muted">{td("groupPerformance")}</h2>
          {groups.length > 0 && <label className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 focus-within:ring-2 focus-within:ring-brand">
            <Search className="size-4 text-fg-muted" aria-hidden />
            <span className="sr-only">{ws("searchGroups")}</span>
            <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setGroupLimit(6); }}
              placeholder={ws("searchGroups")} className="min-h-11 w-full min-w-0 bg-transparent text-fg outline-none" />
          </label>}
          {groupsQ.isError ? <ErrorState title={tc("unknownError")}
            action={<Button variant="outline" onClick={() => void groupsQ.refetch()}>{tc("retry")}</Button>} /> : isLoading || groupsQ.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-36" />
              ))}
            </div>
          ) : filteredGroups.length === 0 ? (
            <EmptyState icon={BookOpen} title={search.trim() ? ws("noMatches") : ta("noGroups")} />
          ) : (
            filteredGroups.slice(0, groupLimit).map((g) => <GroupPerformanceCard key={g.id} group={g} />)
          )}
          {filteredGroups.length > groupLimit && <Button variant="outline" onClick={() => setGroupLimit(groupLimit + 6)}>
            {tc("next")} · {groupLimit} / {filteredGroups.length}
          </Button>}
        </section>

        {/* Right column */}
        <aside className="space-y-4">
          <section className={cn(GLASS, "p-4")} aria-labelledby="review-queue-title">
            <h2 id="review-queue-title" className="flex items-center justify-between gap-2 text-base font-semibold text-fg">
              <span className="flex items-center gap-2"><ClipboardCheck className="size-4 text-fg-subtle" aria-hidden />{td("reviewQueue")}</span>
              {!gradingQ.isError && Boolean(pending) && <span className="rounded-full bg-warning-bg px-2 text-sm font-semibold tabular-nums text-warning">{pending}</span>}
            </h2>
            {gradingQ.isLoading ? (
              <div className="mt-3 space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            ) : gradingQ.isError ? (
              <p className="mt-3 text-sm text-danger" role="alert">{tc("unknownError")}{" "}
                <button type="button" className="min-h-11 underline" onClick={() => void gradingQ.refetch()}>{tc("retry")}</button>
              </p>
            ) : !pending ? (
              <p className="mt-3 text-sm text-fg-muted">{td("reviewEmpty")}</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {(gradingQ.data?.items ?? []).map((a) => (
                  <li key={a.id}>
                    <Link href={`/mock/attempt/${a.attemptId ?? a.id.slice(0, a.id.lastIndexOf("_"))}`} className="flex min-h-12 items-center gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-fg">{a.studentName ?? "—"}</span>
                        <span className="block truncate text-sm text-fg-muted">{a.examTitle}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/mock" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3 w-full justify-between")}>
              {td("reviewCta")}
              <ChevronRight aria-hidden />
            </Link>
          </section>
          <PaymentsWidget />

        </aside>
      </div>
    </div>
  );
}
