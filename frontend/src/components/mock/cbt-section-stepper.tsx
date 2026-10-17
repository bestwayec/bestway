"use client";

import * as React from "react";
import { Flag, ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
  const [activePartIndex, setActivePartIndex] = React.useState(0);
  const [internalFlags, setInternalFlags] = React.useState<Set<string>>(new Set());
  const [activeQuestionId, setActiveQuestionId] = React.useState<string | null>(null);

  const flaggedQuestions = externalFlags ?? internalFlags;

  // Flatten questions with global 1-based sequential index
  const flattenedQuestions = React.useMemo(() => {
    let globalNum = 1;
    return groups.flatMap((group, groupIdx) =>
      group.questions.map((q) => ({
        ...q,
        globalIndex: globalNum++,
        groupIndex: groupIdx,
        groupTitle:
          group.title ||
          (skill === "reading" ? `Passage ${groupIdx + 1}` : `Part ${groupIdx + 1}`),
      }))
    );
  }, [groups, skill]);

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
      onActiveQuestionChange(found.globalIndex);
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

  const activeGroup = groups[activePartIndex] ?? groups[0];

  // Part stats for tabs
  const partStats = React.useMemo(() => {
    return groups.map((group, idx) => {
      const qs = group.questions;
      const answeredCount = qs.filter((q) =>
        multilevelQuestionAnswered(q, answers, audioSet)
      ).length;
      const isComplete = qs.length > 0 && answeredCount === qs.length;
      const label =
        group.title ||
        (skill === "reading" ? `Passage ${idx + 1}` : `Part ${idx + 1}`);
      return {
        label,
        answeredCount,
        totalCount: qs.length,
        isComplete,
      };
    });
  }, [groups, skill, answers, audioSet]);

  const currentFlagged = activeQuestionId
    ? flaggedQuestions.has(activeQuestionId)
    : false;
  const isDtm = simulatorMode === "dtm";

  return (
    <div className="space-y-4">
      {/* 1. Part-by-Part Tabs Stepper */}
      {groups.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-surface/70 p-1.5 backdrop-blur-md">
          {partStats.map((part, idx) => {
            const isActive = idx === activePartIndex;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setActivePartIndex(idx);
                }}
                className={cn(
                  "relative flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-all touch-manipulation",
                  isActive
                    ? "bg-brand text-brand-fg shadow-md scale-[1.02]"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                )}
              >
                <span>{part.label}</span>
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                    isActive
                      ? "bg-black/20 text-white"
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
          "sticky bottom-3 z-30 border p-3 sm:p-4 backdrop-blur-xl shadow-2xl",
          isDtm
            ? "border-slate-300 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95"
            : "border-border/80 bg-surface/95"
        )}
      >
        <div className="space-y-3">
          {/* Question Palette Row */}
          {flattenedQuestions.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                <span className="font-semibold uppercase tracking-wider text-[11px] text-fg">
                  {isDtm ? "DTM Savollar Palitrasi" : "Question Palette"} (
                  {
                    flattenedQuestions.filter((q) =>
                      multilevelQuestionAnswered(q, answers, audioSet)
                    ).length
                  }
                  /{flattenedQuestions.length})
                </span>
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-emerald-600 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                    {isDtm ? "Javob berilgan (Yashil)" : "Ishlangan"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-amber-400 ring-2 ring-amber-400/50" />
                    {isDtm ? "Belgilangan (Sariq)" : "Review"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-slate-300 dark:bg-slate-700 border border-border" />
                    {isDtm ? "Javobsiz (Kulrang)" : "Ishlanmagan"}
                  </span>
                </div>
              </div>

              {/* Scrollable Palette grid */}
              <div
                className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1 py-1"
                role="group"
                aria-label="Question palette"
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
                      title={`Question ${q.globalIndex} (${q.groupTitle})${
                        isAns ? " - Answered" : ""
                      }${isFlag ? " - Flagged" : ""}`}
                      className={cn(
                        "relative flex size-8 items-center justify-center rounded-lg text-xs font-bold transition-all tabular-nums touch-manipulation",
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
                      {q.globalIndex}
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
            </div>
          )}

          {/* Previous / Flag / Next Stepper Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
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
                <ArrowLeft className="mr-1.5 size-4" />
                {isDtm ? "Oldingi qism" : "Previous Part"}
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
                      "mr-1.5 size-3.5",
                      currentFlagged && "fill-amber-400 text-amber-500"
                    )}
                  />
                  {isDtm
                    ? currentFlagged
                      ? "Belgilangan (Flagged)"
                      : "Belgilash (Flag)"
                    : currentFlagged
                    ? "Flagged for Review"
                    : "Flag Question"}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {activePartIndex < groups.length - 1 ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setActivePartIndex(activePartIndex + 1)}
                  className="min-h-[40px] bg-brand text-brand-fg px-4 text-xs font-semibold shadow hover:bg-brand/90 touch-manipulation"
                >
                  {isDtm ? "Keyingi qism" : "Next Part"}
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
                      Next Section →
                    </Button>
                  ) : onSubmitSection ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={onSubmitSection}
                      className="min-h-[40px] bg-emerald-600 text-white px-4 text-xs font-semibold shadow hover:bg-emerald-500 touch-manipulation"
                    >
                      Submit Section
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

