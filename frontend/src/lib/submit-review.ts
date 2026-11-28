/**
 * Data for the submission review: what is still unanswered or flagged in the sections the student may
 * still open, and the Writing / Speaking responses actually held (recordings only once the server has
 * them). Sections that are already closed are never listed, so the review cannot lead back into them.
 */
import type { MockQuestion, MockSection, MockSkill } from "@/lib/types";
import { multilevelQuestionAnswered } from "@/lib/multilevel-completeness";
import { objectiveNumberLabel, objectivePositionCount, selectedObjectiveOptions } from "@/lib/objective-question";

export type SubmitReviewItem = { id: string; label: string; section?: string; skill: MockSkill };
export type SubmitReview = {
  unanswered: SubmitReviewItem[];
  flagged: SubmitReviewItem[];
  writing: { required: number; done: number } | null;
  speaking: { required: number; done: number } | null;
};

function groupsOf(section: MockSection): Array<{ questions?: MockQuestion[] }> {
  return (section.groups || (section as unknown as { parts?: Array<{ questions?: MockQuestion[] }> }).parts || []) as Array<{ questions?: MockQuestion[] }>;
}

function complete(question: MockQuestion, answers: Record<string, string>, recordings: ReadonlySet<string>): boolean {
  const count = objectivePositionCount(question);
  if (count > 1) return new Set(selectedObjectiveOptions(answers[question.id] ?? "", question.options ?? [])).size >= count;
  return multilevelQuestionAnswered(question, answers, recordings);
}

export function submitReview(
  sections: MockSection[],
  openSkills: ReadonlySet<MockSkill>,
  answers: Record<string, string>,
  recordings: ReadonlySet<string>,
  flags: ReadonlySet<string>,
  sectionName: (section: MockSection) => string,
): SubmitReview {
  const review: SubmitReview = { unanswered: [], flagged: [], writing: null, speaking: null };
  for (const section of sections) {
    if (!openSkills.has(section.skill)) continue;
    for (const group of groupsOf(section)) {
      for (const question of group.questions ?? []) {
        const done = complete(question, answers, recordings);
        const item = { id: question.id, label: String(objectiveNumberLabel(question)), section: sectionName(section), skill: section.skill };
        if (section.skill === "writing" || section.skill === "speaking") {
          const key = section.skill;
          review[key] = review[key] ?? { required: 0, done: 0 };
          review[key]!.required += 1;
          if (done) review[key]!.done += 1;
          if (!done) review.unanswered.push(item);
        } else if (!done) review.unanswered.push(item);
        if (flags.has(question.id)) review.flagged.push(item);
      }
    }
  }
  return review;
}
