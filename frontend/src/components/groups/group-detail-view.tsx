"use client";

import * as React from "react";
import {
  ArrowLeft,
  CalendarClock,
  Download,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  User,
  UserMinus,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ClassroomManagement } from "@/components/groups/classroom-management";
import { ClassroomAssignments } from "@/components/groups/classroom-assignments";
import { GroupFormDialog } from "@/components/groups/group-form-dialog";
import { AdjustPointsDialog } from "@/components/students/adjust-points-dialog";
import {
  useAddStudentToGroup,
  useGroupDetail,
  useGroups,
  useRemoveStudentFromGroup,
  downloadGroupExcel,
} from "@/hooks/use-groups";
import { useStudents, useDebouncedValue } from "@/hooks/use-users";
import { useSettings } from "@/hooks/use-settings";
import { useMe } from "@/hooks/use-me";
import { formatPhone } from "@/lib/utils";
import { GroupAiRanking } from "@/components/teacher/group-ai-ranking";
import { AttendanceScreen } from "@/components/workspace/attendance-sheet";
import { GroupHomeworkList } from "@/components/workspace/homework-results";
import { useSearchParams } from "next/navigation";
import { GroupAnalyticsDashboard } from "@/components/teacher/group-analytics-dashboard";
import { CheckSquare, FileText } from "lucide-react";
import { GroupLiveMonitoring } from "@/components/teacher/group-live-monitoring";
import { LiveExamRoomPanel } from "@/components/teacher/live-exam-room-panel";
import { GroupAnalyticsPanel } from "@/components/groups/groups-view";
import { useRouter } from "@/i18n/navigation";

export function GroupDetailView({ groupId }: { groupId: string }) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const tw = useTranslations("weekdaysShort");
  const ws = useTranslations("workspace");
  const wt = useTranslations("tw");
  const router = useRouter();
  const { data: group, isLoading, isError, refetch } = useGroupDetail(groupId);
  const { data: allGroups } = useGroups();
  const removeStudent = useRemoveStudentFromGroup(groupId);
  const addStudent = useAddStudentToGroup(groupId);
  const { data: me } = useMe();
  const settingsQ = useSettings();
  const [editOpen, setEditOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const params = useSearchParams();
  const TABS = ["overview", "students", "attendance", "homework", "results"] as const;
  type Tab = (typeof TABS)[number];
  const requestedTab = params.get("tab") as Tab | null;
  const [tab, setTabState] = React.useState<Tab>(requestedTab && TABS.includes(requestedTab) ? requestedTab : "overview");
  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, "", `${window.location.pathname}?tab=${next}`);   // shareable, no reload
  };
  const [excelBusy, setExcelBusy] = React.useState(false);
  const [pointsTarget, setPointsTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = React.useState("");
  const [rosterSearch, setRosterSearch] = React.useState("");
  const [rosterLimit, setRosterLimit] = React.useState(20);
  const debounced = useDebouncedValue(search);
  const picker = useStudents(debounced.trim(), debounced.trim().length >= 2);

  const isOffice = me?.user.role === "admin" || me?.user.role === "super_admin";
  const canSeePhones =
    me?.user.role === "teacher" || me?.user.role === "admin" || me?.user.role === "super_admin";
  const teacherLimit = me?.user.role === "teacher" ? settingsQ.data?.teacherPointLimit : undefined;

  const memberIds = new Set((group?.students ?? []).map((s) => s.studentId));
  const candidates = (picker.isPlaceholderData ? [] : picker.data ?? []).filter((u) => !memberIds.has(u.id)).slice(0, 6);

  async function handleDownloadExcel() {
    setExcelBusy(true);
    try {
      await downloadGroupExcel(groupId, group?.name ?? "group");
      toast.success("Excel (.xlsx) yuklab olindi");
    } catch (err: any) {
      toast.error(err?.message ?? "Excel yuklab olishda xatolik");
    } finally {
      setExcelBusy(false);
    }
  }

  function onAdd(studentId: string) {
    addStudent.mutate(studentId, {
      onSuccess: () => {
        toast.success(t("studentAdded"));
        setSearch("");
      },
      onError: () => toast.error(tc("unknownError")),
    });
  }

  function onRemove(studentId: string) {
    removeStudent.mutate(studentId, {
      onSuccess: () => toast.success(t("studentRemoved")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      </div>
    );
  }

  if (isLoading || !group) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const days = [...new Set((group.schedule ?? []).map((s) => s.day))].map((d) => tw(d)).join(", ");
  const time = group.schedule?.[0] ? `${group.schedule[0].startTime}–${group.schedule[0].endTime}` : "";

  const matchingStudents = group.students.filter((student) =>
    student.name.toLocaleLowerCase().includes(rosterSearch.trim().toLocaleLowerCase()),
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/groups"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          {t("title")}
        </Link>

        {canSeePhones && (
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            <span>+ Yangi guruh yaratish</span>
          </Button>
        )}
      </div>

      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-fg">{group.name}</h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-fg-muted">
              <User className="size-4" />
              {group.teacherName ?? t("noTeacher")}
            </p>
            {time && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
                <CalendarClock className="size-4" />
                {days} · {time}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSeePhones && (
              <Button size="sm" onClick={() => setTab("attendance")} className="gap-1.5 text-xs font-medium">
                <CheckSquare className="size-4" />
                <span>{wt("home.action.attendance")}</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              asChild
              className="gap-1.5 border-danger-border text-danger hover:bg-danger-bg text-xs"
            >
              <a href={`/api/backend/v1/groups/${groupId}/report/pdf`} target="_blank" rel="noopener noreferrer">
                <FileText className="size-4 text-danger" />
                <span>📄 Oylik Hisobot (PDF)</span>
              </a>
            </Button>
            <Button
              size="sm"
              onClick={handleDownloadExcel}
              loading={excelBusy}
              className="gap-1.5 bg-brand text-brand-fg hover:bg-brand-hover text-xs"
            >
              <Download className="size-4" />
              <span>📊 Excel (.xlsx)</span>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/backend/assessment/groups/${groupId}/export`} download>
                <Download className="size-4" />
                Vedomost (.csv)
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil />
              {t("edit")}
            </Button>
          </div>
        </div>
      </Card>

      {canSeePhones && (
        <div role="tablist" aria-label={ws("classroomSections")} className="mb-4 flex gap-1 overflow-x-auto rounded-card border border-border bg-surface p-1" data-testid="group-tabs">
          {TABS.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} id={`group-tab-${key}`} aria-controls={`group-panel-${key}`}
              onClick={() => setTab(key)}
              className={`min-h-11 shrink-0 rounded-control px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === key ? "bg-brand text-brand-fg" : "text-fg hover:bg-surface-hover"}`}>
              {wt(`group.tab.${key}`)}
            </button>
          ))}
        </div>
      )}

      {canSeePhones && tab === "overview" && (
        <section id="group-panel-overview" role="tabpanel" aria-labelledby="group-tab-overview" className="mb-4 grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => setTab("attendance")} className="min-h-24 rounded-card border border-brand/40 bg-brand-subtle p-4 text-left font-semibold text-fg hover:bg-brand/15">{wt("home.action.attendance")}<span className="mt-1 block text-xs font-normal text-fg-muted">{wt("home.students", { n: group.students.length })}</span></button>
          <Link href={`/teacher/assign?group=${groupId}`} className="min-h-24 rounded-card border border-brand/40 bg-brand-subtle p-4 font-semibold text-fg hover:bg-brand/15">{wt("home.action.assign")}<span className="mt-1 block text-xs font-normal text-fg-muted">{wt("group.assignHint")}</span></Link>
          <button type="button" onClick={() => setTab("results")} className="min-h-24 rounded-card border border-border bg-surface p-4 text-left font-semibold text-fg hover:bg-surface-hover">{wt("home.action.results")}<span className="mt-1 block text-xs font-normal text-fg-muted">{wt("group.resultsHint")}</span></button>
        </section>
      )}

      {canSeePhones && tab === "attendance" && (
        <section id="group-panel-attendance" role="tabpanel" aria-labelledby="group-tab-attendance" className="mb-4">
          <AttendanceScreen embeddedGroupId={groupId} />
        </section>
      )}

      {canSeePhones && tab === "homework" && (
        <section id="group-panel-homework" role="tabpanel" aria-labelledby="group-tab-homework" className="mb-4 space-y-4">
          <Button asChild><Link href={`/teacher/assign?group=${groupId}`}><Plus />{wt("home.action.assign")}</Link></Button>
          <GroupHomeworkList groupId={groupId} />
          {me && (
            <details className="rounded-card border border-border bg-surface p-4">
              <summary className="cursor-pointer text-sm font-medium text-fg-muted">{wt("group.classicTasks")}</summary>
              <div className="mt-3"><ClassroomAssignments key={groupId} groupId={groupId} userId={me.user.id} /></div>
            </details>
          )}
        </section>
      )}

      {canSeePhones && tab === "results" && (
        <section id="group-panel-results" role="tabpanel" aria-labelledby="group-tab-results" aria-label={ws("results")}>
          <LiveExamRoomPanel defaultGroupId={groupId} />
          <GroupAnalyticsPanel
            groups={allGroups}
            selectedGroupId={groupId}
            onSelectGroup={(nextId) => {
              if (nextId && nextId !== groupId) {
                router.push(`/groups/${nextId}`);
              }
            }}
            showGroupSelector={Boolean(allGroups && allGroups.length > 1)}
          />
          <GroupAnalyticsDashboard groupId={groupId} groupName={group.name} className="mb-4" />
          <GroupLiveMonitoring groupId={groupId} />
          <GroupAiRanking groupId={groupId} />
        </section>
      )}

      {(!canSeePhones || tab === "students") && (<div id="group-panel-students" role={canSeePhones ? "tabpanel" : undefined}>
      {/* O'quvchi qo'shish */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Plus className="size-4 text-brand" />
            {t("addStudent")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchStudent")}
              className="pl-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:text-fg"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          {debounced && (
            <div className="mt-2 max-h-64 divide-y divide-border overflow-y-auto overscroll-contain">
              {candidates.length === 0 ? (
                <p className="py-3 text-sm text-fg-muted">{tc("empty")}</p>
              ) : (
                candidates.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={u.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{u.name}</p>
                        {canSeePhones && (
                          <p className="truncate text-xs text-fg-muted">{formatPhone(u.phone)}</p>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="subtle" className="h-7" onClick={() => onAdd(u.id)}>
                      <Plus />
                      {tc("add")}
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Guruh o'quvchilari */}
      <Card id="classroom-roster" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-sm">
            {t("students")} · {group.students.length}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {group.students.length > 0 && <label className="mb-3 block">
            <span className="sr-only">{ws("searchStudents")}</span>
            <input type="search" className="min-h-11 w-full rounded-control border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-brand"
              value={rosterSearch} placeholder={ws("searchStudents")} onChange={(event) => { setRosterSearch(event.target.value); setRosterLimit(20); }} />
          </label>}
          {matchingStudents.length === 0 ? (
            <EmptyState title={rosterSearch.trim() ? ws("noMatches") : t("noStudents")} className="border-0 py-6" />
          ) : (
            <div className="divide-y divide-border">
              {matchingStudents.slice(0, rosterLimit).map((s) => {
                const info = (
                  <>
                    <Avatar name={s.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{s.name}</p>
                      {canSeePhones && s.phone && (
                        <p className="truncate text-xs text-fg-muted">{formatPhone(s.phone)}</p>
                      )}
                    </div>
                  </>
                );
                return (
                  <div key={s.studentId} className="flex items-center justify-between gap-2 py-2.5">
                    {isOffice ? (
                      <Link
                        href={`/students/${s.studentId}`}
                        className="flex min-w-0 items-center gap-2.5 hover:opacity-80"
                      >
                        {info}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2.5">{info}</div>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="flex items-center gap-1 text-sm font-medium text-fg tabular-nums">
                        <Star className="size-3.5 text-brand" />
                        {s.currentPoints}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("addStudent")}
                        onClick={() => setPointsTarget({ id: s.studentId, name: s.name })}
                      >
                        <Sparkles className="text-brand" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("remove")}
                        onClick={() => onRemove(s.studentId)}
                      >
                        <UserMinus className="text-danger" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {matchingStudents.length > rosterLimit && <Button className="mt-3" variant="outline" onClick={() => setRosterLimit(rosterLimit + 20)}>
            {ws("showMore")} · {rosterLimit} / {matchingStudents.length}
          </Button>}
        </CardContent>
      </Card>

      {canSeePhones && me && <ClassroomManagement key={groupId} group={group} userId={me.user.id} />}
      </div>)}

      <GroupFormDialog open={editOpen} group={group} onClose={() => setEditOpen(false)} />
      <GroupFormDialog open={createOpen} group={null} onClose={() => setCreateOpen(false)} />
      <AdjustPointsDialog
        open={!!pointsTarget}
        onClose={() => setPointsTarget(null)}
        studentId={pointsTarget?.id ?? ""}
        studentName={pointsTarget?.name ?? ""}
        limit={teacherLimit}
      />
    </div>
  );
}
