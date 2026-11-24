"use client";

import * as React from "react";
import { Flag, ArrowLeft, ArrowRight, CheckCircle2, LayoutGrid, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useRunnerShortcuts } from "./runner-shortcuts";
import type { ExamSimulatorMode, MockSection, MockSkill } from "@/lib/types";
import { multilevelQuestionAnswered } from "@/lib/multilevel-completeness";

import { objectiveNumberLabel } from "@/lib/objective-question";
import { examContentUnits } from "@/lib/exam-content-units";

export interface CbtSectionStepperProps {
  attemptId?: string;
  canonicalListening?: boolean;
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
    partIndex?: number,
    taskGroups?: MockSection["groups"],
    partNumber?: number,
    unitKey?: string,
  ) => React.ReactNode;
  onReviewComplete?: () => void;
  onNextSection?: () => void;
  onSubmitSection?: () => void;
  isLastSection?: boolean;
  isFullTest?: boolean;
  /** Focus mode: the bar keeps only the question controls. */
  focus?: boolean;
}

export function CbtSectionStepper({
  skill,
  groups,
  attemptId,
  canonicalListening = true,
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
  focus = false,
}: CbtSectionStepperProps) {
  const t = useTranslations("mock.stepper");
  const units = React.useMemo(() => examContentUnits(groups || [], skill, canonicalListening), [groups, skill, canonicalListening]);
  const positionKey = attemptId ? `bw_exam_position_${attemptId}_${skill}` : null;
  const [initialQuestion] = React.useState(() => {
    try { return positionKey ? sessionStorage.getItem(positionKey) : null; }
    catch { return null; }
  });
  const [activePartIndex, setActivePartIndex] = React.useState(() =>
    Math.max(0, units.findIndex((unit) => unit.groups.some((group) => group.questions?.some((q) => q.id === initialQuestion)))));
  const [internalFlags, setInternalFlags] = React.useState<Set<string>>(new Set());
  const [activeQuestionId, setActiveQuestionId] = React.useState<string | null>(initialQuestion);

  const flaggedQuestions = externalFlags ?? internalFlags;

  // Flatten questions. `label` is the authored question number the student
  // sees next to the question (e.g. 9 when a part is absent); the sequential
  // position is only a fallback for items without a number.
  const flattenedQuestions = React.useMemo(() => {
    let globalNum = 1;
    return units.flatMap((unit, groupIdx) =>
      unit.groups.flatMap((group) => (group.questions || []).map((q) => ({
        ...q,
        label: typeof q.displayNumber === "number" && q.displayNumber > 0 ? q.displayNumber : typeof q.number === "number" && q.number > 0 ? q.number : globalNum,
        displayLabel: objectiveNumberLabel(q),
        globalIndex: globalNum++,
        groupIndex: groupIdx,
        groupTitle:
          group.title ||
          (skill === "reading" ? `Passage ${groupIdx + 1}` : `Part ${groupIdx + 1}`),
      })))
    );
  }, [units, skill]);

  // A shorter section (or a resumed one) never keeps a part number it does not have.
  React.useEffect(() => {
    if (activePartIndex > 0 && activePartIndex >= units.length) setActivePartIndex(0);
  }, [activePartIndex, units.length]);

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
    if (!activeQuestionId) return;
    const found = flattenedQuestions.find((q) => q.id === activeQuestionId);
    if (found) {
      onActiveQuestionChange?.(found.label);
      try { if (positionKey) sessionStorage.setItem(positionKey, found.id); } catch {}
    }
  }, [activeQuestionId, flattenedQuestions, onActiveQuestionChange, positionKey]);

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
      const element = document.getElementById(`q-${q.id}`);
      if (!element) return;
      const focusQuestion = () => {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        const target = element.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select, [role=radio], button:not([disabled])");
        if (target) target.focus({ preventScroll: true });
        else { element.tabIndex = -1; element.focus({ preventScroll: true }); }
      };
      const visible = element.dispatchEvent(new Event("bw-exam-show-question", { bubbles: true, cancelable: true }));
      if (visible) focusQuestion();
      else requestAnimationFrame(focusQuestion);
    }, 50);
  };

  const activeUnit = units[activePartIndex] ?? units[0];

  // Part stats for tabs
  const partStats = React.useMemo(() => {
    return units.map(({ source: group, groups: members, number }, idx) => {
      const qs = members.flatMap((item) => item.questions || []);
      const answeredCount = qs.filter((q) =>
        multilevelQuestionAnswered(q, answers, audioSet)
      ).length;
      const isComplete = qs.length > 0 && answeredCount === qs.length;
      const label =
        group?.title ||
        t(skill === "reading" ? "passageN" : "partN", { n: idx + 1 });
      const partNo = number;
      return {
        label,
        shortLabel: t(skill === "reading" ? "passageN" : "partN", { n: partNo }),
        answeredCount,
        totalCount: qs.length,
        isComplete,
      };
    });
  }, [units, skill, answers, audioSet, t]);

  const currentFlagged = activeQuestionId
    ? flaggedQuestions.has(activeQuestionId)
    : false;
  const isDtm = simulatorMode === "dtm";

  // Roving tab stop: each palette is one Tab stop; arrows, Home and End move inside it.
  const currentIndex = Math.max(0, flattenedQuestions.findIndex((q) => q.id === activeQuestionId));
  const activeQuestion = flattenedQuestions[currentIndex];
  const [rovingId, setRovingId] = React.useState<string | null>(null);
  const onPaletteKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-qid]")];
    const at = Math.max(0, list.indexOf(document.activeElement as HTMLButtonElement));
    const last = list.length - 1;
    const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: last }[event.key];
    if (next === undefined || last < 0) return;
    event.preventDefault();
    const target = list[Math.max(0, Math.min(last, next))];
    setRovingId(target.dataset.qid ?? null);
    target.focus();
  };
  const tabStopIn = (ids: string[]) => (rovingId && ids.includes(rovingId) ? rovingId : activeQuestionId && ids.includes(activeQuestionId) ? activeQuestionId : ids[0]);

  // Every question of the section: a sheet on demand (phones always use it; the bar shows the open part's questions).
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const sheetClose = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!sheetOpen) return;
    sheetClose.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSheetOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const answeredTotal = flattenedQuestions.filter((q) => multilevelQuestionAnswered(q, answers, audioSet)).length;
  const goTo = (index: number) => {
    const q = flattenedQuestions[index];
    if (q) jumpToQuestion(q);
  };

  const paletteButton = (q: (typeof flattenedQuestions)[number], tabStop: string | undefined, onOpen?: () => void) => {
    const isAns = multilevelQuestionAnswered(q, answers, audioSet);
    const isFlag = flaggedQuestions.has(q.id);
    const isCurrent = q.id === activeQuestionId;
    const isCurrentPart = q.groupIndex === activePartIndex;
    return (
      <button
        key={q.id}
        type="button"
        data-qid={q.id}
        onClick={() => { jumpToQuestion(q); onOpen?.(); }}
        onFocus={() => setRovingId(q.id)}
        tabIndex={q.id === tabStop ? 0 : -1}
        aria-current={isCurrent ? "true" : undefined}
        aria-label={`${t("questionLabel", { label: q.displayLabel, part: q.groupTitle })}, ${
          isAns ? t("stateAnswered") : t("stateNotAnswered")
        }${isFlag ? `, ${t("stateFlagged")}` : ""}`}
        title={`${t("questionLabel", { label: q.displayLabel, part: q.groupTitle })}${
          isAns ? ` - ${t("stateAnswered")}` : ""
        }${isFlag ? ` - ${t("stateFlagged")}` : ""}`}
        className={cn(
          "relative flex h-11 min-w-11 shrink-0 px-1 items-center justify-center overflow-hidden rounded-field text-sm font-bold tabular-nums transition-colors duration-fast touch-manipulation md:h-9 md:min-w-9",
          isCurrent && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
          isDtm
            ? isFlag
              ? "bg-warning text-warning-fg border border-warning shadow-xs"
              : isAns
              ? "bg-brand text-brand-fg border border-brand shadow-xs"
              : "bg-surface-hover text-fg-muted border border-border-strong"
            : isAns
            ? "bg-brand text-brand-fg"
            : isCurrentPart
            ? "border border-border-strong bg-surface text-fg hover:bg-surface-hover"
            : "border border-border bg-bg-subtle text-fg-muted hover:text-fg",
          // Flagged keeps its answered / unanswered fill and adds a warning outline and corner mark.
          isFlag && !isDtm && "outline outline-2 -outline-offset-2 outline-warning",
        )}
      >
        {q.displayLabel}
        {isFlag && <span className="absolute right-0 top-0 size-0 border-l-[10px] border-t-[10px] border-l-transparent border-t-warning" aria-hidden />}
      </button>
    );
  };

  const partQuestions = flattenedQuestions.filter((q) => q.groupIndex === activePartIndex);
  const partTabStop = tabStopIn(partQuestions.map((q) => q.id));
  const sheetTabStop = tabStopIn(flattenedQuestions.map((q) => q.id));
  const onLastQuestion = currentIndex >= flattenedQuestions.length - 1;
  // Keyboard: N / P move like the arrows below, F flags the open question (never while typing).
  useRunnerShortcuts({
    next: () => { if (!onLastQuestion) goTo(currentIndex + 1); },
    previous: () => { if (currentIndex > 0) goTo(currentIndex - 1); },
    flag: () => { if (activeQuestionId) toggleFlag(activeQuestionId); },
  });
  const onLastPart = activePartIndex >= units.length - 1;
  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
      <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-brand" />{t("legendAnswered")}</span>
      <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-border-strong bg-surface outline outline-2 -outline-offset-2 outline-warning" />{t("legendFlagged")}</span>
      <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-border-strong bg-surface" />{t("legendUnanswered")}</span>
    </div>
  );
  const iconButton = "min-h-11 min-w-11 px-2 touch-manipulation md:min-h-10 md:min-w-10";

  return (
    // At least one screen tall, so the bar sits at the bottom even under a short part.
    <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col gap-3">
      {/* The open part */}
      {activeUnit && (
        <div className="flex-1 transition-opacity duration-200" onFocusCapture={(event) => {
          const element = (event.target as HTMLElement).closest<HTMLElement>('[id^="q-"]');
          if (element) setActiveQuestionId(element.id.slice(2));
        }}>
          {renderGroupBlock(activeUnit.source, onReviewComplete, activePartIndex, activeUnit.groups, activeUnit.number, activeUnit.key)}
        </div>
      )}

      {/* One slim bar: parts, the open part's questions and the stepper controls (two rows on phones). */}
      <div
        data-runner-bottom
        className={cn(
          "sticky bottom-0 z-30 -mx-4 border-t px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:mx-0 sm:px-3",
          isDtm ? "border-border-strong bg-surface" : "border-border/80 bg-surface/95",
        )}
      >
        <nav className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3" aria-label={t("navigatorLabel")}>
          {/* Screen readers hear which question is open and its state. */}
          {activeQuestion && (
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {t("announceQuestion", {
                label: activeQuestion.label,
                total: flattenedQuestions.length,
                state: multilevelQuestionAnswered(activeQuestion, answers, audioSet) ? t("stateAnswered") : t("stateNotAnswered"),
              })}
              {flaggedQuestions.has(activeQuestion.id) ? `, ${t("stateFlagged")}` : ""}
            </p>
          )}

          {units.length > 1 && !focus && (
            <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto md:max-w-[50%]" role="tablist" aria-label={t("partsLabel")}>
              {partStats.map((part, idx) => {
                const isActive = idx === activePartIndex;
                return (
                  <button
                    key={idx}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-label={`${part.label}: ${part.answeredCount}/${part.totalCount}`}
                    title={part.label}
                    onClick={() => setActivePartIndex(idx)}
                    className={cn(
                      "flex min-h-10 shrink-0 items-center gap-1.5 rounded-control px-3 text-sm font-semibold transition-colors duration-fast touch-manipulation",
                      isActive ? "bg-brand text-brand-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                    )}
                  >
                    <span>{part.shortLabel}</span>
                    <span
                      className={cn(
                        "flex items-center gap-0.5 rounded-full px-1.5 text-xs font-bold tabular-nums",
                        isActive ? "bg-black/20 text-brand-fg dark:bg-fg/25" : "bg-bg-subtle text-fg-muted",
                        // Phones: the count on the open part only, so every part tab fits on one row.
                        !isActive && !part.isComplete && "max-sm:hidden",
                      )}
                    >
                      {part.isComplete ? <CheckCircle2 className="size-3" aria-hidden /> : null}
                      <span className={cn(!isActive && "max-sm:hidden")}>{part.answeredCount}/{part.totalCount}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {/* The open part's questions (wide screens); every question is in the sheet. */}
            {partQuestions.length > 0 && !focus && (
              <div
                data-testid="part-palette"
                className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto px-0.5 py-1 md:flex"
                role="toolbar"
                aria-label={t("partQuestions", { part: partStats[activePartIndex]?.label ?? "" })}
                onKeyDown={onPaletteKeyDown}
                onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRovingId(null); }}
              >
                {partQuestions.map((q) => paletteButton(q, partTabStop))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
              className="min-h-11 flex-1 justify-start gap-1.5 px-3 text-sm font-semibold md:min-h-10 md:flex-none"
              title={t("allQuestions")}
            >
              <LayoutGrid className="size-4" aria-hidden />
              <span className="md:sr-only">{t("allQuestions")}</span>
              <span className="tabular-nums text-fg-muted">{answeredTotal}/{flattenedQuestions.length}</span>
            </Button>
            {activeQuestionId && (
              <Button
                type="button"
                variant={currentFlagged ? "subtle" : "ghost"}
                size="sm"
                aria-pressed={currentFlagged}
                aria-label={currentFlagged ? t("flagged") : t("flag")}
                title={currentFlagged ? t("flagged") : t("flag")}
                onClick={() => toggleFlag(activeQuestionId)}
                className={cn(iconButton, currentFlagged ? "border border-warning/50 bg-warning/25 text-warning" : "text-fg-muted")}
              >
                <Flag className={cn("size-4", currentFlagged && "fill-warning text-warning")} aria-hidden />
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" className={iconButton} disabled={currentIndex <= 0} onClick={() => goTo(currentIndex - 1)} aria-label={t("previousQuestion")} title={t("previousQuestion")}>
              <ArrowLeft className="size-4" aria-hidden />
            </Button>
            <Button type="button" variant="outline" size="sm" className={iconButton} disabled={onLastQuestion} onClick={() => goTo(currentIndex + 1)} aria-label={t("nextQuestion")} title={t("nextQuestion")}>
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            {onLastPart && (isFullTest && !isLastSection && onNextSection ? (
              <Button type="button" size="sm" onClick={onNextSection} className="min-h-11 px-3 text-sm font-semibold touch-manipulation md:min-h-10">
                {t("nextSection")} →
              </Button>
            ) : onSubmitSection ? (
              <Button type="button" size="sm" onClick={onSubmitSection} className="min-h-11 px-3 text-sm font-semibold touch-manipulation md:min-h-10">
                {t("submitSection")}
              </Button>
            ) : null)}
          </div>
        </nav>
      </div>

      {sheetOpen && (
        <div className="anim-fade fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" data-state="open" onClick={() => setSheetOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="question-sheet-title"
            data-state="open"
            className="anim-sheet max-h-[80dvh] w-full overflow-y-auto rounded-t-dialog border border-border bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-e3 sm:anim-pop sm:max-w-2xl sm:rounded-dialog sm:pt-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden />
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="question-sheet-title" className="text-base font-semibold text-fg">
                {t("palette")} ({answeredTotal}/{flattenedQuestions.length})
              </h2>
              <Button ref={sheetClose} type="button" variant="ghost" size="sm" className={iconButton} onClick={() => setSheetOpen(false)} aria-label={t("closePalette")}>
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            {legend}
            <div
              data-testid="question-palette"
              id="question-palette-grid"
              className="mt-3 space-y-3"
              role="toolbar"
              aria-label={t("palette")}
              onKeyDown={onPaletteKeyDown}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRovingId(null); }}
            >
              {partStats.map((part, idx) => (
                <section key={idx} aria-label={part.label}>
                  <p className="mb-2 text-sm font-semibold text-fg-muted">{part.label} · {part.answeredCount}/{part.totalCount}</p>
                  <div className="flex flex-wrap gap-2">
                    {flattenedQuestions.filter((q) => q.groupIndex === idx).map((q) => paletteButton(q, sheetTabStop, () => setSheetOpen(false)))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

