import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { rankingScoreLabel, rankingStatusKey } from "@/lib/ai-ranking-types";
import type { GroupAiRankingCohort, GroupAiRankingRow } from "@/lib/ai-ranking-types";

vi.mock("@/hooks/use-ai-ranking", () => ({ useGroupAiRanking: () => ({ data: null }) }));
import { GroupAiRankingTable, GroupAllGradesTable } from "./group-ai-ranking";

const row: GroupAiRankingRow = { studentId: "s", name: "Komiljon", attemptId: "a", jobId: "j",
  aiScore: 44, aiRawScore: 3, teacherScore: 4, finalScore: 4, finalScoreScaleMax: 5,
  finalScoreSource: "TEACHER", confidence: .93, eligible: true, reviewRequired: false, rank: 1, status: "SUCCEEDED" };
const cohort = { scaleMax: 75, rawMax: 5 } as GroupAiRankingCohort;
const t = (key: string) => key;

describe("teacher AI ranking", () => {
  it("keeps unavailable scores empty and real zero visible", () => {
    expect(rankingScoreLabel(null, 75)).toBe("—");
    expect(rankingScoreLabel(undefined, 75)).toBe("—");
    expect(rankingScoreLabel(0, 5)).toBe("0 / 5");
    expect(rankingScoreLabel(44.5, 75)).toBe("44.5 / 75");
  });
  it("shows separate AI website, raw, teacher and final provenance", () => {
    const html = renderToStaticMarkup(React.createElement(GroupAiRankingTable, { rows: [row], cohort, t }));
    expect(html).toContain("44 / 75");
    expect(html).toContain("3 / 5");
    expect(html).toContain("4 / 5");
    expect(html).toContain("sourceTeacher");
  });
  it("never ranks pending or review proposals or manufactures a missing grade", () => {
    const pending = { ...row, aiScore: null, aiRawScore: null, teacherScore: null, finalScore: null,
      finalScoreSource: null, rank: null, status: "PENDING", eligible: false, reviewRequired: true };
    expect(rankingStatusKey(pending)).toBe("pending");
    const html = renderToStaticMarkup(React.createElement(GroupAiRankingTable, { rows: [pending], cohort, t }));
    expect(html).not.toContain("0 / 75"); expect(html).not.toContain("35 / 75"); expect(html).not.toContain("75 / 75");
    const review = { ...row, eligible: false, rank: null, reviewRequired: true, status: "NEEDS_REVIEW" };
    expect(rankingStatusKey(review)).toBe("reviewRequired");
    expect(renderToStaticMarkup(React.createElement(GroupAiRankingTable, { rows: [review], cohort, t }))).toContain("proposalOnly");
  });
  it("uses persisted final internal policy grade without changing teacher raw score", () => {
    const final: GroupAiRankingRow = { ...row, finalPracticeGrade: { policyId: "BESTWAY_INTERNAL_PRACTICE_35_50_V1", score: 47, scaleMax: 75, rawScore: 4, rawMax: 5, rangeMin: 35, rangeMax: 50, isOfficial: false } };
    const html = renderToStaticMarkup(React.createElement(GroupAiRankingTable, { rows: [final], cohort, t }));
    expect(html).toContain("47 / 75"); expect(html).toContain("4 / 5"); expect(html).toContain("44 / 75");
  });
  it("keeps a retained Speaking proposal out of the final score cell", () => {
    const review: GroupAiRankingRow = { ...row, aiScore: 41, aiRawScore: 2, teacherScore: null,
      finalScore: null, finalScoreSource: null, status: "NEEDS_REVIEW", eligible: false,
      rank: null, reviewRequired: true,
      finalPracticeGrade: { policyId: "BESTWAY_INTERNAL_PRACTICE_35_50_V1", score: 41,
        scaleMax: 75, rawScore: 2, rawMax: 5, rangeMin: 35, rangeMax: 50, isOfficial: false } };
    const html = renderToStaticMarkup(React.createElement(GroupAiRankingTable, { rows: [review], cohort, t }));
    expect(html.match(/41 \/ 75/g)).toHaveLength(1);
    expect(html).toContain("proposalOnly");
  });
  it("shows both skills together without promoting an unapproved Speaking proposal", () => {
    const speaking = { ...row, aiScore: 41, aiRawScore: 2, finalScore: null, finalScoreSource: null,
      teacherScore: null, eligible: false, reviewRequired: true, status: "NEEDS_REVIEW",
      finalPracticeGrade: { policyId: "policy", score: 41, scaleMax: 75, rawScore: 2, rawMax: 5, rangeMin: 35, rangeMax: 50, isOfficial: false as const } };
    const html = renderToStaticMarkup(React.createElement(GroupAllGradesTable, { t, rows: [{ studentId: row.studentId,
      name: row.name, writing: { row, cohort }, speaking: { row: speaking, cohort } }] }));
    expect(html).toContain("writing"); expect(html).toContain("speaking");
    expect(html).toContain("44 / 75"); expect(html.match(/41 \/ 75/g)).toHaveLength(1);
    expect(html).toContain("sourceTeacher"); expect(html).toContain("reviewRequired");
  });
});
