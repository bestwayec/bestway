"use client";

import * as React from "react";
import { BookA, ClipboardList, FileText, GraduationCap, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/workspace/homework-results";
import { api, ApiError } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { formatDateTime, useStudentHomework, type StudentHomeworkItem } from "@/lib/teacher-workspace";

const ICON = { quiz: ClipboardList, vocabulary: BookA, exam: GraduationCap, lesson: FileText } as const;

export function MyHomework() {
  const t = useTranslations("tw");
  const q = useStudentHomework();
  const items = q.data ?? [];
  const open = items.filter((i) => ["not_started", "in_progress"].includes(i.status));
  const rest = items.filter((i) => !["not_started", "in_progress"].includes(i.status));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("my.title")} description={t("my.subtitle")} />
      {q.isError ? (
        <ErrorState title={t("common.loadError")} action={<Button variant="outline" size="sm" onClick={() => q.refetch()}>{t("common.retry")}</Button>} />
      ) : q.isLoading ? (
        <div className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("my.none")} description={t("my.noneHint")} />
      ) : (
        <div className="space-y-6">
          {open.length > 0 && <Section title={t("my.todo", { n: open.length })} items={open} />}
          {rest.length > 0 && <Section title={t("my.done")} items={rest} />}
        </div>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: StudentHomeworkItem[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">{title}</h2>
      <ul className="grid gap-3" data-testid="my-homework">
        {items.map((i) => <HomeworkCard key={`${i.kind}-${i.id}`} item={i} />)}
      </ul>
    </section>
  );
}

function HomeworkCard({ item }: { item: StudentHomeworkItem }) {
  const t = useTranslations("tw");
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const Icon = ICON[item.kind];
  const deadline = new Date(item.deadline);
  const soon = item.status === "not_started" && deadline.getTime() - Date.now() < 86_400_000;

  async function openExam() {
    setBusy(true);
    try {
      const exam = await api.get<{ id: string }>(`/student/assignments/${encodeURIComponent(item.id)}/exam`);
      router.push(`/mock/${encodeURIComponent(exam.id)}?assignment=${encodeURIComponent(item.id)}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.loadError"));
    } finally {
      setBusy(false);
    }
  }

  async function submitLesson() {
    setBusy(true);
    try {
      await api.post(`/student/assignments/${encodeURIComponent(item.id)}/submit`, {});
      toast.success(t("my.submitted"));
      await qc.invalidateQueries({ queryKey: ["student", "homework"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setBusy(false);
    }
  }

  let action: React.ReactNode = null;
  if (item.status === "graded" || item.status === "awaiting_review" || item.status === "submitted") {
    if (item.href && item.kind !== "lesson") action = <Button asChild variant="outline" size="sm"><Link href={item.href}>{t("my.viewResult")}</Link></Button>;
    if (item.kind === "quiz" && item.canStart && item.attemptsLeft) action = <Button asChild size="sm"><Link href={item.href ?? "#"}><Play />{t("my.retry")}</Link></Button>;
  } else if (item.status === "in_progress") {
    action = <Button asChild size="sm"><Link href={item.href ?? "#"}><Play />{t("my.continue")}</Link></Button>;
  } else if (item.status === "not_started") {
    if (item.kind === "exam") action = item.canStart ? <Button size="sm" onClick={openExam} loading={busy}><Play />{t("my.start")}</Button> : null;
    else if (item.kind === "lesson") action = (
      <span className="flex flex-wrap gap-2">
        {item.href && <Button asChild variant="outline" size="sm"><Link href={item.href}>{t("my.openLesson")}</Link></Button>}
        <Button size="sm" onClick={submitLesson} loading={busy}>{t("my.markDone")}</Button>
      </span>
    );
    else if (item.href) action = <Button asChild size="sm"><Link href={item.href}><Play />{t("my.start")}</Link></Button>;
  }

  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="hw-card" data-kind={item.kind}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand-subtle"><Icon className="size-5 text-brand" aria-hidden /></span>
          <div className="min-w-0">
            <p className="font-semibold text-fg">{item.title}</p>
            <p className="text-xs text-fg-muted">{t(`kind.${item.kind}`)} · {item.groupName}{item.teacherName ? ` · ${item.teacherName}` : ""}</p>
            <p className={soon ? "text-xs font-medium text-warning" : "text-xs text-fg-muted"}>
              {t("res.deadline")}: {formatDateTime(deadline)}
              {item.questionCount ? ` · ${t("hw.questions", { n: item.questionCount })}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <StatusBadge status={item.status} />
          {item.percent != null && <span className="text-sm font-semibold tabular-nums text-fg" data-testid="hw-percent">{item.percent}%</span>}
          {action}
        </div>
      </Card>
    </li>
  );
}
