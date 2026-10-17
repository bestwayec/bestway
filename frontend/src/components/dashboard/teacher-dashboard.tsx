"use client";

import { BookOpen, CalendarCheck, ChevronRight, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { LiveExamRoomPanel } from "@/components/teacher/live-exam-room-panel";
import { useMe } from "@/hooks/use-me";
import type { TeacherSelfProfile } from "@/lib/types";

export function TeacherDashboard() {
  const t = useTranslations("dashboard");
  const ta = useTranslations("attendance");
  const tc = useTranslations("common");
  const { data: me, isLoading } = useMe();

  const firstName = me?.user.name.split(" ")[0] ?? "";
  const profile = me?.profile && "groups" in me.profile ? (me.profile as TeacherSelfProfile) : null;
  const groups = profile?.groups ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("greeting", { name: firstName })} />

      <LiveExamRoomPanel />

      <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t("myGroups")}</h2>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={BookOpen} title={ta("noGroups")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <Link key={g.id} href={`/attendance?group=${g.id}`}>
              <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-border-strong">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-brand-subtle text-brand-subtle-fg">
                    <BookOpen className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{g.name}</p>
                    <p className="flex items-center gap-1 text-sm text-fg-muted">
                      <Users className="size-3.5" />
                      {g.studentsCount} {tc("students").toLowerCase()}
                    </p>
                  </div>
                </div>
                <ChevronRight className="size-5 shrink-0 text-fg-subtle" />
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-[12px] border border-border bg-bg-subtle p-4">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <CalendarCheck className="size-4 text-brand" />
          {ta("subtitle")}
        </div>
      </div>
    </div>
  );
}
