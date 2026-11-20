"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AttendanceRow, AttendanceState } from "@/lib/types";

function attendanceKey(groupId?: string, month?: string) {
  return ["attendance", groupId, month] as const;
}

/** GET /attendance?groupId=&month= — oylik yozuvlar (yassi ro'yxat) */
export function useAttendance(groupId?: string, month?: string) {
  return useQuery({
    queryKey: attendanceKey(groupId, month),
    queryFn: () => api.get<AttendanceRow[]>("/attendance", { groupId, month }),
    enabled: !!groupId,
  });
}

/** Bitta o'quvchining oylik davomati (tafsilot sahifasi uchun) — guruh + studentId */
export function useStudentAttendance(groupId?: string, studentId?: string, month?: string) {
  return useQuery({
    queryKey: ["student-attendance", groupId, studentId, month],
    queryFn: () => api.get<AttendanceRow[]>("/attendance", { groupId, studentId, month }),
    enabled: !!groupId && !!studentId,
  });
}

export interface AttendanceCellChange {
  studentId: string;
  date: string;
  state: AttendanceState;
}

/**
 * Bitta katakni saqlash — PUT /attendance/bulk bitta yozuv bilan (upsert).
 * Optimistik: keshni darhol yangilaymiz, xato bo'lsa ortga qaytaramiz.
 */
export function useSaveAttendanceCell(groupId: string, month: string) {
  const qc = useQueryClient();
  const key = attendanceKey(groupId, month);

  return useMutation({
    mutationFn: (v: AttendanceCellChange) =>
      api.put("/attendance/bulk", {
        groupId,
        date: v.date,
        records: [{ studentId: v.studentId, state: v.state }],
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AttendanceRow[]>(key);
      qc.setQueryData<AttendanceRow[]>(key, (old = []) => {
        const idx = old.findIndex((r) => r.studentId === v.studentId && r.date === v.date);
        if (idx >= 0) {
          const copy = old.slice();
          copy[idx] = { ...copy[idx], state: v.state };
          return copy;
        }
        return [...old, { studentId: v.studentId, date: v.date, state: v.state }];
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    // Server haqiqati bilan sinxronlash (masalan, tozalangan katak keshda qolib ketmasin)
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["attendance", "teacher-today"] });
    },
  });
}
