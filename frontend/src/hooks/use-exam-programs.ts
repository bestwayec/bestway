"use client";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
export type ExamProgram = 'IELTS' | 'MULTILEVEL';
export interface ProgramState { availablePrograms: ExamProgram[]; activeProgram: ExamProgram | null }
export function useExamPrograms(studentId?: string, enabled = true) {
  return useQuery({ queryKey: ['exam-programs', studentId ?? 'mine'], queryFn: () => api.get<ProgramState>(studentId ? `/exam-programs/students/${studentId}` : '/exam-programs/mine'), enabled });
}
export function useSetExamPrograms(studentId?: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (state: ProgramState) => studentId
    ? api.put<ProgramState>(`/exam-programs/students/${studentId}`, state)
    : api.patch<ProgramState>('/exam-programs/mine', { program: state.activeProgram }),
    onSuccess: async () => { await Promise.all(['exam-programs','mock-exams','mock-exam','mock-attempts-mine'].map((key) => qc.invalidateQueries({ queryKey: [key] }))); } });
}
