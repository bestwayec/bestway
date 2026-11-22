"use client";

import * as React from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { neighbourStep, STEP_ORDER, type BuilderStep, type StepId } from "./builder-steps";
import { tx } from "./types";

const LABELS: Record<StepId, [string, string]> = {
  info: ["stepInfo", "Exam information"],
  track: ["stepTrack", "Track and sections"],
  questions: ["stepQuestions", "Questions"],
  material: ["stepMaterial", "Passages, audio and files"],
  keys: ["stepKeys", "Answers and keys"],
  preview: ["stepPreview", "Preview"],
  publish: ["stepPublish", "Validate and publish"],
};

const HINTS: Record<StepId, [string, string]> = {
  info: ["stepInfoHint", "Title, type and exam settings."],
  track: ["stepTrackHint", "Pick the IELTS or Multilevel track and add the sections."],
  questions: ["stepQuestionsHint", "Write the questions of each part, passage or task."],
  material: ["stepMaterialHint", "Attach the passage text, audio and pictures the questions refer to."],
  keys: ["stepKeysHint", "Set the correct answers, accepted variants and answer locations."],
  preview: ["stepPreviewHint", "See the exam exactly as a student will."],
  publish: ["stepPublishHint", "Fix every error, then publish. Save Draft keeps the exam hidden from students."],
};

/**
 * Guided path through the builder. Each step opens the existing editor through `onGo` (which runs the
 * unsaved-changes guard), so moving backwards or forwards never drops work.
 */
export function BuilderStepper({
  steps,
  current,
  onGo,
}: {
  steps: BuilderStep[];
  current: StepId;
  onGo: (step: BuilderStep) => void;
}) {
  const t = useTranslations("examBuilder");
  const label = (id: StepId) => tx(t, LABELS[id][0], LABELS[id][1]);
  const index = STEP_ORDER.indexOf(current);
  const byId = (id: StepId) => steps.find((s) => s.id === id)!;
  const listRef = React.useRef<HTMLOListElement | null>(null);

  // Arrow keys move between steps (Home/End jump); Tab order stays natural.
  const onKeyDown = (event: React.KeyboardEvent<HTMLOListElement>) => {
    const keys: Record<string, StepId | undefined> = {
      ArrowRight: neighbourStep(current, 1),
      ArrowLeft: neighbourStep(current, -1),
      Home: STEP_ORDER[0],
      End: STEP_ORDER[STEP_ORDER.length - 1],
    };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    listRef.current?.querySelector<HTMLButtonElement>(`[data-step="${next}"]`)?.focus();
  };

  return (
    <nav aria-label={tx(t, "stepperLabel", "Exam builder steps")} className="mt-3" data-testid="builder-stepper">
      {/* Phones and narrow tablets: one line with the current step and back / next. */}
      <div className="flex items-center gap-2 xl:hidden">
        <Button type="button" size="sm" variant="outline" aria-label={tx(t, "stepBack", "Previous step")} disabled={index === 0} onClick={() => onGo(byId(neighbourStep(current, -1)))}>
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg" aria-live="polite">
          {tx(t, "stepOf", "Step {n} of {total}", { n: index + 1, total: STEP_ORDER.length })} · {label(current)}
        </p>
        <Button type="button" size="sm" variant="outline" aria-label={tx(t, "stepNext", "Next step")} disabled={index === STEP_ORDER.length - 1} onClick={() => onGo(byId(neighbourStep(current, 1)))}>
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>

      <ol ref={listRef} onKeyDown={onKeyDown} className="hidden grid-cols-7 gap-1.5 xl:grid">
        {STEP_ORDER.map((id, i) => {
          const step = byId(id);
          const active = id === current;
          return (
            <li key={id} className="min-w-0">
              <button
                type="button"
                data-step={id}
                aria-current={active ? "step" : undefined}
                onClick={() => onGo(step)}
                className={cn(
                  "flex min-h-12 w-full items-center gap-2 rounded-control border px-2 py-1.5 text-left text-sm transition-colors duration-fast",
                  active ? "border-brand bg-brand-subtle font-semibold text-brand-subtle-fg" : "border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
                    step.status === "done" && "bg-success-bg text-success",
                    step.status === "attention" && "bg-danger-bg text-danger",
                    step.status === "todo" && "bg-bg-subtle text-fg-muted",
                  )}
                >
                  {step.status === "done" ? <Check className="size-3.5" /> : step.status === "attention" ? <AlertCircle className="size-3.5" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1 text-[13px] leading-tight break-words">{label(id)}</span>
                <span className="sr-only">
                  {step.status === "done" ? tx(t, "stepDone", "complete") : step.status === "attention" ? tx(t, "stepAttention", "{count} to fix", { count: step.issues }) : tx(t, "stepTodo", "not started")}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mt-2 text-sm text-fg-muted">{tx(t, HINTS[current][0], HINTS[current][1])}</p>
    </nav>
  );
}
