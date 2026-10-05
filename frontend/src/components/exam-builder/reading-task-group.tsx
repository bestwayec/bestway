"use client";

import { QTYPE_LABEL } from "@/components/mock/exam-builder/types";
import { GappedContent } from "@/components/mock/gapped-content";
import { Input } from "@/components/ui/input";
import { answerRuleHint } from "@/lib/objective-question";
import { unavailablePreviewOptions, type PreviewTaskBlock } from "./reading-preview-model";
import { PreviewQuestionInput } from "./preview-question-renderer";

/**
 * One visual question task group inside the active passage:
 * "Questions X–Y" + exact task instruction + every question in range.
 * Completion documents render here with their gaps in place — interactive
 * gap inputs live only in this panel, never in the passage panel.
 * Separated by spacing and headings, never by cards.
 */
export function ReadingTaskGroup({
  block,
  answers,
  onAnswer,
}: {
  block: PreviewTaskBlock;
  answers: Record<string, string>;
  onAnswer: (questionId: string, value: string) => void;
}) {
  const typeLabel = (QTYPE_LABEL as Record<string, string>)[block.type];
  return (
    <section aria-label={`${block.heading}${typeLabel ? ` — ${typeLabel}` : ""}`}>
      <h3 className="text-sm font-bold uppercase tracking-wide text-fg">
        {block.heading}
        {typeLabel && <span className="font-normal normal-case text-fg-muted"> · {typeLabel}</span>}
      </h3>
      {block.instructions?.trim() && (
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-fg-muted">
          {block.instructions}
        </p>
      )}
      {block.docs.map((doc) => (
        <div key={doc.groupId} className="mt-3">
          <GappedContent
            contentHtml={doc.contentHtml}
            questions={doc.questions}
            renderGap={({ number, question }) =>
              question ? (
                <span
                  id={`preview-gap-${question.id}`}
                  className="mx-1 inline-flex max-w-full scroll-mt-20 items-center gap-1 align-middle"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums"
                  >
                    {number}
                  </span>
                  <Input
                    value={answers[question.id] ?? ""}
                    onChange={(event) => onAnswer(question.id, event.target.value)}
                    aria-label={`Answer for question ${number}`}
                    title={answerRuleHint(question) ?? undefined}
                    className="inline-flex h-8 min-w-24 w-32 text-sm sm:w-40"
                  />
                </span>
              ) : (
                <span className="mx-1 rounded bg-danger-bg px-2 py-1 text-xs text-danger">
                  Q{number}
                </span>
              )
            }
          />
        </div>
      ))}
      {block.questions.length > 0 && (
        <div className="mt-3 space-y-4">
          {block.questions.map((q) => (
            <div
              key={q.id}
              id={`preview-q-${q.id}`}
              data-question-number={q.number}
              className="scroll-mt-20"
            >
              <PreviewQuestionInput
                question={q}
                value={answers[q.id] ?? ""}
                onChange={(v) => onAnswer(q.id, v)}
                unavailableOptions={unavailablePreviewOptions(block, answers, q.id)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
