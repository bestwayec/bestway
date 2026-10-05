"use client";

import { Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PreviewQuestion } from "./StudentPreview";
import { ObjectiveQuestionInput } from "@/components/mock/objective-question-input";

const ESSAY: ReadonlySet<string> = new Set(["essay_task1", "essay_task2"]);

/** Local-only answered check used by preview navigation (never persisted). */
export function isPreviewAnswered(q: PreviewQuestion, value: string): boolean {
  if (q.type === "speaking_task") return false;
  return value.trim().length > 0;
}

function QuestionHeader({ number, prompt }: { number: number; prompt: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums"
      >
        {number}
      </span>
      <p className="whitespace-pre-line pt-px text-sm leading-relaxed text-fg">{prompt}</p>
    </div>
  );
}

export function PreviewQuestionInput({
  question: q,
  value,
  onChange,
  unavailableOptions,
}: {
  question: PreviewQuestion;
  value: string;
  onChange: (v: string) => void;
  unavailableOptions?: string[];
}) {
  const t = useTranslations("mock");

  if (q.type === "speaking_task") {
    return (
      <div className="space-y-2">
        <QuestionHeader number={q.number} prompt={q.prompt} />
        <div className="ml-[34px] flex flex-wrap items-center gap-3 rounded-[6px] border border-border bg-bg-subtle p-3">
          <Button size="sm" variant="outline" disabled aria-disabled="true">
            <Mic aria-hidden />
            {t("record")}
          </Button>
          <span className="text-xs text-fg-subtle">
            Recording is disabled in preview — students record here.
          </span>
        </div>
      </div>
    );
  }

  if (ESSAY.has(q.type)) {
    const words = value.trim() ? value.trim().split(/\s+/).length : 0;
    const minWords =
      q.type === "essay_task1" ? 150 : q.type === "essay_task2" ? 250 : (q.wordLimit ?? 0);
    const underMin = minWords > 0 && words > 0 && words < minWords;
    return (
      <div className="space-y-2">
        <QuestionHeader number={q.number} prompt={q.prompt} />
        <div className="pl-[34px]">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-32 sm:min-h-48"
            placeholder="..."
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            aria-label={`Answer for question ${q.number}`}
          />
          <p
            className={cn(
              "mt-1 text-right text-xs tabular-nums",
              underMin ? "text-warning" : "text-fg-subtle",
            )}
          >
            {words} {t("words")}
            {minWords > 0 ? ` · min ${minWords}` : ""}
            {underMin ? ` — minimum ${minWords} words required` : ""}
          </p>
        </div>
      </div>
    );
  }

  return <ObjectiveQuestionInput question={q} value={value} onChange={onChange} unavailableOptions={unavailableOptions} />;
}
