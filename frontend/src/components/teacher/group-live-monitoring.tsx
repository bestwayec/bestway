"use client";

import * as React from "react";
import {
  BookOpenText,
  Clock,
  Headphones,
  Mic,
  PenLine,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { examLogEventText } from "@/components/mock/exam-log-panel";
import { useGroupLiveMonitoring } from "@/hooks/use-group-monitoring";
import type { CheatAnomalyEvent, LiveMonitoringStudent } from "@/lib/group-monitoring-types";

const SECTION_ICONS = [
  { match: "listen", label: "Listening", icon: Headphones, tone: "text-info" },
  { match: "read", label: "Reading", icon: BookOpenText, tone: "text-success" },
  { match: "writ", label: "Writing", icon: PenLine, tone: "text-warning" },
  { match: "speak", label: "Speaking", icon: Mic, tone: "text-brand" },
] as const;

function SectionBadge({ skill }: { skill: string }) {
  const found = SECTION_ICONS.find((item) => skill.toLowerCase().includes(item.match));
  if (!found) return <Badge variant="neutral">{skill}</Badge>;
  const Icon = found.icon;
  return (
    <Badge variant="neutral" className="inline-flex items-center gap-1">
      <Icon className={`size-3 ${found.tone}`} aria-hidden /> {found.label}
    </Badge>
  );
}

/** How long the student has been working: from the server's active seconds, else from the start time. */
function elapsedParts(startedAt: string, activeSeconds?: number): { hours: number; minutes: number; seconds: number } | null {
  let total: number;
  if (activeSeconds != null && activeSeconds >= 0) total = activeSeconds;
  else {
    const started = new Date(startedAt).getTime();
    if (Number.isNaN(started)) return null;
    total = Math.max(0, Math.floor((Date.now() - started) / 1000));
  }
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

export function GroupLiveMonitoring({ groupId }: { groupId: string }) {
  const t = useTranslations("liveMonitoring");
  const tl = useTranslations("mock.examLog");
  const { data, isLoading, isError, refetch, isFetching } = useGroupLiveMonitoring(groupId);
  const [selectedStudent, setSelectedStudent] = React.useState<LiveMonitoringStudent | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { if (selectedStudent) closeRef.current?.focus(); }, [selectedStudent]);

  const students = data?.students ?? [];
  const activeCount = students.length;
  const elapsedText = (st: LiveMonitoringStudent) => {
    const parts = elapsedParts(st.startedAt, st.timeActiveSeconds);
    if (!parts) return t("justStarted");
    if (parts.hours > 0) return t("activeHours", { hours: parts.hours, minutes: parts.minutes });
    if (parts.minutes > 0) return t("activeMinutes", { minutes: parts.minutes, seconds: parts.seconds });
    return t("activeSeconds", { seconds: parts.seconds });
  };

  return (
    <Card className="mb-6 border-brand/20 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="relative flex size-3" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex size-3 rounded-full bg-success" />
              </span>
              <CardTitle className="text-base font-bold text-fg">{t("title")}</CardTitle>
              <Badge variant={activeCount > 0 ? "success" : "neutral"} className="text-xs">
                {activeCount > 0 ? t("activeStudents", { count: activeCount }) : t("noActive")}
              </Badge>
            </div>
            <CardDescription className="text-xs text-fg-muted">{t("description")}</CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success sm:inline-flex">
              <Radio className="size-3 animate-pulse motion-reduce:animate-none" aria-hidden />
              {t("live")}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              title={t("refresh")}
              aria-label={t("refresh")}
            >
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-border bg-bg-subtle p-4 text-center">
            <p className="text-sm text-fg-muted">{t("loadError")}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
              {t("retry")}
            </Button>
          </div>
        ) : students.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-success-bg text-success">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <p className="mt-2.5 text-sm font-semibold text-fg">{t("emptyTitle")}</p>
            <p className="mt-1 max-w-sm text-xs text-fg-muted">{t("emptyBody")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {students.map((st) => {
              const recorded = st.antiCheatCount > 0;
              return (
                <li
                  key={st.attemptId || st.studentId}
                  className="flex flex-col gap-3 bg-surface p-3.5 transition-colors hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={st.name} size="md" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-fg">{st.name}</p>
                      <p className="truncate text-xs text-fg-muted">
                        {st.examTitle} {st.phone ? `· ${st.phone}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 sm:justify-center">
                    <SectionBadge skill={st.currentSection} />
                    <span className="flex items-center gap-1 text-xs text-fg-muted">
                      <Clock className="size-3.5" aria-hidden />
                      {elapsedText(st)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    {!recorded ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-success-border bg-success-bg px-3 py-1 text-xs font-semibold text-success">
                        <ShieldCheck className="size-3.5" aria-hidden />
                        {t("nothingRecorded")}
                      </span>
                    ) : (
                      // Recorded, never punished: the exam was not stopped (owner rule, phase 2).
                      <button
                        type="button"
                        onClick={() => setSelectedStudent(st)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-warning-border bg-warning-bg px-3 py-1 text-xs font-semibold text-warning transition-colors hover:bg-warning-bg/70"
                        aria-haspopup="dialog"
                      >
                        <ShieldAlert className="size-3.5" aria-hidden />
                        <span>{t("recordedCount", { count: st.antiCheatCount })}</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {selectedStudent && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
            onKeyDown={(event) => { if (event.key === "Escape") setSelectedStudent(null); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="live-monitoring-log-title"
              className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="size-5 text-warning" aria-hidden />
                  <h4 id="live-monitoring-log-title" className="text-base font-bold text-fg">{t("logTitle")}</h4>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setSelectedStudent(null)}
                  className="rounded-lg p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
                  aria-label={t("close")}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="mt-3 space-y-1.5">
                <p className="text-sm font-semibold text-fg">{selectedStudent.name}</p>
                <p className="text-xs text-fg-muted">
                  {t("logSummary", { exam: selectedStudent.examTitle, count: selectedStudent.antiCheatCount })}
                </p>
                <p className="text-xs text-fg-muted">{tl("note")}</p>
              </div>

              <div className="mt-4 max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-bg-subtle" tabIndex={0}>
                {(selectedStudent.anomalies ?? []).length === 0 ? (
                  <div className="p-3 text-center text-xs text-fg-muted">
                    {t("logNoTypes", { count: selectedStudent.antiCheatCount })}
                  </div>
                ) : (
                  (selectedStudent.anomalies ?? []).map((anomaly: CheatAnomalyEvent, index: number) => (
                    <div key={index} className="flex items-start justify-between gap-2 p-2.5 text-xs">
                      <span className="font-medium text-fg">{examLogEventText(tl, anomaly.event)}</span>
                      <span className="shrink-0 tabular-nums text-fg-muted">
                        {anomaly.date ? new Date(anomaly.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setSelectedStudent(null)}>
                  {t("close")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
