"use client";

import * as React from "react";
import { Check, Minus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { MockAttemptQuestion } from "@/lib/types";

export type ReviewFilter = "all" | "wrong" | "unanswered";

const answeredOf = (q: MockAttemptQuestion) => Boolean((q.response ?? "").trim()) || Boolean(q.hasAudio);

/** Rows a filter keeps: "wrong" is an answer that was marked wrong; an empty answer is "unanswered". */
export function filterReviewRows(questions: MockAttemptQuestion[], filter: ReviewFilter): MockAttemptQuestion[] {
  if (filter === "unanswered") return questions.filter((q) => !answeredOf(q));
  if (filter === "wrong") return questions.filter((q) => answeredOf(q) && q.isCorrect === false);
  return questions;
}

/**
 * Auto-marked questions (Listening, Reading) as one compact table: number, question, the student's
 * answer, the key (only when the server sends it) and the mark. Filters: all, wrong, unanswered.
 */
export function ResultReviewTable({ title, questions }: { title: string; questions: MockAttemptQuestion[] }) {
  const t = useTranslations("mock.resultTable");
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const counts: Record<ReviewFilter, number> = {
    all: questions.length,
    wrong: filterReviewRows(questions, "wrong").length,
    unanswered: filterReviewRows(questions, "unanswered").length,
  };
  const rows = filterReviewRows(questions, filter);
  const correct = questions.filter((q) => q.isCorrect === true).length;
  const tableId = React.useId();

  return (
    <section aria-label={title} className="rounded-[12px] border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-fg">
          {title} <span className="font-normal tabular-nums text-fg-muted">· {t("correctOf", { correct, total: questions.length })}</span>
        </h2>
        <div role="group" aria-label={t("filterLabel")} className="flex gap-1 rounded-lg bg-bg-subtle p-0.5">
          {(["all", "wrong", "unanswered"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              aria-controls={tableId}
              onClick={() => setFilter(key)}
              className={cn(
                "min-h-[36px] rounded-md px-2.5 text-xs font-semibold tabular-nums transition-colors",
                filter === key ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {t(`filter_${key}`, { count: counts[key] })}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-fg-muted" role="status">{t(`empty_${filter}`)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table id={tableId} className="w-full text-left text-sm">
            <thead className="text-xs text-fg-muted">
              <tr className="border-b border-border">
                <th scope="col" className="w-12 px-3 py-1.5 font-medium">#</th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">{t("question")}</th>
                <th scope="col" className="px-3 py-1.5 font-medium">{t("yourAnswer")}</th>
                <th scope="col" className="px-3 py-1.5 font-medium">{t("key")}</th>
                <th scope="col" className="w-12 px-3 py-1.5 font-medium"><span className="sr-only">{t("mark")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => {
                const answered = answeredOf(q);
                const state = q.isCorrect === true ? "correct" : !answered ? "unanswered" : q.isCorrect === false ? "wrong" : "pending";
                return (
                  <tr key={q.id} id={`review-${q.id}`} data-review-state={state} className="border-b border-border/60 last:border-0 align-top">
                    <td className="px-3 py-1.5 font-semibold tabular-nums text-fg">{q.displayNumber ?? q.number}</td>
                    <td className="hidden max-w-[28rem] px-3 py-1.5 text-fg-muted sm:table-cell">
                      <span className="line-clamp-2" title={q.prompt}>{q.prompt}</span>
                    </td>
                    <td className={cn("px-3 py-2 font-medium break-words", state === "wrong" ? "text-danger" : "text-fg")}>
                      {answered ? q.response : <span className="font-normal italic text-fg-muted">{t("noAnswer")}</span>}
                    </td>
                    <td className="px-3 py-1.5 break-words text-success">
                      {q.correctAnswers && q.correctAnswers.length > 0 ? q.correctAnswers.join(" / ") : <span className="text-fg-muted">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "grid size-6 place-items-center rounded-full",
                          state === "correct" ? "bg-success-bg text-success" : state === "wrong" ? "bg-danger-bg text-danger" : "bg-bg-subtle text-fg-muted",
                        )}
                        role="img"
                        aria-label={t(`state_${state}`)}
                      >
                        {state === "correct" ? <Check className="size-3.5" aria-hidden /> : state === "wrong" ? <X className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
