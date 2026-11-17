"use client";

import * as React from "react";
import { Check, ChevronDown, Minus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { MockAttemptGroup, MockAttemptQuestion, MockSkill } from "@/lib/types";
import { ReviewExplain } from "./review-explain";

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
export function ResultReviewTable({ title, skill, groups }: { title: string; skill: MockSkill; groups: MockAttemptGroup[] }) {
  const t = useTranslations("mock.resultTable");
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const questions = React.useMemo(() => groups.flatMap((g) => g.questions), [groups]);
  const groupOf = React.useMemo(() => new Map(groups.flatMap((g) => g.questions.map((q) => [q.id, g] as const))), [groups]);
  // The open "where is the answer" panel; a wrong answer with review material opens on click.
  const [open, setOpen] = React.useState<string | null>(null);
  const explainable = (q: MockAttemptQuestion) => Boolean(q.evidence) || q.audioStartSec != null;
  const counts: Record<ReviewFilter, number> = {
    all: questions.length,
    wrong: filterReviewRows(questions, "wrong").length,
    unanswered: filterReviewRows(questions, "unanswered").length,
  };
  const rows = filterReviewRows(questions, filter);
  const correct = questions.filter((q) => q.isCorrect === true).length;
  const tableId = React.useId();

  return (
    <section aria-label={title} className="rounded-card border border-border bg-surface">
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
                <th scope="col" className="w-10 px-2 py-1.5 font-medium"><span className="sr-only">{t("where")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => {
                const answered = answeredOf(q);
                const state = q.isCorrect === true ? "correct" : !answered ? "unanswered" : q.isCorrect === false ? "wrong" : "pending";
                const canExplain = explainable(q);
                const isOpen = open === q.id;
                const group = groupOf.get(q.id);
                return (
                  <React.Fragment key={q.id}>
                  <tr
                    id={`review-${q.id}`}
                    data-review-state={state}
                    className={cn("border-b border-border/60 last:border-0 align-top", canExplain && state !== "correct" && "cursor-pointer hover:bg-surface-hover")}
                    onClick={canExplain && state !== "correct" ? () => setOpen(isOpen ? null : q.id) : undefined}
                  >
                    <td className="px-3 py-1.5 font-semibold tabular-nums text-fg">{q.displayNumber ?? q.number}</td>
                    <td className="hidden max-w-[28rem] px-3 py-1.5 text-fg-muted sm:table-cell">
                      <span className="line-clamp-2" title={q.prompt}>{q.prompt}</span>
                    </td>
                    <td className={cn("px-3 py-2 font-medium break-words", state === "wrong" ? "text-danger" : "text-fg")}>
                      {answered ? q.response : <span className="font-normal italic text-fg-muted">{t("noAnswer")}</span>}
                      {(q as { revealed?: boolean }).revealed && (
                        <span className="ml-1.5 inline-block rounded-full border border-warning-border bg-warning-bg px-1.5 text-[11px] font-medium text-warning">{t("revealed")}</span>
                      )}
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
                    <td className="px-2 py-1.5">
                      {canExplain && (
                        <button
                          type="button"
                          className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                          aria-expanded={isOpen}
                          aria-controls={`review-explain-${q.id}`}
                          aria-label={t("whereFor", { number: q.displayNumber ?? q.number })}
                          title={t("where")}
                          onClick={(event) => { event.stopPropagation(); setOpen(isOpen ? null : q.id); }}
                        >
                          <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && group && (
                    <tr id={`review-explain-${q.id}`} className="border-b border-border/60">
                      <td colSpan={6} className="px-3 pb-3">
                        <ReviewExplain skill={skill} group={group} question={q} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
