"use client";

import * as React from "react";
import {
  AlertTriangle,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { useGroupLiveMonitoring } from "@/hooks/use-group-monitoring";
import type { CheatAnomalyEvent, LiveMonitoringStudent } from "@/lib/group-monitoring-types";

function formatAnomalyName(event: string): string {
  const norm = (event || "").toLowerCase();
  if (norm.includes("fullscreen")) return "Ekrandan chiqdi (exit_fullscreen)";
  if (norm.includes("tab_switch") || norm.includes("tab")) return "Boshqa tabga o'tdi (tab_switch)";
  if (norm.includes("blur") || norm.includes("focus") || norm.includes("window_loss"))
    return "Oynadan chiqib ketish (Window Blur / Focus Lost)";
  if (norm.includes("webcam") || norm.includes("camera")) return "Veb-kamera to'sildi yoki o'chirildi";
  if (norm.includes("copy") || norm.includes("paste")) return "Nusxalash aniqlandi (copy_paste)";
  if (norm.includes("cheat")) return "Taqiqlangan harakat (cheat_attempt)";
  if (norm.includes("monitor")) return "Ikkinchi monitor ulandi";
  return event;
}

function SectionBadge({ skill }: { skill: string }) {
  const norm = skill.toLowerCase();
  if (norm.includes("listen")) {
    return (
      <Badge variant="neutral" className="inline-flex items-center gap-1">
        <Headphones className="size-3 text-sky-500" /> Listening
      </Badge>
    );
  }
  if (norm.includes("read")) {
    return (
      <Badge variant="neutral" className="inline-flex items-center gap-1">
        <BookOpenText className="size-3 text-emerald-500" /> Reading
      </Badge>
    );
  }
  if (norm.includes("writ")) {
    return (
      <Badge variant="neutral" className="inline-flex items-center gap-1">
        <PenLine className="size-3 text-amber-500" /> Writing
      </Badge>
    );
  }
  if (norm.includes("speak")) {
    return (
      <Badge variant="neutral" className="inline-flex items-center gap-1">
        <Mic className="size-3 text-purple-500" /> Speaking
      </Badge>
    );
  }
  return <Badge variant="neutral">{skill}</Badge>;
}

function formatElapsed(startedAt: string, activeSeconds?: number): string {
  if (activeSeconds != null && activeSeconds >= 0) {
    const m = Math.floor(activeSeconds / 60);
    const s = activeSeconds % 60;
    return m > 0 ? `${m} daqiqa ${s} soniya faol` : `${s} soniya faol`;
  }
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return "Hozirgina boshlagan";
  const diffSec = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const m = Math.floor(diffSec / 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h} soat ${remM} daqiqa faol`;
  }
  return `${m} daqiqa faol`;
}

export function GroupLiveMonitoring({ groupId }: { groupId: string }) {
  const { data, isLoading, isError, refetch, isFetching } = useGroupLiveMonitoring(groupId);
  const [selectedStudent, setSelectedStudent] = React.useState<LiveMonitoringStudent | null>(null);

  const students = data?.students ?? [];
  const activeCount = students.length;

  return (
    <Card className="mb-6 border-brand/20 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
              </span>
              <CardTitle className="text-base font-bold text-fg">
                Jonli Imtihon Monitoringi (Live Monitoring)
              </CardTitle>
              <Badge variant={activeCount > 0 ? "success" : "neutral"} className="text-xs">
                {activeCount > 0 ? `${activeCount} ta o'quvchi faol` : "Faol imtihon yo'q"}
              </Badge>
            </div>
            <CardDescription className="text-xs text-fg-muted">
              Guruh o&apos;quvchilarining real vaqtdagi imtihon topshirish jarayoni va anti-cheat xavfsizligi
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 sm:inline-flex">
              <Radio className="size-3 animate-pulse" />
              Jonli efirda kuzatish
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              title="Yangilash"
            >
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
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
            <p className="text-sm text-fg-muted">Monitoring ma&apos;lumotlarini yuklashda xatolik yuz berdi.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
              Qayta urinish
            </Button>
          </div>
        ) : students.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
              <ShieldCheck className="size-5" />
            </div>
            <p className="mt-2.5 text-sm font-semibold text-fg">Hozirda faol imtihon yo&apos;q</p>
            <p className="mt-1 text-xs text-fg-muted max-w-sm">
              Guruh o&apos;quvchilari imtihon boshlaganida ularning holati, joriy bo&apos;limi va xavfsizlik nazorati shu yerda jonli chiqadi.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {students.map((st) => {
              const hasAnomaly = st.antiCheatCount > 0;

              return (
                <div
                  key={st.attemptId || st.studentId}
                  className="flex flex-col gap-3 bg-surface p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between hover:bg-surface-hover"
                >
                  {/* O'quvchi ma'lumoti */}
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={st.name} size="md" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-fg">{st.name}</p>
                      <p className="truncate text-xs text-fg-muted">
                        {st.examTitle} {st.phone ? `· ${st.phone}` : ""}
                      </p>
                    </div>
                  </div>

                  {/* Joriy bo'lim va vaqt */}
                  <div className="flex flex-wrap items-center gap-3 sm:justify-center">
                    <SectionBadge skill={st.currentSection} />
                    <span className="flex items-center gap-1 text-xs text-fg-muted">
                      <Clock className="size-3.5" />
                      {formatElapsed(st.startedAt, st.timeActiveSeconds)}
                    </span>
                  </div>

                  {/* Anti-Cheat / Xavfsiz Ekran statusi */}
                  <div className="flex items-center justify-between sm:justify-end gap-2">
                    {!hasAnomaly ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="size-3.5" />
                        🟢 Xavfsiz rejimda
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedStudent(st)}
                        className="group relative inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-600 animate-pulse hover:animate-none hover:bg-rose-500/25 transition-all cursor-pointer"
                        title="Batafsil ma'lumotni ko'rish"
                      >
                        <ShieldAlert className="size-3.5 text-rose-600" />
                        <span>🔴 Qoidabuzarlik: {st.antiCheatCount} marta!{st.anomalies?.[0]?.event?.toLowerCase().includes("blur") ? ` (${st.antiCheatCount} ta blur)` : st.anomalies?.[0]?.event ? ` (${st.anomalies[0].event})` : ""}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Qoidabuzarlik tafsilotlari modali */}
        {selectedStudent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-rose-600" />
                  <h4 className="text-base font-bold text-fg">Xavfsizlik Ogohlantirishlari</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStudent(null)}
                  className="rounded-lg p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-3 space-y-1.5">
                <p className="text-sm font-semibold text-fg">{selectedStudent.name}</p>
                <p className="text-xs text-fg-muted">
                  Imtihon: {selectedStudent.examTitle} · Jami qoidabuzarliklar: {selectedStudent.antiCheatCount} marta
                </p>
              </div>

              <div className="mt-4 max-h-60 overflow-y-auto divide-y divide-border rounded-xl border border-border bg-bg-subtle">
                {(selectedStudent.anomalies ?? []).length === 0 ? (
                  <div className="p-3 text-center text-xs text-fg-muted">
                    Qoidabuzarlik turi qayd etilmagan (jami {selectedStudent.antiCheatCount} ogohlantirish).
                  </div>
                ) : (
                  (selectedStudent.anomalies ?? []).map((anomaly: CheatAnomalyEvent, index: number) => (
                    <div key={index} className="flex items-start justify-between gap-2 p-2.5 text-xs">
                      <span className="font-medium text-rose-600 dark:text-rose-400">
                        {formatAnomalyName(anomaly.event)}
                      </span>
                      <span className="shrink-0 text-fg-muted">
                        {anomaly.date ? new Date(anomaly.date).toLocaleTimeString() : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setSelectedStudent(null)}>
                  Yopish
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
