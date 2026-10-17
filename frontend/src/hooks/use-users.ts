"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { CreateUserInput, Role, UpdateUserInput, UserDetail, UserListItem } from "@/lib/types";

/** Qiymatni kechiktirib qaytaradi — qidiruvda har bosishda so'rov ketmasin */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** GET /users?role=&search= */
export function useUsersList(role: Role | undefined, search = "", groupId?: string) {
  return useQuery({
    queryKey: ["users", role ?? "all", search, groupId ?? null],
    queryFn: () =>
      api.get<UserListItem[]>("/users", {
        role,
        search: search || undefined,
        groupId,
        limit: 100,
      }),
    placeholderData: (prev) => prev,
  });
}

export function useStudents(search: string) {
  return useUsersList("student", search);
}

/** O'qituvchilar ro'yxati (guruhga biriktirish uchun) */
export function useTeachers(enabled = true) {
  return useQuery({
    queryKey: ["users", "teacher", "", null],
    queryFn: () => api.get<UserListItem[]>("/users", { role: "teacher", limit: 100 }),
    staleTime: 60_000,
    enabled,
  });
}

/** GET /users/:id — bitta foydalanuvchi tafsiloti */
export function useUserDetail(id?: string) {
  return useQuery({
    queryKey: ["user", id],
    queryFn: () => api.get<UserDetail>(`/users/${id}`),
    enabled: !!id,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<UserDetail>("/users", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) => api.patch<UserDetail>(`/users/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["user", id] });
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

/** PATCH /users/:id { isApproved: true } — tez tasdiqlash */
export function useApproveStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/users/${id}`, { isApproved: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
