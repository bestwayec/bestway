"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useGroupAiRanking } from "@/hooks/use-ai-ranking";
import { rankingScoreLabel, rankingStatusKey } from "@/lib/ai-ranking-types";
import type { AiRankingSkill, GroupAiRankingCohort, GroupAiRankingRow } from "@/lib/ai-ranking-types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function GroupAiRankingTable({ rows, cohort, t }: {
  rows: GroupAiRankingRow[]; cohort?: GroupAiRankingCohort; t: Translate;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg-subtle text-fg-muted">
          <tr>{["rank", "student", "aiScore", "rawScore", "teacherScore", "finalScore", "status"].map(key => (
            <th key={key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{t(key)}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(row => (
            <tr key={row.studentId}>
              <td className="px-3 py-3 font-semibold text-fg">{row.rank ?? "—"}</td>
              <th scope="row" className="px-3 py-3 font-medium text-fg">{row.name}</th>
              <td className="whitespace-nowrap px-3 py-3 text-fg">
                {rankingScoreLabel(row.aiScore, cohort?.scaleMax)}
                {row.aiScore != null && !row.eligible && <span className="block text-xs text-fg-muted">{t("proposalOnly")}</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-fg-muted">{rankingScoreLabel(row.aiRawScore, cohort?.rawMax)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-fg-muted">{rankingScoreLabel(row.teacherScore, row.finalScoreScaleMax)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-fg">
                {rankingScoreLabel(row.finalPracticeGrade?.score ?? row.finalScore,
                  row.finalPracticeGrade?.scaleMax ?? row.finalScoreScaleMax)}
                {row.finalScoreSource && <span className="block text-xs text-fg-muted">{t(row.finalScoreSource === "TEACHER" ? "sourceTeacher" : row.finalScoreSource === "ADJUDICATED" ? "sourceAdjudicated" : "sourceAi")}</span>}
              </td>
              <td className="px-3 py-3 text-fg-muted">{t(rankingStatusKey(row))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GroupAiRanking({ groupId }: { groupId: string }) {
  const t = useTranslations("teacherAiRanking");
  const [chosenExamId, setChosenExamId] = React.useState<string>();
  const [skill, setSkill] = React.useState<AiRankingSkill>("writing");
  const options = useGroupAiRanking(groupId);
  const exams = options.data?.exams ?? [];
  const selectedExamId = exams.some(exam => exam.id === chosenExamId) ? chosenExamId : exams[0]?.id;
  const ranking = useGroupAiRanking(groupId, selectedExamId, skill);
  const data = selectedExamId ? ranking.data : undefined;
  const loading = options.isLoading || (!!selectedExamId && ranking.isLoading);
  const error = options.isError || (!!selectedExamId && ranking.isError);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorState title={t("error")} action={<button type="button" className="text-brand underline" onClick={() => { void options.refetch(); void ranking.refetch(); }}>{t("retry")}</button>} /> : loading && !data ? <Skeleton className="h-40" /> : exams.length === 0 ? <EmptyState title={t("noExams")} /> : <>
          <label className="block text-sm text-fg-muted">
            {t("exam")}
            <select value={selectedExamId ?? ""} onChange={event => setChosenExamId(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg">
              {exams.map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
            </select>
          </label>
          <div role="group" aria-label={t("skill")} className="flex gap-2">
            {(["writing", "speaking"] as const).map(value => <button key={value} type="button" aria-pressed={skill === value} onClick={() => setSkill(value)} className={`rounded-lg px-4 py-2 text-sm font-medium ${skill === value ? "bg-brand-subtle text-brand-subtle-fg" : "bg-bg-subtle text-fg-muted"}`}>{t(value)}</button>)}
          </div>
          {data?.cohorts.map((cohort, index) => (
            <section key={cohort.id} className="space-y-2" aria-label={t("cohort", { number: index + 1 })}>
              <h4 className="text-sm font-semibold text-fg">{t("cohort", { number: index + 1 })} · {t("tasks", { count: cohort.questionCount })}</h4>
              <p className="text-xs text-fg-muted">{cohort.label} · {cohort.specificationVersion ?? t("historical")} · {cohort.gradingPolicyId ? t("internalPolicy") : cohort.isPartial ? t("practiceEstimate") : t("rubricScore")}</p>
              <GroupAiRankingTable rows={cohort.rows} cohort={cohort} t={t} />
            </section>
          ))}
          {data && data.cohorts.length === 0 && data.unranked.length === 0 && <EmptyState title={t("noScores")} />}
          {!!data?.unranked.length && <section className="space-y-2"><h4 className="text-sm font-semibold text-fg">{t("unranked")}</h4><GroupAiRankingTable rows={data.unranked} t={t} /></section>}
          <p className="text-xs text-fg-muted">{t("comparisonNote")}</p>
        </>}
      </CardContent>
    </Card>
  );
}
