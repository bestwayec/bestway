"use client";

import * as React from "react";
import { ArrowLeft, BellRing, Download, Eye, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { api, ApiError } from "@/lib/api-client";
import {
  formatDateTime,
  useGradeSubmission,
  useGroupHomework,
  useHomeworkResults,
  useRemindPending,
  useWorkspaceOverview,
  type HomeworkKind,
  type HomeworkStatus,
  type QuizResult,
  type ResultRow,
} from "@/lib/teacher-workspace";
import { cn } from "@/lib/utils";

const STATUS_VARIANT: Record<HomeworkStatus, "neutral" | "info" | "success" | "warning" | "danger" | "brand"> = {
  not_started: "neutral",
  in_progress: "info",
  submitted: "brand",
  awaiting_review: "warning",
  graded: "success",
  overdue: "danger",
};

export function StatusBadge({ status }: { status: HomeworkStatus }) {
  const t = useTranslations("tw");
  return <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>;
}

const when = formatDateTime;

/** /teacher/results — a group's homework list, or one assignment when ?kind=&id= are present. */
export function ResultsScreen() {
  const params = useSearchParams();
  const kind = params.get("kind") as HomeworkKind | null;
  const id = params.get("id");
  if (kind && id) return <HomeworkResultsView kind={kind} id={id} />;
  return <ResultsHome />;
}

function ResultsHome() {
  const t = useTranslations("tw");
  const params = useSearchParams();
  const router = useRouter();
  const overview = useWorkspaceOverview();
  const groups = overview.data?.groups ?? [];
  const groupId = params.get("group") ?? groups[0]?.id;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("res.title")} description={t("res.subtitle")} />
      {groups.length > 1 && (
        <div role="radiogroup" aria-label={t("att.chooseGroup")} className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {groups.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={g.id === groupId} onClick={() => router.replace(`/teacher/results?group=${g.id}`)}
              className={cn("min-h-11 shrink-0 rounded-control border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                g.id === groupId ? "border-brand bg-brand text-brand-fg" : "border-border-strong bg-surface text-fg hover:bg-surface-hover")}>
              {g.name}
            </button>
          ))}
        </div>
      )}
      {groupId ? <GroupHomeworkList groupId={groupId} /> : overview.isLoading ? <Skeleton className="h-64" /> : <EmptyState title={t("home.noGroups")} />}
    </div>
  );
}

export function GroupHomeworkList({ groupId }: { groupId: string }) {
  const t = useTranslations("tw");
  const q = useGroupHomework(groupId);
  if (q.isError) return <ErrorState title={t("common.loadError")} action={<Button variant="outline" size="sm" onClick={() => q.refetch()}>{t("common.retry")}</Button>} />;
  if (!q.data) return <Skeleton className="h-48" />;
  if (!q.data.length) {
    return <EmptyState title={t("res.none")} description={t("res.noneHint")} action={<Button asChild><Link href={`/teacher/assign?group=${groupId}`}>{t("home.action.assign")}</Link></Button>} />;
  }
  return (
    <ul className="grid gap-3" data-testid="hw-list">
      {q.data.map(({ assignment: a, counts, averagePercent }) => (
        <li key={`${a.kind}-${a.id}`}>
          <Link href={`/teacher/results?kind=${a.kind}&id=${a.id}`} className="block rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-fg">{a.title}</p>
                <p className="text-xs text-fg-muted">{t(`kind.${a.kind}`)} · {t("res.deadline")}: {when(a.deadline)}</p>
              </div>
              {a.closed ? <Badge variant="neutral">{t("res.closed")}</Badge> : <Badge variant="brand">{t("res.open")}</Badge>}
            </div>
            <p className="mt-2 text-sm text-fg">
              {t("res.line", { submitted: counts.submitted, assigned: counts.assigned })}
              {counts.awaitingReview > 0 && <span className="text-warning"> · {t("res.toReview", { n: counts.awaitingReview })}</span>}
              {averagePercent != null && <span className="text-fg-muted"> · {t("res.average")}: {averagePercent}%</span>}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function HomeworkResultsView({ kind, id }: { kind: HomeworkKind; id: string }) {
  const t = useTranslations("tw");
  const q = useHomeworkResults(kind, id);
  const remind = useRemindPending(kind, id);
  const [inspect, setInspect] = React.useState<ResultRow | null>(null);
  const data = q.data;

  if (q.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState title={q.error instanceof ApiError && q.error.status === 404 ? t("res.notFound") : t("common.loadError")}
          action={<Button asChild variant="outline" size="sm"><Link href="/teacher/results">{t("common.back")}</Link></Button>} />
      </div>
    );
  }
  if (!data) return <div className="mx-auto max-w-4xl"><Skeleton className="h-96" /></div>;
  const a = data.assignment;
  const c = data.counts;

  async function onRemind() {
    try {
      const r = await remind.mutateAsync();
      toast.success(t("res.reminded", { n: r.queued, pending: r.pending }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.saveError"));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href={`/teacher/results?group=${a.groupId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" />{t("res.backToGroup", { name: a.groupName })}
      </Link>
      <Card className="p-4">
        <p className="text-sm text-fg-muted">{t("res.group")}: <span className="font-medium text-fg">{a.groupName}</span></p>
        <h1 className="mt-1 text-xl font-bold text-fg">{a.title}</h1>
        <p className="text-sm text-fg-muted">{t(`kind.${a.kind}`)}{a.questionCount ? ` · ${t("hw.questions", { n: a.questionCount })}` : ""} · {t("res.deadline")}: {when(a.deadline)}</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="res-counts">
          {[
            [t("res.assigned"), c.assigned],
            [t("res.submitted"), c.submitted],
            [a.closed ? t("res.overdue") : t("res.pending"), a.closed ? c.overdue : c.pending],
            [t("res.average"), data.averagePercent != null ? `${data.averagePercent}%` : "—"],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-control bg-bg-subtle p-3">
              <dt className="text-xs text-fg-muted">{label}</dt>
              <dd className="text-2xl font-bold tabular-nums text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!a.closed && c.pending > 0 && (
            <Button variant="outline" onClick={onRemind} loading={remind.isPending}><BellRing />{t("res.remind")}</Button>
          )}
          {a.kind === "quiz" && (
            <Button variant="outline" asChild><a href={`/api/backend/v1/class-quiz-assignments/${a.id}/export`} download><Download />{t("res.export")}</a></Button>
          )}
          <Button variant="ghost" onClick={() => q.refetch()} aria-label={t("res.refresh")}><RefreshCw className={cn(q.isFetching && "animate-spin")} />{t("res.refresh")}</Button>
          <span className="text-xs text-fg-subtle">{t("res.updated", { time: formatDateTime(data.refreshedAt).slice(-5) })}</span>
        </div>
      </Card>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[560px] text-sm" data-testid="res-table">
          <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr><th className="p-3">{t("res.student")}</th><th className="p-3">{t("res.status")}</th><th className="p-3">{t("res.result")}</th><th className="p-3">{t("res.submittedAt")}</th><th className="p-3 text-right">{t("res.action")}</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.students.map((r) => (
              <tr key={r.studentId} className={cn(r.removed && "opacity-60")} data-testid="res-row">
                <td className="p-3 font-medium text-fg">{r.name}{r.removed && <span className="ml-1 text-xs font-normal text-fg-muted">({t("res.removed")})</span>}</td>
                <td className="p-3"><StatusBadge status={r.status} /></td>
                <td className="p-3 tabular-nums text-fg">
                  {r.percent != null ? `${r.percent}%` : "—"}
                  {r.correct != null && r.total != null && <span className="ml-1 text-xs text-fg-muted">({r.correct}/{r.total})</span>}
                </td>
                <td className="p-3 text-fg-muted">{when(r.submittedAt)}</td>
                <td className="p-3 text-right">
                  {a.kind === "quiz" && r.attemptId ? (
                    <Button size="sm" variant="outline" onClick={() => setInspect(r)}><Eye />{t("res.view")}</Button>
                  ) : a.kind === "exam" && r.attemptId ? (
                    <Button size="sm" variant="outline" asChild><Link href={`/mock/attempt/${r.attemptId}`}><Eye />{t("res.view")}</Link></Button>
                  ) : r.canGrade ? (
                    <GradeButton assignmentId={a.id} studentId={r.studentId} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inspect?.attemptId && <AttemptDialog attemptId={inspect.attemptId} name={inspect.name} onClose={() => setInspect(null)} />}
    </div>
  );
}

function GradeButton({ assignmentId, studentId }: { assignmentId: string; studentId: string }) {
  const t = useTranslations("tw");
  const grade = useGradeSubmission(assignmentId);
  const [value, setValue] = React.useState("");
  return (
    <form className="inline-flex items-center gap-1" onSubmit={(e) => {
      e.preventDefault();
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 100) { toast.error(t("res.gradeRange")); return; }
      grade.mutate({ student_id: studentId, score_percent: n }, { onSuccess: () => toast.success(t("res.graded")), onError: (er) => toast.error(er instanceof ApiError ? er.message : t("common.saveError")) });
    }}>
      <input aria-label={t("res.gradeLabel")} type="number" min={0} max={100} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 w-20 rounded-field border border-input-border bg-surface px-2 text-fg" />
      <Button size="sm" type="submit" loading={grade.isPending}>{t("res.grade")}</Button>
    </form>
  );
}

function AttemptDialog({ attemptId, name, onClose }: { attemptId: string; name: string; onClose: () => void }) {
  const t = useTranslations("tw");
  const [data, setData] = React.useState<QuizResult | null>(null);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    api.get<QuizResult>(`/class-quiz-attempts/${attemptId}/staff`).then((r) => live && setData(r)).catch(() => live && setError(true));
    return () => { live = false; };
  }, [attemptId]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{name}</DialogTitle></DialogHeader>
        <DialogBody className="pb-5">
        {error ? <p className="text-sm text-danger">{t("common.loadError")}</p> : !data ? <Skeleton className="h-40" /> : (
          <div className="space-y-3">
            <p className="text-sm text-fg">{t("res.score", { c: data.correct, n: data.total, p: data.percent })}</p>
            <h3 className="text-sm font-semibold text-fg">{t("res.mistakes", { n: (data.review ?? []).filter((r) => !r.isCorrect).length })}</h3>
            <ul className="space-y-2">
              {(data.review ?? []).filter((r) => !r.isCorrect).map((r) => (
                <li key={r.questionId} className="rounded-control border border-border p-3 text-sm">
                  <p className="font-medium text-fg">{r.index + 1}. {r.prompt}</p>
                  <p className="mt-1 text-danger">✗ {r.yourAnswer || t("res.noAnswer")}</p>
                  <p className="text-success">✓ {r.correctAnswer}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
