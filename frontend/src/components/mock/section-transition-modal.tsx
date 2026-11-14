"use client";

import * as React from "react";
import { Clock, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { MockSkill } from "@/lib/types";

interface SectionTransitionModalProps {
  open: boolean;
  completedSkill: MockSkill;
  nextSkill: MockSkill;
  onStartNext: () => void;
}

// Decorative only; names, tips and all other text come from messages (mock.transition.*). No durations are
// shown here: the real section timing comes from the attempt, not from a static table.
const SKILL_ICONS: Partial<Record<MockSkill, string>> = { listening: "🎧", reading: "📖", writing: "✍️", speaking: "🎙️" };
const KNOWN_SKILLS: MockSkill[] = ["listening", "reading", "writing", "speaking"];

export function SectionTransitionModal({
  open,
  completedSkill,
  nextSkill,
  onStartNext,
}: SectionTransitionModalProps) {
  const t = useTranslations("mock");
  const tt = useTranslations("mock.transition");
  const [secondsLeft, setSecondsLeft] = React.useState(60);

  React.useEffect(() => {
    if (!open) {
      setSecondsLeft(60);
      return;
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onStartNext();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [open, onStartNext]);

  if (!open) return null;

  const skillName = (skill: MockSkill) => (KNOWN_SKILLS.includes(skill) ? t(`skills.${skill}`) : String(skill));
  const nextTip = KNOWN_SKILLS.includes(nextSkill) ? tt(`tips.${nextSkill}`) : tt("tips.default");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div role="dialog" aria-modal="true" aria-labelledby="section-transition-title" className="relative w-full max-w-lg rounded-3xl border border-border bg-bg-subtle/95 p-6 sm:p-8 shadow-2xl text-center text-fg">
        {/* Success badge */}
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand/20 text-brand-subtle-fg ring-4 ring-brand/10">
          <CheckCircle2 className="size-8" />
        </div>

        <h2 id="section-transition-title" className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
          {tt("completed", { skill: skillName(completedSkill) })}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">{tt("saved")}</p>

        {/* Next Section Card */}
        <div className="mt-6 rounded-2xl border border-brand/20 bg-brand/5 p-5 text-left">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
              <Sparkles className="size-3.5" />
              {tt("next")}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <span className="text-3xl" aria-hidden>{SKILL_ICONS[nextSkill] ?? "🎯"}</span>
            <div>
              <p className="text-lg font-bold text-fg">{skillName(nextSkill)}</p>
              <p className="text-sm text-fg-muted">{nextTip}</p>
            </div>
          </div>
        </div>

        {/* Countdown */}
        <div className="mt-6 flex flex-col items-center">
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Clock className="size-4 animate-pulse text-brand" />
            <span>{tt("autoStart")}</span>
            <span className="font-bold tabular-nums text-fg text-base" aria-live="polite">
              {tt("seconds", { count: secondsLeft })}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full bg-brand transition-all duration-1000 ease-linear"
              style={{ width: `${(secondsLeft / 60) * 100}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6">
          <Button
            type="button"
            onClick={onStartNext}
            className="w-full min-h-[48px] bg-brand text-brand-fg font-bold text-sm shadow-lg hover:bg-brand-hover touch-manipulation"
          >
            {tt("startNow", { skill: skillName(nextSkill) })}
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
