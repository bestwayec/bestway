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
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { DeviceCheck } from "./device-check";
import { primeMicrophonePermission } from "@/lib/microphone";
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
  const tl = useTranslations("mock.launcher");
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
  // The server runs the full_test flow only for full_mock (and Writing+Speaking)
  // exams; offering it on a practice exam produced HTTP 400 MOCK_FULL_TEST_UNAVAILABLE.
  const rawProfile = (exam as { rawProfile?: string }).rawProfile ?? exam.profile;
  const fullMockAvailable = rawProfile === "full_mock" || rawProfile === "writing_speaking";

  async function triggerStart(mode: MockAttemptMode, skills?: MockPracticeSkill[]) {
    // Ask for the microphone now, before the exam goes full screen: Android will not show the
    // permission dialog over a full-screen page. A refusal never blocks the exam.
    if (!skills || skills.includes("speaking")) {
      const permission = await primeMicrophonePermission();
      if (permission === "denied") toast.warning(tl("micDenied"));
    }
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
                {tl("minutes", { count: exam.durationMinutes })}
              </span>
            )}
            <span className="flex items-center gap-1 text-sm text-fg-muted">
              <FileQuestion className="size-3.5" />
              {tl("questions", { count: exam.questionCount ?? 0 })}
            </span>
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-fg">
            {exam.title}
          </DialogTitle>
          <DialogDescription className="text-sm text-fg-muted">
            {tl("chooseMode")}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6 pt-2">
          <div className="rounded-[12px] border border-border bg-bg p-4 text-sm leading-relaxed text-fg-muted">
            <h3 className="mb-2 font-semibold text-fg">{tl("beforeTitle")}</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>{tl("before1")}</li>
              <li>{tl("before2")}</li>
              <li>{tl("before3")}</li>
            </ul>
            <DeviceCheck needsMicrophone={availableSkills.includes("speaking")} />
          </div>
          {fullMockAvailable ? (
            <>
          {/* Tanlov 1: To'liq Mock Imtihon (Full Mock) */}
          <div className="rounded-[12px] border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-fg">
                {tl("fullTitle")}
              </h3>
              <Badge variant="brand" className="text-sm">{tl("officialOrder")}</Badge>
            </div>
            <p className="text-sm text-fg-muted leading-relaxed">
              {tl("fullDescription")}
            </p>
            <Button
              type="button"
              loading={isStarting}
              onClick={() => triggerStart("timed", undefined)}
              className="w-full min-h-[44px] bg-brand hover:bg-brand-hover text-brand-fg font-semibold text-base"
            >
              <Play className="mr-2 size-4 fill-current" />
              {tl("startFull")}
            </Button>
          </div>
            </>
          ) : availableSkills.length > 1 ? (
            <div className="rounded-[12px] border border-border bg-surface p-5 space-y-3">
              <h3 className="text-base font-bold text-fg">{tl("allTitle")}</h3>
              <p className="text-sm text-fg-muted leading-relaxed">
                {tl("allDescription", { skills: availableSkills.map((s) => SKILL_TITLES[s]).join(" → ") })}
              </p>
              <Button
                type="button"
                loading={isStarting}
                onClick={() => triggerStart("practice", availableSkills as MockPracticeSkill[])}
                className="w-full min-h-[44px] bg-brand hover:bg-brand-hover text-brand-fg font-semibold text-base"
              >
                <Play className="mr-2 size-4 fill-current" />
                {tl("startAll")}
              </Button>
            </div>
          ) : null}

          {/* Tanlov 2: Alohida Bo'lim Topshirish (Single Section) */}
          <div className="rounded-[12px] border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-fg">
                {tl("singleTitle")}
              </h3>
              <span className="text-sm text-fg-muted">{tl("gradedSeparately")}</span>
            </div>
            <p className="text-sm text-fg-muted leading-relaxed">
              {tl("singleDescription")}
            </p>

            <div className="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2">
              {availableSkills.map((skill) => {
                const Icon = SKILL_ICONS[skill] || Headphones;
                const minutes = durations[skill];
                const meta = { title: SKILL_TITLES[skill] || skill, time: minutes ? tl("minutesShort", { count: minutes }) : "" };

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
                      <span>{tl("startSkill", { skill: meta.title })}</span>
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
