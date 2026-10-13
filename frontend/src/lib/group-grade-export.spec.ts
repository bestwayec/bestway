import { describe, expect, it } from "vitest";
import type { GroupAiRankingData, GroupAiRankingRow } from "./ai-ranking-types";
import { finalGradeLabel, groupGradeRows, groupGradesCsv, groupLeaderboardExcelCsv } from "./group-grade-export";

const row: GroupAiRankingRow = { studentId: "student", name: "=unsafe;Name", attemptId: "writing-attempt", jobId: "j", aiScore: 44,
  aiRawScore: 3, teacherScore: 4, finalScore: 4, finalScoreSource: "TEACHER", finalScoreScaleMax: 5, confidence: .9,
  reviewRequired: false, eligible: true, rank: 1, status: "SUCCEEDED",
  finalPracticeGrade: { policyId: "policy", score: 47, scaleMax: 75, rawScore: 4, rawMax: 5, rangeMin: 35, rangeMax: 50, isOfficial: false } };
function data(skill: "writing" | "speaking", rows: GroupAiRankingRow[]): GroupAiRankingData {
  return { group: { id: "g", name: "Group" }, skill, exams: [{ id: "e", title: "CEFR", type: "multilevel" }], selectedExamId: "e",
    cohorts: [{ id: skill + "-scope", label: skill + "-task", isPartial: true, rawMax: 5, scaleMax: 75, questionCount: 1,
      specificationVersion: "v2", rubricVersion: "r", promptVersion: "p", gradingPolicyId: "policy", parts: [], rows }], unranked: [] };
}
const t = (key: string) => key;

describe("group Writing and Speaking export", () => {
  it("joins by student ID while retaining independent attempts and task scopes", () => {
    const writing = data("writing", [row]);
    const speaking = data("speaking", [{ ...row, attemptId: "speaking-attempt", aiScore: 41, finalScore: null,
      finalScoreSource: null, teacherScore: null, eligible: false, reviewRequired: true, rank: null, status: "NEEDS_REVIEW" }]);
    const summary = groupGradeRows(writing, speaking);
    expect(summary).toHaveLength(1);
    expect(finalGradeLabel(summary[0].writing)).toBe("47 / 75");
    expect(finalGradeLabel(summary[0].speaking)).toBe("—");
    const csv = groupGradesCsv(writing, speaking, t);
    expect(csv).toContain("writing-attempt"); expect(csv).toContain("speaking-attempt");
    expect(csv).toContain("writing-scope"); expect(csv).toContain("speaking-scope");
    expect(csv).toContain("41 / 75"); expect(csv.match(/47 \/ 75/g)).toHaveLength(1);
    expect(csv).toContain("reviewRequired"); expect(csv).toContain("sourceTeacher");
    expect(csv).toContain("'" + row.name);
  });
  it("keeps unattempted learners, genuine zero and missing grades distinct", () => {
    const writing = data("writing", [{ ...row, finalScore: 0, finalPracticeGrade: null, teacherScore: 0, aiScore: 0 }]);
    const speaking = data("speaking", []);
    speaking.unranked.push({ ...row, studentId: "another", name: "Another", attemptId: null, jobId: null,
      aiScore: null, aiRawScore: null, teacherScore: null, finalScore: null, finalPracticeGrade: null,
      finalScoreSource: null, finalScoreScaleMax: null, confidence: null, eligible: false, reviewRequired: false, rank: null, status: "NO_ATTEMPT" });
    const summary = groupGradeRows(writing, speaking);
    expect(summary).toHaveLength(2);
    expect(finalGradeLabel(summary.find(student => student.studentId === "student")?.writing)).toBe("0 / 5");
    const csv = groupGradesCsv(writing, speaking, t);
    expect(csv).toContain("notAttempted"); expect(csv).toContain('"0 / 5"');
    expect(csv).not.toContain("35 / 75"); expect(csv).not.toContain("75 / 75");
  });
  it("never combines different groups, exam selections or swapped skill responses", () => {
    const writing = data("writing", [row]);
    const speaking = data("speaking", [row]);
    expect(groupGradeRows(writing, { ...speaking, selectedExamId: "other" })).toEqual([]);
    expect(groupGradeRows(writing, { ...speaking, group: { id: "foreign", name: "Foreign" } })).toEqual([]);
    expect(groupGradeRows(writing, { ...speaking, skill: "writing" })).toEqual([]);
  });

  it("exports formatted leaderboard CSV with ranks, student names, phones, all skills, overall, CEFR and status", () => {
    const writing = data("writing", [row]);
    const speaking = data("speaking", [{ ...row, finalScore: 50, finalPracticeGrade: { policyId: "policy", score: 50, scaleMax: 75, rawScore: 4, rawMax: 5, rangeMin: 35, rangeMax: 50, isOfficial: false } }]);
    const phoneMap = new Map([["student", "+998901234567"]]);
    const csv = groupLeaderboardExcelCsv(writing, speaking, phoneMap, t);

    // Headers check
    expect(csv).toContain("O'rin");
    expect(csv).toContain("O'quvchi ismi");
    expect(csv).toContain("Telefon raqam");
    expect(csv).toContain("Writing balli");
    expect(csv).toContain("Speaking balli");
    expect(csv).toContain("Listening balli");
    expect(csv).toContain("Reading balli");
    expect(csv).toContain("Umumiy ball");
    expect(csv).toContain("CEFR darajasi");
    expect(csv).toContain("Holati");

    // Row values check
    expect(csv).toContain("+998901234567");
    expect(csv).toContain("47 / 75");
    expect(csv).toContain("50 / 75");
    expect(csv).toContain("B2"); // (47 + 50) / 2 = 48.5 -> B2
    expect(csv).toContain("Baholangan");
  });
});
