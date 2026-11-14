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
  Zap,
} from "lucide-react";
import { WeakPointsTargetDrillModal } from "./WeakPointsTargetDrillModal";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/feedback";
import {
  useMyMockAttempts,
  useStudentScorePrediction,
  useUpdatePredictionTarget,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MockAttemptSummary, ScorePredictionResponse } from "@/lib/types";
import { MULTILEVEL_CEFR_BANDS, multilevelBandFor, multilevelLevelText } from "@/lib/multilevel-scale";

const DEFAULT_MULTILEVEL_BANDS = MULTILEVEL_CEFR_BANDS.map(({ level, min, max }) => ({ level, min, max }));

// Neutral shape used only while rendering an empty card; every number is null so nothing
// demo-like is ever displayed as the student's own result.
const EMPTY_PREDICTION = {
  ielts: { currentBand: null, predictedBand: null, targetBand: 7.5, targetProgressPercent: 0, cefrLevel: null, skillBreakdown: {} },
  multilevel: { currentScore: null, predictedScore: null, targetScore: 65, targetProgressPercent: 0, cefrLevel: null, scaleBands: DEFAULT_MULTILEVEL_BANDS, skillBreakdown: {} },
} as unknown as Pick<ScorePredictionResponse, "ielts" | "multilevel">;

function resolveCategory(moduleName: string): string {
  const lower = moduleName.toLowerCase();
  if (lower.includes("true") || lower.includes("tfng")) return "tfng";
  if (lower.includes("heading")) return "headings";
  if (lower.includes("info") || lower.includes("listening")) return "info_matching";
  if (lower.includes("summary") || lower.includes("note")) return "summary_completion";
  if (lower.includes("grammar") || lower.includes("writing")) return "grammar_cohesion";
  return "tfng";
}

export function ScorePredictionCard({
  studentId,
  readOnlyTarget = false,
  className,
  attempts: propAttempts,
}: {
  studentId?: string;
  readOnlyTarget?: boolean;
  className?: string;
  attempts?: MockAttemptSummary[];
}) {
  const tp = useTranslations("profile");
  const predQ = useStudentScorePrediction(studentId, true);
  const myAttemptsQ = useMyMockAttempts();
  const updateTarget = useUpdatePredictionTarget();

  const [scaleTab, setScaleTab] = React.useState<"both" | "ielts" | "multilevel">("both");
  const [editingGoal, setEditingGoal] = React.useState(false);
  const [targetBandInput, setTargetBandInput] = React.useState("7.5");
  const [targetScoreInput, setTargetScoreInput] = React.useState("65");
  const [targetCefrInput, setTargetCefrInput] = React.useState("C1");
  const [activeDrill, setActiveDrill] = React.useState<{ module: string; categoryId: string } | null>(null);

  const ti = useTranslations("insights");
  const tm = useTranslations("mock");
  const data = predQ.data;

  const effectiveAttempts = propAttempts ?? (!studentId ? myAttemptsQ.data : undefined);
  const completedAttemptsCount = React.useMemo(() => {
    if (!effectiveAttempts) return 0;
    return effectiveAttempts.filter((a) => a.status === "completed" || a.status === "grading").length;
  }, [effectiveAttempts]);

  const latestScored = React.useMemo(() => {
    return effectiveAttempts?.find(
      (a) => a.overallBand != null || a.overallScore != null || a.cefrLevel != null
    );
  }, [effectiveAttempts]);

  const evidenceCount =
    (data?.attemptsAnalyzed ?? 0) ||
    (data?.sectionAttemptsAnalyzed ?? 0) ||
    completedAttemptsCount;
  const hasEvidence =
    evidenceCount > 0 || (data?.history && data.history.length > 0);

  const ielts = React.useMemo(() => {
    const base = data?.ielts ?? EMPTY_PREDICTION.ielts;
    if (base.currentBand == null && latestScored?.overallBand != null) {
      return {
        ...base,
        currentBand: latestScored.overallBand,
        predictedBand: base.predictedBand ?? latestScored.overallBand,
        cefrLevel: base.cefrLevel ?? latestScored.cefrLevel ?? null,
      };
    }
    return base;
  }, [data?.ielts, latestScored]);

  const multilevel = React.useMemo(() => {
    const base = data?.multilevel ?? EMPTY_PREDICTION.multilevel;
    if (base.currentScore == null && latestScored?.overallScore != null) {
      return {
        ...base,
        currentScore: latestScored.overallScore,
        predictedScore: base.predictedScore ?? latestScored.overallScore,
        cefrLevel: base.cefrLevel ?? latestScored.cefrLevel ?? null,
      };
    }
    return base;
  }, [data?.multilevel, latestScored]);

  const fmtBand = (v: number | null | undefined) => (hasEvidence && v != null ? Number(v).toFixed(1) : "—");
  const fmtScore = (v: number | null | undefined) => (hasEvidence && v != null ? String(Math.round(v)) : "—");
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
      toast.success(ti("targetSaved"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : ti("targetSaveError"));
    }
  }

  if (predQ.isLoading || (!data && !predQ.isError)) {
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

  if (!data) {
    return (
      <Card className={cn("mb-5 p-5", className)}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
          <span>{ti("predictionLoadError")}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void predQ.refetch()}>
            {ti("retry")}
          </Button>
        </div>
      </Card>
    );
  }

  const trendBadge =
    data.trend === "improving" ? (
      <Badge variant="success" className="gap-1">
        <TrendingUp className="size-3.5" />
        {ti("trendImproving", { delta: Math.abs(Number(ielts.trendDelta ?? 0)).toFixed(1) })}
      </Badge>
    ) : data.trend === "declining" ? (
      <Badge variant="danger" className="gap-1">
        <TrendingDown className="size-3.5" />
        {ti("trendDeclining")}
      </Badge>
    ) : data.trend === "stable" ? (
      <Badge variant="info" className="gap-1">
        <Minus className="size-3.5" />
        {ti("trendStable")}
      </Badge>
    ) : (
      <Badge variant="neutral" className="gap-1">
        <Sparkles className="size-3.5" />
        {ti("attemptsAnalyzed", { count: evidenceCount })}
      </Badge>
    );

  const historyPoints = data.history ?? [];

  
  if (!hasEvidence) {
    return (
      <Card className="rounded-[12px] border border-border bg-surface p-6 sm:p-8 text-center" data-testid="prediction-no-evidence">
        <Award className="mx-auto size-12 text-fg-muted mb-3" />
        <h3 className="text-xl font-bold text-fg">
          Hali natija yo'q — birinchi testni boshlang
        </h3>
        <p className="mt-2 text-sm text-fg-muted max-w-md mx-auto">
          Bilimingizni sinab ko'rish va taxminiy darajangizni aniqlash uchun mock imtihon topshiring.
        </p>
        <div className="mt-6">
          <Button asChild className="min-h-[44px] bg-brand hover:bg-brand/90 text-brand-fg font-medium px-6 text-base">
            <Link href="/mock">
              Birinchi testni boshlash
            </Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("mb-5 overflow-hidden border-brand/15 bg-surface/90 backdrop-blur-md  transition-all", className)}>
      <CardHeader className="border-b border-border/80 bg-surface/60 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand/15 text-brand border border-brand/30">
              <Compass className="size-4" />
            </span>
            <div>
              <CardTitle className="text-base font-bold text-fg flex items-center gap-2">
                {ti("cardTitle")}
              </CardTitle>
              <p className="text-xs text-fg-muted">
                {ti("cardSubtitle", { count: evidenceCount })}
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
                className="h-8 text-xs border-border-strong bg-surface-hover/80 text-fg hover:bg-border-strong"
              >
                <Target className="size-3.5 mr-1 text-brand" />
                {editingGoal ? ti("close") : ti("changeTarget")}
              </Button>
            )}
          </div>
        </div>

        {/* Scale switcher */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-xl border border-border bg-bg/60 p-1">
            {(
              [
                { id: "both", label: ti("scaleBoth") },
                { id: "ielts", label: ti("scaleIelts") },
                { id: "multilevel", label: ti("scaleMultilevel") },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setScaleTab(t.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                  scaleTab === t.id
                    ? "bg-brand text-brand-fg  shadow-brand/30 ring-1 ring-brand/50"
                    : "text-fg-muted hover:text-fg hover:bg-surface-hover/50",
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
              {ti("targetTitle")}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  {ti("targetBandLabel")}
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
                  {ti("targetScoreLabel")}
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
                  {ti("targetCefrLabel")}
                </label>
                <select
                  value={targetCefrInput}
                  onChange={(e) => setTargetCefrInput(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-bg px-2.5 text-xs font-bold text-fg"
                >
                  {(["B1", "B2", "C1"] as const).map((level) => (
                    <option key={level} value={level}>
                      {level} ({multilevelBandFor(level).min}–{multilevelBandFor(level).max} ball)
                    </option>
                  ))}
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
                {ti("cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                loading={updateTarget.isPending}
                onClick={() => void handleSaveTarget()}
              >
                <Check className="size-3.5 mr-1" />
                {ti("saveTarget")}
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
          {!hasEvidence && (
            <p className={cn("rounded-xl border border-dashed border-border bg-bg-subtle/40 p-3 text-xs text-fg-muted", scaleTab === "both" && "lg:col-span-2")} data-testid="prediction-no-evidence">
              {ti("predictionNoEvidence")}
            </p>
          )}
          {/* 1. IELTS Band Predictor Card */}
          {(scaleTab === "both" || scaleTab === "ielts") && (
            <div className="rounded-xl border border-border bg-bg-subtle/40 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Badge variant="info">IELTS Academic (0.0 – 9.0)</Badge>
                  <h4 className="mt-1.5 text-sm font-bold text-fg">
                    {ti("ieltsEstimateTitle")}
                  </h4>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-baseline gap-1 rounded-xl bg-brand/15 px-3 py-1.5 border border-brand/30">
                    <span className="text-2xl font-black text-brand tabular-nums">
                      {fmtBand(ielts.predictedBand)}
                    </span>
                    <span className="text-xs font-bold text-fg-muted">/ 9.0</span>
                  </div>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    {ti("currentAverage")}: <strong>{fmtBand(ielts.currentBand)}</strong> · CEFR:{" "}
                    <strong>{hasEvidence ? ielts.cefrLevel || "—" : "—"}</strong>
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
                    {ti("targetProgress", { percent: Math.min(100, Math.max(0, Math.round(ielts.targetProgressPercent || 0))) })}
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
                        {fmtBand(val)}
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
                    {ti("multilevelEstimateTitle")}
                  </h4>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-2 rounded-xl bg-brand/10 px-3 py-1.5 border border-brand/25">
                    <span className="text-2xl font-black text-brand tabular-nums">
                      {fmtScore(multilevel.predictedScore)}
                    </span>
                    <span className="text-xs font-bold text-fg-muted">/ 75</span>
                    {hasEvidence && multilevel.cefrLevel ? (
                      <Badge variant="brand" className="ml-1 font-black">
                        {multilevelLevelText(multilevel.cefrLevel, tm("levelBelowB1"))}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    {ti("currentScore")}: <strong>{fmtScore(multilevel.currentScore)} / 75</strong>
                  </p>
                </div>
              </div>

              {/* Official 0-75 CEFR Scale Bar (B1 / B2 / C1 segments) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-fg-muted">
                    Maqsad: <strong className="text-fg">{multilevel.targetScore || 65} ball</strong>
                  </span>
                  <span className="font-bold text-brand tabular-nums">
                    {ti("targetProgress", { percent: Math.min(100, Math.max(0, Math.round(multilevel.targetProgressPercent || 0))) })}
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
                            ? "border-brand bg-brand/20 text-brand font-bold "
                            : "border-border bg-surface text-fg-muted",
                        )}
                      >
                        <div className="font-bold">{b.level}</div>
                        <div className="text-[10px] opacity-80">
                          {ti("scoreRange", { min: b.min, max: b.max })}
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
                        {fmtScore(val)}
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
                {ti("historyTitle", { count: historyPoints.length })}
              </h4>
              <span className="text-xs text-fg-muted">
                {ti("historyHint")}
              </span>
            </div>

            <PredictionSvgChart history={historyPoints} mode={scaleTab === "multilevel" ? "multilevel" : "ielts"} belowB1={tm("levelBelowB1")} />
          </div>
        )}

        {/* Zaif Nuqtalar Xaritasi (Weak Points Map) */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
              <Flame className="size-3.5 text-brand" />
              {tp("weak_points_map")}
            </h4>
            {data.weakModules && data.weakModules.length > 0 && (
              <span className="text-[11px] text-fg-muted">
                {tp("weak_points_sub")}
              </span>
            )}
          </div>

          {(() => {
            const displayList = (data.weakModules ?? []).slice(0, 6);
            if (displayList.length === 0) {
              return (
                <p className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-4 text-xs text-fg-muted" data-testid="weak-points-empty">
                  {ti("weakPointsEmpty")}
                </p>
              );
            }

            return (
              <div className="space-y-2.5">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {displayList.map((wm, idx) => {
                    const isHigh = wm.severity === "high" || wm.errorRatePercent >= 50;
                    const isMed = !isHigh && (wm.severity === "medium" || wm.errorRatePercent >= 30);
                    return (
                      <div
                        key={`${wm.module}-${idx}`}
                        className="rounded-xl border border-border/80 bg-surface/60 p-3.5 space-y-2 backdrop-blur-sm  transition hover:border-border-strong"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-fg">{wm.module}</p>
                            <p className="text-[11px] text-fg-muted">
                              {tp("accuracy")}: <strong className="text-brand">{Math.round(wm.accuracyPercent)}%</strong> ({wm.correctCount}/{wm.totalQuestions} {tp("correct")})
                            </p>
                          </div>
                          <Badge
                            variant={isHigh ? "danger" : isMed ? "warning" : "info"}
                            className="shrink-0 text-[10px]"
                          >
                            {Math.round(wm.errorRatePercent)}% {tp("error_rate")}
                          </Badge>
                        </div>

                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              isHigh ? "bg-danger" : isMed ? "bg-brand" : "bg-brand",
                            )}
                            style={{
                              width: `${Math.min(100, Math.max(6, Math.round(wm.errorRatePercent)))}%`,
                            }}
                          />
                        </div>

                        {wm.recommendation && (
                          <p className="text-[11px] text-fg-muted leading-relaxed flex items-start gap-1.5">
                            <AlertTriangle className="size-3.5 shrink-0 text-brand mt-0.5" />
                            <span>{wm.recommendation}</span>
                          </p>
                        )}

                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setActiveDrill({ module: wm.module, categoryId: resolveCategory(wm.module) })}
                          className="w-full mt-2 h-8 rounded-lg bg-brand/15 hover:bg-brand-hover/25 text-brand border border-brand/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all "
                        >
                          <Zap className="size-3.5 fill-brand text-brand" />
                          <span>{ti("workOnMistakes")}</span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        {activeDrill && (
          <WeakPointsTargetDrillModal
            isOpen={Boolean(activeDrill)}
            onClose={() => setActiveDrill(null)}
            moduleTitle={activeDrill.module}
            categoryId={activeDrill.categoryId}
            onCompleted={() => {
              predQ.refetch();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PredictionSvgChart({
  history,
  mode,
  belowB1,
}: {
  history: ScorePredictionResponse["history"];
  mode: "ielts" | "multilevel";
  belowB1: string;
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
            <stop offset="0%" stopColor="var(--chart-series)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--chart-series)" stopOpacity="0.0" />
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
            stroke="var(--chart-series)"
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
              fill="var(--chart-series)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
            <text
              x={p.x}
              y={p.y - 8}
              textAnchor="middle"
              className="fill-fg text-[10px] font-bold"
            >
              {mode === "multilevel"
                ? `${Math.round(p.val)} (${multilevelLevelText(p.item.cefrLevel, belowB1)})`
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
