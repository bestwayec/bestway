"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { GroupLiveMonitoringData, LiveMonitoringStudent } from "@/lib/group-monitoring-types";

function normalizeStudent(raw: any): LiveMonitoringStudent | null {
  if (!raw) return null;
  const active = raw.activeAttempt;
  if (!active) {
    if (raw.attemptId) {
      // Already flat
      return raw as LiveMonitoringStudent;
    }
    // Student without active attempt
    return null;
  }
  return {
    studentId: raw.studentId || active.studentId || "",
    name: raw.name || "Talaba",
    phone: raw.phone,
    avatarUrl: raw.avatarUrl,
    attemptId: active.attemptId || active.id || "",
    examId: active.examId || "",
    examTitle: active.examTitle || "Mock Imtihon",
    currentSection: active.currentSkill || active.currentSection || "listening",
    startedAt: active.startedAt || new Date().toISOString(),
    timeActiveSeconds: active.timeActiveSeconds,
    antiCheatCount: active.antiCheatCount ?? (active.recentAnomalies?.length ?? 0),
    anomalies: (active.recentAnomalies || active.anomalies || []).map((ev: any) => ({
      event: ev.event,
      date: ev.createdAt || ev.date || new Date().toISOString(),
      details: ev.details,
    })),
  };
}

export function useGroupLiveMonitoring(groupId: string) {
  return useQuery({
    queryKey: ["group-live-monitoring", groupId],
    queryFn: async () => {
      try {
        const res = await api.get<any>(
          `/assessment/groups/${encodeURIComponent(groupId)}/live-monitoring`
        );
        let rawStudents: any[] = [];
        let groupName = "";
        if (Array.isArray(res)) {
          rawStudents = res;
        } else if (res && Array.isArray(res.students)) {
          rawStudents = res.students;
          groupName = res.groupName || "";
        }

        const students: LiveMonitoringStudent[] = [];
        for (const s of rawStudents) {
          const norm = normalizeStudent(s);
          if (norm) {
            students.push(norm);
          }
        }

        return {
          groupId,
          groupName,
          activeCount: students.length,
          students,
        } as GroupLiveMonitoringData;
      } catch {
        return {
          groupId,
          groupName: "",
          activeCount: 0,
          students: [],
        } as GroupLiveMonitoringData;
      }
    },
    enabled: !!groupId,
    refetchInterval: 5_000,
  });
}
