"use client";

import { cn } from "@/lib/utils";
import type { DisplayPassage } from "./reading-preview-model";
import { isPreviewAnswered } from "./preview-question-renderer";

/**
 * Compact fixed bottom bar for the full-screen Reading preview.
 * Only real passages are listed — task groups never create passage items.
 * All state stays local; callbacks only switch passages or scroll.
 */
export function PreviewBottomNavigation({
  passages,
  activeKey,
  activeQuestionId,
  answers,
  onSelectPassage,
  onSelectQuestion,
}: {
  passages: DisplayPassage[];
  activeKey: string;
  activeQuestionId: string | null;
  answers: Record<string, string>;
  onSelectPassage: (passageKey: string) => void;
  onSelectQuestion: (questionId: string) => void;
}) {
  const active = passages.find((p) => p.key === activeKey) ?? passages[0];
  if (!active) return null;

  return (
    <nav
      aria-label="Preview question navigation"
      className="shrink-0 border-t border-border bg-surface"
    >
      <div className="flex min-h-12 items-center gap-2 overflow-x-auto px-3 py-1.5">
        {passages.length > 1 && (
          <>
            <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Passages">
              {passages.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onSelectPassage(p.key)}
                  aria-current={p.key === active.key ? "page" : undefined}
                  title={p.title?.trim() || `Passage ${p.ordinal}`}
                  className={cn(
                    "h-7 shrink-0 rounded-chip border px-2 text-xs font-semibold tabular-nums transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    p.key === active.key
                      ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                      : "border-border bg-transparent text-fg-muted hover:text-fg",
                  )}
                >
                  Passage {p.ordinal}
                </button>
              ))}
            </div>
            <div aria-hidden="true" className="w-px shrink-0 self-stretch bg-border" />
          </>
        )}
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={`Questions for passage ${active.ordinal}`}
        >
          {active.questions.map((q) => {
            const answered = isPreviewAnswered(q, answers[q.id] ?? "");
            const isActive = q.id === activeQuestionId;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => onSelectQuestion(q.id)}
                aria-label={`Go to question ${q.number}${answered ? " (answered)" : ""}`}
                title={`Q${q.number}${answered ? " — answered" : ""}`}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-chip border text-xs font-semibold tabular-nums transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  answered
                    ? "border-brand/60 bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-transparent text-fg-muted hover:text-fg",
                  isActive && "outline outline-1 outline-brand",
                )}
              >
                {q.number}
              </button>
            );
          })}
          {active.questions.length === 0 && (
            <span className="text-xs text-fg-subtle">No questions</span>
          )}
        </div>
      </div>
    </nav>
  );
}
