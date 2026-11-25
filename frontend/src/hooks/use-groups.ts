"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { GroupDetail, GroupInput, GroupListItem } from "@/lib/types";

/** GET /groups — rolga qarab foydalanuvchining guruhlari */
export function useGroups(filters?: { archived: boolean; search: string }) {
  return useQuery({
    queryKey: filters ? ["groups", filters] : ["groups"],
    queryFn: () => api.get<GroupListItem[]>("/groups", filters),
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

function sanitizeFileSlug(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "group"
  );
}

/**
 * Download the classroom report as XLSX.
 */
export async function downloadGroupExcel(groupId: string, groupName = "group"): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const defaultFilename = `group_${sanitizeFileSlug(groupName)}_${dateStr}.xlsx`;
  const { blob, filename } = await api.downloadBlob(`/groups/${groupId}/report/excel`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
