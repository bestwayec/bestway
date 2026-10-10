import type { MockAttemptDetail, MockExamDetail, MockExamListItem, MockPracticeSkill } from "./types";

export function availablePracticeSkills(exam: Pick<MockExamListItem, "type" | "practiceReady" | "practiceSkills">): MockPracticeSkill[] {
  if (exam.type !== "multilevel" || exam.practiceReady !== true) return [];
  return (["writing", "speaking"] as const).filter((skill) => exam.practiceSkills?.includes(skill));
}

/** An explicit practice attempt never renders or submits tasks outside its frozen scope. */
export function practiceExam(exam: MockExamDetail | undefined, attempt: Pick<MockAttemptDetail, "flowMode" | "practiceScope">): MockExamDetail | undefined {
  if (!exam || attempt.flowMode !== "partial_practice") return exam;
  const skills = new Set(attempt.practiceScope?.skills ?? []);
  const ids = new Set(attempt.practiceScope?.questionIds ?? []);
  const sections = exam.sections.filter((section) => skills.has(section.skill as MockPracticeSkill)).map((section) => ({
    ...section,
    groups: section.groups.map((group) => ({ ...group, questions: group.questions.filter((question) => ids.has(question.id)) }))
      .filter((group) => group.questions.length > 0),
  })).filter((section) => section.groups.length > 0);
  return { ...exam, sections, questionCount: sections.reduce((count, section) => count + section.groups.reduce((n, group) => n + group.questions.length, 0), 0) };
}
