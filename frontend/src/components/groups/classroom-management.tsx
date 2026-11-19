"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { useDebouncedValue, useUsersList } from "@/hooks/use-users";
import type { ClassroomArchiveState, ClassroomBulkMembership, ClassroomHistoryPage, ClassroomStudentHistory, GroupDetail } from "@/lib/group-contract.generated";

export function ClassroomManagement({ group, userId }: { group: GroupDetail; userId: string }) {
  const t = useTranslations("classroomManagement");
  const client = useQueryClient();
  const path = `/groups/${encodeURIComponent(group.id)}`;
  const key = ["classroom-management", userId, group.id] as const;
  const [action, setAction] = useState<ClassroomBulkMembership["action"]>("add");
  const [selection, setSelection] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [student, setStudent] = useState("");
  const lookup = useDebouncedValue(search.trim());
  const candidates = useUsersList("student", lookup);
  const roster = new Set(group.students.map(row => row.studentId));
  const options = action === "remove" ? group.students.map(row => ({ id: row.studentId, name: row.name })) :
    lookup.length < 2 ? [] : (candidates.data ?? []).filter(row => !roster.has(row.id)).slice(0, 25);
  const archived = useQuery({
    queryKey: [...key, "archive"],
    queryFn: () => api.get<ClassroomArchiveState>(`${path}/archive`),
  });
  const history = useQuery({
    queryKey: [...key, "history", page],
    queryFn: () => api.get<ClassroomHistoryPage>(`${path}/member-history`, { page }),
  });
  const detail = useQuery({
    queryKey: [...key, "student", student],
    enabled: Boolean(student),
    queryFn: () => api.get<ClassroomStudentHistory>(`${path}/member-history/${encodeURIComponent(student)}`),
  });

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: ["groups"] }),
      client.invalidateQueries({ queryKey: ["group", group.id] }),
      client.invalidateQueries({ queryKey: ["users"] }),
    ]);
  }

  const archive = useMutation({
    mutationFn: (archived: boolean) => api.put<ClassroomArchiveState>(`${path}/archive`, { archived }),
    onSuccess: refresh,
  });
  const bulk = useMutation({
    mutationFn: (body: ClassroomBulkMembership) => api.post<{ updated: number }>(`${path}/students/bulk`, body),
    onSuccess: async () => { setSelection([]); await refresh(); },
  });
  const error = archive.error ?? bulk.error ?? archived.error ?? history.error ?? detail.error ?? (action === "add" && lookup.length >= 2 ? candidates.error : null);
  const selected = options.filter(option => selection.includes(option.id)).map(option => option.id);

  return (
    <Card>
      <CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert">{error instanceof Error ? error.message : t("failed")}</p>}
        {archived.data && <Button type="button" variant="outline" disabled={archive.isPending} onClick={() => {
          if (window.confirm(t(archived.data.archived ? "confirmRestore" : "confirmArchive"))) archive.mutate(!archived.data.archived);
        }}>{t(archived.data.archived ? "restore" : "archive")}</Button>}
        {archived.data && !archived.data.archived && <fieldset className="space-y-2">
          <legend className="font-medium">{t("bulk")}</legend>
          <label className="flex items-center gap-2">{t("action")}
            <select className="rounded-field border border-border bg-surface p-2" value={action} onChange={event => {
              setAction(event.target.value as ClassroomBulkMembership["action"]); setSelection([]);
            }}>
              <option value="add">{t("addStudents")}</option><option value="remove">{t("removeStudents")}</option>
            </select>
          </label>
          {action === "add" && <label className="flex items-center gap-2">{t("searchStudents")}
            <input className="rounded-field border border-border bg-surface p-2" value={search} onChange={event => { setSearch(event.target.value); setSelection([]); }} />
          </label>}
          <ul className="max-h-48 overflow-y-auto">
            {options.map(option => <li key={option.id}><label className="flex gap-2 p-1">
              <input type="checkbox" checked={selection.includes(option.id)} onChange={event => {
                setSelection(current => event.target.checked ? [...current, option.id] : current.filter(id => id !== option.id));
              }} />{option.name}
            </label></li>)}
          </ul>
          <Button type="button" disabled={!selected.length || bulk.isPending} onClick={() => {
            if (action === "add" || window.confirm(t("confirmRemove"))) bulk.mutate({ action, studentIds: selected });
          }}>{t("apply")}</Button>
        </fieldset>}
        <section className="space-y-2">
          <h3 className="font-semibold">{t("history")}</h3>
          {history.isPending && <p role="status">{t("loading")}</p>}
          {history.data && <div className="flex flex-wrap gap-2">
            {history.data.members.map(member => (
              <Button key={member.id} type="button" size="sm" variant="outline" aria-pressed={student === member.id} onClick={() => setStudent(member.id)}>
                {member.name}{!member.currentlyEnrolled && ` · ${t("former")}`}
              </Button>
            ))}
            <Button type="button" size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("previous")}</Button>
            <Button type="button" size="sm" variant="outline" disabled={!history.data.hasNext} onClick={() => setPage(page + 1)}>{t("next")}</Button>
          </div>}
          {student && detail.isPending && <p role="status">{t("loading")}</p>}
          {detail.data && !detail.isError && <div className="space-y-2 rounded-md border border-border p-3">
            <h4 className="font-semibold">{detail.data.name}</h4>
            <p>{t(detail.data.currentlyEnrolled ? "current" : "former")}</p>
            <ul>{detail.data.membership.map((period, index) => <li key={index}>{period.startedAt?.slice(0, 10) ?? t("unknownStart")} – {period.endedAt?.slice(0, 10) ?? t("current")}</li>)}</ul>
            <h5>{t("attendance")}</h5>
            <ul>{detail.data.attendance.map(mark => <li key={mark.date}>{mark.date} · {t(mark.state)}</li>)}</ul>
            <h5>{t("homework")}</h5>
            <ul>{detail.data.homework.map(work => <li key={work.assignment_id}>{work.assignment__title} · {work.status === "graded" ? `${work.score_percent}%` : t("pendingGrade")}</li>)}</ul>
            <h5>{t("exams")}</h5>
            <ul>{detail.data.tests.map(exam => <li key={exam.id}>{exam.test__title} · {exam.total_score ?? "—"}</li>)}
              {detail.data.mockExams.map(exam => <li key={exam.id}>{exam.exam__title} · {exam.overall_band ?? exam.overall_score ?? "—"}</li>)}
            </ul>
            {detail.data.feedback.length > 0 && <><h5>{t("feedback")}</h5><ul>
              {detail.data.feedback.map((row, index) => <li key={index}>{row.skill} · {row.final_score ?? "—"}{typeof row.approved_feedback === "string" && ` · ${row.approved_feedback}`}</li>)}
            </ul></>}
          </div>}
        </section>
      </CardContent>
    </Card>
  );
}
