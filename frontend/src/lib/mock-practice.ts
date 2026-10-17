import type { MockAttemptDetail, MockExamDetail, MockExamListItem, MockPracticeSkill, MockSkill } from "./types";

const ALL_SKILLS: MockPracticeSkill[] = ["listening", "reading", "writing", "speaking"];

export function availablePracticeSkills(
  exam: Pick<MockExamListItem, "type" | "practiceReady" | "practiceSkills"> & {
    ready?: boolean;
    sections?: Array<{ skill: MockSkill | string }>;
  }
): MockPracticeSkill[] {
  if (exam.type === "multilevel" && exam.ready === false && exam.practiceReady !== true) {
    return [];
  }
  if (exam.type && exam.type !== "multilevel" && exam.ready === false) {
    return [];
  }
  if (exam.sections && exam.sections.length > 0) {
    const existing = new Set(exam.sections.map((section) => section.skill));
    return ALL_SKILLS.filter((skill) => existing.has(skill));
  }
  if (exam.practiceSkills && exam.practiceSkills.length > 0) {
    return ALL_SKILLS.filter((skill) => exam.practiceSkills?.includes(skill));
  }
  return [];
}

export function isPartialPractice(
  attempt: Pick<MockAttemptDetail, "flowMode" | "practiceScope"> & { isSingleSection?: boolean; singleSection?: string }
): boolean {
  return (
    attempt.flowMode === "partial_practice" ||
    attempt.flowMode === "single_skill" ||
    Boolean(attempt.isSingleSection) ||
    Boolean(attempt.singleSection) ||
    Boolean(attempt.practiceScope?.skills?.length)
  );
}

/** An explicit practice attempt never renders or submits tasks outside its frozen scope. */
export function practiceExam(
  exam: MockExamDetail | undefined,
  attempt: Pick<MockAttemptDetail, "flowMode" | "practiceScope"> & {
    isSingleSection?: boolean;
    singleSection?: string;
    sections?: Array<{ skill: MockSkill | string }>;
  }
): MockExamDetail | undefined {
  if (!exam) return undefined;
  if (!isPartialPractice(attempt)) return exam;

  // Single section practice takes precedence:
  const targetSkill =
    attempt.singleSection ||
    (attempt.practiceScope?.skills?.length === 1 ? attempt.practiceScope.skills[0] : null) ||
    (attempt.sections?.length === 1 ? attempt.sections[0].skill : null);

  if (targetSkill) {
    const ids = new Set(attempt.practiceScope?.questionIds ?? []);
    const sections = exam.sections
      .filter((section) => section.skill === targetSkill)
      .map((section) => ({
        ...section,
        groups: section.groups
          .map((group) => ({
            ...group,
            questions: ids.size > 0 ? group.questions.filter((q) => ids.has(q.id)) : group.questions,
          }))
          .filter((group) => group.questions.length > 0),
      }))
      .filter((section) => section.groups.length > 0);

    return {
      ...exam,
      sections,
      questionCount: sections.reduce(
        (count, section) => count + section.groups.reduce((n, group) => n + group.questions.length, 0),
        0
      ),
    };
  }

  const skills = new Set(attempt.practiceScope?.skills ?? []);
  const ids = new Set(attempt.practiceScope?.questionIds ?? []);
  const sections = exam.sections
    .filter((section) => skills.has(section.skill as MockPracticeSkill))
    .map((section) => ({
      ...section,
      groups: section.groups
        .map((group) => ({
          ...group,
          questions: ids.size > 0 ? group.questions.filter((question) => ids.has(question.id)) : group.questions,
        }))
        .filter((group) => group.questions.length > 0),
    }))
    .filter((section) => section.groups.length > 0);
  return {
    ...exam,
    sections,
    questionCount: sections.reduce(
      (count, section) => count + section.groups.reduce((n, group) => n + group.questions.length, 0),
      0
    ),
  };
}
