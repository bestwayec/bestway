import { describe, expect, it } from "vitest";
import type { MockExamDetail } from "./types";
import { availablePracticeSkills, practiceExam } from "./mock-practice";

const exam = {
  type: "multilevel", ready: false, practiceReady: true, practiceSkills: ["writing", "speaking"],
  questionCount: 4, sections: [
    { id: "l", skill: "listening", groups: [{ id: "lg", questions: [{ id: "l1" }] }] },
    { id: "w", skill: "writing", groups: [{ id: "wg", questions: [{ id: "w1" }] }] },
    { id: "s", skill: "speaking", groups: [{ id: "sg", questions: [{ id: "s1" }] }, { id: "missing-picture", questions: [{ id: "s2" }] }] },
  ],
} as unknown as MockExamDetail;

describe("explicit authored-task practice", () => {
  it("uses separate authoritative availability while full readiness stays false", () => {
    expect(availablePracticeSkills(exam)).toEqual(["listening", "writing", "speaking"]);
    expect(availablePracticeSkills({ ...exam, practiceReady: false })).toEqual([]);
    expect(availablePracticeSkills({ ...exam, type: "ielts_academic" })).toEqual([]);
    expect(exam.ready).toBe(false);
  });

  it("renders only frozen authored questions and leaves the source definition intact", () => {
    const scoped = practiceExam(exam, { flowMode: "partial_practice", practiceScope: { skills: ["writing", "speaking"], questionIds: ["w1", "s1"] } })!;
    expect(scoped.sections.map((section) => section.skill)).toEqual(["writing", "speaking"]);
    expect(scoped.sections.flatMap((section) => section.groups.flatMap((group) => group.questions.map((q) => q.id)))).toEqual(["w1", "s1"]);
    expect(scoped.questionCount).toBe(2);
    expect(exam.questionCount).toBe(4);
    expect(exam.sections[2].groups).toHaveLength(2);
  });

  it("fails closed for a missing scope and keeps ordinary attempts unchanged", () => {
    expect(practiceExam(exam, { flowMode: "partial_practice" })?.sections).toEqual([]);
    expect(practiceExam(exam, { flowMode: "full_test" })).toBe(exam);
    expect(practiceExam(undefined, { flowMode: "partial_practice" })).toBeUndefined();
  });
});
