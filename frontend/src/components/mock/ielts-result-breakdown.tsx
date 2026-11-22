"use client";

import * as React from "react";
import { CheckCircle2, Clock, HelpCircle, Layers, Target, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MockAttemptDetail, MockAttemptSection, MockSkill } from "@/lib/types";

function calculateTimeUsedMinutes(attempt: MockAttemptDetail): number | null {
  const start = attempt.startedAt ? Date.parse(attempt.startedAt) : null;
  const finish = attempt.finishedAt || attempt.submittedAt;
  const end = finish ? Date.parse(finish) : null;
  if (!start || !end || isNaN(start) || isNaN(end) || end <= start) return null;
  return Math.max(1, Math.round((end - start) / 60000));
}

export function IeltsResultBreakdown({ attempt }: { attempt: MockAttemptDetail }) {
  const t = useTranslations("mock");
  const timeUsedMinutes = React.useMemo(() => calculateTimeUsedMinutes(attempt), [attempt]);

  // Find objective sections (Reading and Listening)
  const objectiveSections = React.useMemo(() => {
    return attempt.sections.filter(
      (s) => s.skill === "reading" || s.skill === "listening"
    );
  }, [attempt.sections]);

  if (objectiveSections.length === 0) return null;

  const isGeneral = attempt.examType === "ielts_general";
  const examTrackLabel = isGeneral ? "IELTS General Training" : "IELTS Academic";

  return (
    <div className="mt-6 space-y-6" data-testid="ielts-result-breakdown">
      {objectiveSections.map((section) => {
        const questions = section.groups.flatMap((g) => g.questions);
        const total = questions.length;
        if (total === 0) return null;

        const correct = questions.filter((q) => q.isCorrect === true).length;
        const answered = questions.filter(
          (q) => (q.response ?? "").trim().length > 0 || q.hasAudio
        ).length;
        const incorrect = questions.filter(
          (q) => ((q.response ?? "").trim().length > 0 || q.hasAudio) && q.isCorrect === false
        ).length;
        const unanswered = questions.filter(
          (q) => !((q.response ?? "").trim().length > 0 || q.hasAudio)
        ).length;

        const isReading = section.skill === "reading";
        const isListening = section.skill === "listening";
        const unitName = isReading ? "Passage" : "Section";
        const skillTitle = isReading ? "IELTS Reading" : "IELTS Listening";

        const isPractice = attempt.mode === "practice";
        const band = isPractice ? null : section.band;
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

        return (
          <Card key={section.id} className="p-5 sm:p-6 border-border bg-surface">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <span className="text-xs font-semibold text-brand tracking-wider uppercase">
                  {isPractice ? "IELTS Practice" : examTrackLabel}
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-fg">
                  {skillTitle} Natijasi
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {!isPractice && band != null && (
                  <Badge variant="brand" className="text-sm px-3 py-1 font-bold">
                    {section.bandBelowRange ? "below 4.0" : `Band ${band.toFixed(1)}`}
                  </Badge>
                )}
                {timeUsedMinutes != null && (
                  <div className="flex items-center gap-1.5 text-xs text-fg-muted font-medium bg-bg-subtle px-2.5 py-1 rounded-md border border-border">
                    <Clock className="size-3.5 text-fg-muted" />
                    <span>{timeUsedMinutes} daqiqa sarflandi</span>
                  </div>
                )}
              </div>
            </div>

            {/* Top Stat Cards */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border bg-bg-subtle/50 p-3 text-center">
                <span className="text-xs text-fg-muted font-medium flex items-center justify-center gap-1">
                  <CheckCircle2 className="size-3.5 text-brand" /> To&apos;g&apos;ri
                </span>
                <p className="mt-1 text-2xl font-black text-brand tabular-nums">
                  {correct} <span className="text-xs font-normal text-fg-muted">/ {total}</span>
                </p>
                <span className="text-[11px] text-fg-subtle">{accuracy}% aniqlik</span>
              </div>

              <div className="rounded-lg border border-border bg-bg-subtle/50 p-3 text-center">
                <span className="text-xs text-fg-muted font-medium flex items-center justify-center gap-1">
                  <XCircle className="size-3.5 text-danger" /> Noto&apos;g&apos;ri
                </span>
                <p className="mt-1 text-2xl font-black text-danger tabular-nums">
                  {incorrect}
                </p>
                <span className="text-[11px] text-fg-subtle">
                  {total > 0 ? Math.round((incorrect / total) * 100) : 0}% xato
                </span>
              </div>

              <div className="rounded-lg border border-border bg-bg-subtle/50 p-3 text-center">
                <span className="text-xs text-fg-muted font-medium flex items-center justify-center gap-1">
                  <HelpCircle className="size-3.5 text-fg-muted" /> Javobsiz
                </span>
                <p className="mt-1 text-2xl font-black text-fg-muted tabular-nums">
                  {unanswered}
                </p>
                <span className="text-[11px] text-fg-subtle">
                  {total > 0 ? Math.round((unanswered / total) * 100) : 0}% qoldirilgan
                </span>
              </div>

              <div className="rounded-lg border border-border bg-bg-subtle/50 p-3 text-center">
                <span className="text-xs text-fg-muted font-medium flex items-center justify-center gap-1">
                  <Target className="size-3.5 text-info" /> {isPractice ? "Aniqlik" : "IELTS Band"}
                </span>
                <p className="mt-1 text-2xl font-black text-fg tabular-nums">
                  {isPractice
                    ? `${accuracy}%`
                    : band != null
                    ? section.bandBelowRange
                      ? "< 4.0"
                      : band.toFixed(1)
                    : "—"}
                </p>
                <span className="text-[11px] text-fg-subtle">
                  {isPractice
                    ? "Amaliyot (Raw Score)"
                    : isReading
                    ? isGeneral
                      ? "GT shkalasi"
                      : "Academic shkalasi"
                    : "Rasmiy jadval"}
                </span>
              </div>
            </div>

            {/* Section / Passage breakdown */}
            <div className="mt-5 space-y-3">
              <h4 className="text-xs font-bold text-fg-muted uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="size-3.5 text-brand" />
                {isReading ? "Matnlar bo'yicha tahlil (Passages)" : "Qismlar bo'yicha tahlil (Sections)"}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {section.groups.map((group, idx) => {
                  const gQuestions = group.questions;
                  const gTotal = gQuestions.length;
                  const gCorrect = gQuestions.filter((q) => q.isCorrect === true).length;
                  const gTitle = group.title || `${unitName} ${idx + 1}`;
                  const gPct = gTotal > 0 ? Math.round((gCorrect / gTotal) * 100) : 0;

                  return (
                    <div
                      key={group.id}
                      className="rounded-lg border border-border bg-surface p-3 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-fg truncate" title={gTitle}>
                          {gTitle}
                        </span>
                        <span className="font-extrabold text-brand tabular-nums">
                          {gCorrect} / {gTotal}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                        <div
                          className="h-full rounded-full bg-brand transition-all duration-500"
                          style={{ width: `${gPct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-fg-muted">
                        <span>Aniqlik: {gPct}%</span>
                        <span>{gTotal - gCorrect} ta xato</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Official Scoring Policy Explanation */}
            {!isPractice && (
              <div className="mt-4 rounded-lg border border-border/80 bg-bg-subtle/30 p-3 text-xs text-fg-muted leading-relaxed">
                <p>
                  <strong className="text-fg font-semibold">Ball hisoblash qoidasi: </strong>
                  {isReading ? (
                    isGeneral ? (
                      "IELTS General Training Reading imtihonida 40 ta savoldan kamida 30 tasi Band 6.0, 34 tasi Band 7.0 va 37 tasi Band 8.0 ball beradi."
                    ) : (
                      "IELTS Academic Reading imtihonida 40 ta savoldan kamida 23 tasi Band 6.0, 30 tasi Band 7.0 va 35 tasi Band 8.0 ball beradi."
                    )
                  ) : (
                    "IELTS Listening imtihonida 40 ta savoldan kamida 23 tasi Band 6.0, 30 tasi Band 7.0 va 35 tasi Band 8.0 ball beradi."
                  )}
                </p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
