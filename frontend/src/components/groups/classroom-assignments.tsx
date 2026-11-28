"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api-client";
import type { ClassroomAssignment, ClassroomAssignmentInput, ClassroomVocabularyCollection, VocabularyAssignmentReports } from "@/lib/group-contract.generated";

// Classroom times are entered and shown in Asia/Tashkent (UTC+05:00, no daylight saving) and stored in UTC.
const TASHKENT_OFFSET = "+05:00";
export function tashkentInputToIso(value: string): string {
  return new Date(`${value.length === 16 ? `${value}:00` : value}${TASHKENT_OFFSET}`).toISOString();
}
export function formatTashkent(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" });
}

export function ClassroomAssignments({ groupId, userId }: { groupId: string; userId: string }) {
  const t = useTranslations("classroomAssignments");
  const tv = useTranslations("vocabularyAssignment");
  const tm = useTranslations("classroomManagement");
  const queryClient = useQueryClient();
  const queryKey = ["classroom-assignments", userId, groupId] as const;
  const path = `/groups/${encodeURIComponent(groupId)}/assignments`;
  const tasks = useQuery({ queryKey, queryFn: () => api.get<ClassroomAssignment[]>(path) });
  const collections = useQuery({
    queryKey: ["classroom-vocabulary-collections", userId, groupId],
    queryFn: () => api.get<ClassroomVocabularyCollection[]>(`/groups/${encodeURIComponent(groupId)}/vocabulary-collections`),
  });
  const exams = useQuery({
    queryKey: ["classroom-assignable-exams", userId, groupId],
    queryFn: () => api.get<Array<{ id: string; title: string }>>(`/groups/${encodeURIComponent(groupId)}/assignable-exams`),
  });
  const [examId, setExamId] = useState("");
  const [setId, setSetId] = useState("");
  const [minimum, setMinimum] = useState("80");
  const [report, setReport] = useState("");
  const [page, setPage] = useState(1);
  const [reportSearch, setReportSearch] = useState("");
  const results = useQuery({
    queryKey: ["classroom-vocabulary-results", userId, groupId, report, page, reportSearch],
    queryFn: () => api.get<VocabularyAssignmentReports>(`${path}/${encodeURIComponent(report)}/vocabulary-results`, { page, search: reportSearch }),
    enabled: Boolean(report),
  });
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [timing, setTiming] = useState<"individual" | "fixed_close">("individual");

  const create = useMutation({
    mutationFn: (input: ClassroomAssignmentInput) => api.post<ClassroomAssignment>(path, input),
    onSuccess: async () => {
      setTitle("");
      setDeadline("");
      setOpensAt("");
      setTiming("individual");
      setSetId("");
      setExamId("");
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || create.isPending) return;
    if (examId && timing === "fixed_close" && !deadline) return;
    create.mutate({
      title: title.trim(),
      ...(deadline ? { deadline: tashkentInputToIso(deadline) } : {}),
      ...(setId ? { vocabulary_set_id: setId, min_pass_percent: Number(minimum) } : {}),
      ...(examId ? { exam_id: examId, min_pass_percent: Number(minimum), timing_policy: timing,
        ...(opensAt ? { opens_at: tashkentInputToIso(opensAt) } : {}) } : {}),
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("heading")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
          <label className="grid gap-1 text-sm">
            {t("title")}
            <Input value={title} onChange={event => setTitle(event.target.value)} maxLength={255} required />
          </label>
          <label className="grid gap-1 text-sm">
            {t("deadline")}
            <Input type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            {tv("set")}
            <select className="rounded-md border border-border bg-surface p-2" value={setId} onChange={event => { setSetId(event.target.value); if (event.target.value) setExamId(""); }}>
              <option value="">{tv("none")}</option>
              {collections.data?.map(set => <option key={set.id} value={set.id}>{set.title} ({set.wordCount})</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            {t("exam")}
            <select className="rounded-md border border-border bg-surface p-2" value={examId} onChange={event => { setExamId(event.target.value); if (event.target.value) setSetId(""); }}>
              <option value="">{t("noExam")}</option>
              {exams.data?.map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
            </select>
          </label>
          {examId && <label className="grid gap-1 text-sm">
            {t("opensAt")}
            <Input type="datetime-local" value={opensAt} onChange={event => setOpensAt(event.target.value)} />
          </label>}
          {examId && <fieldset className="grid gap-1 text-sm">
            <legend>{t("timingPolicy")}</legend>
            {(["individual", "fixed_close"] as const).map(option => (
              <label className="flex items-center gap-2" key={option}>
                <input type="radio" name="timing_policy" value={option} checked={timing === option} onChange={() => setTiming(option)} />
                {t(option === "individual" ? "timingIndividual" : "timingFixed")}
              </label>
            ))}
          </fieldset>}
          {(setId || examId) && <label className="grid gap-1 text-sm">
            {tv("minimum")}
            <Input type="number" min={0} max={100} required value={minimum} onChange={event => setMinimum(event.target.value)} />
          </label>}
          <Button type="submit" disabled={!title.trim() || create.isPending || (Boolean(examId) && timing === "fixed_close" && !deadline)}>
            {create.isPending ? t("saving") : t("assign")}
          </Button>
        </form>
        {examId && <p className="text-sm text-fg-muted" data-testid="timing-help">
          {t(timing === "individual" ? "timingIndividualHelp" : "timingFixedHelp")} {t("tashkent")}
          {timing === "fixed_close" && !deadline && <> <strong role="alert">{t("fixedNeedsDeadline")}</strong></>}
        </p>}
        {exams.isError && <p role="alert">{t("failed")} <Button size="sm" onClick={() => void exams.refetch()}>{t("retry")}</Button></p>}
        {collections.isError && <p role="alert">{tv("failed")} <Button size="sm" onClick={() => void collections.refetch()}>{tv("retry")}</Button></p>}
        {create.isError && <p role="alert">{create.error instanceof Error ? create.error.message : t("failed")}</p>}
        {tasks.isPending && <p role="status">{t("loading")}</p>}
        {tasks.isError && <p role="alert">{t("failed")} <Button size="sm" onClick={() => void tasks.refetch()}>{t("retry")}</Button></p>}
        {tasks.isSuccess && (tasks.data.length ? (
          <ul className="divide-y divide-border">
            {tasks.data.map(task => (
              <li className="flex flex-wrap justify-between gap-2 py-2" key={task.id}>
                <span>{task.title}</span>
                {task.vocabulary_set_id && <Button variant="outline" size="sm" aria-expanded={report === task.id} onClick={() => { setReport(report === task.id ? "" : task.id); setPage(1); setReportSearch(""); }}>{tv("results")}</Button>}
                {task.exam_id && <Link className="text-sm text-brand underline" href={`/teacher/results/exam/${encodeURIComponent(task.id)}`}>{t("results")}</Link>}
                {task.timing_policy === "fixed_close" && <span className="rounded bg-surface-muted px-2 text-xs">{t("fixedBadge")}</span>}
                {task.opens_at && <span className="text-xs text-fg-muted">{t("opensBadge", { when: formatTashkent(task.opens_at) })}</span>}
                <time className="text-fg-muted" dateTime={task.deadline}>{formatTashkent(task.deadline)}</time>
              </li>
            ))}
          </ul>
        ) : <p>{t("empty")}</p>)}
        {report && results.isPending && <p role="status">{tv("loading")}</p>}
        {report && results.isError && <p role="alert">{tv("failed")} <Button size="sm" onClick={() => void results.refetch()}>{tv("retry")}</Button></p>}
        {report && results.data && !results.isError && <div className="space-y-2 rounded-md border border-border p-3">
          <p>{tv("completed", { completed: results.data.completedCount, assigned: results.data.assignedCount })}</p>
          <p>{tv("overdue", { count: results.data.overdueCount })}</p>
          <div className="flex gap-2">
            {(["csv", "xlsx"] as const).map(format => (
              <Button asChild key={format} size="sm" variant="outline">
                <a href={`/api/backend${path}/${encodeURIComponent(report)}/vocabulary-results?download=${format}`} download>{format.toUpperCase()}</a>
              </Button>
            ))}
          </div>
          <label className="grid gap-1">{tm("searchStudents")}
            <Input value={reportSearch} onChange={event => { setReportSearch(event.target.value); setPage(1); }} />
          </label>
          <ul>{results.data.students.map(student => <li key={student.studentId}>{student.name} · {student.percentage}%{!student.currentlyEnrolled && ` · ${tm("former")}`}</li>)}</ul>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>{tm("previous")}</Button>
            <Button type="button" variant="outline" disabled={!results.data.hasNext} onClick={() => setPage(page + 1)}>{tm("next")}</Button>
          </div>
          {results.data.overdueStudents.length > 0 && <ul>{results.data.overdueStudents.map(student => <li key={student.studentId}>{student.name}</li>)}</ul>}
          {results.data.missedWords.length > 0 && <div><h3>{tv("missed")}</h3>
            <ul>{results.data.missedWords.map(word => <li key={word.english}>{word.english} · {word.count}</li>)}</ul>
          </div>}
        </div>}
      </CardContent>
    </Card>
  );
}
