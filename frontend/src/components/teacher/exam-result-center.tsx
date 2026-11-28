"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ArrowDownUp, FileSpreadsheet, FileText, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { GroupExamProgress, StudentExamProgress } from "./exam-progress-charts";

import { completionRate, isStale, MEDALS, overallCell, scoreCell, SKILLS, SORTS, tashkent, type ExamReport, type ExamReportRow } from "./exam-result-helpers";

export type { ExamReport, ExamReportRow } from "./exam-result-helpers";
export { completionRate, isStale, overallCell, scoreCell } from "./exam-result-helpers";

function remaining(deadline: string, now: number) {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function StatusBadge({ row }: { row: ExamReportRow }) {
  const t = useTranslations("examResultCenter");
  const part = row.participation;
  if (part === "not_started" || part === "not_submitted") return <Badge size="sm" variant="outline">{t(`participation.${part}`)}</Badge>;
  if (part === "in_progress") return <Badge size="sm" variant="info">{t("participation.in_progress")}</Badge>;
  const variant = row.grading === "finalized" ? "success" : row.grading === "partially_graded" ? "brand" : "warning";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge size="sm" variant={variant}>{t(`grading.${row.grading}`)}</Badge>
      {part === "auto_submitted" && <Badge size="sm" variant="neutral">{t("autoShort")}</Badge>}
    </span>
  );
}

export function ExamResultCenter({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("examResultCenter");
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [grading, setGrading] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]>("rank");
  const [student, setStudent] = useState("");
  const path = `/teacher/exam-assignments/${encodeURIComponent(assignmentId)}/results`;
  const report = useQuery({
    queryKey: ["exam-result-center", assignmentId, page, search, grading, sort],
    queryFn: () => api.get<ExamReport>(path, { page, limit: 50, sort, ...(search ? { search } : {}), ...(grading ? { grading } : {}) }),
    // Server-derived counts refresh on their own while the exam runs; paused in a hidden tab.
    refetchInterval: query => (query.state.data?.stage === "final" ? false : 20_000),
    refetchIntervalInBackground: false,
  });
  const resend = useMutation({ mutationFn: () => api.post<{ queued: number }>(`${path}/resend`, { confirm: true }) });
  const data = report.data;

  if (report.isPending) return <p role="status" className="p-4">{t("loading")}</p>;
  if (report.isError || !data) return <p role="alert" className="p-4">{t("failed")} <Button size="sm" onClick={() => void report.refetch()}>{t("retry")}</Button></p>;
  const c = data.counts;
  const now = new Date(data.generatedAt).getTime();
  const left = data.stage === "open" ? remaining(data.deadline, now) : null;
  const rate = completionRate(c);
  const pages = Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit));
  const stageVariant = data.stage === "final" ? "success" : data.stage === "preliminary" ? "warning" : "info";
  const openRow = (row: ExamReportRow) => {
    if (row.attemptId && row.participation !== "in_progress") router.push(`/mock/attempt/${encodeURIComponent(row.attemptId)}`);
  };

  return (
    <div className="space-y-4">
      <header className="rounded-card border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg-muted">{data.groupName} · {t(data.timingPolicy === "fixed_close" ? "fixedClose" : "individual")}</p>
            <h1 className="mt-0.5 text-xl font-semibold leading-tight text-fg sm:text-2xl">{data.examTitle}</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {data.opensAt ? `${t("opens", { when: tashkent(data.opensAt) })} · ` : ""}{t("closes", { when: tashkent(data.deadline) })}
            </p>
          </div>
          <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5">
            <Badge data-testid="report-stage" variant={stageVariant}>{t(`stage.${data.stage}`)}</Badge>
            {left && <span className="text-sm font-semibold tabular-nums text-fg" data-testid="time-left">{t("timeLeft", { left })}</span>}
            <span className="text-xs text-fg-subtle">{t("updated", { when: tashkent(data.generatedAt) })}</span>
          </div>
        </div>
      </header>

      <section aria-label={t("overview")} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={t("counts.eligible")} value={c.eligible} hint={t("startedHint", { n: c.eligible - c.notStarted - c.notSubmitted })} />
        <StatTile label={t("counts.submitted")} value={c.handedIn} hint={t("autoHint", { n: c.autoSubmitted })} />
        <StatTile label={t("counts.inProgress")} value={c.inProgress} />
        <StatTile label={t("counts.awaitingGrading")} value={c.awaitingGrading} />
        <StatTile label={t("counts.finalized")} value={c.finalized} />
        <StatTile label={t("counts.notSubmitted")} value={c.notSubmitted + c.notStarted} hint={data.stage === "open" ? t("notYet") : undefined} />
        <StatTile label={t("average")} value={data.stats.average === null ? "—" : data.scale === "ielts" ? data.stats.average.toFixed(2) : data.stats.average} hint={data.stats.average === null ? t("unavailable") : t("sample", { n: data.stats.sample })} />
        <StatTile label={t("completion")} value={rate === null ? "—" : `${rate}%`} />
      </section>

      {data.stage === "open" && <LiveMonitor rows={data.rows} now={now} />}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{t("gradebook")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><a href={`/api/backend${path}/excel`} download><FileSpreadsheet />Excel</a></Button>
            <Button asChild variant="outline" size="sm"><a href={`/api/backend${path}/pdf`} download><FileText />PDF</a></Button>
            <Button size="sm" variant="outline" disabled={data.stage === "open" || resend.isPending}
              onClick={() => { if (window.confirm(t("resendConfirm"))) resend.mutate(); }}><Send />{t("resend")}</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">{t("search")}<Input className="h-9 w-56" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} maxLength={100} /></label>
            <label className="grid gap-1 text-sm">{t("filter")}
              <select className="h-9 rounded-field border border-border bg-surface px-2 text-sm" value={grading} onChange={e => { setGrading(e.target.value); setPage(1); }}>
                <option value="">{t("all")}</option>
                {["finalized", "partially_graded", "awaiting_teacher_review", "awaiting_assessment", "none"].map(g => <option key={g} value={g}>{t(`grading.${g}`)}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm"><span className="inline-flex items-center gap-1"><ArrowDownUp className="size-3.5" aria-hidden />{t("sort")}</span>
              <select className="h-9 rounded-field border border-border bg-surface px-2 text-sm" value={sort} onChange={e => { setSort(e.target.value as (typeof SORTS)[number]); setPage(1); }}>
                {SORTS.map(s => <option key={s} value={s}>{t(`sorts.${s}`)}</option>)}
              </select>
            </label>
            {resend.isSuccess && <span role="status" className="text-sm text-success">{t("resendQueued", { count: resend.data.queued })}</span>}
            {resend.isError && <span role="alert" className="text-sm text-danger">{t("failed")}</span>}
          </div>
          <Table wrapperClassName="max-h-[70vh] overflow-auto rounded-field border border-border" className="text-sm">
            <TableHeader className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--border)]"><TableRow>
              <TableHead className="w-14">{t("rank")}</TableHead><TableHead className="min-w-44">{t("student")}</TableHead>
              {SKILLS.map(s => <TableHead key={s} numeric title={t(`skillFull.${s}`)}>{t(`skill.${s}`)}</TableHead>)}
              <TableHead numeric>{t("overall")}</TableHead><TableHead numeric>{t("growth")}</TableHead>
              <TableHead className="min-w-40">{t("status")}</TableHead><TableHead>{t("details")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.rows.map(row => {
                const clickable = Boolean(row.attemptId) && row.participation !== "in_progress";
                return (
                  <TableRow key={row.studentId} data-testid="result-row" className={cn(clickable && "cursor-pointer")} onClick={() => openRow(row)}>
                    <TableCell className="font-semibold tabular-nums">{row.rank ? <span>{MEDALS[row.rank] ? <span aria-hidden className="mr-1">{MEDALS[row.rank]}</span> : null}{row.rank}</span> : "—"}</TableCell>
                    <TableCell>
                      <button type="button" className="text-left font-medium text-fg underline-offset-2 hover:underline" aria-expanded={student === row.studentId}
                        onClick={e => { e.stopPropagation(); setStudent(student === row.studentId ? "" : row.studentId); }}>{row.name}</button>
                      {row.submittedAt && <span className="block text-xs text-fg-subtle">{tashkent(row.submittedAt)}</span>}
                    </TableCell>
                    {SKILLS.map(s => {
                      const v = scoreCell(row, s, t("pendingShort"), data.scale);
                      return <TableCell key={s} numeric className={cn(v === t("pendingShort") && "text-xs font-medium text-warning")} title={v === t("pendingShort") ? t("pending") : undefined}>{v}</TableCell>;
                    })}
                    <TableCell numeric className="font-semibold">{overallCell(row, t("pendingShort"), data.scale)}{row.cefr ? <span className="ml-1 text-xs font-normal text-fg-muted">{row.cefr}</span> : null}</TableCell>
                    <TableCell numeric className={cn(row.growth !== null && row.growth > 0 && "text-success", row.growth !== null && row.growth < 0 && "text-danger")}>
                      {row.growth === null ? "—" : row.growth > 0 ? `▲ +${row.growth}` : row.growth < 0 ? `▼ ${row.growth}` : "0"}
                    </TableCell>
                    <TableCell><StatusBadge row={row} /></TableCell>
                    <TableCell>{clickable && row.attemptId
                      ? <Link onClick={e => e.stopPropagation()} className="text-brand underline-offset-2 hover:underline" href={`/mock/attempt/${encodeURIComponent(row.attemptId)}`}>{t("open")}</Link>
                      : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("previous")}</Button>
              <span className="text-sm tabular-nums">{page}/{pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("next")}</Button>
            </div>
            <p className="text-xs text-fg-muted">{t("tieNote")}</p>
          </div>
          {student && data.groupId && <StudentExamProgress groupId={data.groupId} studentId={student} track={data.scale === "multilevel" ? "multilevel" : "ielts"} />}
          <DeliveryStatus delivery={data.delivery} />
        </CardContent>
      </Card>

      {data.groupId && data.scale !== "raw" && <Card id="progress"><CardContent className="pt-5">
        <GroupExamProgress groupId={data.groupId} track={data.scale === "multilevel" ? "multilevel" : "ielts"} />
      </CardContent></Card>}
    </div>
  );
}

function DeliveryStatus({ delivery }: { delivery: ExamReport["delivery"] }) {
  const t = useTranslations("examResultCenter");
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-fg-muted" data-testid="delivery-status">
      <span className="font-semibold text-fg">{t("telegram")}</span>
      <Badge size="sm" variant={delivery.preliminaryAt ? "success" : "outline"}>{t("prelimDelivery", { when: delivery.preliminaryAt ? tashkent(delivery.preliminaryAt) : "—" })}</Badge>
      <Badge size="sm" variant={delivery.finalAt ? "success" : "outline"}>{t("finalDelivery", { when: delivery.finalAt ? tashkent(delivery.finalAt) : "—" })}{delivery.finalVersion > 1 ? ` · v${delivery.finalVersion}` : ""}</Badge>
      {delivery.messages.slice(0, 3).map((m, i) => (
        <Badge key={i} size="sm" variant={m.status === "sent" ? "success" : m.status === "failed" || m.status === "dead" ? "danger" : "neutral"}>
          {m.key}: {t.has(`deliveryState.${m.status}`) ? t(`deliveryState.${m.status}`) : m.status}{m.error ? ` (${m.error})` : ""}
        </Badge>
      ))}
    </div>
  );
}

function LiveMonitor({ rows, now }: { rows: ExamReportRow[]; now: number }) {
  const t = useTranslations("examResultCenter");
  const running = rows.filter(r => r.participation === "in_progress" && r.monitor);
  return (
    <Card data-testid="live-monitor">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2"><RefreshCw className="size-4 text-brand" aria-hidden />{t("monitor")}</CardTitle>
        <span className="text-xs text-fg-muted">{t("monitorNote")}</span>
      </CardHeader>
      <CardContent>
        {running.length === 0 ? <p className="text-sm text-fg-muted">{t("monitorEmpty")}</p> : (
          <Table wrapperClassName="overflow-x-auto" className="text-sm">
            <TableHeader><TableRow><TableHead>{t("student")}</TableHead><TableHead>{t("currentSkill")}</TableHead><TableHead numeric>{t("confirmed")}</TableHead>
              <TableHead>{t("lastConfirmed")}</TableHead><TableHead>{t("connection")}</TableHead><TableHead numeric>{t("incidents")}</TableHead></TableRow></TableHeader>
            <TableBody>{running.map(r => {
              const stale = isStale(r.monitor?.lastConfirmedAt ?? null, now);
              return (
                <TableRow key={r.studentId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="capitalize">{r.monitor?.currentSkill ?? "—"}</TableCell>
                  <TableCell numeric>{r.monitor?.confirmedAnswers ?? 0}</TableCell>
                  <TableCell>{r.monitor?.lastConfirmedAt ? tashkent(r.monitor.lastConfirmedAt) : "—"}</TableCell>
                  <TableCell><Badge size="sm" variant={stale ? "warning" : "success"}>{t(stale ? "stale" : "active")}</Badge></TableCell>
                  <TableCell numeric>{r.monitor?.incidents ? <span className="inline-flex items-center gap-1 text-warning"><ShieldAlert className="size-3.5" aria-hidden />{r.monitor.incidents}</span> : 0}</TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

