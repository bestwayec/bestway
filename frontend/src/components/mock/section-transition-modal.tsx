"use client";

import * as React from "react";
import { Clock, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MockSkill } from "@/lib/types";

interface SectionTransitionModalProps {
  open: boolean;
  completedSkill: MockSkill;
  nextSkill: MockSkill;
  onStartNext: () => void;
}

const SKILL_NAMES: Record<MockSkill, { name: string; icon: string; tips: string; duration: string }> = {
  listening: {
    name: "Listening",
    icon: "🎧",
    tips: "Audio avtomatik yangraydi. Diqqat bilan tinglang va javoblarni belgilang.",
    duration: "35–40 daqiqa",
  },
  reading: {
    name: "Reading",
    icon: "📖",
    tips: "Matnlarni o'qib, savollarga javob bering. Part / Passage tablari orqali o'ting.",
    duration: "60 daqiqa",
  },
  writing: {
    name: "Writing",
    icon: "✍️",
    tips: "Vazifalar bo'yicha insho yozing. So'zlar soni hisoblagichiga e'tibor qarating.",
    duration: "45–60 daqiqa",
  },
  speaking: {
    name: "Speaking",
    icon: "🎙️",
    tips: "Savollarni tinglang va mikrofon orqali aniq, ravshan javob bering.",
    duration: "12–15 daqiqa",
  },
};

export function SectionTransitionModal({
  open,
  completedSkill,
  nextSkill,
  onStartNext,
}: SectionTransitionModalProps) {
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

  const completedInfo = SKILL_NAMES[completedSkill] ?? { name: completedSkill, icon: "✓" };
  const nextInfo = SKILL_NAMES[nextSkill] ?? {
    name: nextSkill,
    icon: "🎯",
    tips: "Keyingi bo'limga tayyorlaning.",
    duration: "Standart vaqt",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0B0F17]/95 p-6 sm:p-8 shadow-2xl text-center text-white">
        {/* Success badge */}
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 ring-4 ring-emerald-500/10">
          <CheckCircle2 className="size-8" />
        </div>

        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
          {completedInfo.name} bo&apos;limi yakunlandi!
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Javoblaringiz tizimda to&apos;liq saqlandi.
        </p>

        {/* Next Section Card */}
        <div className="mt-6 rounded-2xl border border-brand/20 bg-brand/5 p-5 text-left">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
              <Sparkles className="size-3.5" />
              Keyingi bo&apos;lim
            </span>
            <span className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Clock className="size-3.5" />
              {nextInfo.duration}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <span className="text-3xl">{nextInfo.icon}</span>
            <div>
              <p className="text-lg font-bold text-white">{nextInfo.name}</p>
              <p className="text-xs text-zinc-400">{nextInfo.tips}</p>
            </div>
          </div>
        </div>

        {/* Countdown */}
        <div className="mt-6 flex flex-col items-center">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Clock className="size-4 animate-pulse text-brand" />
            <span>Avtomatik boshlanishiga:</span>
            <span className="font-bold tabular-nums text-white text-base">
              {secondsLeft} soniya
            </span>
          </div>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-zinc-800">
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
            className="w-full min-h-[48px] bg-brand text-brand-fg font-bold text-sm shadow-lg hover:bg-brand/90 touch-manipulation"
          >
            Hozir boshlash ({nextInfo.name})
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
