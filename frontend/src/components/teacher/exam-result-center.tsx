"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";

type Skill = "listening" | "reading" | "writing" | "speaking";
export type ExamReportRow = {
  studentId: string; name: string; attemptId: string | null;
  participation: "not_started" | "in_progress" | "submitted" | "auto_submitted" | "not_submitted";
  grading: "none" | "awaiting_assessment" | "awaiting_teacher_review" | "partially_graded" | "finalized";
  scores: Record<Skill, number | null>; overall: number | null; cefr: string | null; rank: number | null;
  rawScore: number | null; rawMax: number | null; growth: number | null; pendingSkills: string[]; submittedAt: string | null;
};
export type ExamReport = {
  assignmentId: string; title: string; examTitle: string; groupName: string; scale: "ielts" | "multilevel" | "raw";
  stage: "open" | "preliminary" | "final"; deadline: string; opensAt: string | null; timingPolicy: string; generatedAt: string;
  counts: Record<"eligible" | "notStarted" | "inProgress" | "submitted" | "autoSubmitted" | "notSubmitted" | "handedIn" | "awaitingGrading" | "finalized", number>;
  stats: { average: number | null; median: number | null; highest: number | null; sample: number };
  rows: ExamReportRow[]; pagination: { page: number; limit: number; total: number };
  delivery: { preliminaryAt: string | null; finalAt: string | null; finalVersion: number; messages: Array<{ key: string; status: string; error: string | null }> };
};

const SKILLS: Skill[] = ["listening", "reading", "writing", "speaking"];
const tashkent = (iso: string) => new Date(iso).toLocaleString(undefined, { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" });

/** A pending subjective grade is a status, never a number: only server-confirmed values are shown. */
export function scoreCell(row: ExamReportRow, skill: Skill, pendingLabel: string): string {
  const value = row.scores[skill];
  if (value !== null) return String(value);
  return row.pendingSkills.includes(skill) ? pendingLabel : "—";
}

export function ExamResultCenter({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("examResultCenter");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [grading, setGrading] = useState("");
  const path = `/teacher/exam-assignments/${encodeURIComponent(assignmentId)}/results`;
  const report = useQuery({
    queryKey: ["exam-result-center", assignmentId, page, search, grading],
    queryFn: () => api.get<ExamReport>(path, { page, limit: 50, ...(search ? { search } : {}), ...(grading ? { grading } : {}) }),
    // Server-derived counts refresh on their own while the exam runs; paused in a hidden tab.
    refetchInterval: query => (query.state.data?.stage === "final" ? false : 20_000),
    refetchIntervalInBackground: false,
  });
  const resend = useMutation({ mutationFn: () => api.post<{ queued: number }>(`${path}/resend`, { confirm: true }) });
  const data = report.data;

  if (report.isPending) return <p role="status">{t("loading")}</p>;
  if (report.isError || !data) return <p role="alert">{t("failed")} <Button size="sm" onClick={() => void report.refetch()}>{t("retry")}</Button></p>;
  const c = data.counts;
  const tiles: Array<[string, number]> = [["eligible", c.eligible], ["notStarted", c.notStarted], ["inProgress", c.inProgress],
    ["submitted", c.submitted], ["autoSubmitted", c.autoSubmitted], ["awaitingGrading", c.awaitingGrading], ["finalized", c.finalized], ["notSubmitted", c.notSubmitted]];
  const pages = Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{data.examTitle} · {data.groupName}</CardTitle>
          <p className="text-sm text-fg-muted">
            <span data-testid="report-stage" className="mr-2 rounded bg-surface-muted px-2 py-0.5 font-semibold">{t(`stage.${data.stage}`)}</span>
            {t("closes", { when: tashkent(data.deadline) })} · {t(data.timingPolicy === "fixed_close" ? "fixedClose" : "individual")} · {t("updated", { when: tashkent(data.generatedAt) })}
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map(([key, value]) => (
              <div className="rounded-md border border-border p-2" key={key}>
                <dt className="text-xs text-fg-muted">{t(`counts.${key}`)}</dt><dd className="text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm">{t("average")}: <strong>{data.stats.average ?? t("unavailable")}</strong> (n={data.stats.sample}) · {t("tieNote")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">{t("search")}<Input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} maxLength={100} /></label>
            <label className="grid gap-1 text-sm">{t("filter")}
              <select className="rounded-md border border-border bg-surface p-2" value={grading} onChange={e => { setGrading(e.target.value); setPage(1); }}>
                <option value="">{t("all")}</option>
                {["finalized", "partially_graded", "awaiting_teacher_review", "awaiting_assessment", "none"].map(g => <option key={g} value={g}>{t(`grading.${g}`)}</option>)}
              </select>
            </label>
            <Button asChild variant="outline" size="sm"><a href={`/api/backend${path}/excel`} download>Excel</a></Button>
            <Button size="sm" variant="outline" disabled={data.stage === "open" || resend.isPending}
              onClick={() => { if (window.confirm(t("resendConfirm"))) resend.mutate(); }}>{t("resend")}</Button>
            {resend.isSuccess && <span role="status" className="text-sm">{t("resendQueued", { count: resend.data.queued })}</span>}
          </div>
          <Table wrapperClassName="overflow-x-auto">
            <TableHeader><TableRow>
              <TableHead>{t("rank")}</TableHead><TableHead>{t("student")}</TableHead>
              {SKILLS.map(s => <TableHead key={s} numeric>{t(`skill.${s}`)}</TableHead>)}
              <TableHead numeric>{t("overall")}</TableHead><TableHead numeric>{t("growth")}</TableHead><TableHead>{t("status")}</TableHead><TableHead>{t("submittedAt")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.rows.map(row => (
                <TableRow key={row.studentId} data-testid="result-row">
                  <TableCell>{row.rank ?? "—"}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  {SKILLS.map(s => <TableCell key={s} numeric>{scoreCell(row, s, t("pending"))}</TableCell>)}
                  <TableCell numeric>{row.overall ?? (row.grading === "finalized" ? "—" : t("pending"))}{row.cefr ? ` (${row.cefr})` : ""}</TableCell>
                  <TableCell numeric>{row.growth === null ? "—" : row.growth > 0 ? `+${row.growth}` : row.growth}</TableCell>
                  <TableCell>{t(`participation.${row.participation}`)}{row.participation !== "not_started" && row.participation !== "not_submitted" && row.participation !== "in_progress" ? ` · ${t(`grading.${row.grading}`)}` : ""}</TableCell>
                  <TableCell>{row.submittedAt ? tashkent(row.submittedAt) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("previous")}</Button>
            <span className="text-sm">{page}/{pages}</span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("next")}</Button>
          </div>
          <p className="text-xs text-fg-muted" data-testid="delivery-status">
            {t("delivery", { preliminary: data.delivery.preliminaryAt ? tashkent(data.delivery.preliminaryAt) : "—", final: data.delivery.finalAt ? tashkent(data.delivery.finalAt) : "—" })}
            {data.delivery.messages.slice(0, 3).map(m => ` · ${m.key}: ${m.status}${m.error ? ` (${m.error})` : ""}`).join("")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
