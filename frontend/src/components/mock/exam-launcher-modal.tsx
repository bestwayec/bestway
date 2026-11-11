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
import { cn } from "@/lib/utils";
import type {
  ExamSimulatorMode,
  MockAttemptMode,
  MockExamDetail,
  MockExamListItem,
  MockPracticeSkill,
  MockSkill,
} from "@/lib/types";

const SKILL_ICONS: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

const SKILL_TITLES: Record<MockSkill, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
  speaking: "Speaking",
};

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
  const simulatorMode: ExamSimulatorMode = isMultilevel ? "dtm" : "cdi";

  // Offer only sections the server confirmed as practice-ready, with the
  // server's own time limit; never a hard-coded estimate.
  const availableSkills: MockSkill[] = React.useMemo(() => {
    if (Array.isArray(exam.practiceSkills)) return exam.practiceSkills as MockSkill[];
    if ("skills" in exam && Array.isArray((exam as { skills?: unknown }).skills) && (exam as { skills: MockSkill[] }).skills.length > 0) {
      return (exam as { skills: MockSkill[] }).skills;
    }
    return ["listening", "reading", "writing", "speaking"];
  }, [exam]);
  const durations = exam.sectionDurations ?? {};

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
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-[12px] border border-border bg-surface p-4 sm:p-6">
        <DialogHeader className="text-left space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-sm">
              {isMultilevel ? "Multi-Level CEFR" : "IELTS Academic"}
            </Badge>
            {exam.durationMinutes != null && (
              <span className="flex items-center gap-1 text-sm text-fg-muted">
                <Clock className="size-3.5" />
                {exam.durationMinutes} daqiqa
              </span>
            )}
            <span className="flex items-center gap-1 text-sm text-fg-muted">
              <FileQuestion className="size-3.5" />
              {exam.questionCount} savol
            </span>
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-fg">
            {exam.title}
          </DialogTitle>
          <DialogDescription className="text-sm text-fg-muted">
            To&apos;liq imtihon yoki alohida bo&apos;limni tanlang.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6 pt-2">
          <div className="rounded-[12px] border border-border bg-bg p-4 text-sm leading-relaxed text-fg-muted">
            <h3 className="mb-2 font-semibold text-fg">Boshlashdan oldin</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>Barqaror internet ulanishini tekshiring.</li>
              <li>Listening uchun ovozni, Speaking uchun mikrofon va ruxsatlarni tekshiring.</li>
              <li>Javob saqlanganini ko‘rsatuvchi holatni kuzating; xato bo‘lsa qayta urinib ko‘ring.</li>
            </ul>
          </div>
          {/* Tanlov 1: To'liq Mock Imtihon (Full Mock) */}
          <div className="rounded-[12px] border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-fg">
                To&apos;liq Mock Imtihon (Full Mock)
              </h3>
              <Badge variant="brand" className="text-sm">Rasmiy Tartib</Badge>
            </div>
            <p className="text-sm text-fg-muted leading-relaxed">
              Barcha 4 ta bo&apos;lim ketma-ket topshiriladi: Listening → Reading → Writing → Speaking.
            </p>
            <Button
              type="button"
              loading={isStarting}
              onClick={() => triggerStart("timed", undefined)}
              className="w-full min-h-[44px] bg-brand hover:bg-brand/90 text-brand-fg font-semibold text-base"
            >
              <Play className="mr-2 size-4 fill-current" />
              To&apos;liq imtihonni boshlash (Full Mock)
            </Button>
          </div>

          {/* Tanlov 2: Alohida Bo'lim Topshirish (Single Section) */}
          <div className="rounded-[12px] border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-fg">
                Alohida Bo&apos;lim (Single Section)
              </h3>
              <span className="text-sm text-fg-muted">Alohida baholanadi</span>
            </div>
            <p className="text-sm text-fg-muted leading-relaxed">
              Ixtiyoriy bitta bo&apos;limni tanlab, mashq qiling:
            </p>

            <div className="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2">
              {availableSkills.map((skill) => {
                const Icon = SKILL_ICONS[skill] || Headphones;
                const minutes = durations[skill];
                const meta = { title: SKILL_TITLES[skill] || skill, time: minutes ? `${minutes} daq` : "" };

                return (
                  <Button
                    key={skill}
                    type="button"
                    variant="outline"
                    loading={isStarting}
                    onClick={() => triggerStart("timed", [skill as MockPracticeSkill])}
                    className="flex items-center justify-between min-h-[48px] px-3.5 border-border hover:border-brand text-fg font-semibold text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-brand" />
                      <span>{meta.title} Boshlash</span>
                    </span>
                    <span className="text-sm font-normal text-fg-muted">{meta.time}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
