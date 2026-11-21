"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { BookOpenText, Headphones, Mic, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { MockSkill } from "@/lib/types";
import { MULTILEVEL_CEFR_BANDS, multilevelLevelText } from "@/lib/multilevel-scale";
import { cn } from "@/lib/utils";

export interface SkillScoreData {
  skill: MockSkill;
  title?: string;
  score?: number | null;
  max?: number | null;
  standardScore?: number | null;
  band?: number | null;
  bandBelowRange?: boolean;
}

export interface CefrResultInfographicProps {
  cefrLevel?: string | null;
  overallScore?: number | null;
  overallBand?: number | null;
  isIelts?: boolean;
  sections: SkillScoreData[];
  examTitle?: string;
  completedAt?: string | null;
  /** True once the result is confirmed (teacher-reviewed or calibrated); otherwise it is labelled an estimate. */
  verified?: boolean;
  className?: string;
}

const SKILL_ICONS: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

const MULTILEVEL_MAX = 75;
const IELTS_MAX = 9;

/** What one skill tile shows and the share (0–100) its meter fills. Only numbers the backend returned are used. */
export function skillMeter(section: SkillScoreData, isIelts: boolean): { percent: number | null; max: number; value: number | null; kind: "band" | "standard" | "raw" | "pending" } {
  if (isIelts && section.band != null) return { percent: (section.band / IELTS_MAX) * 100, max: IELTS_MAX, value: section.band, kind: "band" };
  if (!isIelts && section.standardScore != null) return { percent: (section.standardScore / MULTILEVEL_MAX) * 100, max: MULTILEVEL_MAX, value: section.standardScore, kind: "standard" };
  if (section.score != null && section.max != null && section.max > 0) return { percent: (section.score / section.max) * 100, max: section.max, value: section.score, kind: "raw" };
  return { percent: null, max: 0, value: null, kind: "pending" };
}

export function CefrResultInfographic({
  cefrLevel,
  overallScore,
  overallBand,
  isIelts = false,
  sections,
  examTitle,
  verified = false,
  className = "",
}: CefrResultInfographicProps) {
  // A single-section practice has no overall score or level: never dress it up as "A2 / Below B1".
  const hasOverall = isIelts ? overallBand != null : overallScore != null && Boolean(cefrLevel);
  const t = useTranslations("mock");
  const ti = useTranslations("mock.infographic");
  const levelText = multilevelLevelText(cefrLevel, t("levelBelowB1"));
  const trackPercent = Math.min(Math.max(((overallScore ?? 0) / MULTILEVEL_MAX) * 100, 0), 100);

  return (
    <Card className={cn("p-5 sm:p-6", className)} data-testid="cefr-infographic">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {examTitle && <p className="truncate text-sm text-fg-muted">{examTitle}</p>}
          <h2 className="mt-1 text-lg font-semibold text-fg">
            {!hasOverall ? ti("sectionResult") : isIelts ? ti("overallBand") : ti("cefrLevel")}
          </h2>
          {hasOverall ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-display tabular-nums text-fg">{isIelts ? overallBand?.toFixed(1) : levelText}</span>
              <Badge variant={verified ? "success" : "warning"} data-testid="infographic-status">
                {verified ? ti("verified") : ti("estimated")}
              </Badge>
            </div>
          ) : (
            <p className="mt-1 max-w-prose text-sm text-fg-muted">{ti("sectionResultHint")}</p>
          )}
          {hasOverall && !verified && <p className="mt-2 max-w-prose text-sm text-fg-muted">{ti("estimatedNote")}</p>}
        </div>

        {hasOverall && !isIelts && (
          <div className="shrink-0 sm:text-right">
            <p className="text-sm text-fg-muted">{ti("totalScore")}</p>
            <p className="text-2xl font-bold tabular-nums text-fg">
              {overallScore}
              <span className="text-sm font-normal text-fg-muted"> / {MULTILEVEL_MAX}</span>
            </p>
          </div>
        )}
      </div>

      {/* Multilevel scale: the real level thresholds with a marker at the score. No decorative fill. */}
      {!isIelts && hasOverall && (
        <div className="mt-5" role="img" aria-label={ti("levelTrackAria", { score: overallScore ?? 0, max: MULTILEVEL_MAX, level: levelText })}>
          <div className="relative h-2 rounded-full bg-bg-subtle">
            {MULTILEVEL_CEFR_BANDS.map((band, index) => (
              <span
                key={band.level}
                aria-hidden
                className={cn("absolute inset-y-0 bg-border", index > 0 && "border-l-2 border-surface", index === 0 && "rounded-l-full", index === MULTILEVEL_CEFR_BANDS.length - 1 && "rounded-r-full")}
                style={{ left: `${(band.min / MULTILEVEL_MAX) * 100}%`, width: `${((band.max - band.min + (index === MULTILEVEL_CEFR_BANDS.length - 1 ? 0 : 1)) / MULTILEVEL_MAX) * 100}%` }}
              />
            ))}
            <span
              aria-hidden
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand"
              style={{ left: `${trackPercent}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-sm tabular-nums text-fg-muted">
            {MULTILEVEL_CEFR_BANDS.map((band) => (
              <span key={band.level}>
                {band.label} · {band.min}–{band.max}
              </span>
            ))}
          </div>
        </div>
      )}

      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={ti("skillsAria")}>
        {sections.map((section) => {
          const Icon = SKILL_ICONS[section.skill] ?? Headphones;
          const meter = skillMeter(section, isIelts);
          const name = section.title ?? section.skill;
          const valueText =
            meter.kind === "band" ? (section.bandBelowRange ? t("bandBelowRange") : meter.value!.toFixed(1))
            : meter.kind === "pending" ? ti("pending")
            : String(meter.value);
          return (
            <li key={section.skill} className="rounded-card border border-border bg-surface p-3.5" data-testid={`infographic-${section.skill}`}>
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <Icon className="size-4 text-fg-muted" aria-hidden />
                <span className="truncate">{name}</span>
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums text-fg">
                {valueText}
                {meter.kind !== "pending" && !(meter.kind === "band" && section.bandBelowRange) && <span className="text-sm font-normal text-fg-muted"> / {meter.max}</span>}
              </p>
              <p className="text-sm text-fg-muted">
                {meter.kind === "band" ? ti("bandLabel") : meter.kind === "standard" ? ti("standardLabel") : meter.kind === "raw" ? ti("rawLabel") : ti("pendingHint")}
                {meter.kind === "standard" && section.score != null && section.max != null ? ` · ${section.score}/${section.max}` : ""}
              </p>
              {meter.percent != null && (
                <div
                  role="meter"
                  aria-label={ti("meterAria", { skill: name, value: valueText, max: meter.max })}
                  aria-valuemin={0}
                  aria-valuemax={meter.max}
                  aria-valuenow={meter.value ?? 0}
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-subtle"
                >
                  <div className="h-full rounded-full bg-chart-series" style={{ width: `${Math.min(Math.max(meter.percent, 0), 100)}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
