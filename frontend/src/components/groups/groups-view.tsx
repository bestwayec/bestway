"use client";

import * as React from "react";
import {
  Award,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pencil,
  Plus,
  User,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { GroupFormDialog } from "@/components/groups/group-form-dialog";
import {
  downloadGroupExcel,
  exportGroupAnalyticsCsv,
  printGroupAnalyticsPdf,
  useGroupAnalytics,
  useGroups,
} from "@/hooks/use-groups";
import type { GroupListItem, ScheduleItem } from "@/lib/types";

function scheduleSummary(schedule: ScheduleItem[] | null, tw: (k: string) => string): string {
  if (!schedule || schedule.length === 0) return "";
  const days = [...new Set(schedule.map((s) => s.day))].map((d) => tw(d)).join(", ");
  const time = schedule[0] ? `${schedule[0].startTime}–${schedule[0].endTime}` : "";
  return time ? `${days} · ${time}` : days;
}

export function GroupAnalyticsPanel({
  groups,
  selectedGroupId,
  onSelectGroup,
  showGroupSelector = true,
}: {
  groups?: GroupListItem[];
  selectedGroupId: string;
  onSelectGroup?: (groupId: string) => void;
  showGroupSelector?: boolean;
}) {
  const ta = useTranslations("groupAnalytics");
  const analyticsQ = useGroupAnalytics(selectedGroupId);
  const [excelLoading, setExcelLoading] = React.useState(false);

  const analytics = analyticsQ.data;
  const selectedGroup = groups?.find((g) => g.id === selectedGroupId);
  const groupName = analytics?.groupName ?? selectedGroup?.name ?? "group";

  const handleExcelDownload = async () => {
    if (!selectedGroupId) return;
    setExcelLoading(true);
    try {
      await downloadGroupExcel(selectedGroupId, groupName);
      toast.success(ta("excelDownloaded"));
    } catch (err: any) {
      toast.error(err?.message ?? ta("excelFailed"));
    } finally {
      setExcelLoading(false);
    }
  };

  return (
    <Card className="mb-6 overflow-hidden border-border">
      <CardHeader className="border-b border-border bg-bg-subtle/50 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base font-bold text-fg">
              {ta("title")}
            </CardTitle>
            {showGroupSelector && groups && groups.length > 0 && onSelectGroup && (
              <select
                aria-label={ta("selectGroup")}
                value={selectedGroupId}
                onChange={(e) => onSelectGroup(e.target.value)}
                className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg focus:border-brand focus:outline-none"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({ta("students", { count: g.studentsCount })})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleExcelDownload}
              disabled={!selectedGroupId || excelLoading}
              className="gap-1.5 bg-brand text-brand-fg hover:bg-brand-hover"
            >
              {excelLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-4" />
              )}
              <span>{ta("excelExport")}</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!analytics}
              onClick={() => analytics && exportGroupAnalyticsCsv(analytics)}
              className="gap-1.5"
            >
              <Download className="size-4" />
              <span>CSV</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!analytics}
              onClick={() => analytics && printGroupAnalyticsPdf(analytics)}
              className="gap-1.5"
            >
              <FileText className="size-4" />
              <span>PDF</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {analyticsQ.isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
            <Skeleton className="h-44" />
          </div>
        ) : !analytics ? (
          <p className="py-4 text-center text-sm text-fg-muted">
            {ta("empty")}
          </p>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-bg-subtle/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-fg-muted">
                    {ta("averageBand")}
                  </span>
                  <Award className="size-4 text-brand" />
                </div>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-fg">
                  {analytics.averageBandScore !== null ? analytics.averageBandScore.toFixed(1) : "—"}
                </p>
                {analytics.averageBandScore !== null && analytics.incompleteOverallCount > 0 && (
                  <p className="mt-1 text-[11px] text-warning">
                    {ta("incompleteAverage", { count: analytics.incompleteOverallCount })}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-bg-subtle/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-fg-muted">{ta("activeStudents")}</span>
                  <Users className="size-4 text-emerald-500" />
                </div>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-fg">
                  {analytics.activeStudents}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-bg-subtle/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-fg-muted">
                    {ta("completedExams")}
                  </span>
                  <CheckCircle2 className="size-4 text-blue-500" />
                </div>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-fg">
                  {analytics.totalCompletedAttempts}
                </p>
              </div>
            </div>
            {analytics.skippedSections > 0 && (
              <p className="text-xs text-fg-muted">
                {ta.rich("skippedSections", { count: analytics.skippedSections, strong: (chunks) => <strong className="tabular-nums text-fg">{chunks}</strong> })}
              </p>
            )}

            {/* Student Analytics Table */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-subtle text-xs font-semibold text-fg-muted">
                    <th className="px-3.5 py-2.5">#</th>
                    <th className="px-3.5 py-2.5">{ta("colStudent")}</th>
                    <th className="px-3.5 py-2.5 text-center">{ta("colCompleted")}</th>
                    <th className="px-3.5 py-2.5 text-center">{ta("colWriting")}</th>
                    <th className="px-3.5 py-2.5 text-center">{ta("colSpeaking")}</th>
                    <th className="px-3.5 py-2.5 text-center">Listening / Reading</th>
                    <th className="px-3.5 py-2.5 text-center">{ta("colOverall")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {analytics.students.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-sm text-fg-muted">
                        {ta("noStudents")}
                      </td>
                    </tr>
                  ) : (
                    analytics.students.map((st, idx) => (
                      <tr key={st.studentId} className="hover:bg-surface-hover/50">
                        <td className="px-3.5 py-2.5 text-xs text-fg-muted tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="px-3.5 py-2.5 font-medium text-fg">{st.name}</td>
                        <td className="px-3.5 py-2.5 text-center tabular-nums">
                          {st.completedExamsCount}
                        </td>
                        <td className="px-3.5 py-2.5 text-center font-medium tabular-nums">
                          {st.writingScore !== null ? st.writingScore.toFixed(1) : "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-center font-medium tabular-nums">
                          {st.speakingScore !== null ? st.speakingScore.toFixed(1) : "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-center text-xs text-fg-muted tabular-nums">
                          {st.listeningScore !== null ? st.listeningScore.toFixed(1) : "—"} /{" "}
                          {st.readingScore !== null ? st.readingScore.toFixed(1) : "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-center font-bold text-brand tabular-nums">
                          {st.overallBand !== null ? st.overallBand.toFixed(1) : "—"}
                          {st.overallBand !== null && st.overallBandIncomplete && (
                            <span className="ml-1 text-[10px] font-medium text-warning" title={ta("incompleteHint")}>
                              {ta("incomplete")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function GroupsView() {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const tw = useTranslations("weekdaysShort");
  const tm = useTranslations("classroomManagement");
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
            <GroupAnalyticsPanel
              groups={groups}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
              showGroupSelector
            />
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
