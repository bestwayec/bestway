"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import type { MockAttemptSummary } from "@/lib/types";
import { MAX_POINTS, MOCK_SCALE, resultsProgress, type MockFamily } from "@/lib/results-progress";
import { cn } from "@/lib/utils";

interface ChartPoint {
  id: string;
  at: string;
  examTitle: string;
  value: number;
  /** Text shown in the tooltip and the table, e.g. "Band 6.5 · B2" or "8/10 correct · 80%". */
  text: string;
}

/**
 * One series, one axis. Bars for practice (each set stands alone), dots for full mocks joined by a line only
 * between real points (no fitted trend). Marks are focusable; a table view carries the same numbers.
 */
function PointsChart({
  title,
  caption,
  points,
  max,
  ticks,
  kind,
}: {
  title: string;
  caption: string;
  points: ChartPoint[];
  max: number;
  ticks: number[];
  kind: "bar" | "dot";
}) {
  const t = useTranslations("profile.progress");
  // Month names from messages: browsers have no short Uzbek month names (Chromium printed "M11 12").
  const tMonths = useTranslations("monthsShort");
  const [active, setActive] = React.useState<number | null>(null);
  const n = points.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => Math.max(0, Math.min(1, v / max)) * 100;
  const date = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()} ${tMonths(String(d.getMonth() + 1))}`;
  };
  const activePoint = active != null ? points[active] : null;

  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-fg">{title}</h4>
        <p className="text-sm text-fg-muted">{caption}</p>
      </div>
      <div className="flex gap-2">
        <div className="relative h-40 w-9 shrink-0 text-right text-xs tabular-nums text-fg-subtle" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${y(tick)}%` }}>
              {tick}
            </span>
          ))}
        </div>
        <div className="relative h-40 min-w-0 flex-1" onMouseLeave={() => setActive(null)}>
          {ticks.map((tick) => (
            <div key={tick} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${y(tick)}%` }} aria-hidden="true" />
          ))}
          {kind === "dot" && n >= 2 && (
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points={points.map((p, i) => `${x(i)},${100 - y(p.value)}`).join(" ")}
                fill="none"
                stroke="var(--chart-series)"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {points.map((p, i) =>
            kind === "bar" ? (
              <div
                key={p.id}
                className={cn("absolute bottom-0 -translate-x-1/2 rounded-t-[4px] bg-chart-series transition-opacity", active != null && active !== i && "opacity-60")}
                style={{ left: `${x(i)}%`, height: `${y(p.value)}%`, width: `min(28px, ${60 / n}%)`, minHeight: p.value > 0 ? 2 : 0 }}
                aria-hidden="true"
              />
            ) : (
              <div
                key={p.id}
                className={cn("absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-chart-series ring-2 ring-surface", active === i && "size-3.5")}
                style={{ left: `${x(i)}%`, bottom: `${y(p.value)}%` }}
                aria-hidden="true"
              />
            ),
          )}
          {/* Hit targets: the whole column of each point, larger than the mark. */}
          {points.map((p, i) => (
            <button
              key={`hit-${p.id}`}
              type="button"
              className="absolute inset-y-0 -translate-x-1/2 rounded-sm focus-visible:outline-2 focus-visible:outline-brand"
              style={{ left: `${x(i)}%`, width: `${100 / n}%` }}
              aria-label={`${date(p.at)} · ${p.examTitle} · ${p.text}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
          {activePoint && active != null && (
            <div
              role="tooltip"
              className={cn(
                "pointer-events-none absolute z-10 w-max max-w-[220px] rounded-[8px] border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md",
                x(active) < 20 ? "translate-x-0" : x(active) > 80 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${x(active)}%`, bottom: `calc(${Math.min(y(activePoint.value), 70)}% + 14px)` }}
            >
              <p className="font-semibold tabular-nums text-fg">{activePoint.text}</p>
              <p className="truncate text-fg-muted">{activePoint.examTitle}</p>
              <p className="text-fg-subtle">{date(activePoint.at)}</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between pl-11 text-xs text-fg-subtle tabular-nums" aria-hidden="true">
        <span>{date(points[0].at)}</span>
        {n > 1 && <span>{date(points[n - 1].at)}</span>}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">{t("showTable")}</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-fg-muted">
              <th className="py-1.5 pr-2 font-medium">{t("colDate")}</th>
              <th className="py-1.5 pr-2 font-medium">{t("colExam")}</th>
              <th className="py-1.5 text-right font-medium">{t("colResult")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {points.map((p) => (
              <tr key={p.id}>
                <td className="py-1.5 pr-2 whitespace-nowrap text-fg-muted">{date(p.at)}</td>
                <td className="py-1.5 pr-2 text-fg">{p.examTitle}</td>
                <td className="py-1.5 text-right whitespace-nowrap tabular-nums text-fg">{p.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

const MOCK_TICKS: Record<MockFamily, number[]> = { ielts: [0, 3, 6, 9], multilevel: [0, 25, 50, 75] };

/** Results page progress: counts and charts from the student's own submitted attempts only. */
export function ResultsProgressCard({ attempts, loading }: { attempts: MockAttemptSummary[]; loading: boolean }) {
  const t = useTranslations("profile.progress");
  const data = React.useMemo(() => resultsProgress(attempts), [attempts]);
  const hasCharts = data.mocks.ielts.length + data.mocks.multilevel.length + data.practice.length > 0;

  const mockText = (family: MockFamily, value: number, cefr: string | null) =>
    `${family === "ielts" ? t("band", { value: value.toFixed(1) }) : t("score", { value })}${cefr ? ` · ${cefr}` : ""}`;

  return (
    <Card className="rounded-[12px] border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-1 border-b border-border pb-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-fg">
          <TrendingUp className="size-5 text-brand" aria-hidden="true" />
          {t("title")}
        </h3>
        <p className="text-sm text-fg-muted">{t("subtitle")}</p>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-16 w-full rounded-[12px]" />
          <Skeleton className="h-40 w-full rounded-[12px]" />
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-[12px] border border-border bg-bg-subtle p-3">
              <dt className="text-sm text-fg-muted">{t("finished")}</dt>
              <dd className="text-2xl font-bold tabular-nums text-fg">{data.finished}</dd>
            </div>
            <div className="rounded-[12px] border border-border bg-bg-subtle p-3">
              <dt className="text-sm text-fg-muted">{t("checking")}</dt>
              <dd className="text-2xl font-bold tabular-nums text-fg">{data.checking}</dd>
            </div>
          </dl>

          {!hasCharts ? (
            <p className="rounded-[12px] border border-dashed border-border p-6 text-center text-sm text-fg-muted">
              {data.finished > 0 ? t("emptyChecking") : t("emptyNone")}
            </p>
          ) : (
            <>
              {(["ielts", "multilevel"] as const).map((family) =>
                data.mocks[family].length > 0 ? (
                  <PointsChart
                    key={family}
                    kind="dot"
                    title={family === "ielts" ? t("mockIeltsTitle") : t("mockMultilevelTitle")}
                    caption={t("mockCaption", { count: MAX_POINTS })}
                    max={MOCK_SCALE[family]}
                    ticks={MOCK_TICKS[family]}
                    points={data.mocks[family].map((m) => ({ id: m.id, at: m.at, examTitle: m.examTitle, value: m.value, text: mockText(family, m.value, m.cefrLevel) }))}
                  />
                ) : null,
              )}
              {data.practice.length > 0 && (
                <PointsChart
                  kind="bar"
                  title={t("practiceTitle")}
                  caption={t("practiceCaption", { count: MAX_POINTS })}
                  max={100}
                  ticks={[0, 50, 100]}
                  points={data.practice.map((p) => ({
                    id: p.id,
                    at: p.at,
                    examTitle: p.examTitle,
                    value: p.percent,
                    text: t("practiceValue", { correct: p.correct, total: p.total, percent: p.percent }),
                  }))}
                />
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
