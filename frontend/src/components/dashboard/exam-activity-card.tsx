"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExamActivity } from "@/hooks/use-dashboard";
import type { ExamActivityRange } from "@/lib/types";

const RANGES: ExamActivityRange[] = ["today", "7d", "30d", "3m", "6m", "year"];

const PERIOD_KEY: Record<ExamActivityRange, string> = {
  today: "periodToday",
  "7d": "period7d",
  "30d": "period30d",
  "3m": "period3m",
  "6m": "period6m",
  year: "periodYear",
};

/** Pulsing line point (SMIL — no JS animation loop needed). */
function PulsingDot(props: { cx?: number; cy?: number }) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={4.5} fill="none" stroke="var(--accent)" strokeWidth={1.5}>
        <animate attributeName="r" values="4.5;12" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.7;0" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/**
 * BoardUI "Combo Chart Card" pattern, rebuilt on the project's recharts stack:
 * rounded bars (completed exams, left axis) + line (average score, right axis),
 * hover dims other bars / pops a pulsing line dot / swaps the headline.
 * All values come from GET /stats/exam-activity — no demo data.
 */
export function ExamActivityCard() {
  const t = useTranslations("dashboard");
  const tm = useTranslations("monthsShort");
  const [range, setRange] = React.useState<ExamActivityRange>("7d");
  const [hover, setHover] = React.useState<number | null>(null);
  const { data, isLoading, isError, refetch } = useExamActivity(range);

  const rows = React.useMemo(() => {
    if (!data) return [];
    return data.buckets.map((b) => {
      const d = new Date(b.key);
      const label =
        range === "today"
          ? `${String(d.getHours()).padStart(2, "0")}:00`
          : range === "year"
            ? tm(String(d.getMonth() + 1))
            : `${d.getDate()} ${tm(String(d.getMonth() + 1))}`;
      return { ...b, label };
    });
  }, [data, range, tm]);

  const hovered = hover != null ? rows[hover] : undefined;
  const prev = hover != null && hover > 0 ? rows[hover - 1] : undefined;
  const delta = hovered && prev ? deltaPct(hovered.completed, prev.completed) : null;

  const headline = hovered ? hovered.completed : (data?.totals.completed ?? 0);
  const headlineAvg = hovered ? hovered.avgScore : (data?.totals.avgScore ?? null);
  const empty = !isLoading && data != null && data.totals.started === 0;

  return (
    <Card>
      <CardContent className="pt-5">
        {/* Header: title + period selector */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-fg">{t("analytics")}</h3>
          <Select value={range} onValueChange={(v) => { setHover(null); setRange(v as ExamActivityRange); }}>
            <SelectTrigger className="w-40" aria-label={t("analytics")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(PERIOD_KEY[r] as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading || !data ? (
          <div className="mt-4 h-[340px] animate-pulse rounded-field bg-border/40" />
        ) : isError ? (
          <div className="mt-4 rounded-field border border-danger-border bg-danger-bg/40 p-5 text-center">
            <p className="text-sm font-medium text-danger">{t("noActivity")}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Headline: swaps to hovered bucket */}
            <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
              <div>
                <p className="text-xs text-fg-muted">{t("completedExams")}</p>
                <p className="text-3xl font-bold tabular-nums text-fg">{headline}</p>
              </div>
              <div className="pb-1">
                {hovered ? (
                  <p className="text-xs text-fg-muted">
                    {hovered.label} · {t("avgScore")}:{" "}
                    <span className="font-semibold text-fg">
                      {hovered.avgScore ?? "—"}
                    </span>
                    {delta != null && (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 font-semibold tabular-nums ${
                          delta > 0
                            ? "bg-brand-subtle text-brand-subtle-fg"
                            : delta < 0
                              ? "bg-danger-bg text-danger"
                              : "bg-surface-hover text-fg-muted"
                        }`}
                      >
                        {delta > 0 ? "▲" : delta < 0 ? "▼" : "●"} {Math.abs(delta)}% {t("vsPrev")}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-fg-muted">
                    {t("avgScore")}:{" "}
                    <span className="font-semibold text-fg">{data.totals.avgScore ?? "—"}</span>
                    {" · "}
                    {t("completionRate")}:{" "}
                    <span className="font-semibold text-fg">{data.totals.completionRate}%</span>
                  </p>
                )}
              </div>
              {/* Legend */}
              <div className="ml-auto flex items-center gap-4 pb-1 text-xs text-fg-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-[4px] bg-brand" />
                  {t("completedExams")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-5 rounded bg-accent" />
                  {t("avgScore")}
                </span>
              </div>
            </div>

            {/* No activity: a short empty state instead of 300 px of empty axes. */}
            {empty ? (
              <p className="mt-3 rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-sm text-fg-muted">
                {t("noActivity")}
              </p>
            ) : (
            <div className="mt-2 h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={rows}
                  margin={{ top: 12, right: 4, left: 0, bottom: 0 }}
                  onMouseMove={(s: unknown) => {
                    const o = s as { activeTooltipIndex?: unknown } | null;
                    const v = o?.activeTooltipIndex;
                    setHover(typeof v === "number" ? v : null);
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
                    dy={6}
                  />
                  <YAxis
                    yAxisId="left"
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    allowDecimals={false}
                    tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    domain={[0, "auto"]}
                    tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
                    tickFormatter={(v: number) => String(Math.round(v * 10) / 10)}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--surface-hover)", opacity: 0.5 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as
                        | { completed?: number; avgScore?: number | null }
                        | undefined;
                      return (
                        <div className="rounded-field border border-border bg-surface px-3 py-2 text-sm shadow-lg">
                          <p className="font-medium text-fg">{label}</p>
                          <p className="mt-1 text-fg-muted">
                            {t("completedExams")}:{" "}
                            <span className="font-semibold text-brand">{row?.completed ?? 0}</span>
                          </p>
                          <p className="text-fg-muted">
                            {t("avgScore")}:{" "}
                            <span className="font-semibold text-fg">{row?.avgScore ?? "—"}</span>
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="completed"
                    fill="var(--brand)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={28}
                  >
                    {rows.map((_, i) => (
                      <Cell
                        key={i}
                        fillOpacity={hover == null || hover === i ? 1 : 0.3}
                      />
                    ))}
                  </Bar>
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avgScore"
                    stroke="var(--accent)"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                    activeDot={<PulsingDot />}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            )}

            {/* Bottom summary tiles — real period totals */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-control border border-border bg-bg-subtle px-4 py-3">
                <p className="text-sm font-medium text-fg-muted">
                  {t("totalCompleted")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-fg">
                  {data.totals.completed}
                </p>
              </div>
              <div className="rounded-control border border-border bg-bg-subtle px-4 py-3">
                <p className="text-sm font-medium text-fg-muted">
                  {t("avgScore")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-fg">
                  {data.totals.avgScore ?? "—"}
                </p>
              </div>
              <div className="rounded-control border border-border bg-bg-subtle px-4 py-3">
                <p className="text-sm font-medium text-fg-muted">
                  {t("completionRate")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-fg">
                  {data.totals.completionRate}%
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
