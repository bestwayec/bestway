"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMockExam } from "@/hooks/use-mock";
import { cn } from "@/lib/utils";
import type { MockAttemptMode, MockPracticeSkill, MockSkill } from "@/lib/types";

export type PracticeChoice = { groupIds?: string[]; timer?: "none" | "section" | "part" };

/** Default section time when the author gave none (the server uses the same defaults). */
const DEFAULT_MINUTES: Record<MockSkill, number> = { listening: 40, reading: 60, writing: 60, speaking: 15 };

/** A part's share of the section time by questions, in whole minutes (at least one), like the server. */
export function partMinutes(sectionMinutes: number, partQuestions: number, sectionQuestions: number): number {
  return Math.max(1, Math.ceil((sectionMinutes * partQuestions) / Math.max(1, sectionQuestions)));
}

function Choice({ name, value, current, onChange, label, hint }: {
  name: string; value: string; current: string; onChange: (value: string) => void; label: string; hint?: string;
}) {
  const id = `${name}-${value}`;
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-2 rounded-field border p-2.5 text-sm",
      current === value ? "border-brand bg-brand-subtle" : "border-border bg-surface hover:bg-surface-hover")}>
      <input id={id} type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value)} className="mt-0.5 accent-brand" />
      <span>
        <span className="font-medium text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Starting one section from the catalogue: the exam (official rules: one play, server time,
 * no help) or practice (all parts or one, no timer / the section's time / the part's share,
 * with the practice tools). Practice results are raw, never a band.
 */
export function SectionStartDialog({ open, onOpenChange, examId, skill, onStart }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  skill: MockPracticeSkill;
  onStart: (mode: MockAttemptMode, skills: MockPracticeSkill[], practice?: PracticeChoice) => void;
}) {
  const t = useTranslations("mock.sectionStart");
  const tm = useTranslations("mock");
  const examQ = useMockExam(open ? examId : "");
  const section = examQ.data?.sections.find((s) => s.skill === skill);
  const groups = section?.groups ?? [];
  const sectionQuestions = groups.reduce((n, g) => n + g.questions.length, 0);
  const sectionMinutes = section?.durationMinutes ?? DEFAULT_MINUTES[skill];
  const [mode, setMode] = React.useState<"practice" | "timed">("practice");
  const [part, setPart] = React.useState("all");
  const [timer, setTimer] = React.useState<"none" | "section" | "part">("none");
  const chosen = groups.find((g) => g.id === part);
  React.useEffect(() => { if (part === "all" && timer === "part") setTimer("none"); }, [part, timer]);
  const auto = skill === "listening" || skill === "reading";
  const partName = (index: number, title?: string | null) => title || t(skill === "reading" ? "passageN" : "partN", { n: index + 1 });

  const start = () => {
    if (mode === "timed") onStart("timed", [skill]);
    else onStart("practice", [skill], { groupIds: part === "all" ? undefined : [part], timer });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title", { skill: tm(`skills.${skill}`) })}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-semibold text-fg">{t("modeLabel")}</legend>
            <Choice name="start-mode" value="practice" current={mode} onChange={() => setMode("practice")} label={t("modePractice")} hint={t(auto ? "modePracticeHint" : "modePracticeHintManual")} />
            <Choice name="start-mode" value="timed" current={mode} onChange={() => setMode("timed")} label={t("modeExam")} hint={t("modeExamHint")} />
          </fieldset>
          {mode === "practice" && (
            <>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-sm font-semibold text-fg">{t("partLabel")}</legend>
                <Choice name="start-part" value="all" current={part} onChange={setPart} label={t("allParts")} hint={t("questions", { count: sectionQuestions })} />
                {groups.map((g, i) => (
                  <Choice key={g.id} name="start-part" value={g.id} current={part} onChange={setPart} label={partName(i, g.title)} hint={t("questions", { count: g.questions.length })} />
                ))}
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-sm font-semibold text-fg">{t("timerLabel")}</legend>
                <Choice name="start-timer" value="none" current={timer} onChange={() => setTimer("none")} label={t("timerNone")} />
                <Choice name="start-timer" value="section" current={timer} onChange={() => setTimer("section")} label={t("timerSection", { minutes: sectionMinutes })} />
                {chosen && (
                  <Choice name="start-timer" value="part" current={timer} onChange={() => setTimer("part")}
                    label={t("timerPart", { minutes: partMinutes(sectionMinutes, chosen.questions.length, sectionQuestions) })} hint={t("timerPartHint")} />
                )}
              </fieldset>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="button" onClick={start} disabled={mode === "practice" && examQ.isPending}>{t(mode === "timed" ? "startExam" : "startPractice")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
