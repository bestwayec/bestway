"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useGroupAiRanking } from "@/hooks/use-ai-ranking";
import { rankingScoreLabel, rankingStatusKey } from "@/lib/ai-ranking-types";
import type { AiRankingSkill, GroupAiRankingCohort, GroupAiRankingRow } from "@/lib/ai-ranking-types";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv-export";
import { finalGradeLabel, groupGradeRows, groupGradesCsv, groupLeaderboardExcelCsv, type GroupGradeSummary, type GroupSkillGrade } from "@/lib/group-grade-export";
import { useGroupDetail } from "@/hooks/use-groups";
import { FileSpreadsheet } from "lucide-react";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function RankBadge({ rank }: { rank: number | null | undefined }) {
  if (rank == null) return <span className="font-semibold text-fg-muted">—</span>;
  if (rank === 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/30">
        🥇 1-o&apos;rin
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-400/15 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-400/30">
        🥈 2-o&apos;rin
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-700/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-500 border border-amber-700/30">
        🥉 3-o&apos;rin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-subtle px-2 py-0.5 text-xs font-medium text-fg-muted border border-border">
      {rank}-o&apos;rin
    </span>
  );
}

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
              <td className="px-3 py-3 font-semibold text-fg"><RankBadge rank={row.rank} /></td>
              <th scope="row" className="px-3 py-3 font-medium text-fg">{row.name}</th>
              <td className="whitespace-nowrap px-3 py-3 text-fg">
                {rankingScoreLabel(row.aiScore, cohort?.scaleMax)}
                {row.aiScore != null && !row.eligible && <span className="block text-xs text-fg-muted">{t("proposalOnly")}</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-fg-muted">{rankingScoreLabel(row.aiRawScore, cohort?.rawMax)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-fg-muted">{rankingScoreLabel(row.teacherScore, row.finalScoreScaleMax)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-fg">
                {rankingScoreLabel(row.finalScore == null ? null : row.finalPracticeGrade?.score ?? row.finalScore,
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

export function GroupAllGradesTable({ rows, t }: { rows: GroupGradeSummary[]; t: Translate }) {
  const ai = (grade?: GroupSkillGrade) => <>
    {rankingScoreLabel(grade?.row.aiScore, grade?.cohort?.scaleMax)}
    {grade?.row.aiRawScore != null && <span className="block text-xs text-fg-muted">{t("rawScore")}: {rankingScoreLabel(grade.row.aiRawScore, grade.cohort?.rawMax)}</span>}
    {grade?.row.aiScore != null && !grade.row.eligible && <span className="block text-xs text-fg-muted">{t("proposalOnly")}</span>}
    {grade && <span className="block text-xs text-fg-muted">{t(rankingStatusKey(grade.row))}</span>}
  </>;
  const final = (grade?: GroupSkillGrade) => <>
    {finalGradeLabel(grade)}
    {grade?.row.finalScore != null && grade.row.finalScoreSource && <span className="block text-xs text-fg-muted">{t(grade.row.finalScoreSource === "TEACHER" ? "sourceTeacher" : grade.row.finalScoreSource === "ADJUDICATED" ? "sourceAdjudicated" : "sourceAi")}</span>}
    {grade && <span className="block text-xs text-fg-muted">{t(grade.row.finalScore != null ? "graded" : rankingStatusKey(grade.row))}</span>}
    {grade?.cohort && <span className="block text-xs text-fg-muted">{grade.cohort.label} · {grade.cohort.specificationVersion ?? t("historical")}</span>}
  </>;
  return <div className="overflow-x-auto rounded-xl border border-border">
    <table className="w-full text-left text-sm">
      <thead className="bg-bg-subtle text-fg-muted"><tr>
        <th scope="col" className="px-3 py-2 font-medium">{t("student")}</th>
        {(["writing", "speaking"] as const).flatMap(skill => ["aiScore", "teacherScore", "finalScore"].map(key => <th key={skill + key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{t(skill)} · {t(key)}</th>))}
      </tr></thead>
      <tbody className="divide-y divide-border">{rows.map(row => <tr key={row.studentId}>
        <th scope="row" className="px-3 py-3 font-medium text-fg">{row.name}</th>
        {(["writing", "speaking"] as const).map(skill => <React.Fragment key={skill}>
          <td className="whitespace-nowrap px-3 py-3 text-fg">{ai(row[skill])}</td>
          <td className="whitespace-nowrap px-3 py-3 text-fg-muted">{rankingScoreLabel(row[skill]?.row.teacherScore, row[skill]?.row.finalScoreScaleMax)}</td>
          <td className="px-3 py-3 text-fg">{final(row[skill])}</td>
        </React.Fragment>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function GroupAiRanking({ groupId }: { groupId: string }) {
  const t = useTranslations("teacherAiRanking");
  const [chosenExamId, setChosenExamId] = React.useState<string>();
  const [skill, setSkill] = React.useState<AiRankingSkill>("writing");
  const options = useGroupAiRanking(groupId);
  const groupQ = useGroupDetail(groupId);
  const phoneMap = new Map((groupQ.data?.students ?? []).map(s => [s.studentId, s.phone]));
  const groupName = groupQ.data?.name ?? options.data?.group?.name ?? "group";
  const exams = options.data?.exams ?? [];
  const selectedExamId = exams.some(exam => exam.id === chosenExamId) ? chosenExamId : exams[0]?.id;
  const writing = useGroupAiRanking(groupId, selectedExamId, "writing");
  const speaking = useGroupAiRanking(groupId, selectedExamId, "speaking");
  const ranking = skill === "writing" ? writing : speaking;
  const data = selectedExamId ? ranking.data : undefined;
  const summaryReady = !!selectedExamId && writing.data?.selectedExamId === selectedExamId && speaking.data?.selectedExamId === selectedExamId && !writing.isError && !speaking.isError;
  const summary = summaryReady && writing.data && speaking.data ? groupGradeRows(writing.data, speaking.data) : [];
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
          <section className="space-y-2" aria-label={t("allResults")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-fg">{t("allResults")}</h4>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-1.5 font-medium border-emerald-600/30 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                  disabled={!summaryReady || summary.length === 0}
                  onClick={() => {
                    if (!summaryReady || !writing.data || !speaking.data) return;
                    const safeName = groupName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
                    const filename = `bestway-group-${safeName}-results.csv`;
                    downloadCsv(groupLeaderboardExcelCsv(writing.data, speaking.data, phoneMap, t), filename);
                  }}
                >
                  <FileSpreadsheet className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Excelga yuklab olish
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!summaryReady || summary.length === 0} onClick={() => {
                  if (!summaryReady || !writing.data || !speaking.data) return;
                  const suffix = `${groupId}-${selectedExamId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
                  downloadCsv(groupGradesCsv(writing.data, speaking.data, t), `bestway-group-results-${suffix}.csv`);
                }}>{t("exportCsv")}</Button>
              </div>
            </div>
            <p className="text-xs text-fg-muted">{t("exportDescription")}</p>
            {summaryReady ? <GroupAllGradesTable rows={summary} t={t} /> : <p role="status" className="text-xs text-fg-muted">{t("exportUnavailable")}</p>}
          </section>
          <div role="group" aria-label={t("skill")} className="flex gap-2">
            {(["writing", "speaking"] as const).map(value => <button key={value} type="button" aria-pressed={skill === value} onClick={() => setSkill(value)} className={`rounded-lg px-4 py-2 text-sm font-medium ${skill === value ? "bg-brand-subtle text-brand-subtle-fg" : "bg-bg-subtle text-fg-muted"}`}>{t(value)}</button>)}
          </div>
          {data?.cohorts.map((cohort, index) => (
            <section key={cohort.id} className="space-y-2" aria-label={t("cohort", { number: index + 1 })}>
              <h4 className="text-sm font-semibold text-fg">{t("cohort", { number: index + 1 })} · {t("tasks", { count: cohort.questionCount })}</h4>
              <p className="text-xs text-fg-muted">{cohort.label} · {cohort.specificationVersion ?? t("historical")}</p>
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
