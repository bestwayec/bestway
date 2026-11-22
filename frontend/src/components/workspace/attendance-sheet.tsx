"use client";

import * as React from "react";
import { CalendarDays, CheckCheck, History, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { ApiError } from "@/lib/api-client";
import {
  attendanceSummary,
  changedRecords,
  localDay,
  useAttendanceHistory,
  useAttendanceSheet,
  useSaveAttendance,
  useWorkspaceOverview,
  type AttendanceSaveResult,
  type MarkState,
} from "@/lib/teacher-workspace";
import { cn } from "@/lib/utils";

const STATES: { state: MarkState; tone: string; active: string }[] = [
  { state: "present", tone: "hover:bg-success-bg", active: "bg-success text-white border-success" },
  { state: "absent", tone: "hover:bg-danger-bg", active: "bg-danger text-danger-fg border-danger" },
  { state: "late", tone: "hover:bg-warning-bg", active: "bg-warning text-warning-fg border-warning" },
];

/** Page wrapper: group picker + the sheet. `embeddedGroupId` is used inside the Group Detail page. */
export function AttendanceScreen({ embeddedGroupId }: { embeddedGroupId?: string }) {
  const t = useTranslations("tw");
  const params = useSearchParams();
  const router = useRouter();
  const overview = useWorkspaceOverview();
  const groups = overview.data?.groups ?? [];
  const requested = embeddedGroupId ?? params.get("group") ?? undefined;
  const groupId = requested ?? groups.find((g) => g.scheduledToday)?.id ?? groups[0]?.id;
  const [date, setDate] = React.useState(() => params.get("date") ?? localDay());

  const body = !groupId ? (
    overview.isLoading ? <Skeleton className="h-72" /> : <EmptyState title={t("home.noGroups")} description={t("home.noGroupsHint")} />
  ) : (
    <AttendanceSheetView key={`${groupId}:${date}`} groupId={groupId} date={date} onDate={setDate} />
  );

  if (embeddedGroupId) return body;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("att.title")} description={t("att.subtitle")} />
      {groups.length > 1 && (
        <div role="radiogroup" aria-label={t("att.chooseGroup")} className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={g.id === groupId}
              onClick={() => router.replace(`/teacher/attendance?group=${g.id}`)}
              className={cn(
                "min-h-11 shrink-0 rounded-control border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                g.id === groupId ? "border-brand bg-brand text-brand-fg" : "border-border-strong bg-surface text-fg hover:bg-surface-hover",
              )}
            >
              {g.name}
              {g.scheduledToday && <span className="ml-1.5 text-xs opacity-80">· {t("att.today")}</span>}
            </button>
          ))}
        </div>
      )}
      {body}
    </div>
  );
}

function AttendanceSheetView({ groupId, date, onDate }: { groupId: string; date: string; onDate: (d: string) => void }) {
  const t = useTranslations("tw");
  const sheetQ = useAttendanceSheet(groupId, date);
  const history = useAttendanceHistory(groupId);
  const save = useSaveAttendance(groupId);
  const [marks, setMarks] = React.useState<Record<string, MarkState | null>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saved, setSaved] = React.useState<AttendanceSaveResult | null>(null);
  const sheet = sheetQ.data;

  // Load the STORED marks. Unmarked students stay unmarked — nothing is pre-filled.
  // After a conflict (409) the fresh sheet is loaded but the teacher's own edits are kept on top of it.
  React.useEffect(() => {
    if (!sheet) return;
    setMarks((current) => {
      const next: Record<string, MarkState | null> = {};
      for (const s of sheet.students) next[s.studentId] = dirty && current[s.studentId] ? current[s.studentId] : s.state;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (sheetQ.isError) {
    return <ErrorState title={sheetQ.error instanceof ApiError ? sheetQ.error.message : t("common.loadError")} action={<Button variant="outline" size="sm" onClick={() => sheetQ.refetch()}>{t("common.retry")}</Button>} />;
  }
  if (!sheet) return <Skeleton className="h-96" />;

  const readOnly = sheet.archived;
  const editable = sheet.students.filter((s) => s.active);
  const changes = changedRecords(editable, marks);
  const counts = attendanceSummary(marks);
  const unmarked = editable.filter((s) => !marks[s.studentId]).length;

  function setMark(studentId: string, state: MarkState) {
    setMarks((m) => ({ ...m, [studentId]: state }));
    setDirty(true);
    setSaved(null);
  }

  function markAllPresent() {
    setMarks((m) => {
      const next = { ...m };
      for (const s of editable) next[s.studentId] = "present";
      return next;
    });
    setDirty(true);
    setSaved(null);
  }

  async function onSave() {
    if (!sheet || changes.length === 0 || save.isPending) return;
    try {
      const result = await save.mutateAsync({ date: sheet.date, revision: sheet.revision, records: changes });
      setDirty(false);
      setSaved(result);
      toast.success(t("att.saved"));
      await sheetQ.refetch();
    } catch (error) {
      if (error instanceof ApiError && error.code === "ATTENDANCE_CHANGED") {
        toast.error(error.message);
        await sheetQ.refetch(); // fresh baseline; the teacher's edits stay visible for review
      } else {
        toast.error(error instanceof ApiError ? error.message : t("common.saveError"));
      }
    }
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div>
          <p className="text-lg font-semibold text-fg">{sheet.groupName}</p>
          <p className="text-sm text-fg-muted" data-testid="att-lesson">
            {sheet.slots.length ? t("att.lesson", { time: sheet.slots.map((s) => `${s.startTime}–${s.endTime}`).join(", ") }) : t("att.noLesson")}
            {" · "}{t("att.markedOf", { marked: sheet.marked, total: sheet.total })}
          </p>
        </div>
        <label className="grid gap-1 text-sm font-medium text-fg">
          <span className="flex items-center gap-1"><CalendarDays className="size-4" />{t("att.date")}</span>
          <input
            type="date"
            value={date}
            max={localDay()}
            onChange={(e) => {
              if (!e.target.value) return;
              if (dirty && !window.confirm(t("att.discard"))) return;
              onDate(e.target.value);
            }}
            className="h-11 rounded-field border border-input-border bg-surface px-3 text-fg"
          />
        </label>
      </Card>

      {readOnly && <p className="rounded-card border border-warning-border bg-warning-bg p-3 text-sm text-warning">{t("att.archived")}</p>}

      {sheet.students.length === 0 ? (
        <EmptyState title={t("att.noStudents")} description={t("att.noStudentsHint")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="subtle" onClick={markAllPresent} disabled={readOnly} data-testid="att-mark-all">
              <CheckCheck />{t("att.markAll")}
            </Button>
            <p className="text-sm text-fg-muted" aria-live="polite">
              {t("att.live", { present: counts.present, absent: counts.absent, late: counts.late, unmarked })}
            </p>
          </div>

          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface" data-testid="att-list">
            {sheet.students.map((s, index) => {
              const value = marks[s.studentId];
              return (
                <li key={s.studentId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="att-row">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-fg">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-fg-subtle">{index + 1}</span>
                    <span className="truncate">{s.name}</span>
                    {!s.active && <span className="text-xs text-fg-muted">({t("att.blocked")})</span>}
                    {!value && s.active && <span className="text-xs font-normal text-fg-subtle">· {t("att.notMarked")}</span>}
                  </span>
                  <div role="radiogroup" aria-label={s.name} className="grid grid-cols-3 gap-1.5 sm:flex">
                    {STATES.map(({ state, tone, active }) => (
                      <button
                        key={state}
                        type="button"
                        role="radio"
                        aria-checked={value === state}
                        disabled={readOnly || !s.active}
                        onClick={() => setMark(s.studentId, state)}
                        className={cn(
                          "min-h-11 rounded-control border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50",
                          value === state ? active : cn("border-border-strong bg-surface text-fg", tone),
                        )}
                      >
                        {t(`att.state.${state}`)}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-elevated p-3 shadow-e1 md:bottom-3">
            <span className="text-sm text-fg-muted">{changes.length ? t("att.changes", { n: changes.length }) : t("att.noChanges")}</span>
            <Button size="lg" onClick={onSave} loading={save.isPending} disabled={readOnly || changes.length === 0} data-testid="att-save">
              <Save />{t("att.save")}
            </Button>
          </div>
        </>
      )}

      {saved && (
        <Card className="border-success-border bg-success-bg p-4" role="status" data-testid="att-summary">
          <p className="mb-2 font-semibold text-success">{t("att.savedTitle", { date: saved.date })}</p>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {(["present", "absent", "late"] as const).map((k) => (
              <div key={k} className="rounded-control bg-surface p-2">
                <dt className="text-xs text-fg-muted">{t(`att.state.${k}`)}</dt>
                <dd className="text-xl font-bold tabular-nums text-fg">{saved.summary[k]}</dd>
              </div>
            ))}
          </dl>
          {saved.marked < saved.total && <p className="mt-2 text-xs text-fg-muted">{t("att.stillUnmarked", { n: saved.total - saved.marked })}</p>}
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-fg"><History className="size-4 text-brand" />{t("att.history")}</h2>
        {!history.data?.length ? (
          <p className="text-sm text-fg-muted">{t("att.noHistory")}</p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {history.data.slice(0, 10).map((h) => (
              <li key={h.date}>
                <button
                  type="button"
                  onClick={() => { if (!dirty || window.confirm(t("att.discard"))) onDate(h.date); }}
                  className={cn("flex min-h-11 w-full items-center justify-between rounded-control px-3 text-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    h.date === sheet.date && "bg-brand-subtle")}
                >
                  <span className="font-medium text-fg">{h.date}</span>
                  <span className="tabular-nums text-fg-muted">✓{h.present} · ✗{h.absent} · ⏱{h.late}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/attendance?view=month&group=${groupId}`} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">{t("att.monthGrid")}</Link>
      </Card>
    </div>
  );
}
