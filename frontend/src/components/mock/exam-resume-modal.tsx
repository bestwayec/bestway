"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Headphones, BookOpenText, PenLine, Mic, ArrowRight } from "lucide-react";
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

const SKILL_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; desc: string; emoji: string }
> = {
  writing: {
    label: "Writing",
    icon: <PenLine className="size-5 text-amber-500" />,
    desc: "Insholar va xat yozish topshiriqlari",
    emoji: "✍️",
  },
  speaking: {
    label: "Speaking",
    icon: <Mic className="size-5 text-emerald-500" />,
    desc: "Og'zaki javoblar va audio yozish topshiriqlari",
    emoji: "🗣️",
  },
  reading: {
    label: "Reading",
    icon: <BookOpenText className="size-5 text-blue-500" />,
    desc: "Matnlarni o'qish va tahlil qilish",
    emoji: "📖",
  },
  listening: {
    label: "Listening",
    icon: <Headphones className="size-5 text-purple-500" />,
    desc: "Audio eshitish va savollarga javob berish",
    emoji: "🎧",
  },
};

export function ExamResumeModal({
  open,
  onOpenChange,
  attemptId,
  skills,
  examTitle,
}: ExamResumeModalProps) {
  const router = useRouter();

  const handleSelectSkill = (skill: MockSkill) => {
    onOpenChange(false);
    router.push(`/mock/attempt/${attemptId}?skill=${skill}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 bg-[#0B0F17] border border-border text-fg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-fg">
            Qaysi bo&apos;limni davom ettirmoqchisiz?
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            {examTitle ? `${examTitle} — ` : ""}Istalgan bo&apos;limni tanlab, o&apos;sha yerdan davom ettirishingiz mumkin.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-2.5">
          {skills.map((skill) => {
            const config = SKILL_CONFIG[skill] || {
              label: skill.toUpperCase(),
              icon: <PenLine className="size-5 text-brand" />,
              desc: `${skill} bo'limi`,
              emoji: "📝",
            };
            return (
              <button
                key={skill}
                type="button"
                onClick={() => handleSelectSkill(skill)}
                className="group flex w-full items-center justify-between rounded-xl border border-border bg-surface p-4 text-left transition-all hover:border-emerald-500/50 hover:bg-emerald-500/5 active:scale-[0.99]"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-subtle group-hover:border-emerald-500/30">
                    <span className="text-lg">{config.emoji}</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-fg group-hover:text-emerald-400">
                      {config.label}
                    </h3>
                    <p className="text-xs text-fg-muted">{config.desc}</p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-fg-muted transition-transform group-hover:translate-x-1 group-hover:text-emerald-400" />
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
