"use client";

import * as React from "react";
import { Check, ClipboardList, Copy, Plus, Send, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useCohortShareUrl } from "./TeacherCohortList";

export interface CohortAssignmentItem {
  id: string;
  title: string;
  lesson_id?: string | null;
  lesson_title?: string | null;
  exam_id?: string | null;
  exam_title?: string | null;
  deadline: string;
  min_pass_percent: number;
}

export interface StudentProgressRow {
  student_id: string;
  name: string;
  phone?: string;
  email?: string;
  joined_at: string;
  lessons_completed: number;
  total_submissions: number;
  passed_count: number;
  average_score: number;
  submissions: Record<
    string,
    {
      submitted: boolean;
      /** null while waiting for an exam result or the teacher's grade */
      score_percent: number | null;
      is_passed: boolean;
      status?: "graded" | "awaiting_result" | "awaiting_review";
      completed_at?: string;
    }
  >;
}

export interface CohortDetailData {
  cohort: {
    id: string;
    name: string;
    invite_code: string;
    description: string;
    teacher_name: string;
  };
  assignments: CohortAssignmentItem[];
  students: StudentProgressRow[];
}

interface CohortProgressTableProps {
  data: CohortDetailData;
  isLoading?: boolean;
  onOpenCreateAssignment: () => void;
  /** Called after the teacher saves a grade, to reload the matrix. */
  onGraded?: () => void;
}

/** The only place a non-exam homework gets its score: the teacher enters it. */
function GradeCell({ assignmentId, studentId, studentName, onGraded }: { assignmentId: string; studentId: string; studentName: string; onGraded?: () => void }) {
  const t = useTranslations("teacherWorkspace");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={t("gradeFor", { name: studentName })}>
        {t("grade")}
      </Button>
    );
  }
  const score = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(score) && score >= 0 && score <= 100;
  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await apiClient.post(`/teacher/assignments/${assignmentId}/grade`, { student_id: studentId, score_percent: score });
      toast.success(t("gradeSaved"));
      setOpen(false);
      onGraded?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("gradeSaveFailed"));
    } finally {
      setSaving(false);
    }
  };
  // Keyboard: Enter saves, Escape cancels.
  return (
    <div className="flex items-center justify-center gap-1">
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={100}
        inputMode="numeric"
        aria-label={t("gradeInputLabel", { name: studentName })}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key === "Escape") setOpen(false); }}
        className="h-10 w-16 rounded-control border border-input-border bg-surface px-2 text-center text-sm tabular-nums text-fg"
      />
      <Button type="button" size="sm" disabled={!valid} loading={saving} onClick={() => void save()}>
        {tc("save")}
      </Button>
    </div>
  );
}

export function CohortProgressTable({ data, isLoading, onOpenCreateAssignment, onGraded }: CohortProgressTableProps) {
  const t = useTranslations("teacherWorkspace");
  const shareUrl = useCohortShareUrl();
  const [copied, setCopied] = React.useState(false);
  const { cohort, assignments, students } = data;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(cohort.invite_code);
      setCopied(true);
      toast.success(t("codeCopied", { code: cohort.invite_code }));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const now = new Date();
  const statusBadge = (label: string, variant: "success" | "warning" | "danger" | "neutral" | "info") => <Badge variant={variant} size="sm" className="tabular-nums">{label}</Badge>;

  return (
    <section className="space-y-4" aria-labelledby="cohort-detail-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="cohort-detail-title" className="text-xl font-semibold text-fg">{cohort.name}</h2>
            <Badge variant="outline" className="font-mono">{t("codeLabel", { code: cohort.invite_code })}</Badge>
          </div>
          {cohort.description && <p className="text-sm text-fg-muted">{cohort.description}</p>}
          <p className="flex flex-wrap items-center gap-4 pt-1 text-sm text-fg-muted tabular-nums">
            <span className="flex items-center gap-1"><Users className="size-4 text-fg-subtle" aria-hidden />{t("studentsCount", { count: students.length })}</span>
            <span className="flex items-center gap-1"><ClipboardList className="size-4 text-fg-subtle" aria-hidden />{t("assignmentsCount", { count: assignments.length })}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => void copyCode()}>
            {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
            {copied ? t("copied") : t("copyCode")}
          </Button>
          <a href={shareUrl(cohort.name, cohort.invite_code)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg">
            <Send className="size-4" aria-hidden />
            {t("shareTelegram")}
          </a>
          <Button onClick={onOpenCreateAssignment}>
            <Plus aria-hidden />
            {t("newAssignment")}
          </Button>
        </div>
      </div>

      {students.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("noStudentsTitle")}
          description={t("noStudentsBody", { code: cohort.invite_code })}
          action={<Button variant="outline" onClick={() => void copyCode()}><Copy aria-hidden />{t("copyCode")}</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky-col min-w-44 bg-bg-subtle">{t("colStudent")}</TableHead>
              <TableHead numeric>{t("colLessons")}</TableHead>
              <TableHead numeric>{t("colAverage")}</TableHead>
              {assignments.map((a) => (
                <TableHead key={a.id} className="min-w-36 text-center">
                  <span className="block max-w-44 truncate text-fg" title={a.title}>{a.title}</span>
                  <span className="block text-sm font-normal text-fg-subtle">{t("dueBy", { date: new Date(a.deadline).toLocaleDateString(), percent: a.min_pass_percent })}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <TableRow key={student.student_id}>
                <TableCell className="sticky-col bg-surface">
                  <div className="font-medium text-fg">{student.name}</div>
                  <div className="font-mono text-sm text-fg-muted">{student.phone || student.email || "—"}</div>
                </TableCell>
                <TableCell numeric>
                  {student.lessons_completed}<span className="text-fg-muted"> / 29</span>
                </TableCell>
                <TableCell numeric>
                  {student.total_submissions > 0 ? (
                    <span className={cn("font-semibold", student.average_score >= 80 ? "text-success" : student.average_score >= 60 ? "text-warning" : "text-danger")}>{student.average_score}%</span>
                  ) : <span className="text-fg-subtle">—</span>}
                </TableCell>
                {assignments.map((a) => {
                  const sub = student.submissions[a.id];
                  const isOverdue = !sub && new Date(a.deadline) < now;
                  let cell: React.ReactNode;
                  if (sub && sub.is_passed) cell = statusBadge(t("passed", { percent: sub.score_percent ?? 0 }), "success");
                  else if (sub && sub.status === "awaiting_review") cell = <GradeCell assignmentId={a.id} studentId={student.student_id} studentName={student.name} onGraded={onGraded} />;
                  else if (sub && sub.status === "awaiting_result") cell = statusBadge(t("awaitingResult"), "neutral");
                  else if (sub && !sub.is_passed) cell = statusBadge(t("notPassed", { percent: sub.score_percent ?? 0 }), "warning");
                  else if (isOverdue) cell = statusBadge(t("notSubmitted"), "danger");
                  else cell = statusBadge(t("pending"), "info");
                  return <TableCell key={a.id} className="text-center">{cell}</TableCell>;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
