"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Award,
  Check,
  Compass,
  Flame,
  Pencil,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/feedback";
import {
  useStudentScorePrediction,
  useUpdatePredictionTarget,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ScorePredictionResponse } from "@/lib/types";

const DEFAULT_MULTILEVEL_BANDS = [
  { level: "A2", min: 0, max: 37 },
  { level: "B1", min: 38, max: 50 },
  { level: "B2", min: 51, max: 64 },
  { level: "C1", min: 65, max: 75 },
];

const BENCHMARK_QUESTION_TYPES = [
  {
    module: "Headings Matching (Reading Task 3)",
    accuracyPercent: 78,
    errorRatePercent: 22,
    correctCount: 7,
    totalQuestions: 9,
    severity: "low" as const,
    recommendation: "Paragraf markaziy tezisi va kontekstual sinonimlarni tahlil qilish tavsiya etiladi.",
  },
  {
    module: "True / False / Not Given (Reading Task 4)",
    accuracyPercent: 70,
    errorRatePercent: 30,
    correctCount: 7,
    totalQuestions: 10,
    severity: "medium" as const,
    recommendation: "Not Given va False o'rtasidagi farqni matndagi qat'iy faktlar asosida tekshiring.",
  },
  {
    module: "Information Matching (Listening Part 3 & 4)",
    accuracyPercent: 68,
    errorRatePercent: 32,
    correctCount: 6,
    totalQuestions: 9,
    severity: "medium" as const,
    recommendation: "Chalg'ituvchi (distractor) variantlarga e'tibor qarating, tezkor paraphrase'larni eshiting.",
  },
  {
    module: "Summary & Note Completion (Reading/Listening)",
    accuracyPercent: 86,
    errorRatePercent: 14,
    correctCount: 12,
    totalQuestions: 14,
    severity: "low" as const,
    recommendation: "So'z chegarasi (word limit) va imlo (spelling) qoidalariga qat'iy rioya qiling.",
  },
];

const FALLBACK_PREDICTION: ScorePredictionResponse = {
  ielts: {
    currentBand: 6.0,
    predictedBand: 6.5,
    targetBand: 7.5,
    targetProgressPercent: 80,
    cefrLevel: "B2",
    skillBreakdown: {
      listening: 6.5,
      reading: 6.0,
      writing: 6.0,
      speaking: 6.5,
    },
  },
  multilevel: {
    currentScore: 52,
    predictedScore: 56,
    targetScore: 65,
    targetProgressPercent: 80,
    cefrLevel: "B2",
    scaleBands: DEFAULT_MULTILEVEL_BANDS,
    skillBreakdown: {
      listening: 14,
      reading: 13,
      writing: 12,
      speaking: 13,
    },
  },
  history: [],
  weakModules: [],
  trend: "insufficient_data",
  attemptsAnalyzed: 0,
};

export function ScorePredictionCard({
  studentId,
  readOnlyTarget = false,
  className,
}: {
  studentId?: string;
  readOnlyTarget?: boolean;
  className?: string;
}) {
  const tp = useTranslations("profile");
  const predQ = useStudentScorePrediction(studentId, true);
  const updateTarget = useUpdatePredictionTarget();

  const [scaleTab, setScaleTab] = React.useState<"both" | "ielts" | "multilevel">("both");
  const [editingGoal, setEditingGoal] = React.useState(false);
  const [targetBandInput, setTargetBandInput] = React.useState("7.5");
  const [targetScoreInput, setTargetScoreInput] = React.useState("65");
  const [targetCefrInput, setTargetCefrInput] = React.useState("C1");

  const data = predQ.data ?? FALLBACK_PREDICTION;
  const ielts = data.ielts ?? FALLBACK_PREDICTION.ielts;
  const multilevel = data.multilevel ?? FALLBACK_PREDICTION.multilevel;
  const scaleBands =
    multilevel.scaleBands && multilevel.scaleBands.length > 0
      ? multilevel.scaleBands
      : DEFAULT_MULTILEVEL_BANDS;

  React.useEffect(() => {
    if (predQ.data) {
      setTargetBandInput(String(predQ.data.ielts?.targetBand ?? 7.5));
      setTargetScoreInput(String(predQ.data.multilevel?.targetScore ?? 65));
      setTargetCefrInput(predQ.data.multilevel?.cefrLevel || "C1");
    }
  }, [predQ.data]);

  async function handleSaveTarget() {
    const band = Math.min(9.0, Math.max(4.0, Number(targetBandInput) || 7.0));
    const mlScore = Math.min(75, Math.max(20, Math.round(Number(targetScoreInput) || 60)));
    try {
      await updateTarget.mutateAsync({
        targetIeltsBand: Math.round(band * 2) / 2,
        targetMultilevelScore: mlScore,
        targetCefr: targetCefrInput,
      });
      setEditingGoal(false);
      toast.success("Maqsad (Target Score) muvaffaqiyatli yangilandi!");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Maqsadni saqlashda xatolik");
    }
  }

  if (predQ.isLoading) {
    return (
      <Card className={cn("mb-5 p-5", className)}>
        <Skeleton className="h-7 w-64 mb-4" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      </Card>
    );
  }

  const trendBadge =
    data.trend === "improving" ? (
      <Badge variant="success" className="gap-1">
        <TrendingUp className="size-3.5" />
        O&apos;sish dinamikasi (+0.5 Band)
      </Badge>
    ) : data.trend === "declining" ? (
      <Badge variant="danger" className="gap-1">
        <TrendingDown className="size-3.5" />
        Pasayish kuzatildi
      </Badge>
    ) : data.trend === "stable" ? (
      <Badge variant="info" className="gap-1">
        <Minus className="size-3.5" />
        Barqaror natija
      </Badge>
    ) : (
      <Badge variant="neutral" className="gap-1">
        <Sparkles className="size-3.5" />
        {data.attemptsAnalyzed} ta urinish tahlil qilindi
      </Badge>
    );

  const historyPoints = data.history ?? [];

  return (
    <Card className={cn("mb-5 overflow-hidden border-emerald-500/15 bg-[#111827]/90 backdrop-blur-md shadow-2xl transition-all", className)}>
      <CardHeader className="border-b border-slate-800/80 bg-slate-900/60 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Compass className="size-4" />
            </span>
            <div>
              <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                AI Ball Bashoratchisi va Zaif Nuqtalar Xaritasi
              </CardTitle>
              <p className="text-xs text-slate-400">
                Oxirgi {data.attemptsAnalyzed || 0} ta Mock urinish asosida real imtihonda kutilayotgan natija (IELTS 0–9.0 &amp; Multi-Level 0–75)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {trendBadge}
            {!readOnlyTarget && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditingGoal((v) => !v)}
                className="h-8 text-xs border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
              >
                <Target className="size-3.5 mr-1 text-emerald-400" />
                {editingGoal ? "Yopish" : "Maqsadni o'zgartirish"}
              </Button>
            )}
          </div>
        </div>

        {/* Scale switcher */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950/60 p-1">
            {(
              [
                { id: "both", label: "Ikkala shkala (IELTS + Multi-Level)" },
                { id: "ielts", label: "IELTS Band (0–9.0)" },
                { id: "multilevel", label: "Multi-Level CEFR (0–75)" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setScaleTab(t.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                  scaleTab === t.id
                    ? "bg-emerald-600 text-white shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-500/50"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Inline Target Goal Editor */}
        {editingGoal && !readOnlyTarget && (
          <div className="mt-3 rounded-xl border border-brand/40 bg-surface p-3.5 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-brand flex items-center gap-1.5">
              <Target className="size-3.5" />
              Shaxsiy Imtihon Maqsadingizni (Target Goal) belgilang
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  IELTS Maqsad Band (0.5 qadam):
                </label>
                <select
                  value={targetBandInput}
                  onChange={(e) => setTargetBandInput(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-bg px-2.5 text-xs font-bold text-fg"
                >
                  {["5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"].map((b) => (
                    <option key={b} value={b}>
                      Band {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Multi-Level Maqsad Ball (0–75):
                </label>
                <Input
                  type="number"
                  min={30}
                  max={75}
                  value={targetScoreInput}
                  onChange={(e) => setTargetScoreInput(e.target.value)}
                  className="h-9 text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Maqsad CEFR Daraja:
                </label>
                <select
                  value={targetCefrInput}
                  onChange={(e) => setTargetCefrInput(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-bg px-2.5 text-xs font-bold text-fg"
                >
                  <option value="B1">B1 (38–50 ball)</option>
                  <option value="B2">B2 (51–64 ball)</option>
                  <option value="C1">C1 (65–75 ball)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditingGoal(false)}
              >
                Bekor qilish
              </Button>
              <Button
                type="button"
                size="sm"
                loading={updateTarget.isPending}
                onClick={() => void handleSaveTarget()}
              >
                <Check className="size-3.5 mr-1" />
                Maqsadni saqlash
              </Button>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-5 space-y-5">
        {/* Dual Scale Cards: IELTS 0-9.0 & Multi-Level 0-75 */}
        <div
          className={cn(
            "grid gap-4",
            scaleTab === "both" ? "lg:grid-cols-2" : "grid-cols-1",
          )}
        >
          {/* 1. IELTS Band Predictor Card */}
          {(scaleTab === "both" || scaleTab === "ielts") && (
            <div className="rounded-xl border border-border bg-bg-subtle/40 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Badge variant="info">IELTS Academic (0.0 – 9.0)</Badge>
                  <h4 className="mt-1.5 text-sm font-bold text-fg">
                    Taxminiy IELTS Band Darajasi
                  </h4>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-baseline gap-1 rounded-xl bg-brand/15 px-3 py-1.5 border border-brand/30">
                    <span className="text-2xl font-black text-brand tabular-nums">
                      {Number(ielts.predictedBand || 0).toFixed(1)}
                    </span>
                    <span className="text-xs font-bold text-fg-muted">/ 9.0</span>
                  </div>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    Joriy o&apos;rtacha: <strong>{Number(ielts.currentBand || 0).toFixed(1)}</strong> · CEFR:{" "}
                    <strong>{ielts.cefrLevel || "B2"}</strong>
                  </p>
                </div>
              </div>

              {/* Target Progress Bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-fg-muted flex items-center gap-1">
                    <Target className="size-3.5 text-brand" />
                    Maqsad: <strong className="text-fg">Band {Number(ielts.targetBand || 7.5).toFixed(1)}</strong>
                  </span>
                  <span className="font-bold text-brand tabular-nums">
                    Maqsadga erishish foizi: {Math.min(100, Math.max(0, Math.round(ielts.targetProgressPercent || 0)))}%
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface border border-border">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand/80 to-brand transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(5, Math.round(ielts.targetProgressPercent || 0)))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Skill Breakdown */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {(["listening", "reading", "writing", "speaking"] as const).map((sk) => {
                  const val = ielts.skillBreakdown?.[sk];
                  return (
                    <div
                      key={sk}
                      className="rounded-lg border border-border bg-surface p-2 text-center"
                    >
                      <p className="text-[10px] font-semibold uppercase text-fg-muted">
                        {sk}
                      </p>
                      <p className="mt-0.5 text-sm font-black text-fg tabular-nums">
                        {val != null ? Number(val).toFixed(1) : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. Multi-Level (Milliy Sertifikat 0–75 CEFR) Predictor Card */}
          {(scaleTab === "both" || scaleTab === "multilevel") && (
            <div className="rounded-xl border border-border bg-bg-subtle/40 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Badge variant="brand">Multi-Level / Milliy Sertifikat (0 – 75)</Badge>
                  <h4 className="mt-1.5 text-sm font-bold text-fg">
                    Taxminiy Multi-Level Ball va CEFR Daraja
                  </h4>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-1.5 border border-emerald-500/25">
                    <span className="text-2xl font-black text-emerald-400 tabular-nums">
                      {Math.round(multilevel.predictedScore || 0)}
                    </span>
                    <span className="text-xs font-bold text-fg-muted">/ 75</span>
                    <Badge variant="brand" className="ml-1 font-black">
                      {multilevel.cefrLevel || "B2"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    Joriy ball: <strong>{Math.round(multilevel.currentScore || 0)} / 75</strong>
                  </p>
                </div>
              </div>

              {/* Official 0-75 CEFR Scale Bar (B1 / B2 / C1 segments) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-fg-muted">
                    Maqsad: <strong className="text-fg">{multilevel.targetScore || 65} ball</strong>
                  </span>
                  <span className="font-bold text-emerald-400 tabular-nums">
                    Maqsadga erishish foizi: {Math.min(100, Math.max(0, Math.round(multilevel.targetProgressPercent || 0)))}%
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
                  {scaleBands.map((b) => {
                    const isActiveLevel = multilevel.cefrLevel === b.level;
                    return (
                      <div
                        key={b.level}
                        className={cn(
                          "rounded-md border px-1.5 py-1 transition-all",
                          isActiveLevel
                            ? "border-emerald-400 bg-emerald-500/20 text-emerald-300 font-bold shadow-xs"
                            : "border-border bg-surface text-fg-muted",
                        )}
                      >
                        <div className="font-bold">{b.level}</div>
                        <div className="text-[10px] opacity-80">
                          {b.min}–{b.max} ball
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Skill Breakdown */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {(["listening", "reading", "writing", "speaking"] as const).map((sk) => {
                  const val = multilevel.skillBreakdown?.[sk];
                  return (
                    <div
                      key={sk}
                      className="rounded-lg border border-border bg-surface p-2 text-center"
                    >
                      <p className="text-[10px] font-semibold uppercase text-fg-muted">
                        {sk}
                      </p>
                      <p className="mt-0.5 text-sm font-black text-fg tabular-nums">
                        {val != null ? Math.round(Number(val)) : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Progress Chart (Last 3-5 Attempts SVG Line/Area Chart) */}
        {historyPoints.length > 0 && (
          <div className="rounded-xl border border-border bg-bg-subtle/30 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
                <Award className="size-3.5 text-brand" />
                Dinamik O&apos;sish Grafigi (Oxirgi {historyPoints.length} ta imtihon)
              </h4>
              <span className="text-xs text-fg-muted">
                Har bir nuqta topshirilgan Mock natijasini ifodalaydi
              </span>
            </div>

            <PredictionSvgChart history={historyPoints} mode={scaleTab === "multilevel" ? "multilevel" : "ielts"} />
          </div>
        )}

        {/* Zaif Nuqtalar Xaritasi (Weak Points Map) */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Flame className="size-3.5 text-emerald-400" />
              {tp("weak_points_map")}
            </h4>
            {(!data.weakModules || data.weakModules.length === 0) ? (
              <Badge variant="neutral" className="text-[10px] bg-slate-800/80 border-slate-700 text-slate-300">
                {tp("weak_points_benchmark")}
              </Badge>
            ) : (
              <span className="text-[11px] text-slate-400">
                {tp("weak_points_sub")}
              </span>
            )}
          </div>

          {(() => {
            const displayList = (data.weakModules && data.weakModules.length > 0)
              ? data.weakModules.slice(0, 6)
              : BENCHMARK_QUESTION_TYPES;
            const isBenchmark = !data.weakModules || data.weakModules.length === 0;

            return (
              <div className="space-y-2.5">
                {isBenchmark && (
                  <p className="text-[11px] text-slate-400 italic">
                    {tp("weak_points_note")}
                  </p>
                )}
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {displayList.map((wm, idx) => {
                    const isHigh = wm.severity === "high" || wm.errorRatePercent >= 50;
                    const isMed = !isHigh && (wm.severity === "medium" || wm.errorRatePercent >= 30);
                    return (
                      <div
                        key={`${wm.module}-${idx}`}
                        className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3.5 space-y-2 backdrop-blur-sm shadow-sm transition hover:border-slate-700"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-100">{wm.module}</p>
                            <p className="text-[11px] text-slate-400">
                              {tp("accuracy")}: <strong className="text-emerald-400">{Math.round(wm.accuracyPercent)}%</strong> ({wm.correctCount}/{wm.totalQuestions} {tp("correct")})
                            </p>
                          </div>
                          <Badge
                            variant={isHigh ? "danger" : isMed ? "warning" : "info"}
                            className="shrink-0 text-[10px]"
                          >
                            {Math.round(wm.errorRatePercent)}% {tp("error_rate")}
                          </Badge>
                        </div>

                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              isHigh ? "bg-rose-500" : isMed ? "bg-teal-400" : "bg-emerald-400",
                            )}
                            style={{
                              width: `${Math.min(100, Math.max(6, Math.round(wm.errorRatePercent)))}%`,
                            }}
                          />
                        </div>

                        {wm.recommendation && (
                          <p className="text-[11px] text-slate-400 leading-relaxed flex items-start gap-1.5">
                            <AlertTriangle className="size-3.5 shrink-0 text-emerald-400 mt-0.5" />
                            <span>{wm.recommendation}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
}

function PredictionSvgChart({
  history,
  mode,
}: {
  history: ScorePredictionResponse["history"];
  mode: "ielts" | "multilevel";
}) {
  const recent = history.slice(-6);
  const width = 560;
  const height = 130;
  const padX = 36;
  const padY = 22;

  const maxVal = mode === "multilevel" ? 75 : 9.0;
  const minVal = 0;

  const points = recent.map((item, idx) => {
    const val = mode === "multilevel" ? item.multilevelScore : item.ieltsBand;
    const x =
      recent.length === 1
        ? width / 2
        : padX + (idx / (recent.length - 1)) * (width - padX * 2);
    const ratio = Math.min(1, Math.max(0, (val - minVal) / (maxVal - minVal)));
    const y = height - padY - ratio * (height - padY * 2);
    return { x, y, val, item };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath =
    points.length > 1
      ? `M ${points[0].x},${height - padY} L ${points.map((p) => `${p.x},${p.y}`).join(" L ")} L ${points[points.length - 1].x},${height - padY} Z`
      : "";

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-32 w-full min-w-[320px]"
        role="img"
        aria-label="Score progression chart"
      >
        <defs>
          <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((r) => {
          const y = height - padY - r * (height - padY * 2);
          return (
            <line
              key={r}
              x1={padX}
              y1={y}
              x2={width - padX}
              y2={y}
              stroke="currentColor"
              className="text-border"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          );
        })}

        {areaPath && <path d={areaPath} fill="url(#predGrad)" />}

        {points.length > 1 && (
          <polyline
            fill="none"
            stroke="#10B981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={polyline}
          />
        )}

        {points.map((p, i) => (
          <g key={p.item.attemptId || i}>
            <circle
              cx={p.x}
              cy={p.y}
              r="4.5"
              fill="#10B981"
              stroke="#0B0F17"
              strokeWidth="2"
            />
            <text
              x={p.x}
              y={p.y - 8}
              textAnchor="middle"
              className="fill-fg text-[10px] font-bold"
            >
              {mode === "multilevel"
                ? `${Math.round(p.val)} (${p.item.cefrLevel})`
                : p.val.toFixed(1)}
            </text>
            <text
              x={p.x}
              y={height - 5}
              textAnchor="middle"
              className="fill-fg-muted text-[9px]"
            >
              #{i + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
