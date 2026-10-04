"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MockSkill, ObjectiveAnswerRule } from "@/lib/types";
import { usedMatchingOptions } from "@/lib/objective-question";
import { tx } from "./types";
import { GappedContent, hasGappedDocument } from "@/components/mock/gapped-content";
import { PreviewQuestionInput } from "./preview-question-renderer";

export interface PreviewQuestion {
  id: string;
  number: number;
  type: string;
  prompt: string;
  options: string[] | null;
  points: number;
  wordLimit: number | null;
  answerRule?: ObjectiveAnswerRule | null;
}

export interface PreviewGroup {
  id: string;
  title: string | null;
  instructions: string | null;
  passageText: string | null;
  contentHtml?: string | null;
  contentLayout?: string | null;
  optionsReusable?: boolean | null;
  hasAudio: boolean;
  imageUrl: string | null;
  questions: PreviewQuestion[];
}

/**
 * Presentation mode for the student preview.
 * - `inline` keeps the current card layout used inside the builder editors.
 * - `fullscreen` renders the same content without the nested card, for use
 *   inside the full-screen preview workspace.
 */
export type StudentPreviewVariant = "inline" | "fullscreen";

/**
 * Read-only student view of one block — the shape students answer.
 * Interactive like a student (answers stay local, nothing is saved), with no
 * answer keys, no points editing, no ids, no validation output.
 */
export function StudentPreview({
  group,
  skill,
  audioSrc,
  imageSrc,
  variant = "inline",
}: {
  group: PreviewGroup;
  skill: MockSkill;
  audioSrc?: string | null;
  imageSrc?: string | null;
  variant?: StudentPreviewVariant;
}) {
  const t = useTranslations("examBuilder");
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
        {tx(t, "studentView", "Student view")}
      </p>
      {/* Fresh answer sheet per block (key); never persisted, never submitted. */}
      <PreviewBody
        key={group.id}
        group={group}
        skill={skill}
        audioSrc={audioSrc}
        imageSrc={imageSrc}
        variant={variant}
      />
      <div className="mt-2">
        <Badge variant="info">{tx(t, "previewNote", "Preview only — students see this after you publish.")}</Badge>
      </div>
    </div>
  );
}

function PreviewBody({
  group,
  skill,
  audioSrc,
  imageSrc,
  variant = "inline",
}: {
  group: PreviewGroup;
  skill: MockSkill;
  audioSrc?: string | null;
  imageSrc?: string | null;
  variant?: StudentPreviewVariant;
}) {
  const t = useTranslations("examBuilder");
  const [answers, setAnswers] = React.useState<Record<string, string>>({});

  function setAnswer(qid: string, val: string) {
    setAnswers((a) => ({ ...a, [qid]: val }));
  }

  const hasPassage = !!(group.passageText && group.passageText.trim());
  const hasGappedContent = hasGappedDocument(group.contentHtml);
  const resolvedAudioSrc = audioSrc ?? `/api/backend/mock/groups/${group.id}/audio`;
  const resolvedImageSrc =
    imageSrc ?? (group.imageUrl ? `/api/backend/mock/groups/${group.id}/image` : null);

  const content = (
    <>
        {group.title?.trim() && <h3 className="font-semibold text-fg">{group.title}</h3>}
        {skill === "listening" && !group.hasAudio && (
          <p className="mt-3 rounded-[8px] border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-fg-muted">
            {tx(t, "noAudioPreview", "No audio uploaded — students see no player here.")}
          </p>
        )}
        {group.hasAudio && (
          <audio controls src={resolvedAudioSrc} className="mt-3 w-full" preload="none">
            <track kind="captions" />
          </audio>
        )}
        {resolvedImageSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated /api/backend mock image route; next/image optimizer bypass is intentional
          <img
            src={resolvedImageSrc}
            alt=""
            loading="lazy"
            decoding="async"
            className="mt-3 max-h-96 w-full rounded-[8px] border border-border object-contain"
          />
        )}
        {group.instructions?.trim() && (
          <p className="mt-3 text-sm font-medium text-fg-muted">{group.instructions}</p>
        )}

        <div className={cn("mt-3 min-w-0", hasPassage && !hasGappedContent && "lg:grid lg:grid-cols-2 lg:gap-6")}>
          {hasPassage && !hasGappedContent && (
            <div className="mb-4 max-h-[40vh] min-w-0 overflow-y-auto whitespace-pre-line break-words rounded-[8px] border border-border bg-bg-subtle p-3 text-sm leading-relaxed text-fg sm:p-4 lg:mb-0 lg:max-h-[70vh]">
              {group.passageText}
            </div>
          )}
          {hasGappedContent ? (
            <div className="overflow-x-auto rounded-[8px] border border-border bg-surface p-3 sm:p-4">
              <GappedContent
                contentHtml={group.contentHtml!}
                questions={group.questions}
                renderGap={({ number, question }) =>
                  question ? (
                    <span className="mx-1 inline-flex max-w-full items-center gap-1 align-middle">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums">
                        {number}
                      </span>
                      <Input
                        value={answers[question.id] ?? ""}
                        onChange={(event) => setAnswer(question.id, event.target.value)}
                        aria-label={`Answer for question ${number}`}
                        className="inline-flex h-8 min-w-24 w-32 sm:w-40"
                      />
                    </span>
                  ) : (
                    <span className="mx-1 rounded bg-danger-bg px-2 py-1 text-xs text-danger">Q{number}</span>
                  )
                }
              />
            </div>
          ) : (
          <div className="space-y-5">
            {group.questions.map((q) => (
              <div
                key={q.id}
                id={`preview-q-${q.id}`}
                data-question-number={q.number}
                className="scroll-mt-4"
              >
                <PreviewQuestionInput
                  question={q}
                  value={answers[q.id] ?? ""}
                  onChange={(v) => setAnswer(q.id, v)}
                  unavailableOptions={group.optionsReusable === false ? usedMatchingOptions(group.questions, answers, q.id) : []}
                />
              </div>
            ))}
            {group.questions.length === 0 && (
              <p className="text-sm text-fg-muted">
                {tx(t, "noQuestionsPreview", "No questions yet.")}
              </p>
            )}
          </div>
          )}
      </div>
    </>
  );

  if (variant === "fullscreen") {
    return <div className="min-w-0">{content}</div>;
  }

  return (
    <Card className="mt-1.5 min-w-0 overflow-hidden p-3 sm:p-5">
      {content}
    </Card>
  );
}


