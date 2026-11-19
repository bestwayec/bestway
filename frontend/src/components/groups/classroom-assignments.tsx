"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import type { ClassroomAssignment, ClassroomAssignmentInput } from "@/lib/group-contract.generated";

export function ClassroomAssignments({ groupId, userId }: { groupId: string; userId: string }) {
  const t = useTranslations("classroomAssignments");
  const queryClient = useQueryClient();
  const queryKey = ["classroom-assignments", userId, groupId] as const;
  const path = `/groups/${encodeURIComponent(groupId)}/assignments`;
  const tasks = useQuery({ queryKey, queryFn: () => api.get<ClassroomAssignment[]>(path) });
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");

  const create = useMutation({
    mutationFn: (input: ClassroomAssignmentInput) => api.post<ClassroomAssignment>(path, input),
    onSuccess: async () => {
      setTitle("");
      setDeadline("");
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || create.isPending) return;
    create.mutate({
      title: title.trim(),
      ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
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
          <Button type="submit" disabled={!title.trim() || create.isPending}>
            {create.isPending ? t("saving") : t("assign")}
          </Button>
        </form>
        {create.isError && <p role="alert">{create.error instanceof Error ? create.error.message : t("failed")}</p>}
        {tasks.isPending && <p role="status">{t("loading")}</p>}
        {tasks.isError && <p role="alert">{t("failed")} <Button size="sm" onClick={() => void tasks.refetch()}>{t("retry")}</Button></p>}
        {tasks.isSuccess && (tasks.data.length ? (
          <ul className="divide-y divide-border">
            {tasks.data.map(task => (
              <li className="flex flex-wrap justify-between gap-2 py-2" key={task.id}>
                <span>{task.title}</span>
                <time className="text-fg-muted" dateTime={task.deadline}>{new Date(task.deadline).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        ) : <p>{t("empty")}</p>)}
      </CardContent>
    </Card>
  );
}
