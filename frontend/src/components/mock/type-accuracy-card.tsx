"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { HELP_TYPES, helpTypeOf } from "./exam-toolbar";

type Point = { attemptId: string; finishedAt: string | null; correct: number; total: number };
type Row = { type: string; correct: number; total: number; accuracy: number | null; history: Point[] };
export type TypeAccuracy = { attempts: Array<{ id: string; examTitle: string; finishedAt: string | null }>; types: Row[] };

/** Rows of the server merged by the family the student knows (all completion types are one). */
export function familyRows(types: Row[]): Array<{ key: string; correct: number; total: number; accuracy: number | null; trend: number[] }> {
  const families = new Map<string, { correct: number; total: number; byAttempt: Map<string, [number, number]> }>();
  for (const row of types) {
    const key = helpTypeOf(row.type) ?? row.type;
    const family = families.get(key) ?? { correct: 0, total: 0, byAttempt: new Map() };
    family.correct += row.correct;
    family.total += row.total;
    for (const point of row.history) {
      const [c, t] = family.byAttempt.get(point.attemptId) ?? [0, 0];
      family.byAttempt.set(point.attemptId, [c + point.correct, t + point.total]);
    }
    families.set(key, family);
  }
  return [...families.entries()]
    .map(([key, f]) => ({
      key, correct: f.correct, total: f.total,
      accuracy: f.total ? Math.round((100 * f.correct) / f.total) : null,
      trend: [...f.byAttempt.values()].filter(([, t]) => t > 0).map(([c, t]) => Math.round((100 * c) / t)),
    }))
    .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101) || a.key.localeCompare(b.key));
}

function Sparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const w = 72, h = 20;
  const step = w / (points.length - 1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (p / 100) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="shrink-0 overflow-visible text-brand">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(points.length - 1) * step} cy={h - (points[points.length - 1] / 100) * h} r={2} fill="currentColor" />
    </svg>
  );
}

/** Accuracy per question type over the student's latest released results, with the trend. Real data only. */
export function TypeAccuracyCard({ program }: { program: "IELTS" | "MULTILEVEL" }) {
  const t = useTranslations("mock.typeAccuracy");
  const tt = useTranslations("mock.examTools");
  const q = useQuery({
    queryKey: ["type-accuracy", program],
    queryFn: () => api.get<TypeAccuracy>("/mock/attempts/mine/type-accuracy", { program }),
  });
  const rows = q.data ? familyRows(q.data.types) : [];
  return (
    <Card className="space-y-3 p-4" data-testid="type-accuracy">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{t("title")}</h2>
        {q.data && q.data.attempts.length > 0 && <span className="text-xs text-fg-muted">{t("attempts", { count: q.data.attempts.length })}</span>}
      </div>
      <p className="text-xs text-fg-muted">{t("subtitle")}</p>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : q.isError ? (
        <p className="text-sm text-danger" role="alert">{t("error")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const name = (HELP_TYPES as readonly string[]).includes(row.key) ? tt(`helpTitle_${row.key}`) : row.key.replace(/_/g, " ");
            return (
              <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:flex-nowrap">
                <span className="basis-full truncate text-fg sm:w-44 sm:shrink-0 sm:basis-auto" title={name}>{name}</span>
                <span className="relative h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${row.accuracy ?? 0}%` }} />
                </span>
                <span className="shrink-0 whitespace-nowrap text-right tabular-nums text-fg-muted sm:w-32">{row.correct}/{row.total} ({row.accuracy ?? 0}%)</span>
                <Sparkline points={row.trend} label={t("trendLabel", { points: row.trend.map((p) => `${p}%`).join(", ") })} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
