"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { BookOpenText, CalendarClock, CheckCircle2, Clock, FileQuestion, Headphones, Mic, PenLine, ShieldCheck, XCircle } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { DeviceCheck, type ReadinessSummary } from "./device-check";
import type { MockSkill } from "@/lib/types";

const SKILL_ICON: Record<MockSkill, typeof Headphones> = { listening: Headphones, reading: BookOpenText, writing: PenLine, speaking: Mic };
const tashkent = (iso: string) => new Date(iso).toLocaleString(undefined, { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" });

export type AssignmentWindow = { assignmentTitle?: string; timingPolicy?: string; opensAt?: string | null; deadline?: string };
type Eligibility = { state: "checking" } | { state: "ok"; window: AssignmentWindow } | { state: "fail"; code: string };

/**
 * Pre-exam readiness screen for a timed attempt: the real exam facts (type, skills, positions, duration,
 * assignment window and timing policy), the rules, eligibility confirmed by the server and the device
 * check. Nothing here creates the attempt; only "Start" does, through the caller.
 */
export function ExamReadinessDialog({
  open,
  onOpenChange,
  title,
  examType,
  skills,
  questionCount,
  durationMinutes,
  sectionDurations,
  assignmentId,
  starting,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  examType: string;
  skills: MockSkill[];
  questionCount?: number | null;
  durationMinutes?: number | null;
  sectionDurations?: Partial<Record<MockSkill, number>>;
  assignmentId?: string | null;
  starting?: boolean;
  onStart: () => void;
}) {
  const t = useTranslations("mock.readiness");
  const tSkills = useTranslations("mock.skills");
  const [eligibility, setEligibility] = React.useState<Eligibility | null>(null);
  const [summary, setSummary] = React.useState<ReadinessSummary>({ done: false, requiredProblems: 0 });

  const checkEligibility = React.useCallback(() => {
    if (!assignmentId) return;
    setEligibility({ state: "checking" });
    api.get<AssignmentWindow>(`/student/assignments/${encodeURIComponent(assignmentId)}/exam`)
      .then((value) => setEligibility({ state: "ok", window: value }))
      .catch((error: unknown) => setEligibility({ state: "fail", code: (error as { code?: string })?.code ?? "UNKNOWN" }));
  }, [assignmentId]);
  React.useEffect(() => { if (open) checkEligibility(); }, [open, checkEligibility]);

  const assignmentWindow = eligibility?.state === "ok" ? eligibility.window : null;
  const minutes = durationMinutes ?? skills.reduce((sum, skill) => sum + (sectionDurations?.[skill] ?? 0), 0);
  const blocked = eligibility?.state === "fail";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto" data-testid="exam-readiness">
        <DialogHeader className="space-y-2 text-left">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <Badge variant="outline">{examType === "multilevel" ? "Multilevel CEFR" : "IELTS Academic"}</Badge>
            {minutes > 0 && <span className="flex items-center gap-1"><Clock className="size-3.5" aria-hidden />{t("minutes", { count: minutes })}</span>}
            {questionCount ? <span className="flex items-center gap-1"><FileQuestion className="size-3.5" aria-hidden />{t("positions", { count: questionCount })}</span> : null}
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <ul className="flex flex-wrap gap-1.5" aria-label={t("skills")}>
            {skills.map((skill) => {
              const Icon = SKILL_ICON[skill];
              return (
                <li key={skill} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-1 text-sm text-fg">
                  <Icon className="size-3.5 text-brand" aria-hidden />{tSkills(skill)}
                  {sectionDurations?.[skill] ? <span className="text-fg-muted">· {t("minutesShort", { count: sectionDurations[skill]! })}</span> : null}
                </li>
              );
            })}
          </ul>

          {assignmentId && (
            <div className="rounded-card border border-border p-3 text-sm" data-testid="readiness-eligibility" data-state={eligibility?.state ?? "idle"}>
              <p className="flex items-center gap-2 font-medium text-fg">
                <CalendarClock className="size-4 text-fg-muted" aria-hidden />{t("assignment")}
                {eligibility?.state === "ok" && <CheckCircle2 className="size-4 text-success" aria-hidden />}
                {eligibility?.state === "fail" && <XCircle className="size-4 text-danger" aria-hidden />}
              </p>
              {eligibility?.state === "checking" && <p className="mt-1 text-fg-muted">{t("checking")}</p>}
              {assignmentWindow && (
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-fg-muted">
                  {assignmentWindow.opensAt && <><dt>{t("opens")}</dt><dd className="text-fg">{tashkent(assignmentWindow.opensAt)}</dd></>}
                  {assignmentWindow.deadline && <><dt>{t("closes")}</dt><dd className="text-fg">{tashkent(assignmentWindow.deadline)}</dd></>}
                  <dt>{t("timing")}</dt>
                  <dd className="text-fg">{t(assignmentWindow.timingPolicy === "fixed_close" ? "timingFixed" : "timingIndividual")}</dd>
                </dl>
              )}
              {eligibility?.state === "fail" && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-danger">{t(`eligibility.${["ASSIGNMENT_EXPIRED", "ASSIGNMENT_ALREADY_SUBMITTED", "NOT_FOUND"].includes(eligibility.code) ? eligibility.code : "UNKNOWN"}`)}</p>
                  {eligibility.code === "UNKNOWN" && <Button size="sm" variant="ghost" onClick={checkEligibility}>{t("retry")}</Button>}
                </div>
              )}
            </div>
          )}

          <div className="rounded-card border border-border bg-bg p-3 text-sm text-fg-muted">
            <p className="mb-1.5 flex items-center gap-2 font-semibold text-fg"><ShieldCheck className="size-4 text-brand" aria-hidden />{t("rulesTitle")}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("ruleTimer")}</li>
              {skills.includes("listening") && <li>{t("ruleListening")}</li>}
              <li>{t("ruleSaving")}</li>
              <li>{t("ruleOneSession")}</li>
              {skills.includes("speaking") && <li>{t("ruleSpeaking")}</li>}
              <li>{t("ruleFullscreen")}</li>
            </ul>
            <DeviceCheck needsMicrophone={skills.includes("speaking")} checkSession onSummary={setSummary} />
          </div>
        </DialogBody>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="button" className="flex-1" loading={starting} disabled={blocked || eligibility?.state === "checking"} onClick={onStart} data-testid="readiness-start">
            {summary.done && summary.requiredProblems > 0 ? t("startAnyway") : t("start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
