"use client";

import * as React from "react";
import { Flag, ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { ExamSimulatorMode, MockSection, MockSkill } from "@/lib/types";
import { multilevelQuestionAnswered } from "@/lib/multilevel-completeness";

export interface CbtSectionStepperProps {
  skill: MockSkill;
  groups: MockSection["groups"];
  answers: Record<string, string>;
  audioSet: Set<string>;
  audioDurations?: Record<string, number>;
  simulatorMode?: ExamSimulatorMode;
  flaggedQuestions?: Set<string>;
  onToggleFlag?: (qid: string) => void;
  onActiveQuestionChange?: (questionNumber: number) => void;
  renderGroupBlock: (
    group: MockSection["groups"][number],
    onReviewComplete?: () => void,
    partIndex?: number
  ) => React.ReactNode;
  onReviewComplete?: () => void;
  onNextSection?: () => void;
  onSubmitSection?: () => void;
  isLastSection?: boolean;
  isFullTest?: boolean;
}

export function CbtSectionStepper({
  skill,
  groups,
  answers,
  audioSet,
  simulatorMode = "cdi",
  flaggedQuestions: externalFlags,
  onToggleFlag: externalToggleFlag,
  onActiveQuestionChange,
  renderGroupBlock,
  onReviewComplete,
  onNextSection,
  onSubmitSection,
  isLastSection = false,
  isFullTest = false,
}: CbtSectionStepperProps) {
  const t = useTranslations("mock.stepper");
  const safeGroups = groups || [];
  const [activePartIndex, setActivePartIndex] = React.useState(0);
  const [internalFlags, setInternalFlags] = React.useState<Set<string>>(new Set());
  const [activeQuestionId, setActiveQuestionId] = React.useState<string | null>(null);

  const flaggedQuestions = externalFlags ?? internalFlags;

  // Flatten questions. `label` is the authored question number the student
  // sees next to the question (e.g. 9 when a part is absent); the sequential
  // position is only a fallback for items without a number.
  const flattenedQuestions = React.useMemo(() => {
    let globalNum = 1;
    return safeGroups.flatMap((group, groupIdx) =>
      (group?.questions || []).map((q) => ({
        ...q,
        label: typeof q.number === "number" && q.number > 0 ? q.number : globalNum,
        globalIndex: globalNum++,
        groupIndex: groupIdx,
        groupTitle:
          group.title ||
          (skill === "reading" ? `Passage ${groupIdx + 1}` : `Part ${groupIdx + 1}`),
      }))
    );
  }, [safeGroups, skill]);

  // Set initial active question
  React.useEffect(() => {
    if (!activeQuestionId && flattenedQuestions.length > 0) {
      setActiveQuestionId(flattenedQuestions[0].id);
    }
  }, [flattenedQuestions, activeQuestionId]);

  // Sync active question to the first question of active group if current active is outside
  React.useEffect(() => {
    const currentGroupQuestions = flattenedQuestions.filter(
      (q) => q.groupIndex === activePartIndex
    );
    if (currentGroupQuestions.length > 0) {
      const isCurrentInGroup = currentGroupQuestions.some(
        (q) => q.id === activeQuestionId
      );
      if (!isCurrentInGroup) {
        setActiveQuestionId(currentGroupQuestions[0].id);
      }
    }
  }, [activePartIndex, flattenedQuestions, activeQuestionId]);

  React.useEffect(() => {
    if (!onActiveQuestionChange || !activeQuestionId) return;
    const found = flattenedQuestions.find((q) => q.id === activeQuestionId);
    if (found) {
      onActiveQuestionChange(found.label);
    }
  }, [activeQuestionId, flattenedQuestions, onActiveQuestionChange]);

  const toggleFlag = (qid: string) => {
    if (externalToggleFlag) {
      externalToggleFlag(qid);
      return;
    }
    setInternalFlags((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) {
        next.delete(qid);
      } else {
        next.add(qid);
      }
      return next;
    });
  };

  const jumpToQuestion = (q: (typeof flattenedQuestions)[number]) => {
    setActivePartIndex(q.groupIndex);
    setActiveQuestionId(q.id);
    setTimeout(() => {
      const el = document.getElementById(`q-${q.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
  };

  const activeGroup = safeGroups[activePartIndex] ?? safeGroups[0];

  // Part stats for tabs
  const partStats = React.useMemo(() => {
    return safeGroups.map((group, idx) => {
      const qs = group?.questions || [];
      const answeredCount = qs.filter((q) =>
        multilevelQuestionAnswered(q, answers, audioSet)
      ).length;
      const isComplete = qs.length > 0 && answeredCount === qs.length;
      const label =
        group?.title ||
        (skill === "reading" ? `Passage ${idx + 1}` : `Part ${idx + 1}`);
      const partNo = typeof group?.partNumber === "number" ? group.partNumber : idx + 1;
      return {
        label,
        shortLabel: `${skill === "reading" ? "Passage" : "Part"} ${partNo}`,
        answeredCount,
        totalCount: qs.length,
        isComplete,
      };
    });
  }, [safeGroups, skill, answers, audioSet]);

  const currentFlagged = activeQuestionId
    ? flaggedQuestions.has(activeQuestionId)
    : false;
  const isDtm = simulatorMode === "dtm";

  // The palette wraps into rows (a sideways-scrolling row hid everything after question 9 on phones).
  // When it holds more rows than fit, say so and keep the current question in view.
  const paletteRef = React.useRef<HTMLDivElement>(null);
  const [paletteHasMore, setPaletteHasMore] = React.useState(false);
  const refreshPaletteHint = React.useCallback(() => {
    const el = paletteRef.current;
    if (el) setPaletteHasMore(el.scrollHeight - el.clientHeight - el.scrollTop > 4);
  }, []);
  React.useEffect(() => {
    const el = paletteRef.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="true"]');
    if (el && current) {
      if (current.offsetTop < el.scrollTop) el.scrollTop = Math.max(0, current.offsetTop - 4);
      else if (current.offsetTop + current.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = current.offsetTop + current.offsetHeight - el.clientHeight + 4;
    }
    refreshPaletteHint();
  }, [activeQuestionId, flattenedQuestions.length, refreshPaletteHint]);

  return (
    <div className="space-y-4">
      {/* 1. Part-by-Part Tabs Stepper */}
      {safeGroups.length > 1 && (
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto rounded-2xl border border-border/70 bg-surface/70 p-1.5 backdrop-blur-md sm:flex-wrap" role="tablist" aria-label={t("partsLabel")}>
          {partStats.map((part, idx) => {
            const isActive = idx === activePartIndex;
            return (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`${part.label}: ${part.answeredCount}/${part.totalCount}`}
                onClick={() => {
                  setActivePartIndex(idx);
                }}
                className={cn(
                  "relative flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold transition-all touch-manipulation",
                  isActive
                    ? "bg-brand text-brand-fg shadow-md scale-[1.02]"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                )}
              >
                <span className="sm:hidden">{part.shortLabel}</span>
                <span className="hidden sm:inline">{part.label}</span>
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                    isActive
                      ? "bg-black/20 text-brand-fg"
                      : "bg-bg-subtle text-fg-muted"
                  )}
                >
                  {part.isComplete ? (
                    <CheckCircle2 className="size-3 text-emerald-400" />
                  ) : null}
                  {part.answeredCount}/{part.totalCount}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 2. Active Part Group Content */}
      {activeGroup && (
        <div className="transition-opacity duration-200">
          {renderGroupBlock(activeGroup, onReviewComplete, activePartIndex)}
        </div>
      )}

      {/* 3. CBT / DTM Question Palette & Stepper Controls */}
      <Card
        className={cn(
          "sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 border p-2 sm:p-4 backdrop-blur-xl",
          isDtm
            ? "border-slate-300 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95"
            : "border-border/80 bg-surface/95"
        )}
      >
        <div className="space-y-2 sm:space-y-3">
          {/* Question Palette Row */}
          {flattenedQuestions.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                <span className="font-semibold uppercase tracking-wider text-[11px] text-fg">
                  {t("palette")} (
                  {
                    flattenedQuestions.filter((q) =>
                      multilevelQuestionAnswered(q, answers, audioSet)
                    ).length
                  }
                  /{flattenedQuestions.length})
                </span>
                <div className="hidden sm:flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-emerald-600 " />
                    {t("legendAnswered")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-amber-400 " />
                    {t("legendFlagged")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-slate-300 dark:bg-slate-700 border border-border" />
                    {t("legendUnanswered")}
                  </span>
                </div>
              </div>

              {/* Palette: one swipeable row on phones, wrapping grid on larger screens */}
              <div
                ref={paletteRef}
                onScroll={refreshPaletteHint}
                data-testid="question-palette"
                className="relative flex max-h-[7.25rem] flex-wrap gap-1.5 overflow-y-auto overscroll-contain px-0.5 py-1 pr-1 sm:max-h-24"
                role="group"
                aria-label={t("palette")}
              >
                {flattenedQuestions.map((q) => {
                  const isAns = multilevelQuestionAnswered(q, answers, audioSet);
                  const isFlag = flaggedQuestions.has(q.id);
                  const isCurrent = q.id === activeQuestionId;
                  const isCurrentPart = q.groupIndex === activePartIndex;

                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => jumpToQuestion(q)}
                      aria-current={isCurrent ? "true" : undefined}
                      aria-label={`${t("questionLabel", { label: q.label, part: q.groupTitle })}, ${
                        isAns ? t("stateAnswered") : t("stateNotAnswered")
                      }${isFlag ? `, ${t("stateFlagged")}` : ""}`}
                      title={`${t("questionLabel", { label: q.label, part: q.groupTitle })}${
                        isAns ? ` - ${t("stateAnswered")}` : ""
                      }${isFlag ? ` - ${t("stateFlagged")}` : ""}`}
                      className={cn(
                        "relative flex size-9 sm:size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-all tabular-nums touch-manipulation",
                        isCurrent &&
                          "ring-2 ring-brand ring-offset-2 ring-offset-bg font-black scale-105",
                        isDtm
                          ? isFlag
                            ? "bg-amber-400 text-slate-950 border border-amber-500 shadow-xs"
                            : isAns
                            ? "bg-emerald-600 text-white border border-emerald-700 shadow-xs"
                            : "bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                          : isFlag
                          ? "bg-amber-500/25 text-amber-300 ring-1 ring-amber-400"
                          : isAns
                          ? "bg-emerald-600 text-white shadow-sm"
                          : isCurrentPart
                          ? "bg-bg-subtle text-fg border border-border/80 hover:bg-surface-hover"
                          : "bg-surface text-fg-muted/70 border border-border/40 hover:text-fg"
                      )}
                    >
                      {q.label}
                      {isFlag && (
                        <span
                          className={cn(
                            "absolute -top-1 -right-1 text-[9px] leading-none",
                            isDtm ? "text-amber-700 dark:text-amber-300" : "text-amber-400"
                          )}
                        >
                          ⚑
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {paletteHasMore && (
                <p aria-hidden data-testid="palette-more" className="pt-0.5 text-center text-[11px] text-fg-muted">⌄ {t("scrollHint")}</p>
              )}
            </div>
          )}

          {/* Previous / Flag / Next Stepper Controls */}
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 sm:pt-2.5">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={activePartIndex === 0}
                onClick={() => {
                  if (activePartIndex > 0)
                    setActivePartIndex(activePartIndex - 1);
                }}
                className="min-h-[40px] px-3.5 text-xs font-medium touch-manipulation"
              >
                <ArrowLeft className="size-4 sm:mr-1.5" />
                <span className="sr-only sm:not-sr-only">{t("previousPart")}</span>
              </Button>

              {activeQuestionId && (
                <Button
                  type="button"
                  variant={currentFlagged ? "subtle" : "ghost"}
                  size="sm"
                  onClick={() => toggleFlag(activeQuestionId)}
                  className={cn(
                    "min-h-[40px] px-3 text-xs font-medium transition-colors touch-manipulation",
                    currentFlagged
                      ? "bg-amber-400/25 text-amber-600 dark:text-amber-300 border border-amber-500/50"
                      : "text-fg-muted"
                  )}
                >
                  <Flag
                    className={cn(
                      "size-3.5 sm:mr-1.5",
                      currentFlagged && "fill-amber-400 text-amber-500"
                    )}
                  />
                  <span className="sr-only sm:not-sr-only">{currentFlagged ? t("flagged") : t("flag")}</span>
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {activePartIndex < safeGroups.length - 1 ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setActivePartIndex(activePartIndex + 1)}
                  className="min-h-[40px] bg-brand text-brand-fg px-4 text-xs font-semibold shadow hover:bg-brand/90 touch-manipulation"
                >
                  {t("nextPart")}
                  <ArrowRight className="ml-1.5 size-4" />
                </Button>
              ) : (
                <>
                  {isFullTest && !isLastSection && onNextSection ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={onNextSection}
                      className="min-h-[40px] bg-brand text-brand-fg px-4 text-xs font-semibold shadow hover:bg-brand/90 touch-manipulation"
                    >
                      {t("nextSection")} →
                    </Button>
                  ) : onSubmitSection ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={onSubmitSection}
                      className="min-h-[40px] bg-emerald-600 text-white px-4 text-xs font-semibold shadow hover:bg-emerald-700 touch-manipulation"
                    >
                      {t("submitSection")}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

