"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Clock, Download, Minus, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { attendanceCsv } from "@/lib/attendance-export";
import { downloadCsv } from "@/lib/csv-export";
import { DataGrid, type DataGridColumn } from "@/components/data-grid/data-grid";
import { StateCell, type CellTone } from "@/components/data-grid/state-cell";
import { useGroups, useGroupDetail } from "@/hooks/use-groups";
import { useAttendance, useSaveAttendanceCell } from "@/hooks/use-attendance";
import { ApiError } from "@/lib/api-client";
import type { AttendanceState, ScheduleItem } from "@/lib/types";
import { currentMonthKey, daysInMonth, toDateKey } from "@/lib/utils";

const WD_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DEFAULT_DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat"]);

const STATE_VIEW: Record<AttendanceState, { tone: CellTone; Icon: typeof Check }> = {
  present: { tone: "success", Icon: Check },
  absent: { tone: "danger", Icon: X },
  late: { tone: "warning", Icon: Clock },
  empty: { tone: "neutral", Icon: Minus },
  blank: { tone: "neutral", Icon: Minus },
};

function isEmptyState(state?: string): boolean {
  return state === "empty" || state === "blank";
}

function nextState(cur?: AttendanceState): AttendanceState {
  if (cur === "present") return "absent";
  if (cur === "absent") return "late";
  if (cur === "late") return "empty";
  if (isEmptyState(cur)) return "present";
  return "present";
}

/** Bo'sh/empty holatiga o'tkazish — hech qanday amal bajarmaydi, shunchaki tanlovni tozalaydi */
export function clearAttendanceState(): AttendanceState {
  return "empty";
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function scheduleDaySet(schedule: ScheduleItem[] | null): Set<string> {
  if (!schedule || schedule.length === 0) return DEFAULT_DAYS;
  return new Set(schedule.map((s) => s.day));
}

export function AttendancePanel() {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  const tMonths = useTranslations("months");
  const tWd = useTranslations("weekdaysShort");
  const params = useSearchParams();

  const groupsQ = useGroups();
  const [groupId, setGroupId] = React.useState<string>("");
  const [month, setMonth] = React.useState<string>(currentMonthKey());

  const wantedGroup = params.get("group");
  const fallbackGroupId =
    groupsQ.data && groupsQ.data.length > 0
      ? wantedGroup && groupsQ.data.some((g) => g.id === wantedGroup)
        ? wantedGroup
        : groupsQ.data[0].id
      : "";
  const activeGroupId = groupId || fallbackGroupId;

  const detailQ = useGroupDetail(activeGroupId || undefined);
  const attendanceQ = useAttendance(activeGroupId || undefined, month);
  const save = useSaveAttendanceCell(activeGroupId, month);

  const students = React.useMemo(() => detailQ.data?.students ?? [], [detailQ.data?.students]);

  const columns: DataGridColumn[] = React.useMemo(() => {
    const days = scheduleDaySet(detailQ.data?.schedule ?? null);
    const [y, m] = month.split("-").map(Number);
    const total = daysInMonth(y, m);
    const todayKey = toDateKey(new Date());
    const cols: DataGridColumn[] = [];
    for (let d = 1; d <= total; d++) {
      const date = new Date(Date.UTC(y, m - 1, d));
      const wd = WD_KEYS[date.getUTCDay()];
      if (!days.has(wd)) continue;
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      cols.push({
        id: dateStr,
        width: 48,
        highlight: dateStr === todayKey,
        header: (
          <div className="flex flex-col items-center leading-tight">
            <span className="text-[13px] font-semibold text-fg">{d}</span>
            <span className="text-[10px] font-normal">{tWd(wd)}</span>
          </div>
        ),
      });
    }
    return cols;
  }, [detailQ.data?.schedule, month, tWd]);

  // Tez qidiruv uchun: "studentId|date" -> state
  const stateMap = React.useMemo(() => {
    const map = new Map<string, AttendanceState>();
    for (const r of attendanceQ.data ?? []) map.set(`${r.studentId}|${r.date}`, r.state);
    return map;
  }, [attendanceQ.data]);

  const studentsById = React.useMemo(() => new Map(students.map((s) => [s.studentId, s])), [students]);

  const commit = React.useCallback(
    (studentId: string, date: string, state: AttendanceState) => {
      // Bloklangan o'quvchi: so'rov yubormaymiz — darhol xabardor qilamiz
      if (studentsById.get(studentId)?.isActive === false) {
        toast.error(tc("studentBlocked"));
        return;
      }
      save.mutate(
        { studentId, date, state },
        {
          onError: (e) => {
            // Haqiqiy sabab dev-log'da qoladi; backend xatosini userga
            // "internet" deb ko'rsatmaymiz — bu xabar faqat tarmoq uzilganda.
            if (process.env.NODE_ENV !== "production") {
              console.error("[attendance] save failed", { studentId, date, state, error: e });
            }
            // Backend STUDENT_BLOCKED rad etsa — aniq sababni ko'rsatamiz
            if (e instanceof ApiError && e.code === "STUDENT_BLOCKED") {
              toast.error(tc("studentBlocked"));
              return;
            }
            const backendMessage =
              e instanceof ApiError && e.status > 0 && e.code !== "UNKNOWN" && e.message
                ? e.message
                : null;
            toast.error(backendMessage ?? t("saveError"));
          },
        },
      );
    },
    [save, t, tc, studentsById],
  );

  const rows = React.useMemo(
    () =>
      students.map((s) => ({
        id: s.studentId,
        header: (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{s.name}</span>
            {!s.isActive && (
              <Badge variant="neutral" className="shrink-0">
                {tc("blocked")}
              </Badge>
            )}
          </span>
        ),
      })),
    [students, tc],
  );

  const renderCell = React.useCallback(
    (studentId: string, date: string) => {
      const cur = stateMap.get(`${studentId}|${date}`);
      const isEmpty = isEmptyState(cur);
      const view = cur && !isEmpty ? STATE_VIEW[cur] : isEmpty ? STATE_VIEW["empty"] : null;
      const titleKey = !cur ? "notMarked" : isEmpty ? "empty" : cur;
      return (
        <StateCell
          tone={view?.tone ?? "neutral"}
          title={t(titleKey as never)}
          onClick={() => commit(studentId, date, nextState(cur))}
          onKeyDown={(e) => {
            const k = e.key.toLowerCase();
            if (k === "k") commit(studentId, date, "present");
            else if (k === "n") commit(studentId, date, "absent");
            else if (k === "s") commit(studentId, date, "late");
            else if (k === "b" || k === "e" || k === "x" || k === "0" || k === " ") commit(studentId, date, "empty");
            else if (k === "delete" || k === "backspace") commit(studentId, date, "empty");
          }}
        >
          {view ? <view.Icon className={isEmpty ? "opacity-50" : undefined} /> : <span className="text-fg-subtle">·</span>}
        </StateCell>
      );
    },
    [stateMap, commit, t],
  );

  const monthLabel = `${tMonths(String(Number(month.split("-")[1])))} ${month.split("-")[0]}`;

  return (
    <div className="mx-auto max-w-full">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            {activeGroupId && (
              <Button variant="outline" size="sm"
                disabled={!detailQ.data || !attendanceQ.data || detailQ.isFetching || attendanceQ.isFetching || detailQ.isError || attendanceQ.isError || save.isPending}
                onClick={() => {
                  if (!detailQ.data || !attendanceQ.data) return;
                  downloadCsv(attendanceCsv(detailQ.data.name, month, students, attendanceQ.data, {
                    group: tc("group"), month: tc("month"), student: tc("student"),
                    present: t("present"), absent: t("absent"), late: t("late"), notMarked: t("notMarked"),
                  }), `davomat-${activeGroupId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${month}.csv`);
                }}>
                <Download />{tc("export")}
              </Button>
            )}
            {groupsQ.data && groupsQ.data.length > 0 && (
              <Select value={activeGroupId} onValueChange={setGroupId}>
                <SelectTrigger className="w-full min-w-[9rem] max-w-full sm:w-44">
                  <SelectValue placeholder={t("selectGroup")} />
                </SelectTrigger>
                <SelectContent>
                  {groupsQ.data.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        }
      />

      {groupsQ.isError ? (
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => groupsQ.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      ) : groupsQ.isLoading ? (
        <Skeleton className="h-72" />
      ) : (groupsQ.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Users} title={t("noGroups")} />
      ) : (
        <>
          {/* Oy navigatsiyasi + belgilar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setMonth((mo) => shiftMonth(mo, -1))}
                aria-label={tc("back")}
              >
                <ChevronLeft />
              </Button>
              <span className="min-w-[9rem] text-center text-sm font-semibold text-fg sm:min-w-36">
                {monthLabel}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setMonth((mo) => shiftMonth(mo, 1))}
                aria-label={tc("next")}
              >
                <ChevronRight />
              </Button>
            </div>
            <Legend />
          </div>

          {detailQ.isLoading || attendanceQ.isLoading ? (
            <Skeleton className="h-72" />
          ) : students.length === 0 ? (
            <EmptyState icon={Users} title={tc("empty")} />
          ) : columns.length === 0 ? (
            <EmptyState icon={Clock} title={tc("empty")} />
          ) : (
            <>
              <DataGrid columns={columns} rows={rows} corner={tc("student")} renderCell={renderCell} />
              <p className="mt-3 text-xs text-fg-subtle">{t("keyboardHint")}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Legend() {
  const t = useTranslations("attendance");
  const items: { state: AttendanceState }[] = [
    { state: "present" },
    { state: "absent" },
    { state: "late" },
    { state: "empty" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
      {items.map(({ state }) => {
        const { tone, Icon } = STATE_VIEW[state];
        const bg = {
          success: "bg-success-bg text-success",
          danger: "bg-danger-bg text-danger",
          warning: "bg-warning-bg text-warning",
          info: "bg-info-bg text-info",
          neutral: "bg-bg-subtle text-fg-subtle",
        }[tone];
        return (
          <span key={state} className="inline-flex items-center gap-1.5">
            <span className={`inline-flex size-5 items-center justify-center rounded ${bg} [&_svg]:size-3.5`}>
              <Icon />
            </span>
            {t(state)}
          </span>
        );
      })}
    </div>
  );
}
