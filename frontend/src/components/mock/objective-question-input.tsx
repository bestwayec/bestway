"use client";

import { Input } from "@/components/ui/input";
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
  const multiple = q.type === "multi_select";
  const options = objectiveOptions(q);
  const selected = multiple ? selectedObjectiveOptions(value, options) : [value];
  const hint = answerRuleHint(q);
  return (
    <div className="space-y-2">
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
                  <label key={option} className={cn("flex min-h-10 items-center gap-3 rounded-[6px] border px-3 py-1.5 text-sm leading-snug", checked ? "border-brand bg-brand-subtle font-medium text-brand-subtle-fg" : "border-border text-fg", unavailable || disabled ? "opacity-50" : "cursor-pointer hover:border-border-strong")}>
                    <input type={multiple ? "checkbox" : "radio"} name={`objective-answer-${q.id}`} value={option} checked={checked} disabled={disabled || unavailable}
                      onChange={() => onChange(multiple ? toggleObjectiveOption(value, option, options) : option)} className="size-4 shrink-0 accent-brand" />
                    <span className="min-w-0 flex-1 break-words">{option}</span>
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
      </div>
    </div>
  );
}
