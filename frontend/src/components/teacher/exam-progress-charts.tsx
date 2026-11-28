"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api-client";

type Skill = "listening" | "reading" | "writing" | "speaking";
type Point = { attemptId: string; examTitle: string; date: string; overall: number | null; skills: Record<Skill, number | null> };
type StudentProgress = {
  name: string; scale: "ielts" | "multilevel"; completed: number; finalized: number; participationRate: number | null; history: Point[];
  summary: { count: number; insufficientHistory: boolean; first?: number; previous?: number | null; latest?: number; best?: number;
    changeFromPrevious?: number | null; changeFromFirst?: number | null };
};
type GroupProgress = {
  history: Array<{ assignmentId: string; title: string; date: string; stage: string; eligible: number; handedIn: number; finalized: number;
    pending: number; completionRate: number | null; average: number | null; median: number | null; highest: number | null; sample: number;
    skills: Record<Skill, number | null> }>;
  improved: number; declined: number; mayNeedSupport: Array<{ studentId: string; name: string; growth: number }>;
};

// Distinct hues (not shades of one green) so lines stay identifiable in light and dark themes.
const COLORS: Record<Skill | "overall", string> = {
  overall: "var(--brand)", listening: "#0284c7", reading: "#7c3aed", writing: "#d97706", speaking: "#db2777",
};
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: "Asia/Tashkent", month: "short", day: "numeric" });

/** Chart rows keep missing scores as null so lines are never joined through a zero. */
export function chartRows(points: Point[]) {
  return points.map(p => ({ label: `${day(p.date)} · ${p.examTitle.slice(0, 18)}`, overall: p.overall, ...p.skills }));
}

function Chart({ rows, keys, max, labels }: { rows: Array<Record<string, string | number | null>>; keys: string[]; max: number; labels?: Record<string, string> }) {
  const t = useTranslations("examProgress");
  const colors: Record<string, string> = { ...COLORS, completion: "var(--brand)" };
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} />
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: "var(--fg-muted)" }} width={32} />
          <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
          <Legend />
          {keys.map(key => <Line key={key} dataKey={key} name={labels?.[key] ?? t(`series.${key}`)} stroke={colors[key]} strokeWidth={key === "overall" || key === "completion" ? 3 : 1.5}
            dot connectNulls={false} isAnimationActive={false} type="monotone" />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GroupExamProgress({ groupId, track }: { groupId: string; track: "ielts" | "multilevel" }) {
  const t = useTranslations("examProgress");
  const data = useQuery({ queryKey: ["group-exam-progress", groupId, track], queryFn: () => api.get<GroupProgress>(`/groups/${encodeURIComponent(groupId)}/exam-progress`, { track }) });
  if (data.isPending) return <p role="status">{t("loading")}</p>;
  if (data.isError) return <p role="alert">{t("failed")}</p>;
  const rows = data.data.history.map(h => ({ label: `${day(h.date)} · ${h.title.slice(0, 18)}`, overall: h.average, ...h.skills }));
  return (
    <section aria-labelledby="group-progress-title" className="space-y-2">
      <h3 id="group-progress-title" className="font-semibold">{t("groupTitle")}</h3>
      {data.data.history.length < 2 ? <p className="rounded-field border border-dashed border-border p-4 text-sm text-fg-muted">{t("insufficient")}</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <figure><figcaption className="mb-1 text-sm font-medium text-fg-muted">{t("averageChart")}</figcaption>
            <Chart rows={rows} keys={["overall", "listening", "reading", "writing", "speaking"]} max={track === "multilevel" ? 75 : 9} /></figure>
          <figure><figcaption className="mb-1 text-sm font-medium text-fg-muted">{t("participationChart")}</figcaption>
            <Chart rows={data.data.history.map(h => ({ label: `${day(h.date)} · ${h.title.slice(0, 18)}`, completion: h.completionRate }))}
              keys={["completion"]} max={100} labels={{ completion: t("completionSeries") }} /></figure>
        </div>
      )}
      <ul className="text-sm">
        {data.data.history.map(h => <li key={h.assignmentId}>{day(h.date)} · {h.title}: {t("groupLine", { avg: h.average ?? "—", median: h.median ?? "—", n: h.sample, eligible: h.eligible, rate: h.completionRate ?? "—", pending: h.pending })}</li>)}
      </ul>
      <p className="text-sm">{t("movement", { improved: data.data.improved, declined: data.data.declined })}</p>
      {data.data.mayNeedSupport.length > 0 && <p className="text-sm">{t("support")}: {data.data.mayNeedSupport.map(s => s.name).join(", ")}</p>}
      <p className="text-xs text-fg-muted">{t("caveat")}</p>
    </section>
  );
}

export function StudentExamProgress({ groupId, studentId, track }: { groupId: string; studentId: string; track: "ielts" | "multilevel" }) {
  const t = useTranslations("examProgress");
  const [skills, setSkills] = useState(true);
  const data = useQuery({ queryKey: ["student-exam-progress", groupId, studentId, track], queryFn: () =>
    api.get<StudentProgress>(`/groups/${encodeURIComponent(groupId)}/students/${encodeURIComponent(studentId)}/exam-progress`, { track }) });
  if (data.isPending) return <p role="status">{t("loading")}</p>;
  if (data.isError) return <p role="alert">{t("failed")}</p>;
  const s = data.data.summary;
  return (
    <section className="space-y-2 rounded-md border border-border p-3" aria-label={t("studentTitle", { name: data.data.name })}>
      <h3 className="font-semibold">{t("studentTitle", { name: data.data.name })}</h3>
      <p className="text-sm">{t("studentLine", { completed: data.data.completed, finalized: data.data.finalized, rate: data.data.participationRate ?? "—" })}</p>
      {s.insufficientHistory ? <p>{t("insufficient")}</p> : <>
        <p className="text-sm">{t("summary", { first: s.first ?? "—", previous: s.previous ?? "—", latest: s.latest ?? "—", best: s.best ?? "—",
          change: s.changeFromPrevious ?? "—", total: s.changeFromFirst ?? "—" })}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skills} onChange={e => setSkills(e.target.checked)} />{t("showSkills")}</label>
        <Chart rows={chartRows(data.data.history)} keys={skills ? ["overall", "listening", "reading", "writing", "speaking"] : ["overall"]} max={data.data.scale === "multilevel" ? 75 : 9} />
      </>}
      <p className="text-xs text-fg-muted">{t("caveat")}</p>
    </section>
  );
}
