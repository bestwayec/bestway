export const PROGRAM_DATA_KEYS = new Set([
  'tests', 'test', 'my-attempts', 'attempt', 'mock-exams', 'mock-exam',
  'mock-attempts-mine', 'mock-attempt', 'attempt-assessments', 'dashboard',
  'student-analytics', 'recent-activity', 'assessment-history',
]);

export function isProgramDataKey(key: readonly unknown[]): boolean {
  return typeof key[0] === 'string' && PROGRAM_DATA_KEYS.has(key[0]);
}
