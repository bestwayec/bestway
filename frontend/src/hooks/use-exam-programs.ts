"use client";
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { isProgramDataKey } from '@/lib/program-cache';
import { programGate, needsProgramSelection, type ProgramGate } from '@/lib/program-gate';
import { useMe } from './use-me';
export type ExamProgram = 'IELTS' | 'MULTILEVEL';
export interface ProgramState { availablePrograms: ExamProgram[]; activeProgram: ExamProgram | null; accessPolicy?: 'SELF_SELECT' | 'STAFF_ASSIGNED' }
export function useExamPrograms(studentId?: string, enabled = true) {
  const me = useMe();
  return useQuery({ queryKey: ['exam-programs', studentId ?? 'mine', me.data?.user.id], queryFn: () => api.get<ProgramState>(studentId ? `/exam-programs/students/${studentId}` : '/exam-programs/mine'), enabled: enabled && (!!studentId || me.data?.user.role === 'student') });
}
export function useStudentProgramScope() {
  const me = useMe();
  const student = me.data?.user.role === 'student';
  const state = useExamPrograms(undefined, student);
  const switching = useIsMutating({ mutationKey: ['select-exam-program'] }) > 0;
  const gate: ProgramGate = programGate({
    signedIn: me.isSuccess,
    student,
    loaded: state.isSuccess,
    program: state.data?.activeProgram,
    accessPolicy: state.data?.accessPolicy,
    switching,
  });
  const program = gate === 'ready' ? state.data?.activeProgram ?? undefined : undefined;
  return {
    student,
    program,
    owner: me.data?.user.id ?? 'guest',
    ready: gate === 'ready' || gate === 'not-student',
    needsProgramSelection: needsProgramSelection(gate),
    accessPolicy: state.data?.accessPolicy ?? 'SELF_SELECT',
    state,
    switching,
    gate,
  };
}
export function useSetExamPrograms(studentId?: string) {
  const qc = useQueryClient();
  const me = useMe();
  return useMutation({ mutationKey: ['select-exam-program'], mutationFn: (state: ProgramState) => studentId
    ? api.put<ProgramState>(`/exam-programs/students/${studentId}`, state)
    : api.patch<ProgramState>('/exam-programs/mine', { program: state.activeProgram }),
    onMutate: async () => { if (!studentId) await qc.cancelQueries({ predicate: (q) => isProgramDataKey(q.queryKey) }); },
    onSuccess: async (saved) => {
      if (!studentId) {
        qc.removeQueries({ predicate: (q) => isProgramDataKey(q.queryKey) });
        qc.setQueryData(['exam-programs', 'mine', me.data?.user.id], saved);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['exam-programs'] }),
        qc.invalidateQueries({ queryKey: ['me'] }),
        qc.invalidateQueries({ predicate: (q) => isProgramDataKey(q.queryKey) }),
      ]);
    } });
}
