"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AttemptQuestion, TestSection } from "@/lib/types";

const SECTION_ORDER: TestSection[] = ["listening", "reading", "writing", "speaking"];

function tFallback(t: ReturnType<typeof useTranslations>, key: string, fallback: string): string {
  const v = t(key as never) as unknown;
  if (typeof v !== "string" || v === key || v.endsWith(`.${key}`)) return fallback;
  return v;
}

export function QuestionNav({
  questions,
  answers,
  activeId,
  activeSection,
  onJump,
  onSectionChange,
}: {
  questions: AttemptQuestion[];
  answers: Record<string, string>;
  activeId: string | null;
  activeSection: TestSection;
  onJump: (qid: string) => void;
  onSectionChange: (s: TestSection) => void;
}) {
  const t = useTranslations("tests");

  const bySection = React.useMemo(() => {
    const map = new Map<TestSection, AttemptQuestion[]>();
    for (const sec of SECTION_ORDER) {
      const list = questions.filter((q) => q.section === sec);
      if (list.length) map.set(sec, list);
    }
    return map;
  }, [questions]);

  const currentList = bySection.get(activeSection) ?? questions;

  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:mx-0 sm:rounded-t-[12px] sm:border sm:px-4">
      {/* mobile: horizontal scroll pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {/* Scores pill */}
        <span className="shrink-0 rounded-full bg-bg-subtle px-3 py-1 text-xs font-semibold text-fg-muted">
          {tFallback(t, "score", "Scores")}: {Object.values(answers).filter((v) => v?.trim()).length}/{questions.length}
        </span>

        <div className="flex items-center gap-1.5" role="tablist" aria-label="Question navigation">
          {currentList.map((q) => {
            const answered = !!(answers[q.questionId] ?? "").trim();
            const isActive = activeId === q.questionId;
            return (
              <button
                key={q.questionId}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`${t("question")} ${q.order}${answered ? " ✓" : ""}`}
                onClick={() => onJump(q.questionId)}
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                  isActive
                    ? "bg-brand text-brand-fg shadow-sm"
                    : answered
                      ? "bg-success-bg text-success ring-1 ring-success/20 hover:bg-success-bg/80"
                      : "border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg",
                )}
              >
                {q.order}
              </button>
            );
          })}
        </div>

        <div className="ml-auto hidden items-center gap-1 sm:flex">
          {Array.from(bySection.keys()).map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => onSectionChange(sec)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                sec === activeSection
                  ? "bg-brand-subtle text-brand-subtle-fg"
                  : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
              )}
            >
              {tFallback(t, `sections.${sec}`, sec)}
            </button>
          ))}
        </div>
      </div>

      {/* tiny keyboard hint */}
      <p className="mt-1 hidden text-[11px] text-fg-subtle sm:block">
        {tFallback(
          t,
          "navHint",
          "Tip: Click a number to jump · Tab / Shift+Tab to move · Answers auto-save on blur",
        )}
      </p>
    </div>
  );
}
