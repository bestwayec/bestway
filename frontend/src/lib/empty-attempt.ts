import type { MockAttemptDetail } from "@/lib/types";

/** True when the attempt holds no student work at all: no answer text, recording or handwriting page. */
export function isEmptyAttempt(attempt: Pick<MockAttemptDetail, "status" | "sections">): boolean {
  if (attempt.status === "in_progress") return false;
  const questions = (attempt.sections ?? []).flatMap((section) => (section.groups ?? []).flatMap((group) => group.questions ?? []));
  if (questions.length === 0) return false;
  return questions.every((question) => {
    const rubric = question.rubricScores as Record<string, unknown> | null | undefined;
    const handwriting = Boolean(rubric && (Array.isArray(rubric.imageKeys) ? rubric.imageKeys.length : Array.isArray(rubric.imageUrls) ? rubric.imageUrls.length : 0));
    return !(question.response ?? "").trim() && !question.hasAudio && !handwriting;
  });
}
