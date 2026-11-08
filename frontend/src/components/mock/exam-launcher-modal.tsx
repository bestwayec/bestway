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

const SKILL_LABELS: Record<MockSkill, { uz: string; en: string; time: string }> = {
  listening: { uz: "Listening", en: "Listening", time: "~35 daq" },
  reading: { uz: "Reading", en: "Reading", time: "~60 daq" },
  writing: { uz: "Writing", en: "Writing", time: "~50 daq" },
  speaking: { uz: "Speaking", en: "Speaking", time: "~15 daq" },
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
  const [modeChoice, setModeChoice] = React.useState<"full" | "section">("full");
  const [selectedSkill, setSelectedSkill] = React.useState<MockPracticeSkill>("listening");

  const simulatorMode: ExamSimulatorMode = isMultilevel ? "dtm" : "cdi";

  const availableSkills: MockSkill[] = React.useMemo(() => {
    if ("skills" in exam && Array.isArray((exam as { skills?: unknown }).skills) && (exam as { skills: MockSkill[] }).skills.length > 0) {
      return (exam as { skills: MockSkill[] }).skills;
    }
    return ["listening", "reading", "writing", "speaking"];
  }, [exam]);

  React.useEffect(() => {
    if (!availableSkills.includes(selectedSkill as MockSkill)) {
      setSelectedSkill((availableSkills[0] as MockPracticeSkill) || "listening");
    }
  }, [availableSkills, selectedSkill]);

  function handleStart() {
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("bw_simulator_mode", simulatorMode);
      } catch {
        // Ignore storage error
      }
    }
    if (modeChoice === "full") {
      onStart("timed", undefined, simulatorMode);
    } else {
      onStart("timed", [selectedSkill], simulatorMode);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-[12px] border border-border bg-surface p-6">
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
            Topshirish rejimini tanlang va testni boshlang.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6 pt-4">
          {/* Oddiy ikki tugma: Full Mock vs Bitta bo'lim */}
          <div className="grid grid-cols-2 gap-2 rounded-[12px] border border-border bg-surface-elevated p-1.5">
            <button
              type="button"
              onClick={() => setModeChoice("full")}
              className={cn(
                "min-h-[44px] rounded-[8px] text-sm font-semibold transition-colors",
                modeChoice === "full"
                  ? "bg-brand text-brand-fg"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              Full Mock (To&apos;liq)
            </button>
            <button
              type="button"
              onClick={() => setModeChoice("section")}
              className={cn(
                "min-h-[44px] rounded-[8px] text-sm font-semibold transition-colors",
                modeChoice === "section"
                  ? "bg-brand text-brand-fg"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              Bitta bo&apos;lim (Section)
            </button>
          </div>

          {modeChoice === "full" ? (
            <div className="rounded-[12px] border border-border bg-surface p-4 text-sm text-fg-muted space-y-2">
              <p className="font-medium text-fg">Rasmiy ketma-ketlikda topshirish:</p>
              <p>
                Barcha 4 ta bo&apos;lim rasmiy imtihon tartibida ketma-ket topshiriladi:
                Listening → Reading → Writing → Speaking.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-fg">Kerakli bo&apos;limni tanlang:</p>
              <div className="grid grid-cols-2 gap-2">
                {availableSkills.map((skill) => {
                  const Icon = SKILL_ICONS[skill] || Headphones;
                  const isSelected = selectedSkill === skill;
                  const meta = SKILL_LABELS[skill] || { uz: skill, time: "" };

                  return (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => setSelectedSkill(skill as MockPracticeSkill)}
                      className={cn(
                        "flex items-center justify-between rounded-[8px] border p-3 min-h-[48px] text-left transition-colors",
                        isSelected
                          ? "border-brand bg-brand-subtle text-brand"
                          : "border-border bg-surface text-fg hover:border-brand/40"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0" />
                        <span className="text-sm font-semibold capitalize">{meta.uz}</span>
                      </div>
                      <span className="text-sm text-fg-muted">{meta.time}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bitta asosiy "Boshlash" tugmasi */}
          <Button
            type="button"
            loading={isStarting}
            onClick={handleStart}
            className="w-full min-h-[44px] bg-brand hover:bg-brand/90 text-brand-fg font-semibold text-base"
          >
            <Play className="mr-2 size-4 fill-current" />
            {modeChoice === "full" ? "Imtihonni boshlash" : "Bo'limni boshlash"}
          </Button>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
