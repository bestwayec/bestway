"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, TrendingUp } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { api } from "@/lib/api-client";
import { useMyMockAttempts } from "@/hooks/use-mock";
import type { MockAttemptSummary, MockSkill } from "@/lib/types";
import { cn } from "@/lib/utils";
import { familyRows } from "./type-accuracy-card";
import { HELP_TYPES } from "./exam-toolbar";

export interface SkillBand {
  skill: MockSkill;
  label: string;
  /** IELTS band (0–9) or Multilevel standard score (0–75); null when not available. */
  value: number | null;
  /** What to print instead of the number (pending, skipped, below range). */
  note?: string;
  provisional?: boolean;
}

/**
 * Section results as one horizontal bar chart (docs/design/DIRECTION.md, result page): one hue, the
 * value printed at the end of each bar, the scale's maximum as the track. A list, so screen readers
 * read "Listening 7.5 of 9".
 */
export function SkillBandChart({ rows, max, format, title }: { rows: SkillBand[]; max: number; format: (v: number) => string; title: string }) {
  const t = useTranslations("mock.resultOverview");
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="mb-3 text-sm font-semibold text-fg-muted">{title}</figcaption>
      <ul className="space-y-3">
        {rows.map((row) => {
          const pct = row.value == null ? 0 : Math.max(0, Math.min(100, (row.value / max) * 100));
          return (
            <li key={row.skill} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="truncate font-medium text-fg">{row.label}</span>
              <span className="relative h-2.5 overflow-hidden rounded-full bg-border" aria-hidden>
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-slow ease-out motion-reduce:transition-none", row.provisional ? "bg-chart-series/55" : "bg-chart-series")}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="min-w-12 text-right font-semibold tabular-nums text-fg">
                {row.note ?? (row.value == null ? "—" : format(row.value))}
                {row.provisional && <span className="ml-1 text-warning" title={t("provisionalShort")} aria-label={t("provisionalShort")}>*</span>}
                <span className="sr-only"> {t("ofMax", { max })}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {rows.some((row) => row.provisional) && <p className="mt-3 text-sm text-fg-muted"><span className="text-warning">*</span> {t("provisionalNote")}</p>}
    </figure>
  );
}

type TypeAccuracy = { attempts: string[]; types: Parameters<typeof familyRows>[0] };

/**
 * Strong and weak question types, and the next step, from the student's own marked answers
 * (/mock/attempts/mine/type-accuracy). Nothing is shown without enough answers of a type.
 */
export function NextSteps({ program }: { program: "IELTS" | "MULTILEVEL" }) {
  const t = useTranslations("mock.resultOverview");
  const tt = useTranslations("mock.examTools");
  const q = useQuery({
    queryKey: ["type-accuracy", program],
    queryFn: () => api.get<TypeAccuracy>("/mock/attempts/mine/type-accuracy", { program }),
  });
  const name = (key: string) => ((HELP_TYPES as readonly string[]).includes(key) ? tt(`helpTitle_${key}`) : key.replace(/_/g, " "));
  // At least 4 marked answers of a type before we call it strong or weak.
  const rows = (q.data ? familyRows(q.data.types) : []).filter((row) => row.total >= 4 && row.accuracy != null);
  const sorted = [...rows].sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
  const weak = sorted.filter((row) => (row.accuracy ?? 0) < 70).slice(0, 2);
  const strong = [...sorted].reverse().filter((row) => (row.accuracy ?? 0) >= 80).slice(0, 2);

  if (q.isPending) return <Skeleton className="h-32" />;
  if (q.isError || rows.length === 0) return null;
  return (
    <Card className="p-4 sm:p-5" data-testid="next-steps">
      <h2 className="text-lg font-semibold text-fg">{t("nextStepsTitle")}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t("nextStepsSubtitle", { count: q.data?.attempts.length ?? 0 })}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="ns-weak">
          <h3 id="ns-weak" className="text-sm font-semibold text-fg">{t("weakTitle")}</h3>
          {weak.length ? (
            <ul className="mt-2 space-y-2">
              {weak.map((row) => (
                <li key={row.key} className="rounded-control border border-border bg-bg-subtle p-3">
                  <p className="font-medium text-fg">{name(row.key)}</p>
                  <p className="text-sm text-fg-muted tabular-nums">{t("accuracyLine", { correct: row.correct, total: row.total, percent: row.accuracy ?? 0 })}</p>
                  <p className="mt-1 text-sm text-fg">{t("weakAdvice")}</p>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-fg-muted">{t("noWeak")}</p>}
        </section>
        <section aria-labelledby="ns-strong">
          <h3 id="ns-strong" className="text-sm font-semibold text-fg">{t("strongTitle")}</h3>
          {strong.length ? (
            <ul className="mt-2 space-y-2">
              {strong.map((row) => (
                <li key={row.key} className="rounded-control border border-border p-3">
                  <p className="font-medium text-fg">{name(row.key)}</p>
                  <p className="text-sm text-fg-muted tabular-nums">{t("accuracyLine", { correct: row.correct, total: row.total, percent: row.accuracy ?? 0 })}</p>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-fg-muted">{t("noStrong")}</p>}
        </section>
      </div>
      <Link href="/mock" className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
        {t("practiceLink")} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Card>
  );
}

/** Completed full IELTS results with an overall band, oldest first (practice and partial attempts excluded). */
export function bandHistory(attempts: MockAttemptSummary[]): Array<{ id: string; date: string; band: number; title: string }> {
  return attempts
    .filter((a) => a.status === "completed" && typeof a.overallBand === "number" && a.examType !== "multilevel" && a.flowMode !== "single_skill" && a.flowMode !== "partial_practice")
    .map((a) => ({ id: a.id, date: a.submittedAt ?? a.startedAt ?? "", band: a.overallBand as number, title: a.examTitle ?? "" }))
    .filter((a) => a.date)
    .sort((x, y) => x.date.localeCompare(y.date));
}

/**
 * Band over time (IELTS full results only). A plain SVG line: nothing is drawn with fewer than two
 * results, and the points are listed for screen readers.
 */
export function BandTrend({ currentId }: { currentId: string }) {
  const t = useTranslations("mock.resultOverview");
  const q = useMyMockAttempts();
  const points = React.useMemo(() => bandHistory((q.data ?? []) as MockAttemptSummary[]).slice(-8), [q.data]);
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError || points.length < 2) return null;
  const W = 560, H = 140, PAD = 28;
  const min = Math.max(0, Math.floor(Math.min(...points.map((p) => p.band))) - 1);
  const max = Math.min(9, Math.ceil(Math.max(...points.map((p) => p.band))) + 1);
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, points.length - 1);
  const y = (b: number) => H - PAD + 8 - ((b - min) / Math.max(0.5, max - min)) * (H - PAD * 1.5);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.band).toFixed(1)}`).join(" ");
  const first = points[0].band, last = points[points.length - 1].band;
  const change = last - first;
  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <Card className="p-4 sm:p-5" data-testid="band-trend">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-fg"><TrendingUp className="size-5 text-fg-subtle" aria-hidden />{t("trendTitle")}</h2>
        <p className="text-sm text-fg-muted tabular-nums">
          {t("trendChange", { count: points.length, change: `${change > 0 ? "+" : ""}${change.toFixed(1)}` })}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label={t("trendAria", { points: points.map((p) => `${fmt(p.date)} ${p.band.toFixed(1)}`).join(", ") })}>
        {[min, (min + max) / 2, max].map((b) => (
          <g key={b}>
            <line x1={PAD} x2={W - PAD} y1={y(b)} y2={y(b)} className="stroke-border" strokeDasharray="3 4" />
            <text x={4} y={y(b) + 4} className="fill-fg-subtle text-[11px] tabular-nums">{b.toFixed(1)}</text>
          </g>
        ))}
        <path d={path} fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-chart-series" />
        {points.map((p, i) => (
          <g key={p.id}>
            <circle cx={x(i)} cy={y(p.band)} r={p.id === currentId ? 6 : 4} className={p.id === currentId ? "fill-chart-series stroke-surface" : "fill-surface stroke-chart-series"} strokeWidth={2} />
            <text x={x(i)} y={H - 4} textAnchor="middle" className="fill-fg-subtle text-[11px]">{fmt(p.date)}</text>
          </g>
        ))}
      </svg>
    </Card>
  );
}
