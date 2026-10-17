"use client";

import { Input } from "@/components/ui/input";
import { Check, CheckCircle2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { answerRuleHint, isObjectiveChoice, MATCHING_TYPES, objectiveOptions, selectedObjectiveOptions, toggleObjectiveOption, type ObjectiveQuestion } from "@/lib/objective-question";

/** Shared objective controls for active attempts and author student previews. */
export function ObjectiveQuestionInput({ question: q, value, onChange, unavailableOptions = [], disabled = false }: {
  question: ObjectiveQuestion;
  value: string;
  onChange: (value: string) => void;
  unavailableOptions?: string[];
  disabled?: boolean;
}) {
  const t = useTranslations("mock.runnerUx");
  const multiple = q.type === "multi_select";
  const options = objectiveOptions(q);
  const selected = multiple ? selectedObjectiveOptions(value, options) : [value];
  const hint = answerRuleHint(q);
  const hasResponse = multiple ? selected.length > 0 : !!value.trim();
  return (
    <div className={cn("space-y-2 rounded-[10px] border p-3 transition-colors", hasResponse ? "border-brand/30 bg-brand-subtle/20" : "border-border bg-surface")}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums">{q.number}</span>
        <p className="whitespace-pre-line text-sm leading-relaxed text-fg">{q.prompt}</p>
      </div>
      <div className="pl-[34px]">
        {isObjectiveChoice(q) ? (
          <fieldset>
            <legend className="sr-only">Question {q.number}</legend>
            <div className="space-y-1">
              {objectiveOptions(q).map((option) => {
                const checked = selected.includes(option);
                const unavailable = MATCHING_TYPES.has(q.type) && unavailableOptions.includes(option) && !checked;
                return (
                  <label key={option} className={cn("flex min-h-11 items-center gap-3 rounded-[8px] border px-3 py-2 text-sm leading-snug transition-colors focus-within:ring-2 focus-within:ring-brand/30", checked ? "border-brand bg-brand-subtle font-medium text-brand-subtle-fg" : "border-border text-fg", unavailable || disabled ? "opacity-50" : "cursor-pointer hover:border-brand/50 hover:bg-bg-subtle")}>
                    <input type={multiple ? "checkbox" : "radio"} name={`objective-answer-${q.id}`} value={option} checked={checked} disabled={disabled || unavailable}
                      onChange={() => onChange(multiple ? toggleObjectiveOption(value, option, options) : option)} className="size-4 shrink-0 accent-brand" />
                    <span className="min-w-0 flex-1 break-words">{option}</span>
                    {checked && <Check aria-hidden className="size-4 shrink-0" />}
                    {unavailable && <span className="text-xs text-fg-subtle">Already used</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <Input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label={`Answer for question ${q.number}`} autoComplete="off" spellCheck={false} className="min-h-10" />
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
