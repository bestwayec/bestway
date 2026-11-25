"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/feedback";
import { useGroupAnalytics } from "@/hooks/use-mock";
import { api } from "@/lib/api-client";

const TRACKS = { ielts_academic: "IELTS Academic", ielts_general: "IELTS General", multilevel: "Multilevel" };
const SKILLS = ["listening", "reading", "writing", "speaking"] as const;
const PAGE_SIZE = 20;
const selectClass = "min-h-10 max-w-full rounded-field border border-border bg-surface px-2 text-sm text-fg";
const tableClass = "w-full border-collapse text-left text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2";
const trackLabel = (track: string) => TRACKS[track as keyof typeof TRACKS] ?? track;

export function GroupAnalyticsDashboard({ groupId, groupName, className }: {
  groupId: string;
  groupName?: string;
  className?: string;
}) {
  const t = useTranslations("exam4Analytics");
  const format = useFormatter();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const base = useGroupAnalytics(groupId);
  const result = useGroupAnalytics(groupId, Boolean(Object.values(filters).some(Boolean)), filters);
  const query = Object.values(filters).some(Boolean) ? result : base;
  const data = query.data;

  function update(key: string, value: string) {
    setPage(0);
    setFilters((previous) => ({ ...previous, ...(key === "examId" ? { assignmentId: "" } : key === "assignmentId" ? { examId: "" } : {}), [key]: value }));
  }

  async function download(kind: "pdf" | "excel") {
    setExportError(false);
    setDownloading(true);
    try {
      const { blob, filename } = await api.downloadBlob(`/groups/${groupId}/report/${kind}`, filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename ?? (kind === "pdf" ? "classroom-report.pdf" : "classroom-report.xlsx");
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError(true);
    } finally {
      setDownloading(false);
    }
  }

  const score = (value: number | null | undefined) => value == null ? "—" : format.number(value, { maximumFractionDigits: 2 });
  const matches = (name: string) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const students = data?.students.filter((student) => matches(student.name)).sort((a, b) => {
    if (sort === "attempts") return b.mockAttemptsCount - a.mockAttemptsCount || a.name.localeCompare(b.name);
    if (sort === "activity") return (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "") || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  }) ?? [];
  const rank = data?.ranking.filter((student) => matches(student.name)) ?? [];
  const assessments = new Map([...(base.data?.assessments ?? []), ...(data?.assessments ?? [])].map((exam) => [exam.id, exam.title]));
  const pages = Math.ceil(Math.max(students.length, rank.length) / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pages - 1));
  const start = currentPage * PAGE_SIZE;
  const statuses: Record<string, string> = { in_progress: t("started"), grading: t("pending"), completed: t("graded") };

  return (
    <Card className={className} data-testid="group-exam-analytics">
      <CardHeader>
        <CardTitle>{t("title")} · {data?.groupName ?? groupName}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!data || downloading} onClick={() => void download("pdf")}>PDF</Button>
          <Button variant="outline" size="sm" disabled={!data || downloading} onClick={() => void download("excel")}>Excel</Button>
        </div>
        {exportError && <p role="alert" className="text-sm text-danger">{t("exportError")}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <select aria-label={t("track")} className={selectClass} value={filters.track ?? ""} onChange={(e) => update("track", e.target.value)}>
            <option value="">{t("allTracks")}</option>
            {Object.entries(TRACKS).map(([track, label]) => <option key={track} value={track}>{label}</option>)}
          </select>
          <select aria-label={t("assessment")} className={selectClass} value={filters.examId ?? ""} onChange={(e) => update("examId", e.target.value)}>
            <option value="">{t("allAssessments")}</option>
            {[...assessments].map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
          <select aria-label={t("assignment")} className={selectClass} value={filters.assignmentId ?? ""} onChange={(e) => update("assignmentId", e.target.value)}>
            <option value="">{t("allAssignments")}</option>
            {base.data?.assignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.title}</option>)}
          </select>
          <select aria-label={t("skill")} className={selectClass} value={filters.skill ?? ""} onChange={(e) => update("skill", e.target.value)}>
            <option value="">{t("allSkills")}</option>
            {SKILLS.map((skill) => <option key={skill} value={skill}>{t(skill)}</option>)}
          </select>
          <select aria-label={t("status")} className={selectClass} value={filters.status ?? ""} onChange={(e) => update("status", e.target.value)}>
            <option value="">{t("allStatuses")}</option>
            {Object.entries(statuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
          <select aria-label={t("policy")} className={selectClass} value={filters.policy ?? "latest"} onChange={(e) => update("policy", e.target.value)}>
            <option value="latest">{t("latest")}</option><option value="best">{t("best")}</option>
          </select>
          {(["from", "to"] as const).map((date) => (
            <label key={date} className="flex items-center gap-1 text-sm">
              {t(date)} <Input className="w-auto" type="date" value={filters[date] ?? ""} onChange={(e) => update(date, e.target.value)} />
            </label>
          ))}
        </div>
        {query.isError && <div role="alert" className="text-sm text-danger">{t("loadError")} <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button></div>}
        {query.isPending && <Skeleton className="h-48" />}
        {data && <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ["members", data.totalStudents], ["eligible", data.totalEligible], ["assigned", data.assignedStudents],
              ["started", data.startedStudents], ["submitted", data.submittedStudents], ["pending", data.pendingStudents],
              ["graded", data.gradedStudents], ["notSubmitted", data.notSubmittedStudents],
              ["completion", data.completionRate == null ? null : `${data.completionRate}%`],
              ["attendance", data.groupAverageAttendance == null ? null : `${data.groupAverageAttendance}%`],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-field border border-border p-3">
                <dt className="text-xs text-fg-muted">{t(label)}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {!Object.keys(data.groupAveragesByScale).length && <p role="status" className="text-sm text-fg-muted">{t("noScores")}</p>}
          {Object.entries(data.groupAveragesByScale).map(([track, average]) => (
            <section key={track} className="rounded-field border border-border p-3">
              <h3 className="font-semibold">{trackLabel(track)}</h3>
              <p className="text-sm">{t("summary", { average: score(average), median: score(data.scaleSummary[track]?.median), best: score(data.scaleSummary[track]?.best), count: data.scaleSummary[track]?.students ?? 0 })}</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(data.skills[track] ?? {}).map(([skill, value]) => (
                  <div key={skill}><dt className="text-xs text-fg-muted">{t(skill)}</dt><dd className="text-sm">{t("skillScore", { score: score(value.average), students: value.students, attempts: value.attempts })}</dd></div>
                ))}
              </dl>
            </section>
          ))}
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-0 flex-1" aria-label={t("search")} placeholder={t("search")} value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            <select className={selectClass} aria-label={t("sort")} value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
              <option value="name">{t("student")}</option><option value="attempts">{t("attempts")}</option><option value="activity">{t("activity")}</option>
            </select>
          </div>
          {rank.length > 0 && <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="py-2 text-left font-semibold">{t("ranking")} · {t(data.rankingPolicy)}</caption>
              <thead><tr>{[t("rank"), t("student"), t("track"), t("version"), t("score"), ...SKILLS.map((skill) => t(skill)), t("attempts"), t("submitted"), t("improvement"), t("review")].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>{rank.slice(start, start + PAGE_SIZE).map((row) => (
                <tr key={`${row.studentId}:${row.examId}:${row.specificationVersion}:${row.scoreVersion}`}>
                  <td>{row.rank}</td><td>{row.name}</td><td>{trackLabel(row.track)}</td><td>{[row.specificationVersion, row.scoreVersion].filter(Boolean).join(" / ") || "—"}</td><td>{score(row.score)}</td>
                  {SKILLS.map((skill) => <td key={skill}>{score(row.skills[skill])}</td>)}
                  <td>{row.attempts}</td><td>{row.submittedAt ? format.dateTime(new Date(row.submittedAt), { dateStyle: "short" }) : "—"}</td>
                  <td>{row.improvement != null && row.improvement > 0 ? "+" : ""}{score(row.improvement)}</td>
                  <td>{row.attemptId ? <Link className="text-brand underline" href={`/mock/attempt/${encodeURIComponent(row.attemptId)}`}>{t("review")}</Link> : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>}
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="py-2 text-left font-semibold">{t("studentPerformance")}</caption>
              <thead><tr>{[t("student"), t("status"), t("attempts"), t("score"), t("attendance"), t("activity")].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>{students.slice(start, start + PAGE_SIZE).map((row) => (
                <tr key={row.studentId}><td>{row.name}</td><td>{statuses[row.status ?? ""] ?? t("noAttempt")}</td><td>{row.mockAttemptsCount}</td>
                  <td>{Object.keys(row.scoresByScale).length ? Object.entries(row.scoresByScale).map(([track, value]) => <div key={track}>{trackLabel(track)} · {score(value)}</div>) : "—"}</td>
                  <td>{row.attendanceRate == null ? "—" : `${row.attendanceRate}%`}</td>
                  <td>{row.lastActiveAt ? format.dateTime(new Date(row.lastActiveAt), { dateStyle: "short" }) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
            {!students.length && <p className="p-2 text-sm text-fg-muted">{t("noStudents")}</p>}
          </div>
          {pages > 1 && <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("previous")}</Button>
            <span className="text-sm">{currentPage + 1}/{pages}</span>
            <Button size="sm" variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t("next")}</Button>
          </div>}
          <section><h3 className="font-semibold">{t("topics")}</h3>
            {data.weakTopicsHeatmap.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {data.weakTopicsHeatmap.map((row) => <div className="rounded-field border border-border p-2 text-sm" key={`${row.track}:${row.skill}:${row.questionType}`}>
                  <p>{trackLabel(row.track)} · {t(row.skill)} · {row.questionType.replaceAll("_", " ")}</p>
                  <p className="text-fg-muted">{row.accuracy == null ? "—" : `${row.accuracy}%`} · {t("topicScores", { correct: row.correct, incorrect: row.incorrect, unanswered: row.unanswered, affected: row.affectedStudentsCount })}</p>
                </div>)}
              </div>
            ) : <p className="text-sm text-fg-muted">{t("noScores")}</p>}
          </section>
          {data.questionDifficulty.length > 0 && <details>
            <summary className="cursor-pointer font-semibold">{t("difficulty")}</summary>
            <ul className="space-y-1 py-2">{data.questionDifficulty.map((row) => <li className="text-sm" key={row.questionId}>
              {t(row.skill)} #{row.number} · {row.questionType.replaceAll("_", " ")} · {t("questionScores", { correct: row.correct, incorrect: row.incorrect, unanswered: row.unanswered })}
              {row.commonIncorrectChoices?.length ? <p className="text-fg-muted">
                {t("commonIncorrect")} {row.commonIncorrectChoices.map((choice) => `${choice.option} (${choice.students})`).join(", ")}
              </p> : null}
            </li>)}</ul>
          </details>}
          {Object.keys(data.scoreDistribution).length > 0 && <details>
            <summary className="cursor-pointer font-semibold">{t("distribution")}</summary>
            {Object.entries(data.scoreDistribution).map(([track, values]) => <div key={track} className="py-2">
              <p className="text-sm font-medium">{trackLabel(track)}</p>
              <dl className="flex flex-wrap gap-2">{values.map((value) => <div className="rounded-field border border-border px-2 py-1" key={value.score}>
                <dt className="text-xs text-fg-muted">{score(value.score)}</dt><dd className="text-sm">{value.count}</dd>
              </div>)}</dl>
            </div>)}
          </details>}
          {([
            ["weekly", data.weeklyHistory.map((row) => ({ ...row, label: row.week, id: row.week }))],
            ["monthly", data.history.map((row) => ({ ...row, label: row.month, id: row.month }))],
            ["bySkill", data.skillHistory.map((row) => ({ ...row, label: `${row.month} · ${t(row.skill)}`, id: `${row.month}:${row.skill}` }))],
            ["byExam", data.examHistory.map((row) => ({ ...row, label: [row.title, row.specificationVersion, row.scoreVersion].filter(Boolean).join(" · "), id: `${row.examId}:${row.specificationVersion}:${row.scoreVersion}` }))],
          ] as const).map(([period, rows]) => rows.length > 0 && <details key={period}>
            <summary className="cursor-pointer font-semibold">{t(period)}</summary>
            <ul className="space-y-1 py-2">{rows.map((row) => <li className="text-sm" key={`${row.track}:${row.id}`}>
              {row.label} · {trackLabel(row.track)} · {t("historyPoint", { score: score(row.average), count: row.attempts })}
            </li>)}</ul>
          </details>)}
        </>}
      </CardContent>
    </Card>
  );
}
