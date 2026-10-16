"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { GroupDetail, GroupInput, GroupListItem } from "@/lib/types";

/** GET /groups — rolga qarab foydalanuvchining guruhlari */
export function useGroups() {
  return useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get<GroupListItem[]>("/groups"),
  });
}

/** GET /groups/:id — o'quvchilar va jadval bilan */
export function useGroupDetail(id?: string) {
  return useQuery({
    queryKey: ["group", id],
    queryFn: () => api.get<GroupDetail>(`/groups/${id}`),
    enabled: !!id,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GroupInput) => api.post<GroupDetail>("/groups", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });
}

export function useUpdateGroup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<GroupInput>) => api.patch<GroupDetail>(`/groups/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["group", id] });
    },
  });
}

export function useAddStudentToGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      api.post(`/groups/${groupId}/students`, { studentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group", groupId] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useRemoveStudentFromGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      api.delete(`/groups/${groupId}/students/${studentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group", groupId] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export interface GroupStudentAnalyticsRow {
  studentId: string;
  name: string;
  phone?: string;
  isActive?: boolean;
  completedExamsCount: number;
  writingScore: number | null;
  speakingScore: number | null;
  listeningScore: number | null;
  readingScore: number | null;
  overallBand: number | null;
}

export interface GroupAnalyticsData {
  groupId: string;
  groupName: string;
  teacherName?: string | null;
  averageBandScore: number | null;
  activeStudents: number;
  totalCompletedAttempts: number;
  students: GroupStudentAnalyticsRow[];
}

function toNumOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 10) / 10;
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return Math.round(parsed * 10) / 10;
  }
  return null;
}

export function useGroupAnalytics(groupId?: string) {
  return useQuery({
    queryKey: ["group-analytics", groupId],
    enabled: !!groupId,
    queryFn: async (): Promise<GroupAnalyticsData> => {
      // Try dedicated analytics endpoint first; fallback to composing from /groups/:id and /mock/attempts
      let rawAnalytics: Record<string, unknown> | null = null;
      try {
        rawAnalytics = await api.get<Record<string, unknown>>(`/groups/${groupId}/analytics`);
      } catch {
        rawAnalytics = null;
      }

      const groupDetail = await api
        .get<GroupDetail & Record<string, unknown>>(`/groups/${groupId}`)
        .catch(() => null);

      const rawStudentsList = Array.isArray(rawAnalytics?.students)
        ? (rawAnalytics.students as Record<string, unknown>[])
        : Array.isArray(groupDetail?.students)
          ? (groupDetail.students as unknown as Record<string, unknown>[])
          : [];

      // If student analytics aren't pre-populated on rawAnalytics, enrich from /mock/attempts
      const hasPrecomputedScores =
        rawAnalytics !== null &&
        rawStudentsList.some(
          (s) =>
            s.completedExamsCount !== undefined ||
            s.writingScore !== undefined ||
            s.overallBand !== undefined,
        );

      let attemptsByStudent = new Map<
        string,
        {
          completedCount: number;
          writing: number[];
          speaking: number[];
          listening: number[];
          reading: number[];
          overall: number[];
        }
      >();

      if (!hasPrecomputedScores) {
        try {
          const attempts = await api.get<Array<Record<string, unknown>>>("/mock/attempts");
          for (const att of attempts ?? []) {
            const stId = String(att.studentId ?? att.userId ?? "");
            if (!stId) continue;
            const status = String(att.status ?? "");
            if (status !== "completed" && status !== "grading") continue;
            const entry = attemptsByStudent.get(stId) ?? {
              completedCount: 0,
              writing: [],
              speaking: [],
              listening: [],
              reading: [],
              overall: [],
            };
            entry.completedCount += 1;
            const w = toNumOrNull(att.writingBand ?? att.writingScore);
            const s = toNumOrNull(att.speakingBand ?? att.speakingScore);
            const l = toNumOrNull(att.listeningBand ?? att.listeningScore);
            const r = toNumOrNull(att.readingBand ?? att.readingScore);
            const o = toNumOrNull(att.overallBand ?? att.totalScore ?? att.bandScore);
            if (w !== null) entry.writing.push(w);
            if (s !== null) entry.speaking.push(s);
            if (l !== null) entry.listening.push(l);
            if (r !== null) entry.reading.push(r);
            if (o !== null) entry.overall.push(o);
            attemptsByStudent.set(stId, entry);
          }
        } catch {
          attemptsByStudent = new Map();
        }
      }

      const avgArr = (arr: number[]): number | null =>
        arr.length > 0
          ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
          : null;

      // Merge group detail students and analytics students
      const studentMap = new Map<string, GroupStudentAnalyticsRow>();
      for (const gs of groupDetail?.students ?? []) {
        const fallback = attemptsByStudent.get(gs.studentId);
        studentMap.set(gs.studentId, {
          studentId: gs.studentId,
          name: gs.name,
          phone: gs.phone,
          isActive: gs.isActive,
          completedExamsCount: fallback?.completedCount ?? 0,
          writingScore: fallback ? avgArr(fallback.writing) : null,
          speakingScore: fallback ? avgArr(fallback.speaking) : null,
          listeningScore: fallback ? avgArr(fallback.listening) : null,
          readingScore: fallback ? avgArr(fallback.reading) : null,
          overallBand: fallback ? avgArr(fallback.overall) : null,
        });
      }

      for (const rs of rawStudentsList) {
        const sid = String(rs.studentId ?? rs.id ?? "");
        if (!sid) continue;
        const prev = studentMap.get(sid);
        const fallback = attemptsByStudent.get(sid);
        const w = toNumOrNull(rs.writingScore ?? rs.writingBand) ?? prev?.writingScore ?? (fallback ? avgArr(fallback.writing) : null);
        const s = toNumOrNull(rs.speakingScore ?? rs.speakingBand) ?? prev?.speakingScore ?? (fallback ? avgArr(fallback.speaking) : null);
        const l = toNumOrNull(rs.listeningScore ?? rs.listeningBand) ?? prev?.listeningScore ?? (fallback ? avgArr(fallback.listening) : null);
        const r = toNumOrNull(rs.readingScore ?? rs.readingBand) ?? prev?.readingScore ?? (fallback ? avgArr(fallback.reading) : null);
        let overall =
          toNumOrNull(rs.overallBand ?? rs.overallScore ?? rs.averageBand) ??
          prev?.overallBand ??
          (fallback ? avgArr(fallback.overall) : null);

        if (overall === null) {
          const parts = [w, s, l, r].filter((x): x is number => x !== null);
          if (parts.length > 0) {
            overall = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10;
          }
        }

        const completedCount =
          typeof rs.completedExamsCount === "number"
            ? rs.completedExamsCount
            : typeof rs.attemptsCount === "number"
              ? rs.attemptsCount
              : (prev?.completedExamsCount ?? fallback?.completedCount ?? 0);

        studentMap.set(sid, {
          studentId: sid,
          name: String(rs.name ?? prev?.name ?? "O'quvchi"),
          phone: typeof rs.phone === "string" ? rs.phone : prev?.phone,
          isActive: typeof rs.isActive === "boolean" ? rs.isActive : (prev?.isActive ?? true),
          completedExamsCount: completedCount,
          writingScore: w,
          speakingScore: s,
          listeningScore: l,
          readingScore: r,
          overallBand: overall,
        });
      }

      const students = Array.from(studentMap.values());
      const scoredBands = students
        .map((st) => st.overallBand)
        .filter((b): b is number => b !== null);

      const computedAvgBand =
        scoredBands.length > 0
          ? Math.round((scoredBands.reduce((a, b) => a + b, 0) / scoredBands.length) * 10) / 10
          : null;

      const averageBandScore =
        toNumOrNull(rawAnalytics?.averageBandScore ?? rawAnalytics?.groupAverageBandScore ?? groupDetail?.averageBandScore) ??
        computedAvgBand;

      const activeStudents =
        typeof rawAnalytics?.activeStudents === "number"
          ? rawAnalytics.activeStudents
          : typeof rawAnalytics?.activeStudentsCount === "number"
            ? rawAnalytics.activeStudentsCount
            : students.filter((s) => s.isActive !== false).length;

      const totalCompletedAttempts =
        typeof rawAnalytics?.totalCompletedAttempts === "number"
          ? rawAnalytics.totalCompletedAttempts
          : typeof rawAnalytics?.completedAttemptsCount === "number"
            ? rawAnalytics.completedAttemptsCount
            : students.reduce((acc, s) => acc + s.completedExamsCount, 0);

      return {
        groupId: String(groupId),
        groupName: String(rawAnalytics?.groupName ?? groupDetail?.name ?? "Guruh"),
        teacherName: (rawAnalytics?.teacherName as string | null) ?? groupDetail?.teacherName ?? null,
        averageBandScore,
        activeStudents,
        totalCompletedAttempts,
        students,
      };
    },
  });
}

function sanitizeFileSlug(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "group"
  );
}

/**
 * Triggers GET /api/v1/groups/${groupId}/export/excel and downloads `group_${name}_${date}.xlsx`
 */
export async function downloadGroupExcel(groupId: string, groupName = "group"): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const defaultFilename = `group_${sanitizeFileSlug(groupName)}_${dateStr}.xlsx`;
  const { blob, filename } = await api.downloadBlob(`/api/v1/groups/${groupId}/export/excel`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportGroupAnalyticsCsv(analytics: GroupAnalyticsData): void {
  const dateStr = new Date().toISOString().slice(0, 10);
  const headers = [
    "#",
    "O'quvchi F.I.Sh.",
    "Topshirilgan imtihonlar soni",
    "Writing balli",
    "Speaking balli",
    "Listening balli",
    "Reading balli",
    "Umumiy ball (Overall Band)",
  ];
  const escapeCsv = (val: string | number | null | undefined) => {
    const s = val === null || val === undefined ? "—" : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = analytics.students.map((st, idx) =>
    [
      idx + 1,
      st.name,
      st.completedExamsCount,
      st.writingScore ?? "—",
      st.speakingScore ?? "—",
      st.listeningScore ?? "—",
      st.readingScore ?? "—",
      st.overallBand ?? "—",
    ]
      .map(escapeCsv)
      .join(","),
  );
  const csvContent = "\uFEFF" + [headers.map(escapeCsv).join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `group_${sanitizeFileSlug(analytics.groupName)}_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function printGroupAnalyticsPdf(analytics: GroupAnalyticsData): void {
  const win = window.open("", "_blank", "width=960,height=720");
  if (!win) return;
  const dateStr = new Date().toLocaleDateString("uz-UZ");
  const rowsHtml = analytics.students
    .map(
      (st, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td style="font-weight:600">${st.name}</td>
        <td style="text-align:center">${st.completedExamsCount}</td>
        <td style="text-align:center">${st.writingScore ?? "—"}</td>
        <td style="text-align:center">${st.speakingScore ?? "—"}</td>
        <td style="text-align:center">${st.listeningScore ?? "—"} / ${st.readingScore ?? "—"}</td>
        <td style="text-align:center;font-weight:700">${st.overallBand ?? "—"}</td>
      </tr>`,
    )
    .join("");

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${analytics.groupName} — Guruh natijalari</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #0f172a; }
    h1 { margin: 0 0 6px; font-size: 20px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 16px; }
    .cards { display: flex; gap: 16px; margin-bottom: 18px; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; min-width: 140px; }
    .card-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
    .card-val { font-size: 18px; font-weight: 700; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
  </style>
</head>
<body>
  <h1>${analytics.groupName} — Guruh tahlili va natijalar</h1>
  <div class="meta">O'qituvchi: ${analytics.teacherName ?? "—"} · Sana: ${dateStr}</div>
  <div class="cards">
    <div class="card">
      <div class="card-label">Guruh O'rtacha Balli</div>
      <div class="card-val">${analytics.averageBandScore ?? "—"}</div>
    </div>
    <div class="card">
      <div class="card-label">Faol o'quvchilar</div>
      <div class="card-val">${analytics.activeStudents}</div>
    </div>
    <div class="card">
      <div class="card-label">Topshirilgan imtihonlar</div>
      <div class="card-val">${analytics.totalCompletedAttempts}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>O'quvchi F.I.Sh.</th>
        <th style="text-align:center">Imtihonlar soni</th>
        <th style="text-align:center">Writing</th>
        <th style="text-align:center">Speaking</th>
        <th style="text-align:center">Listening / Reading</th>
        <th style="text-align:center">Umumiy ball</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`);
  win.document.close();
}

