"use client";

import * as React from "react";
import { BarChart3, CalendarCheck, ChevronRight, ClipboardList, Clock, ListChecks, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { useMe } from "@/hooks/use-me";
import { formatDateTime, useWorkspaceOverview, type WorkspaceOverview } from "@/lib/teacher-workspace";
import { cn } from "@/lib/utils";

const ACTIONS = [
  { key: "attendance", href: "/teacher/attendance", icon: CalendarCheck, primary: true },
  { key: "assign", href: "/teacher/assign", icon: ClipboardList, primary: true },
  { key: "groups", href: "/groups", icon: Users, primary: false },
  { key: "results", href: "/teacher/results", icon: BarChart3, primary: false },
] as const;


export function TeacherHome() {
  const t = useTranslations("tw");
  const { data: me } = useMe();
  const q = useWorkspaceOverview();
  const firstName = me?.user.name?.split(" ")[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={firstName ? t("home.hello", { name: firstName }) : t("home.title")} description={t("home.subtitle")} />

      {/* The four primary actions: large, always first, no nesting */}
      <nav aria-label={t("home.actionsLabel")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ACTIONS.map(({ key, href, icon: Icon, primary }) => (
          <Link
            key={key}
            href={href}
            data-testid={`tw-action-${key}`}
            className={cn(
              "group flex min-h-[112px] flex-col justify-between rounded-card border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
              primary ? "border-brand/40 bg-brand-subtle hover:bg-brand/15" : "border-border bg-surface hover:bg-surface-hover",
            )}
          >
            <Icon className={cn("size-7", primary ? "text-brand" : "text-fg-muted")} aria-hidden />
            <span className="mt-3 flex items-center justify-between gap-2 text-base font-semibold leading-tight text-fg">
              {t(`home.action.${key}`)}
              <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        ))}
      </nav>

      {q.isError ? (
        <ErrorState title={t("common.loadError")} action={<Button variant="outline" size="sm" onClick={() => q.refetch()}>{t("common.retry")}</Button>} />
      ) : q.isLoading || !q.data ? (
        <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : (
        <Overview data={q.data} />
      )}
    </div>
  );
}

function Overview({ data }: { data: WorkspaceOverview }) {
  const t = useTranslations("tw");
  const today = data.groups.filter((g) => g.scheduledToday);
  const stats = [
    { label: t("home.stat.todayGroups"), value: data.todayGroups },
    { label: t("home.stat.presentToday"), value: data.today.present + data.today.late },
    { label: t("home.stat.activeHomework"), value: data.activeHomework },
    { label: t("home.stat.awaitingReview"), value: data.awaitingReview, warn: data.awaitingReview > 0 },
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="tw-overview-stats">
        {stats.map((s) => (
          <div key={s.label} className="rounded-card border border-border bg-surface p-3">
            <dt className="text-xs font-medium text-fg-muted">{s.label}</dt>
            <dd className={cn("mt-1 text-2xl font-bold tabular-nums", s.warn ? "text-warning" : "text-fg")}>{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-fg"><CalendarCheck className="size-4 text-brand" />{t("home.todayTitle")}</h2>
          {data.groups.length === 0 ? (
            <EmptyState icon={Users} title={t("home.noGroups")} description={t("home.noGroupsHint")} />
          ) : today.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("home.noLessonsToday")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {today.map((g) => {
                const done = g.attendance.marked > 0;
                return (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg">{g.name}</p>
                      <p className="flex items-center gap-1 text-xs text-fg-muted">
                        <Clock className="size-3" />
                        {g.todaySlots.map((s) => `${s.startTime ?? ""}–${s.endTime ?? ""}`).join(", ")} · {t("home.students", { n: g.studentCount })}
                      </p>
                    </div>
                    {done ? (
                      <Badge variant="success">{t("home.marked", { present: g.attendance.present + g.attendance.late, total: g.studentCount })}</Badge>
                    ) : (
                      <Button asChild size="sm"><Link href={`/teacher/attendance?group=${g.id}`}>{t("home.takeNow")}</Link></Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-fg"><ListChecks className="size-4 text-brand" />{t("home.deadlinesTitle")}</h2>
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("home.noDeadlines")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.upcoming.map((u) => (
                <li key={`${u.kind}-${u.id}`}>
                  <Link href={`/teacher/results?kind=${u.kind}&id=${u.id}`} className="flex items-center justify-between gap-2 rounded-md py-2.5 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg">{u.title}</span>
                      <span className="block text-xs text-fg-muted">{u.groupName} · {t(`kind.${u.kind}`)}</span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-fg-muted">{formatDateTime(u.deadline)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <details className="rounded-card border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium text-fg-muted">{t("home.more")}</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/attendance?view=month">{t("home.monthGrid")}</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/payments">{t("home.payments")}</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/vocabulary">{t("home.vocabulary")}</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/exam-builder">{t("home.examBuilder")}</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/teacher/insights">{t("home.insights")}</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/teacher/cohorts">{t("home.cohorts")}</Link></Button>
        </div>
      </details>
    </div>
  );
}
