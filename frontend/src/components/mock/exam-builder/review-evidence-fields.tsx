"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input, Textarea } from "@/components/ui/input";
import { formatClock, locateEvidence, parseClock } from "@/lib/review-evidence";
import type { BuilderQuestion } from "./types";

/**
 * Review material for one question (shown to students only after their result is
 * released): the words of the passage / audioscript that hold the answer, and for
 * Listening the moment it is heard. The server checks the same rules on save.
 */
export function ReviewEvidenceFields({ question, skill, source, audioDurationSec, onChange }: {
  question: BuilderQuestion;
  skill: "listening" | "reading";
  /** Reading: the passage; Listening: the audioscript. */
  source: string;
  audioDurationSec?: number | null;
  onChange: (next: BuilderQuestion) => void;
}) {
  const t = useTranslations("reviewEvidence");
  const id = `qe-${question.clientId}`;
  const evidence = question.evidenceText ?? "";
  const found = evidence.trim() ? locateEvidence(evidence, source) : null;
  const [clock, setClock] = React.useState(formatClock(question.audioStartSec));
  React.useEffect(() => { setClock(formatClock(question.audioStartSec)); }, [question.audioStartSec]);
  const seconds = parseClock(clock);
  const clockError = seconds !== null && (Number.isNaN(seconds) || (audioDurationSec ? seconds > audioDurationSec : false));

  return (
    <fieldset className="space-y-2 rounded-field border border-dashed border-border p-3" data-testid="review-evidence-fields">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{t("legend")}</legend>
      <p className="text-xs text-fg-muted">{t(skill === "listening" ? "hintListening" : "hintReading")}</p>
      <label htmlFor={`${id}-evidence`} className="block text-sm font-medium text-fg">{t("evidenceLabel")}</label>
      <Textarea
        id={`${id}-evidence`}
        value={evidence}
        maxLength={600}
        className="min-h-16 text-sm"
        placeholder={t(skill === "listening" ? "evidencePlaceholderListening" : "evidencePlaceholderReading")}
        onChange={(event) => onChange({ ...question, evidenceText: event.target.value })}
        aria-describedby={`${id}-evidence-state`}
      />
      <p id={`${id}-evidence-state`} className="flex items-center gap-1.5 text-xs" role="status">
        {!evidence.trim() ? (
          <span className="flex items-center gap-1.5 text-fg-muted"><Info className="size-3.5" aria-hidden />{t("evidenceEmpty")}</span>
        ) : !source.trim() ? (
          <span className="flex items-center gap-1.5 text-warning"><AlertTriangle className="size-3.5" aria-hidden />{t(skill === "listening" ? "noScript" : "noPassage")}</span>
        ) : found ? (
          <span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="size-3.5" aria-hidden />{t("evidenceFound")}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-danger"><AlertTriangle className="size-3.5" aria-hidden />{t("evidenceMissing")}</span>
        )}
      </p>
      {skill === "listening" && (
        <div className="space-y-1">
          <label htmlFor={`${id}-heard`} className="block text-sm font-medium text-fg">{t("heardAtLabel")}</label>
          <Input
            id={`${id}-heard`}
            value={clock}
            inputMode="numeric"
            className="w-28"
            placeholder="m:ss"
            aria-invalid={clockError || undefined}
            aria-describedby={`${id}-heard-hint`}
            onChange={(event) => {
              const next = event.target.value;
              setClock(next);
              const value = parseClock(next);
              if (value === null) onChange({ ...question, audioStartSec: null });
              else if (!Number.isNaN(value)) onChange({ ...question, audioStartSec: value });
            }}
          />
          <p id={`${id}-heard-hint`} className={clockError ? "text-xs text-danger" : "text-xs text-fg-muted"}>
            {clockError ? t("heardAtInvalid", { length: formatClock(audioDurationSec ?? 0) }) : t("heardAtHint")}
          </p>
        </div>
      )}
    </fieldset>
  );
}
