"use client";

import * as React from "react";
import { Check, ChevronDown, Flag, Minus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { examContentUnits } from "@/lib/exam-content-units";
import { cn } from "@/lib/utils";
import type { MockAttemptGroup, MockAttemptQuestion, MockSkill } from "@/lib/types";
import { ReviewExplain } from "./review-explain";

export type ReviewFilter = "all" | "wrong" | "unanswered" | "correct" | "pending" | "flagged";

const answeredOf = (q: MockAttemptQuestion) =>
  Boolean((q.response ?? "").trim()) || Boolean(q.hasAudio);

export function reviewState(q: MockAttemptQuestion): "correct" | "wrong" | "unanswered" | "pending" {
  // The scorer can credit a position in a shared-response cluster even if its own field is empty.
  if (q.isCorrect === true) return "correct";
  if (!answeredOf(q)) return "unanswered";
  return q.isCorrect === false || q.isGraded ? "wrong" : "pending";
}

function positions(q: MockAttemptQuestion) {
  return Math.max(1, (q.displayNumberEnd ?? q.displayNumber ?? q.number) - (q.displayNumber ?? q.number) + 1);
}

export function filterReviewRows(
  questions: MockAttemptQuestion[],
  filter: ReviewFilter,
  flaggedIds?: Set<string>,
): MockAttemptQuestion[] {
  if (filter === "all") return questions;
  if (filter === "flagged") return questions.filter((q) => flaggedIds?.has(q.id));
  return questions.filter((q) => reviewState(q) === filter);
}

/**
 * Auto-marked questions (Listening, Reading) as one compact table: number, question, the student's
 * answer, the key (only when the server sends it) and the mark. Filters: all, wrong, unanswered, correct, flagged.
 * Groups by Passage (Reading) or Section (Listening) when multiple groups exist.
 */
export function ResultReviewTable({
  title,
  skill,
  groups,
  flaggedIds,
  canonicalListening = true,
}: {
  title: string;
  skill: MockSkill;
  groups: MockAttemptGroup[];
  flaggedIds?: Set<string>;
  canonicalListening?: boolean;
}) {
  const t = useTranslations("mock.resultTable");
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const [unitKey, setUnitKey] = React.useState("");
  const [questionType, setQuestionType] = React.useState("");
  const units = React.useMemo(() => examContentUnits(groups, skill, canonicalListening), [groups, skill, canonicalListening]);
  const allQuestions = units.flatMap((unit) => unit.groups.flatMap((group) => group.questions));
  const groupOf = new Map(groups.flatMap((group) => group.questions.map((q) => [q.id, group] as const)));
  const selectedUnits = units.filter((unit) => !unitKey || unit.key === unitKey);
  const questions = selectedUnits.flatMap((unit) => unit.groups.flatMap((group) => group.questions))
    .filter((q) => !questionType || q.type === questionType);
  const [open, setOpen] = React.useState<string | null>(null);
  const tableId = React.useId();
  const filterKeys: ReviewFilter[] = ["all", "correct", "wrong", "unanswered", "pending",
    ...(flaggedIds?.size ? (["flagged"] as const) : [])];
  const count = (key: ReviewFilter) => filterReviewRows(questions, key, flaggedIds)
    .reduce((total, question) => total + positions(question), 0);
  const rows = filterReviewRows(questions, filter, flaggedIds);
  const correct = count("correct");

  const renderTableRows = (qs: MockAttemptQuestion[]) => {
    return qs.map((q) => {
      const answered = answeredOf(q);
      const state = reviewState(q);
      const group = groupOf.get(q.id);
      const canExplain = Boolean(group && (q.correctAnswers != null || q.reviewExplanation || group.reviewText || group.reviewAudioUrl || group.audioScript));
      const isOpen = open === q.id;
      const number = q.displayNumber ?? q.number;

      const isFlagged = flaggedIds?.has(q.id);

      return (
        <React.Fragment key={q.id}>
          <tr
            id={`review-${q.id}`}
            data-review-state={state}
            className={cn(
              "border-b border-border/60 last:border-0 align-top transition-colors",
              canExplain && "cursor-pointer hover:bg-surface-hover",
            )}
            onClick={canExplain ? () => setOpen(isOpen ? null : q.id) : undefined}
          >
            <td className="px-3 py-2 font-semibold tabular-nums text-fg">
              <div className="flex items-center gap-1">
                <span>{q.displayNumberEnd ? `${number}–${q.displayNumberEnd}` : number}</span>
                {isFlagged && (
                  <Flag className="size-3 text-warning fill-warning" aria-label="Flagged" />
                )}
              </div>
            </td>
            <td className="hidden max-w-[28rem] px-3 py-2 text-fg-muted sm:table-cell">
              <span className="line-clamp-2" title={q.prompt}>
                {q.prompt}
              </span>
              <span className="text-xs">{q.type.replaceAll("_", " ")}</span>
            </td>
            <td
              className={cn(
                "px-3 py-2 font-medium break-words",
                state === "correct" ? "text-brand" : state === "wrong" ? "text-danger" : "text-fg",
              )}
            >
              {answered ? (
                q.response
              ) : (
                <span className="font-normal italic text-fg-muted">{t("noAnswer")}</span>
              )}
              {(q as { revealed?: boolean }).revealed && (
                <span className="ml-1.5 inline-block rounded-full border border-warning-border bg-warning-bg px-1.5 text-[11px] font-medium text-warning">
                  {t("revealed")}
                </span>
              )}
            </td>
            <td className="px-3 py-2 break-words text-brand font-medium">
              {q.correctAnswers && q.correctAnswers.length > 0 ? (
                q.correctAnswers.join(" / ")
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </td>
            <td className="px-3 py-2">
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-xs font-bold",
                  state === "correct"
                    ? "bg-brand/10 text-brand"
                    : state === "wrong"
                    ? "bg-danger-bg text-danger"
                    : "bg-bg-subtle text-fg-muted",
                )}
                role="img"
                aria-label={t(`state_${state}`)}
              >
                {state === "correct" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : state === "wrong" ? (
                  <X className="size-3.5" aria-hidden />
                ) : (
                  <Minus className="size-3.5" aria-hidden />
                )}
              </span>
            </td>
            <td className="px-2 py-2">
              {q.score != null && <span className="block text-xs tabular-nums">{q.score}/{q.points}</span>}
              {canExplain && (
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                  aria-expanded={isOpen}
                  aria-controls={`review-explain-${q.id}`}
                  aria-label={t("whereFor", { number: q.displayNumber ?? q.number })}
                  title={t("where")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(isOpen ? null : q.id);
                  }}
                >
                  <ChevronDown
                    className={cn("size-4 transition-transform", isOpen && "rotate-180")}
                    aria-hidden
                  />
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
    });
  };

  return (
    <section aria-label={title} className="rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold text-fg">
          {title}{" "}
          <span className="font-normal tabular-nums text-fg-muted">
            · {t("correctOf", { correct, total: count("all") })}
          </span>
        </h2>
        <div role="group" aria-label={t("filterLabel")} className="flex flex-wrap gap-1 rounded-lg bg-bg-subtle p-0.5">
          {filterKeys.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              aria-controls={tableId}
              onClick={() => setFilter(key)}
              className={cn(
                "min-h-[36px] rounded-md px-2.5 text-xs font-semibold tabular-nums transition-colors touch-manipulation",
                filter === key
                  ? "bg-surface text-fg shadow-xs"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {t(`filter_${key}`, { count: count(key) })}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-3 py-2">
        <select aria-label={t("unitFilter")} value={unitKey} onChange={(event) => setUnitKey(event.target.value)} className="min-h-10 max-w-full rounded-field border border-border bg-surface px-2 text-sm text-fg">
          <option value="">{t("allUnits")}</option>
          {units.map((unit) => <option key={unit.key} value={unit.key}>{unit.source.title || t(skill === "reading" ? "passage" : "part", { number: unit.number })}</option>)}
        </select>
        <select aria-label={t("typeFilter")} value={questionType} onChange={(event) => setQuestionType(event.target.value)} className="min-h-10 max-w-full rounded-field border border-border bg-surface px-2 text-sm text-fg">
          <option value="">{t("allTypes")}</option>
          {[...new Set(allQuestions.map((question) => question.type))].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
        </select>
      </div>
      <div id={tableId}>
        {rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-fg-muted" role="status">{t(`empty_${filter}`)}</p>}
        {selectedUnits.map((unit) => {
          const unitRows = rows.filter((q) => unit.groups.some((g) => g.id === groupOf.get(q.id)?.id));
          if (!unitRows.length) return null;
          return (
            <div key={unit.key} className="border-t border-border p-2 sm:p-3">
              <h3 className="p-1 text-sm font-semibold">{unit.source.title || t(skill === "reading" ? "passage" : "part", { number: unit.number })}</h3>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-left text-xs sm:text-sm">
                  <thead className="text-xs text-fg-muted">
                    <tr className="border-b border-border">
                      <th scope="col" className="w-12 px-2 py-2">#</th>
                      <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("question")}</th>
                      <th scope="col" className="px-3 py-2">{t("yourAnswer")}</th>
                      <th scope="col" className="px-3 py-2">{t("key")}</th>
                      <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">{t("mark")}</span></th>
                      <th scope="col" className="w-12 px-2 py-2"><span className="sr-only">{t("where")}</span></th>
                    </tr>
                  </thead>
                  <tbody>{renderTableRows(unitRows)}</tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
