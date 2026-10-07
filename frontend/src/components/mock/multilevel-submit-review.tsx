"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Clock3, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { multilevelSkillLabel, type MultilevelMissingWork, type MultilevelSectionWork } from "@/lib/multilevel-completeness";
import type { MockSkill } from "@/lib/types";

const SKILL_ICON: Record<MockSkill, string> = { listening: "🎧", reading: "📖", writing: "✍️", speaking: "🎙️" };

function statusText(section: MultilevelSectionWork): string {
  if (section.expired) return "Time ended — not counted";
  if (!section.required) return "Not reached yet";
  if (!section.missing) return `Complete · ${section.answered} / ${section.total}`;
  if (section.spoken) return `${section.missing} of ${section.total} not recorded`;
  return `${section.missing} of ${section.total} unanswered`;
}

/**
 * Pre-submit completeness surface (STEP 19). It lists every section of the exam
 * with what is still missing, lets the student jump back, and only offers the
 * final submit when nothing required is outstanding. The server re-checks the
 * same rule and refuses with `MOCK_ATTEMPT_INCOMPLETE`.
 *
 * In `advance` mode the same surface warns before a one-way "Next section"
 * move: the student may continue anyway, but sees what the section still owes.
 */
export function MultilevelSubmitReview({
  work,
  onJump,
  onClose,
  onConfirm,
  busy,
  advance = false,
}: {
  work: MultilevelMissingWork;
  onJump?: (skill: MockSkill) => void;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  advance?: boolean;
}) {
  const blocked = !advance && !work.complete;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto bg-black/50 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={advance ? "Before you move on" : "Before you submit"}>
      {/* Short viewports (mobile landscape) scroll inside the panel so its
          heading and both actions stay reachable. */}
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-[12px] border border-border bg-surface p-4 shadow-xl sm:p-5">
        <h2 className="text-lg font-semibold text-fg">{advance ? "Before you move on" : "Before you submit"}</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {work.complete
            ? "Every required section is complete."
            : `${work.missing} of ${work.total} required ${work.missing === 1 ? "answer is" : "answers are"} still missing.`}
        </p>

        <ul className="mt-3 space-y-2" aria-label="Section completeness">
          {work.sections.map((section) => {
            const done = section.required && !section.missing;
            const canJump = !!onJump && !section.expired && (section.missing > 0 || !section.required);
            return (
              <li key={section.skill} className={cn("flex flex-wrap items-center gap-2 rounded-[8px] border px-3 py-2 text-sm", section.required && section.missing > 0 ? "border-warning-border bg-warning-bg" : "border-border bg-bg-subtle")}>
                {done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : section.expired ? (
                  <Clock3 className="size-4 shrink-0 text-fg-subtle" />
                ) : section.required ? (
                  <AlertTriangle className="size-4 shrink-0 text-warning" />
                ) : (
                  <LockKeyhole className="size-3.5 shrink-0 text-fg-subtle" />
                )}
                <span className="font-medium text-fg">
                  {SKILL_ICON[section.skill]} {multilevelSkillLabel(section.skill)}
                </span>
                <span className="text-fg-muted">{statusText(section)}</span>
                {canJump && (
                  <button type="button" className="ml-auto font-semibold text-brand underline-offset-2 hover:underline" onClick={() => onJump?.(section.skill)}>
                    Go to section
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-xs text-fg-muted">
          {advance
            ? "A finished section is closed behind you and its answers can no longer be changed."
            : work.timed
              ? "An unfinished exam is refused while the timer runs; when the timer ends it submits by itself."
              : "An unfinished exam cannot be submitted — finish every section first."}
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {advance ? "Stay in this section" : "Keep working"}
          </Button>
          <Button type="button" size="sm" loading={busy} disabled={blocked} onClick={onConfirm}>
            {advance ? "Move on anyway" : "Submit exam"}
          </Button>
        </div>
      </div>
    </div>
  );
}
