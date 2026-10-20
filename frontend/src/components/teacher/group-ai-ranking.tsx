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
import {
  finalGradeLabel,
  groupGradeRows,
  groupGradesCsv,
  groupLeaderboardExcelCsv,
  type GroupGradeSummary,
  type GroupSkillGrade,
} from "@/lib/group-grade-export";
import { useGroupDetail } from "@/hooks/use-groups";
import { FileSpreadsheet, FileText, Search, ArrowUpDown, PenTool } from "lucide-react";
import { TeacherEvaluationDialog } from "./teacher-evaluation-dialog";

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

export function GroupAiRankingTable({
  rows,
  cohort,
  t,
  onEvaluate,
}: {
  rows: GroupAiRankingRow[];
  cohort?: GroupAiRankingCohort;
  t: Translate;
  onEvaluate?: (attemptId: string, name: string, aiScore?: number | null, finalScore?: number | null) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg-subtle text-fg-muted">
          <tr>
            {["rank", "student", "aiScore", "rawScore", "teacherScore", "finalScore", "status"].map((key) => (
              <th key={key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                {t(key)}
              </th>
            ))}
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium text-right">
              Amal
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.studentId} className="hover:bg-bg-subtle/40 transition-colors">
              <td className="px-3 py-3 font-semibold text-fg">
                <RankBadge rank={row.rank} />
              </td>
              <th scope="row" className="px-3 py-3 font-medium text-fg">
                {row.name}
              </th>
              <td className="whitespace-nowrap px-3 py-3 text-fg">
                {rankingScoreLabel(row.aiScore, cohort?.scaleMax)}
                {row.aiScore != null && !row.eligible && (
                  <span className="block text-xs text-fg-muted">{t("proposalOnly")}</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
                {rankingScoreLabel(row.aiRawScore, cohort?.rawMax)}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
                {rankingScoreLabel(row.teacherScore, row.finalScoreScaleMax)}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-fg">
                {rankingScoreLabel(
                  row.finalScore == null ? null : row.finalPracticeGrade?.score ?? row.finalScore,
                  row.finalPracticeGrade?.scaleMax ?? row.finalScoreScaleMax
                )}
                {row.finalScoreSource && (
                  <span className="block text-xs text-fg-muted">
                    {t(
                      row.finalScoreSource === "TEACHER"
                        ? "sourceTeacher"
                        : row.finalScoreSource === "ADJUDICATED"
                        ? "sourceAdjudicated"
                        : "sourceAi"
                    )}
                  </span>
                )}
              </td>
              <td className="px-3 py-3 text-fg-muted">{t(rankingStatusKey(row))}</td>
              <td className="px-3 py-3 text-right">
                {row.attemptId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onEvaluate?.(row.attemptId!, row.name, row.aiScore, row.finalScore)}
                    className="h-7 px-2.5 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 gap-1 font-medium inline-flex items-center"
                  >
                    <PenTool className="size-3" />
                    <span>Baholash</span>
                  </Button>
                ) : (
                  <span className="text-xs text-fg-subtle">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GroupAllGradesTable({
  rows,
  t,
  onEvaluate,
}: {
  rows: GroupGradeSummary[];
  t: Translate;
  onEvaluate?: (
    attemptId: string,
    name: string,
    writingScore?: number | null,
    speakingScore?: number | null,
    finalScore?: number | null
  ) => void;
}) {
  const [search, setSearch] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"name" | "score-desc" | "score-asc">("name");

  const getStudentScore = (item: GroupGradeSummary): number => {
    const w = item.writing?.row.finalScore ?? item.writing?.row.aiScore ?? -1;
    const s = item.speaking?.row.finalScore ?? item.speaking?.row.aiScore ?? -1;
    if (w >= 0 && s >= 0) return (w + s) / 2;
    return Math.max(w, s);
  };

  const processedRows = React.useMemo(() => {
    const list = rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));
    if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "score-desc") {
      list.sort((a, b) => getStudentScore(b) - getStudentScore(a));
    } else if (sortBy === "score-asc") {
      list.sort((a, b) => getStudentScore(a) - getStudentScore(b));
    }
    return list;
  }, [rows, search, sortBy]);

  const ai = (grade?: GroupSkillGrade) => (
    <>
      {rankingScoreLabel(grade?.row.aiScore, grade?.cohort?.scaleMax)}
      {grade?.row.aiRawScore != null && (
        <span className="block text-xs text-fg-muted">
          {t("rawScore")}: {rankingScoreLabel(grade.row.aiRawScore, grade.cohort?.rawMax)}
        </span>
      )}
      {grade?.row.aiScore != null && !grade.row.eligible && (
        <span className="block text-xs text-fg-muted">{t("proposalOnly")}</span>
      )}
      {grade && <span className="block text-xs text-fg-muted">{t(rankingStatusKey(grade.row))}</span>}
    </>
  );

  const final = (grade?: GroupSkillGrade) => (
    <>
      {finalGradeLabel(grade)}
      {grade?.row.finalScore != null && grade.row.finalScoreSource && (
        <span className="block text-xs text-fg-muted">
          {t(
            grade.row.finalScoreSource === "TEACHER"
              ? "sourceTeacher"
              : grade.row.finalScoreSource === "ADJUDICATED"
              ? "sourceAdjudicated"
              : "sourceAi"
          )}
        </span>
      )}
      {grade && (
        <span className="block text-xs text-fg-muted">
          {t(grade.row.finalScore != null ? "graded" : rankingStatusKey(grade.row))}
        </span>
      )}
      {grade?.cohort && (
        <span className="block text-xs text-fg-muted">
          {grade.cohort.label} · {grade.cohort.specificationVersion ?? t("historical")}
        </span>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {/* Search and Sort Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="O'quvchi ismini qidirish..."
            className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-xs text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <ArrowUpDown className="size-3 text-fg-subtle" />
            <span>Saralash:</span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "name" | "score-desc" | "score-asc")}
            className="h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-fg focus:border-brand focus:outline-none"
          >
            <option value="name">Alifbo bo&apos;yicha</option>
            <option value="score-desc">Ball: eng yuqoridan</option>
            <option value="score-asc">Ball: eng pastdan</option>
          </select>
          <span className="text-[11px] text-fg-subtle">({processedRows.length} ta o&apos;quvchi)</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-subtle text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("student")}
              </th>
              {(["writing", "speaking"] as const).flatMap((skill) =>
                ["aiScore", "teacherScore", "finalScore"].map((key) => (
                  <th key={skill + key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                    {t(skill)} · {t(key)}
                  </th>
                ))
              )}
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium text-right">
                Amal
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {processedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-xs text-fg-muted">
                  Qidiruv bo&apos;yicha o&apos;quvchi topilmadi
                </td>
              </tr>
            ) : (
              processedRows.map((row) => {
                const targetAttemptId = row.writing?.row.attemptId || row.speaking?.row.attemptId;
                const wScore = row.writing?.row.finalScore ?? row.writing?.row.aiScore;
                const sScore = row.speaking?.row.finalScore ?? row.speaking?.row.aiScore;
                return (
                  <tr key={row.studentId} className="hover:bg-bg-subtle/40 transition-colors">
                    <th scope="row" className="px-3 py-3 font-medium text-fg">
                      {row.name}
                    </th>
                    {(["writing", "speaking"] as const).map((skill) => (
                      <React.Fragment key={skill}>
                        <td className="whitespace-nowrap px-3 py-3 text-fg">{ai(row[skill])}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
                          {rankingScoreLabel(row[skill]?.row.teacherScore, row[skill]?.row.finalScoreScaleMax)}
                        </td>
                        <td className="px-3 py-3 text-fg">{final(row[skill])}</td>
                      </React.Fragment>
                    ))}
                    <td className="px-3 py-3 text-right">
                      {targetAttemptId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onEvaluate?.(targetAttemptId, row.name, wScore, sScore)}
                          className="h-7 px-2.5 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 gap-1 font-medium inline-flex items-center"
                        >
                          <PenTool className="size-3" />
                          <span>Baholash</span>
                        </Button>
                      ) : (
                        <span className="text-xs text-fg-subtle">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GroupAiRanking({ groupId }: { groupId: string }) {
  const t = useTranslations("teacherAiRanking");
  const [chosenExamId, setChosenExamId] = React.useState<string>();
  const [skill, setSkill] = React.useState<AiRankingSkill>("writing");
  const options = useGroupAiRanking(groupId);
  const groupQ = useGroupDetail(groupId);
  const phoneMap = new Map((groupQ.data?.students ?? []).map((s) => [s.studentId, s.phone]));
  const groupName = groupQ.data?.name ?? options.data?.group?.name ?? "group";
  const exams = options.data?.exams ?? [];
  const selectedExamId = exams.some((exam) => exam.id === chosenExamId) ? chosenExamId : exams[0]?.id;
  const writing = useGroupAiRanking(groupId, selectedExamId, "writing");
  const speaking = useGroupAiRanking(groupId, selectedExamId, "speaking");
  const ranking = skill === "writing" ? writing : speaking;
  const data = selectedExamId ? ranking.data : undefined;
  const summaryReady =
    !!selectedExamId &&
    writing.data?.selectedExamId === selectedExamId &&
    speaking.data?.selectedExamId === selectedExamId &&
    !writing.isError &&
    !speaking.isError;
  const summary = summaryReady && writing.data && speaking.data ? groupGradeRows(writing.data, speaking.data) : [];
  const loading = options.isLoading || (!!selectedExamId && ranking.isLoading);
  const error = options.isError || (!!selectedExamId && ranking.isError);

  // State for teacher evaluation modal
  const [evaluationTarget, setEvaluationTarget] = React.useState<{
    attemptId: string;
    studentName: string;
    writingScore?: number | null;
    speakingScore?: number | null;
    finalScore?: number | null;
  } | null>(null);

  const handleOpenEvaluation = (
    attemptId: string,
    studentName: string,
    writingScore?: number | null,
    speakingScore?: number | null,
    finalScore?: number | null
  ) => {
    setEvaluationTarget({
      attemptId,
      studentName,
      writingScore,
      speakingScore,
      finalScore,
    });
  };

  const handleGradedSuccess = () => {
    void options.refetch();
    void writing.refetch();
    void speaking.refetch();
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <ErrorState
            title={t("error")}
            action={
              <button
                type="button"
                className="text-brand underline"
                onClick={() => {
                  void options.refetch();
                  void ranking.refetch();
                }}
              >
                {t("retry")}
              </button>
            }
          />
        ) : loading && !data ? (
          <Skeleton className="h-40" />
        ) : exams.length === 0 ? (
          <EmptyState title={t("noExams")} />
        ) : (
          <>
            <label className="block text-sm text-fg-muted">
              {t("exam")}
              <select
                value={selectedExamId ?? ""}
                onChange={(event) => setChosenExamId(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg"
              >
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.title}
                  </option>
                ))}
              </select>
            </label>
            <section className="space-y-2" aria-label={t("allResults")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-fg">{t("allResults")}</h4>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Direct Excel (.xlsx) & PDF Export Buttons */}
                  {selectedExamId && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        asChild
                        className="inline-flex items-center gap-1.5 font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                      >
                        <a
                          href={`/api/backend/v1/groups/${groupId}/exams/${selectedExamId}/export/excel`}
                          download
                        >
                          <FileSpreadsheet className="size-3.5" />
                          <span>Excel (.xlsx)</span>
                        </a>
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        asChild
                        className="inline-flex items-center gap-1.5 font-medium border-rose-500/40 text-rose-500 hover:bg-rose-500/10 dark:text-rose-400"
                      >
                        <a
                          href={`/api/backend/v1/groups/${groupId}/exams/${selectedExamId}/export/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <FileText className="size-3.5" />
                          <span>PDF Hisobot</span>
                        </a>
                      </Button>
                    </>
                  )}

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
                    Vedomost (CSV)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!summaryReady || summary.length === 0}
                    onClick={() => {
                      if (!summaryReady || !writing.data || !speaking.data) return;
                      const suffix = `${groupId}-${selectedExamId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
                      downloadCsv(groupGradesCsv(writing.data, speaking.data, t), `bestway-group-results-${suffix}.csv`);
                    }}
                  >
                    {t("exportCsv")}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-fg-muted">{t("exportDescription")}</p>
              {summaryReady ? (
                <GroupAllGradesTable rows={summary} t={t} onEvaluate={handleOpenEvaluation} />
              ) : (
                <p role="status" className="text-xs text-fg-muted">
                  {t("exportUnavailable")}
                </p>
              )}
            </section>
            <div role="group" aria-label={t("skill")} className="flex gap-2">
              {(["writing", "speaking"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={skill === value}
                  onClick={() => setSkill(value)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    skill === value ? "bg-brand-subtle text-brand-subtle-fg" : "bg-bg-subtle text-fg-muted"
                  }`}
                >
                  {t(value)}
                </button>
              ))}
            </div>
            {data?.cohorts.map((cohort, index) => (
              <section key={cohort.id} className="space-y-2" aria-label={t("cohort", { number: index + 1 })}>
                <h4 className="text-sm font-semibold text-fg">
                  {t("cohort", { number: index + 1 })} · {t("tasks", { count: cohort.questionCount })}
                </h4>
                <p className="text-xs text-fg-muted">
                  {cohort.label} · {cohort.specificationVersion ?? t("historical")}
                </p>
                <GroupAiRankingTable
                  rows={cohort.rows}
                  cohort={cohort}
                  t={t}
                  onEvaluate={(attId, name, aiScore, fScore) =>
                    handleOpenEvaluation(attId, name, skill === "writing" ? aiScore : null, skill === "speaking" ? aiScore : null, fScore)
                  }
                />
              </section>
            ))}
            {data && data.cohorts.length === 0 && data.unranked.length === 0 && <EmptyState title={t("noScores")} />}
            {!!data?.unranked.length && (
              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-fg">{t("unranked")}</h4>
                <GroupAiRankingTable
                  rows={data.unranked}
                  t={t}
                  onEvaluate={(attId, name, aiScore, fScore) =>
                    handleOpenEvaluation(attId, name, skill === "writing" ? aiScore : null, skill === "speaking" ? aiScore : null, fScore)
                  }
                />
              </section>
            )}
            <p className="text-xs text-fg-muted">{t("comparisonNote")}</p>
          </>
        )}
      </CardContent>

      {/* Split-view Teacher Evaluation Dialog */}
      <TeacherEvaluationDialog
        open={!!evaluationTarget}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEvaluationTarget(null);
        }}
        attemptId={evaluationTarget?.attemptId ?? null}
        studentName={evaluationTarget?.studentName}
        initialWritingScore={evaluationTarget?.writingScore}
        initialSpeakingScore={evaluationTarget?.speakingScore}
        initialFinalScore={evaluationTarget?.finalScore}
        onGraded={handleGradedSuccess}
      />
    </Card>
  );
}
