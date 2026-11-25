"use client";

import * as React from "react";
import {
  BookOpen,
  CalendarClock,
  Pencil,
  Plus,
  User,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { GroupFormDialog } from "@/components/groups/group-form-dialog";
import { useGroups } from "@/hooks/use-groups";
import { GroupAnalyticsDashboard } from "@/components/teacher/group-analytics-dashboard";
import type { GroupListItem, ScheduleItem } from "@/lib/types";

function scheduleSummary(schedule: ScheduleItem[] | null, tw: (k: string) => string): string {
  if (!schedule || schedule.length === 0) return "";
  const days = [...new Set(schedule.map((s) => s.day))].map((d) => tw(d)).join(", ");
  const time = schedule[0] ? `${schedule[0].startTime}–${schedule[0].endTime}` : "";
  return time ? `${days} · ${time}` : days;
}

export function GroupsView() {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const tw = useTranslations("weekdaysShort");
  const tm = useTranslations("classroomManagement");
  const ta = useTranslations("groupAnalytics");
  const [archived, setArchived] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const { data, isLoading, isError, refetch } = useGroups({ archived, search });

  const [dialog, setDialog] = React.useState<{ open: boolean; group: GroupListItem | null }>({
    open: false,
    group: null,
  });

  const groups = data ?? [];
  const [selectedGroupId, setSelectedGroupId] = React.useState<string>("");

  React.useEffect(() => {
    if (groups.length > 0 && (!selectedGroupId || !groups.some((g) => g.id === selectedGroupId))) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => setDialog({ open: true, group: null })}>
            <Plus />
            <span>{t("create")}</span>
          </Button>
        }
      />

      <div className="my-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">{tm("search")}
          <input className="rounded-field border border-border bg-surface px-3 py-2" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />
          {tm("archived")}
        </label>
      </div>

      {isError ? (
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={t("empty")}
          description={t("emptyHint")}
          action={
            <Button size="sm" onClick={() => setDialog({ open: true, group: null })}>
              <Plus />
              <span>{t("create")}</span>
            </Button>
          }
        />
      ) : (
        <>
          {selectedGroupId && (
            <div className="mb-6 space-y-2">
              <label className="flex w-fit items-center gap-2 text-sm">
                {ta("selectGroup")}
                <select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}
                  className="min-h-10 rounded-field border border-border bg-surface px-2">
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <GroupAnalyticsDashboard key={selectedGroupId} groupId={selectedGroupId}
                groupName={groups.find((group) => group.id === selectedGroupId)?.name} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <Card key={g.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-fg">{g.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
                      <User className="size-3.5" />
                      {g.teacherName ?? t("noTeacher")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("edit")}
                    onClick={() => setDialog({ open: true, group: g })}
                  >
                    <Pencil />
                  </Button>
                </div>

                <div className="mt-3 space-y-1.5 text-sm text-fg-muted">
                  <p className="flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    {t("studentsCount", { count: g.studentsCount })}
                  </p>
                  {scheduleSummary(g.schedule, tw) && (
                    <p className="flex items-center gap-1.5">
                      <CalendarClock className="size-3.5" />
                      {scheduleSummary(g.schedule, tw)}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex gap-2 border-t border-border pt-3">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={`/groups/${g.id}`}>{t("students")}</Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/attendance?group=${g.id}`}>{t("openPanel")}</Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <GroupFormDialog
        open={dialog.open}
        group={dialog.group}
        onClose={() => setDialog({ open: false, group: null })}
      />
    </div>
  );
}
