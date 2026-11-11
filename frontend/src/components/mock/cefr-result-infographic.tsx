"use client";

import * as React from "react";
import { Award, BookOpenText, CheckCircle2, ChevronRight, Headphones, Mic, PenLine, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { MockSkill } from "@/lib/types";
import { MULTILEVEL_CEFR_BANDS, multilevelBandFor } from "@/lib/multilevel-scale";

export interface SkillScoreData {
  skill: MockSkill;
  title?: string;
  score?: number | null;
  max?: number | null;
  standardScore?: number | null;
  band?: number | null;
}

export interface CefrResultInfographicProps {
  cefrLevel?: string | null;
  overallScore?: number | null;
  overallBand?: number | null;
  isIelts?: boolean;
  sections: SkillScoreData[];
  examTitle?: string;
  completedAt?: string | null;
  className?: string;
}

const SKILL_ICONS: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

const SKILL_COLORS: Record<MockSkill, { bar: string; text: string; bg: string }> = {
  listening: { bar: "bg-emerald-500", text: "text-emerald-500", bg: "bg-emerald-500/10" },
  reading: { bar: "bg-blue-500", text: "text-blue-500", bg: "bg-blue-500/10" },
  writing: { bar: "bg-purple-500", text: "text-purple-500", bg: "bg-purple-500/10" },
  speaking: { bar: "bg-amber-500", text: "text-amber-500", bg: "bg-amber-500/10" },
};

export function getCefrMeta(level?: string | null) {
  const norm = (level ?? "").trim().toUpperCase();
  if (norm.includes("C1")) {
    return {
      label: "C1 — Effective Operational Proficiency",
      color: "from-emerald-600 to-teal-500",
      badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
      bandMin: multilevelBandFor("C1").min,
      bandMax: multilevelBandFor("C1").max,
      desc: "Can express ideas fluently and spontaneously without much obvious searching for expressions.",
    };
  }
  if (norm.includes("B2")) {
    return {
      label: "B2 — Vantage / Independent User",
      color: "from-sky-600 to-blue-500",
      badge: "border-sky-500/40 bg-sky-500/15 text-sky-400",
      bandMin: multilevelBandFor("B2").min,
      bandMax: multilevelBandFor("B2").max,
      desc: "Can interact with a degree of fluency and spontaneity with native speakers.",
    };
  }
  if (norm.includes("B1")) {
    return {
      label: "B1 — Threshold / Independent User",
      color: "from-amber-600 to-yellow-500",
      badge: "border-amber-500/40 bg-amber-500/15 text-amber-400",
      bandMin: multilevelBandFor("B1").min,
      bandMax: multilevelBandFor("B1").max,
      desc: "Can understand the main points of clear standard input on familiar matters.",
    };
  }
  return {
    label: norm ? `${norm} — Basic User` : "A2 / Below B1",
    color: "from-fg-subtle to-fg-subtle",
    badge: "border-border-strong/40 bg-fg-subtle/15 text-fg-muted",
    bandMin: MULTILEVEL_CEFR_BANDS[0].min,
    bandMax: MULTILEVEL_CEFR_BANDS[0].max,
    desc: "Can understand basic sentences and frequently used expressions related to immediate areas.",
  };
}

export function CefrResultInfographic({
  cefrLevel,
  overallScore,
  overallBand,
  isIelts = false,
  sections,
  examTitle,
  completedAt,
  className = "",
}: CefrResultInfographicProps) {
  // A single-section practice has no overall score or level: never dress it
  // up as "A2 / Below B1" or draw a level bar for a score that does not exist.
  const hasOverall = isIelts ? overallBand != null : overallScore != null && Boolean(cefrLevel);
  const meta = getCefrMeta(cefrLevel);
  const totalScore = overallScore ?? 0;
  const scorePercent = Math.min(Math.round((totalScore / 75) * 100), 100);

  return (
    <Card className={`relative overflow-hidden border border-border/80 bg-gradient-to-b from-surface to-bg p-5 sm:p-6 ${className}`}>
      {/* Decorative top accent glow */}
      <div
        className={`pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-gradient-to-r ${meta.color} opacity-20 blur-3xl`}
        aria-hidden
      />

      <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {examTitle && (
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              {examTitle}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight text-fg sm:text-3xl">
              {!hasOverall
                ? "Bo'lim natijasi"
                : isIelts
                ? `Overall Band: ${overallBand?.toFixed(1) ?? "—"}`
                : `CEFR Level: ${cefrLevel}`}
            </h2>
            {hasOverall && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.badge}`}>
                <Award className="size-3.5" aria-hidden />
                {cefrLevel || "CEFR"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {hasOverall
              ? `${meta.label} · ${meta.desc}`
              : "Umumiy ball va CEFR darajasi faqat to'liq imtihon (4 bo'lim) topshirilganda chiqariladi."}
          </p>
        </div>

        {/* Big Score Radial/Box */}
        <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-border bg-bg-subtle/80 p-4 shadow-sm backdrop-blur">
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              {isIelts ? "IELTS Band" : "Total Score"}
            </p>
            <p className="text-3xl font-black tabular-nums text-fg sm:text-4xl">
              {isIelts ? overallBand?.toFixed(1) ?? "—" : `${overallScore ?? "—"}`}
              {!isIelts && <span className="text-sm font-normal text-fg-muted"> /75</span>}
            </p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Sparkles className="size-6" />
          </div>
        </div>
      </div>

      {/* Visual Level Track Bar */}
      {!isIelts && hasOverall && (
        <div className="relative z-10 mt-6 space-y-2">
          <div className="flex justify-between text-[11px] font-medium text-fg-muted">
            {MULTILEVEL_CEFR_BANDS.map((band, index) => (
              <span key={band.level} className={["", "font-semibold text-amber-500", "font-semibold text-sky-500", "font-semibold text-emerald-500"][index]}>
                {band.label} ({band.min}–{band.max})
              </span>
            ))}
          </div>
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-border/80">
            {/* Zones, positioned from the same scale as the labels */}
            {MULTILEVEL_CEFR_BANDS.map((band, index) => (
              <div
                key={band.level}
                className={["absolute inset-y-0 bg-fg-subtle/20", "absolute inset-y-0 bg-amber-500/20", "absolute inset-y-0 bg-sky-500/20", "absolute inset-y-0 bg-emerald-500/20"][index]}
                style={{ left: `${(band.min / 75) * 100}%`, width: `${((band.max - band.min + (index === 3 ? 0 : 1)) / 75) * 100}%` }}
                title={band.level}
              />
            ))}

            {/* User progress bar */}
            <div
              className={`h-full rounded-full bg-gradient-to-r ${meta.color} transition-all duration-700`}
              style={{ width: `${Math.max(scorePercent, 5)}%` }}
            />
          </div>
        </div>
      )}

      {/* 4-Skill Section Infographic Cards */}
      <div className="relative z-10 mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sections.map((section) => {
          const Icon = SKILL_ICONS[section.skill] ?? Headphones;
          const colors = SKILL_COLORS[section.skill] ?? {
            bar: "bg-brand",
            text: "text-brand",
            bg: "bg-brand/10",
          };

          // Scale score out of 75 for Multi-Level or out of 9 for IELTS
          const rawScore = section.score ?? 0;
          const maxScore = section.max ?? (section.skill === "listening" || section.skill === "reading" ? 35 : 30);
          const standardized = section.standardScore;
          const percent = standardized != null
            ? Math.round((standardized / 75) * 100)
            : maxScore > 0
              ? Math.round((rawScore / maxScore) * 100)
              : 0;

          return (
            <div
              key={section.skill}
              className="group flex flex-col justify-between rounded-xl border border-border bg-surface/70 p-3.5 transition-all hover:border-brand/40 hover:bg-surface"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`flex size-8 items-center justify-center rounded-lg ${colors.bg} ${colors.text}`}>
                    <Icon className="size-4" />
                  </div>
                  <span className="text-xs font-bold capitalize tracking-wide text-fg">
                    {section.title ?? section.skill}
                  </span>
                </div>
                {section.band != null && (
                  <Badge variant="neutral" className="tabular-nums">
                    Band {section.band.toFixed(1)}
                  </Badge>
                )}
              </div>

              <div className="mt-4">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-fg-muted">Score</span>
                  <span className="font-bold tabular-nums text-fg">
                    {standardized != null ? (
                      <>
                        <span className="text-sm font-black text-brand">{standardized}</span>
                        <span className="text-[11px] text-fg-subtle"> /75</span>
                        <span className="ml-1 text-[10px] text-fg-muted font-normal">({rawScore}/{maxScore})</span>
                      </>
                    ) : section.band != null ? (
                      `Band ${section.band.toFixed(1)}`
                    ) : section.score != null ? (
                      `${section.score} / ${maxScore}`
                    ) : (
                      "Pending"
                    )}
                  </span>
                </div>
                {/* Horizontal skill progress */}
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className={`h-full rounded-full ${colors.bar} transition-all duration-500`}
                    style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
