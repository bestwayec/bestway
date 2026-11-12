/**
 * Owner decision 2026-11-12: show an IELTS band / Multilevel standard score or level only for a full section
 * (the official number of objective questions) or a full mock. Short or partial sets show the raw result.
 * Mirrors OFFICIAL_OBJECTIVE_QUESTIONS in backend-django/apps/core/mock_scoring.py; it also hides bands that
 * older attempts stored before the backend rule existed.
 */
export const OFFICIAL_OBJECTIVE_QUESTIONS = { ielts: 40, multilevel: 35 } as const;

export function examFamily(examType: string | null | undefined): keyof typeof OFFICIAL_OBJECTIVE_QUESTIONS | null {
  if (!examType) return null;
  if (examType.startsWith("ielts")) return "ielts";
  if (examType === "multilevel") return "multilevel";
  return null;
}

export function mayShowSectionBand(examType: string | null | undefined, skill: string, questionCount: number): boolean {
  if (skill !== "listening" && skill !== "reading") return true; // expert-graded skills follow their own rules
  const family = examFamily(examType);
  return family !== null && questionCount === OFFICIAL_OBJECTIVE_QUESTIONS[family];
}
