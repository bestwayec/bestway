"use client";

import type * as React from "react";

import { Input } from "@/components/ui/input";
import { Check, CheckCircle2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { answerRuleHint, isObjectiveChoice, MATCHING_TYPES, objectiveNumberLabel, objectiveOptions, selectedObjectiveOptions, toggleObjectiveOption, type ObjectiveQuestion } from "@/lib/objective-question";

/** Shared objective controls for active attempts and author student previews. */
export function ObjectiveQuestionInput({ question: q, value, onChange, unavailableOptions = [], disabled = false, renderPrompt, headerAction, sharedBank = false }: {
  question: ObjectiveQuestion;
  value: string;
  onChange: (value: string) => void;
  unavailableOptions?: string[];
  disabled?: boolean;
  /** Lets the exam window make the question text highlightable (Listening). */
  renderPrompt?: (text: string) => React.ReactNode;
  /** Beside the question number, at the end of the first row (the exam window's Flag). */
  headerAction?: React.ReactNode;
  sharedBank?: boolean;
}) {
  const t = useTranslations("mock.runnerUx");
  const numberLabel = objectiveNumberLabel(q);
  const multiple = q.type === "multi_select";
  const options = objectiveOptions(q);
  const selected = multiple || sharedBank ? selectedObjectiveOptions(value, options) : [value];
  const hint = answerRuleHint(q);
  const hasResponse = multiple ? selected.length > 0 : !!value.trim();
  const isShortOptions = options.length >= 4 && options.every((o) => o.trim().length <= 3);

  return (
    <div className={cn("space-y-2 rounded-card border p-3 transition-colors duration-fast sm:p-4", hasResponse ? "border-brand/35 bg-brand-subtle/30" : "border-border bg-surface")}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-field text-sm font-bold tabular-nums", hasResponse ? "bg-brand text-brand-fg" : "border border-border-strong bg-bg-subtle text-fg")}>{numberLabel}</span>
        {q.prompt && q.prompt.trim() ? (
          renderPrompt ? <div className="min-w-0 flex-1 whitespace-pre-line pt-0.5 text-base leading-relaxed text-fg">{renderPrompt(q.prompt)}</div>
            : <p className="min-w-0 flex-1 whitespace-pre-line pt-0.5 text-base leading-relaxed text-fg">{q.prompt}</p>
        ) : <span className="flex-1" />}
        {headerAction}
      </div>
      <div className={cn(q.prompt && q.prompt.trim() ? "sm:pl-10" : "pt-1")}>
        {sharedBank ? (
          <select aria-label={t("questionOptions", { number: numberLabel })}
            className="h-10 w-full max-w-md rounded-field border border-border bg-surface px-2 text-sm"
            value={selected[0] ?? ""} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
            <option value="">{t("chooseMatchingOption")}</option>
            {options.map((option) => <option key={option} value={option}
              disabled={option !== selected[0] && unavailableOptions.includes(option)}>{option}</option>)}
          </select>
        ) : isObjectiveChoice(q) ? (
          <fieldset>
            <legend className="sr-only">{t("questionNumber", { number: numberLabel })}</legend>
            {isShortOptions ? (
              <div
                className="flex flex-wrap gap-2 pt-1"
                role={multiple ? "group" : "radiogroup"}
                aria-label={t("questionOptions", { number: numberLabel })}
              >
                {options.map((option) => {
                  const checked = selected.includes(option);
                  const unavailable = MATCHING_TYPES.has(q.type) && unavailableOptions.includes(option) && !checked;
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={disabled || unavailable}
                      onClick={() =>
                        onChange(
                          multiple
                            ? toggleObjectiveOption(value, option, options)
                            : checked
                            ? ""
                            : option,
                        )
                      }
                      className={cn(
                        "flex size-10 items-center justify-center rounded-lg border text-sm font-bold transition-all touch-manipulation",
                        checked
                          ? "border-brand bg-brand text-brand-fg shadow-md scale-105"
                          : unavailable
                          ? "border-border/40 bg-bg-subtle/50 text-fg-muted/40 cursor-not-allowed opacity-50"
                          : "border-border bg-surface text-fg hover:border-brand/60 hover:bg-surface-hover"
                      )}
                      aria-pressed={checked}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1">
                {objectiveOptions(q).map((option) => {
                  const checked = selected.includes(option);
                  const unavailable = MATCHING_TYPES.has(q.type) && unavailableOptions.includes(option) && !checked;
                  return (
                    <label key={option} className={cn("flex min-h-11 items-center gap-3 rounded-field border px-3 py-2 text-sm leading-snug transition-colors focus-within:ring-2 focus-within:ring-brand/30", checked ? "border-brand bg-brand-subtle font-medium text-brand-subtle-fg" : "border-border text-fg", unavailable || disabled ? "opacity-50" : "cursor-pointer hover:border-brand/50 hover:bg-bg-subtle")}>
                      <input type={multiple ? "checkbox" : "radio"} name={`objective-answer-${q.id}`} value={option} checked={checked} disabled={disabled || unavailable}
                        onChange={() => onChange(multiple ? toggleObjectiveOption(value, option, options) : option)} className="size-4 shrink-0 accent-brand" />
                      <span className="min-w-0 flex-1 break-words">{option}</span>
                      {checked && <Check aria-hidden className="size-4 shrink-0" />}
                      {unavailable && <span className="text-xs text-fg-subtle">Already used</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
        ) : (
          <Input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label={t("answerFor", { number: numberLabel })} autoComplete="off" spellCheck={false} className="min-h-10" />
        )}
        {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
        {hasResponse && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-brand-subtle-fg"><CheckCircle2 aria-hidden className="size-3.5" />{multiple ? t("choicesSelected", { count: selected.length }) : t(isObjectiveChoice(q) ? "answerSelected" : "answerEntered")}</span>
          {!disabled && <button type="button" onClick={() => onChange("")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-fg-muted outline-offset-2 hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"><RotateCcw aria-hidden className="size-3" />{t("clearAnswer")}</button>}
        </div>}
      </div>
    </div>
  );
}

export function MatchingOptionBank({ options }: { options: string[] }) {
  const t = useTranslations("mock.runnerUx");
  if (!options.length) return null;
  return <section aria-label={t("matchingOptionBank")} className="rounded-field border border-border bg-bg-subtle p-3">
    <p className="text-sm font-semibold">{t("matchingOptionBank")}</p>
    <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
      {options.map((option) => <li key={option}>{option}</li>)}
    </ul>
  </section>;
}
