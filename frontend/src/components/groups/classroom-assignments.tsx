"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import type { ClassroomAssignment, ClassroomAssignmentInput, ClassroomVocabularyCollection, VocabularyAssignmentReports } from "@/lib/group-contract.generated";

export function ClassroomAssignments({ groupId, userId }: { groupId: string; userId: string }) {
  const t = useTranslations("classroomAssignments");
  const tv = useTranslations("vocabularyAssignment");
  const queryClient = useQueryClient();
  const queryKey = ["classroom-assignments", userId, groupId] as const;
  const path = `/groups/${encodeURIComponent(groupId)}/assignments`;
  const tasks = useQuery({ queryKey, queryFn: () => api.get<ClassroomAssignment[]>(path) });
  const collections = useQuery({
    queryKey: ["classroom-vocabulary-collections", userId, groupId],
    queryFn: () => api.get<ClassroomVocabularyCollection[]>(`/groups/${encodeURIComponent(groupId)}/vocabulary-collections`),
  });
  const [setId, setSetId] = useState("");
  const [minimum, setMinimum] = useState("80");
  const [report, setReport] = useState("");
  const results = useQuery({
    queryKey: ["classroom-vocabulary-results", userId, groupId, report],
    queryFn: () => api.get<VocabularyAssignmentReports>(`${path}/${encodeURIComponent(report)}/vocabulary-results`),
    enabled: Boolean(report),
  });
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");

  const create = useMutation({
    mutationFn: (input: ClassroomAssignmentInput) => api.post<ClassroomAssignment>(path, input),
    onSuccess: async () => {
      setTitle("");
      setDeadline("");
      setSetId("");
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || create.isPending) return;
    create.mutate({
      title: title.trim(),
      ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
      ...(setId ? { vocabulary_set_id: setId, min_pass_percent: Number(minimum) } : {}),
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
            <select className="rounded-md border border-border bg-surface p-2" value={setId} onChange={event => setSetId(event.target.value)}>
              <option value="">{tv("none")}</option>
              {collections.data?.map(set => <option key={set.id} value={set.id}>{set.title} ({set.wordCount})</option>)}
            </select>
          </label>
          {setId && <label className="grid gap-1 text-sm">
            {tv("minimum")}
            <Input type="number" min={0} max={100} required value={minimum} onChange={event => setMinimum(event.target.value)} />
          </label>}
          <Button type="submit" disabled={!title.trim() || create.isPending}>
            {create.isPending ? t("saving") : t("assign")}
          </Button>
        </form>
        {collections.isError && <p role="alert">{tv("failed")} <Button size="sm" onClick={() => void collections.refetch()}>{tv("retry")}</Button></p>}
        {create.isError && <p role="alert">{create.error instanceof Error ? create.error.message : t("failed")}</p>}
        {tasks.isPending && <p role="status">{t("loading")}</p>}
        {tasks.isError && <p role="alert">{t("failed")} <Button size="sm" onClick={() => void tasks.refetch()}>{t("retry")}</Button></p>}
        {tasks.isSuccess && (tasks.data.length ? (
          <ul className="divide-y divide-border">
            {tasks.data.map(task => (
              <li className="flex flex-wrap justify-between gap-2 py-2" key={task.id}>
                <span>{task.title}</span>
                {task.vocabulary_set_id && <Button variant="outline" size="sm" aria-expanded={report === task.id} onClick={() => setReport(report === task.id ? "" : task.id)}>{tv("results")}</Button>}
                <time className="text-fg-muted" dateTime={task.deadline}>{new Date(task.deadline).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        ) : <p>{t("empty")}</p>)}
        {report && results.isPending && <p role="status">{tv("loading")}</p>}
        {report && results.isError && <p role="alert">{tv("failed")} <Button size="sm" onClick={() => void results.refetch()}>{tv("retry")}</Button></p>}
        {report && results.data && !results.isError && <div className="space-y-2 rounded-md border border-border p-3">
          <p>{tv("completed", { completed: results.data.completedCount, assigned: results.data.assignedCount })}</p>
          <p>{tv("overdue", { count: results.data.overdueCount })}</p>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/backend${path}/${encodeURIComponent(report)}/vocabulary-results?download=csv`} download>CSV</a>
          </Button>
          <ul>{results.data.students.map(student => <li key={student.studentId}>{student.name} · {student.percentage}%</li>)}</ul>
          {results.data.missedWords.length > 0 && <div><h3>{tv("missed")}</h3>
            <ul>{results.data.missedWords.map(word => <li key={word.english}>{word.english} · {word.count}</li>)}</ul>
          </div>}
        </div>}
      </CardContent>
    </Card>
  );
}
