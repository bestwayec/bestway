"use client";

import * as React from "react";
import {
  BookOpenText,
  Clock,
  FileQuestion,
  Headphones,
  Mic,
  PenLine,
  Play,
  Sparkles,
  Timer,
  CheckCircle2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ExamSimulatorMode, MockAttemptMode, MockExamDetail, MockExamListItem, MockPracticeSkill } from "@/lib/types";

interface ExamLauncherModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: MockExamListItem | MockExamDetail;
  onStart: (mode: MockAttemptMode, skills?: MockPracticeSkill[], simulatorMode?: ExamSimulatorMode) => void;
  isStarting?: boolean;
}

export function ExamLauncherModal({
  open,
  onOpenChange,
  exam,
  onStart,
  isStarting,
}: ExamLauncherModalProps) {
  const isMultilevel = exam.type === "multilevel";
  const [simulatorMode, setSimulatorMode] = React.useState<ExamSimulatorMode>(
    isMultilevel ? "dtm" : "cdi"
  );

  React.useEffect(() => {
    setSimulatorMode(isMultilevel ? "dtm" : "cdi");
  }, [isMultilevel, exam.id]);

  function triggerStart(mode: MockAttemptMode, skills?: MockPracticeSkill[]) {
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("bw_simulator_mode", simulatorMode);
      } catch {
        // Ignore storage error
      }
    }
    onStart(mode, skills, simulatorMode);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden border-border bg-surface">
        <DialogHeader className="bg-bg-subtle/80 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">
              {isMultilevel ? "Multi-Level CEFR" : "IELTS Academic"}
            </Badge>
            {exam.isDemo && <Badge variant="neutral">Demo</Badge>}
            <span className="text-xs text-fg-muted flex items-center gap-1">
              <FileQuestion className="size-3.5" />
              {exam.questionCount} savol
            </span>
            {Boolean("durationMinutes" in exam ? exam.durationMinutes : "sections" in exam) && (
              <span className="text-xs text-fg-muted flex items-center gap-1">
                <Clock className="size-3.5" />
                ~{"durationMinutes" in exam ? exam.durationMinutes : ("sections" in exam ? (exam.sections as Array<{ durationMinutes?: number | null }>).reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0) : null)} daqiqa
              </span>
            )}
          </div>
          <DialogTitle className="mt-2 text-xl font-bold tracking-tight text-fg">
            {exam.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            Topshirish rejimini va rasmiy imtihon interfeysini tanlang
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5 px-6 py-5 max-h-[75vh] overflow-y-auto">
          {/* Official Simulator Interface Selector */}
          <div className="rounded-xl border border-border bg-bg-subtle/60 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-fg">
                Imtihon Simulyatori Interfeysi (Simulator Mode)
              </span>
              <Badge variant="info" className="text-[11px]">
                {simulatorMode === "cdi" ? "IELTS CDI (Inspera)" : "Multi-Level DTM"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSimulatorMode("cdi")}
                className={`flex flex-col items-start rounded-lg border p-3 text-left transition-all ${
                  simulatorMode === "cdi"
                    ? "border-brand bg-brand/10 ring-1 ring-brand"
                    : "border-border bg-surface hover:border-brand/40"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-xs font-bold text-fg">IELTS Computer-Delivered (CDI)</span>
                  {simulatorMode === "cdi" && <CheckCircle2 className="size-4 text-brand" />}
                </div>
                <p className="mt-1 text-[11px] text-fg-muted leading-snug">
                  Kontrast mavzular (Oq, Qora/Sariq, Kulrang), 3 xil Highlighter, Underline va Sticky Notes (Izohlar) oynasi.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSimulatorMode("dtm")}
                className={`flex flex-col items-start rounded-lg border p-3 text-left transition-all ${
                  simulatorMode === "dtm"
                    ? "border-brand bg-brand/10 ring-1 ring-brand"
                    : "border-border bg-surface hover:border-brand/40"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-xs font-bold text-fg">Multi-Level DTM Simulyatori</span>
                  {simulatorMode === "dtm" && <CheckCircle2 className="size-4 text-brand" />}
                </div>
                <p className="mt-1 text-[11px] text-fg-muted leading-snug">
                  50/50 Vertikal Split-Screen, DTM pastki savollar palitrasi (Yashil/Kulrang/Sariq), Belgilash (Flag) va To&apos;liq ekran.
                </p>
              </button>
            </div>
          </div>

          {/* Rejim 1: Full Mock Exam */}
          <div className="rounded-xl border-2 border-brand/40 bg-gradient-to-br from-brand/10 via-surface to-surface p-4 shadow-sm transition-all hover:border-brand/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-brand text-xs font-bold text-white shadow-xs">
                  1
                </span>
                <h3 className="font-bold text-base text-fg">
                  To&apos;liq Mock Imtihon (Full Mock)
                </h3>
              </div>
              <Badge variant="success" className="gap-1 text-xs font-semibold">
                <Sparkles className="size-3 fill-current" />
                Rasmiy CBT Oqimi
              </Badge>
            </div>

            <p className="mt-2 text-xs text-fg-muted leading-relaxed">
              Barcha 4 ta bo&apos;lim rasmiy tartibda ketma-ket topshiriladi:{" "}
              <strong className="text-fg font-medium">1. Listening → 2. Reading → 3. Writing → 4. Speaking</strong>.
              Har bir bo&apos;lim qat&apos;iy vaqt bilan nazorat qilinadi.
            </p>

            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <Button
                className="flex-1 bg-brand font-bold text-white shadow-sm hover:bg-brand-hover"
                loading={isStarting}
                onClick={() => triggerStart("timed")}
              >
                <Timer className="size-4 mr-1.5" />
                To&apos;liq Imtihonni Boshlash (Timed)
              </Button>
              <Button
                variant="outline"
                className="font-medium"
                loading={isStarting}
                onClick={() => triggerStart("practice")}
              >
                <Play className="size-4 mr-1.5 fill-current" />
                Mashq Rejimi (Practice)
              </Button>
            </div>
          </div>

          {/* Rejim 2: Section Practice */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-sky-500/20 text-sky-600 dark:text-sky-400 text-xs font-bold">
                  2
                </span>
                <h3 className="font-bold text-base text-fg">
                  Alohida Bo&apos;lim Topshirish (Single Section)
                </h3>
              </div>
              <span className="text-xs text-fg-muted">Alohida baholanadi</span>
            </div>
            <p className="text-xs text-fg-muted">
              Ixtiyoriy bitta bo&apos;limni tanlang. Bo&apos;lim topshirilishi bilanoq natijasi va tahlili darhol ko&apos;rsatiladi:
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Listening */}
              <div className="group flex flex-col justify-between rounded-xl border border-border bg-bg-subtle/50 p-3.5 transition-all hover:border-brand/40 hover:bg-surface">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold text-fg">
                      <Headphones className="size-4 text-emerald-500" />
                      Listening
                    </span>
                    <span className="text-[11px] text-fg-subtle">~35 daq</span>
                  </div>
                  <p className="mt-1.5 text-xs text-fg-muted">
                    Audio tinglash, part bo&apos;yicha stepper va avtomatik aniq ball.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full font-medium group-hover:border-brand/60 group-hover:text-brand"
                  loading={isStarting}
                  onClick={() => triggerStart("timed", ["listening"])}
                >
                  <Play className="size-3.5 mr-1 fill-current" />
                  Listening Boshlash
                </Button>
              </div>

              {/* Reading */}
              <div className="group flex flex-col justify-between rounded-xl border border-border bg-bg-subtle/50 p-3.5 transition-all hover:border-brand/40 hover:bg-surface">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold text-fg">
                      <BookOpenText className="size-4 text-sky-500" />
                      Reading
                    </span>
                    <span className="text-[11px] text-fg-subtle">~60 daq</span>
                  </div>
                  <p className="mt-1.5 text-xs text-fg-muted">
                    Matnlar, CBT Highlight & Underline vositalari va tezkor ball.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full font-medium group-hover:border-brand/60 group-hover:text-brand"
                  loading={isStarting}
                  onClick={() => triggerStart("timed", ["reading"])}
                >
                  <Play className="size-3.5 mr-1 fill-current" />
                  Reading Boshlash
                </Button>
              </div>

              {/* Writing */}
              <div className="group flex flex-col justify-between rounded-xl border border-border bg-bg-subtle/50 p-3.5 transition-all hover:border-brand/40 hover:bg-surface">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold text-fg">
                      <PenLine className="size-4 text-amber-500" />
                      Writing
                    </span>
                    <span className="text-[11px] text-fg-subtle">~45–60 daq</span>
                  </div>
                  <p className="mt-1.5 text-xs text-fg-muted">
                    Esse terish, so&apos;zlar hisoblagichi va xolis AI tahlili.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full font-medium group-hover:border-brand/60 group-hover:text-brand"
                  loading={isStarting}
                  onClick={() => triggerStart("timed", ["writing"])}
                >
                  <Play className="size-3.5 mr-1 fill-current" />
                  Writing Boshlash
                </Button>
              </div>

              {/* Speaking */}
              <div className="group flex flex-col justify-between rounded-xl border border-border bg-bg-subtle/50 p-3.5 transition-all hover:border-brand/40 hover:bg-surface">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold text-fg">
                      <Mic className="size-4 text-rose-500" />
                      Speaking
                    </span>
                    <span className="text-[11px] text-fg-subtle">~15 daq</span>
                  </div>
                  <p className="mt-1.5 text-xs text-fg-muted">
                    WebRTC audio yozib olish, taymerli partlar va AI nutq baholash.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full font-medium group-hover:border-brand/60 group-hover:text-brand"
                  loading={isStarting}
                  onClick={() => triggerStart("timed", ["speaking"])}
                >
                  <Play className="size-3.5 mr-1 fill-current" />
                  Speaking Boshlash
                </Button>
              </div>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
