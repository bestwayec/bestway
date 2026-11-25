import { examContentUnits } from "./exam-content-units";
import type { MockAttemptDetail, MockExamDetail, MockExamListItem, MockPracticeSkill, MockSection, MockSkill } from "./types";

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

function scopedGroups(section: MockSection, ids: Set<string>, canonicalListening: boolean) {
  return examContentUnits(section.groups ?? (section as MockSection & { parts?: MockSection["groups"] }).parts ?? [], section.skill, canonicalListening).flatMap((unit) => {
    const selected = unit.groups.map((group) => ({
      ...group,
      questions: (group.questions ?? []).filter((question) => !ids.size || ids.has(question.id)),
    }));
    if (!selected.some((group) => group.questions.length)) return [];
    return selected.filter((group) => group.questions.length || group.id === unit.source.id);
  });
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
  // A "single_skill" attempt without a frozen scope (live PIN rooms, attempts started before
  // scopes were stored) is authorised by the backend for the whole exam. Filtering it here
  // removed every section and showed "0 bo'lim" / "0/0" (K1); the runner picks the section
  // from ?skill= or currentSkill instead.
  const hasExplicitScope =
    Boolean(attempt.singleSection) || Boolean(attempt.practiceScope?.skills?.length);
  if (!hasExplicitScope && attempt.flowMode !== "partial_practice") return exam;

  // Single section practice takes precedence:
  const targetSkill =
    attempt.singleSection ||
    (attempt.practiceScope?.skills?.length === 1 ? attempt.practiceScope.skills[0] : null) ||
    (attempt.sections?.length === 1 ? attempt.sections[0].skill : null);

  if (targetSkill) {
    const ids = new Set(attempt.practiceScope?.questionIds ?? []);
    const sections = (exam.sections || [])
      .filter((section) => section?.skill === targetSkill)
      .map((section) => ({ ...section, groups: scopedGroups(section, ids, exam.type !== "multilevel") }))
      .filter((section) => (section?.groups || []).length > 0);

    return {
      ...exam,
      sections,
      questionCount: sections.reduce(
        (count, section) => count + (section?.groups || []).reduce((n: number, group: any) => n + (group?.questions || []).length, 0),
        0
      ),
    };
  }

  const skills = new Set(attempt.practiceScope?.skills ?? []);
  const ids = new Set(attempt.practiceScope?.questionIds ?? []);
  const sections = (exam.sections || [])
    .filter((section) => skills.has(section?.skill as MockPracticeSkill))
    .map((section) => ({ ...section, groups: scopedGroups(section, ids, exam.type !== "multilevel") }))
    .filter((section) => (section?.groups || []).length > 0);
  return {
    ...exam,
    sections,
    questionCount: sections.reduce(
      (count, section) => count + (section?.groups || []).reduce((n: number, group: any) => n + (group?.questions || []).length, 0),
      0
    ),
  };
}
