import type { ExamProgram } from '@/hooks/use-exam-programs';

export type ProgramGate = 'loading' | 'not-student' | 'ready' | 'needs-self-select' | 'needs-staff-assigned';

/**
 * Decides what a program-scoped student surface should render before querying:
 * a ready catalogue, a loading state, or an explicit onboarding state when the
 * student has no active exam track. No active track must never fall back to a
 * mixed IELTS + Multilevel catalogue.
 */
export function programGate(input: {
  signedIn: boolean;
  student: boolean;
  loaded: boolean;
  program?: ExamProgram | null;
  accessPolicy?: 'SELF_SELECT' | 'STAFF_ASSIGNED' | null;
  switching?: boolean;
}): ProgramGate {
  if (!input.signedIn) return 'loading';
  if (!input.student) return 'not-student';
  if (input.switching || !input.loaded) return 'loading';
  if (input.program) return 'ready';
  return input.accessPolicy === 'STAFF_ASSIGNED' ? 'needs-staff-assigned' : 'needs-self-select';
}

export function needsProgramSelection(gate: ProgramGate): boolean {
  return gate === 'needs-self-select' || gate === 'needs-staff-assigned';
}
