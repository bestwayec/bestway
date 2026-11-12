"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Headphones, BookOpenText, PenLine, Mic, ArrowRight } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { MockSkill } from "@/lib/types";

interface ExamResumeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attemptId: string;
  skills: MockSkill[];
  examTitle?: string;
}

const KNOWN_SKILLS = ["listening", "reading", "writing", "speaking"] as const;
type KnownSkill = (typeof KNOWN_SKILLS)[number];

const SKILL_ICON: Record<KnownSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

const isKnownSkill = (skill: string): skill is KnownSkill => (KNOWN_SKILLS as readonly string[]).includes(skill);

export function ExamResumeModal({
  open,
  onOpenChange,
  attemptId,
  skills,
  examTitle,
}: ExamResumeModalProps) {
  const t = useTranslations("mock.resumeDialog");
  const tSkills = useTranslations("mock.skills");
  // Locale-aware router: an English user stays on /en/... instead of bouncing through the Uzbek path.
  const router = useRouter();

  const handleSelectSkill = (skill: MockSkill) => {
    onOpenChange(false);
    router.push(`/mock/attempt/${attemptId}?skill=${skill}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 bg-bg-subtle border border-border text-fg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-fg">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            {examTitle ? t("descriptionWithTitle", { title: examTitle }) : t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-2.5">
          {skills.map((skill) => {
            const known = isKnownSkill(skill);
            const Icon = known ? SKILL_ICON[skill] : PenLine;
            const label = known ? tSkills(skill) : String(skill).toUpperCase();
            const desc = known ? t(skill) : t("other", { skill: String(skill) });
            return (
              <button
                key={skill}
                type="button"
                onClick={() => handleSelectSkill(skill)}
                className="group flex w-full items-center justify-between rounded-xl border border-border bg-surface p-4 text-left transition-all hover:border-brand/50 hover:bg-brand-hover/5 active:scale-[0.99]"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-subtle text-fg-muted group-hover:border-brand/30 group-hover:text-brand">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-fg group-hover:text-brand">
                      {label}
                    </h3>
                    <p className="text-xs text-fg-muted">{desc}</p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-fg-muted transition-transform group-hover:translate-x-1 group-hover:text-brand" />
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
