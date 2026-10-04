import { describe, expect, it } from "vitest";
import { assessmentAudioPath, assessmentPollingInterval, assessmentStatusKey, canAcceptAssessment, overrideParts, splitFeedbackLines } from "./assessment-model";
import type { AssessmentJobView, AssessmentResult, AssessmentStatus } from "./assessment-types";

const result = (criteria: Record<string, number | null> = {}): AssessmentResult => ({
  parts: [{ id: "1.1", rawScore: 4.5, criteria, evidence: {}, feedback: { taskCoverage: "", grammar: "", vocabulary: "", fluencyCohesion: "", ideaDevelopment: "", register: "", spellingPunctuation: "", strengths: [], issues: [], missedPrompts: [], usefulPhrases: [], forCovered: null, againstCovered: null, position: "", argumentBalance: "" } }],
  overallStrengths: [], priorityImprovements: [], grammarCorrections: [], vocabularyUpgrades: [], improvedExamples: [], recommendedPractice: [], confidence: 0.9, pronunciationEvidence: "UNAVAILABLE",
});
const job = (extra: Partial<AssessmentJobView> = {}): AssessmentJobView => ({
  id: "job", skill: "speaking", program: "MULTILEVEL", status: "SUCCEEDED", policyMode: "FULL_MOCK_AI_WITH_REVIEW", version: 2,
  aiScore: 64, teacherScore: null, finalScore: null, finalScoreSource: null, confidence: 0.9, rubricVersion: "rubric-v1", promptVersion: "prompt-v1", evaluation: { result: result() }, approvedFeedback: null,
  submissions: [], parts: [{ id: "1.1", max: 5, task: "Personal questions", context: "" }], ...extra,
});

describe("bounded assessment polling", () => {
  it.each(["PENDING", "PROCESSING", "RETRY"] as AssessmentStatus[])("polls %s every 15 seconds", (status) => {
    expect(assessmentPollingInterval({ attemptId: "attempt", assessments: [job({ status })] }, 1, 0, false)).toBe(15000);
  });
  it.each(["SUCCEEDED", "NEEDS_REVIEW", "FAILED"] as AssessmentStatus[])("stops for stable state %s", (status) => {
    expect(assessmentPollingInterval({ attemptId: "attempt", assessments: [job({ status })] }, 1, 0, false)).toBe(false);
  });
  it("stops after 20 requests, five minutes, an error, or absent jobs", () => {
    const active = { attemptId: "attempt", assessments: [job({ status: "PENDING" })] };
    expect(assessmentPollingInterval(active, 20, 0, false)).toBe(false);
    expect(assessmentPollingInterval(active, 1, 300000, false)).toBe(false);
    expect(assessmentPollingInterval(active, 1, 0, true)).toBe(false);
    expect(assessmentPollingInterval(undefined, 1, 0, false)).toBe(false);
    expect(assessmentPollingInterval({ attemptId: "attempt", assessments: [] }, 1, 0, false)).toBe(false);
  });
});

describe("teacher review score boundary", () => {
  it("accepts a holistic Multilevel half-point score without scaling in the client", () => {
    expect(overrideParts(job(), { "1.1": { rawScore: "4.5" } })).toEqual([{ id: "1.1", rawScore: 4.5 }]);
  });
  it.each(["", "NaN", "Infinity", "-0.5", "5.5", "4.25"])("rejects invalid Multilevel raw score %s", (rawScore) => {
    expect(() => overrideParts(job(), { "1.1": { rawScore } })).toThrow("INVALID_ASSESSMENT_SCORE");
  });
  it("requires all four IELTS criteria, including teacher pronunciation, without calculating the band", () => {
    const ielts = job({ program: "IELTS_ACADEMIC" });
    const criteria = { fluency: "6", lexical: "6.5", grammar: "7", pronunciation: "7.5" };
    expect(overrideParts(ielts, { "1.1": criteria })).toEqual([{ id: "1.1", criteria: { fluency: 6, lexical: 6.5, grammar: 7, pronunciation: 7.5 } }]);
    expect(() => overrideParts(ielts, { "1.1": { ...criteria, pronunciation: "" } })).toThrow();
  });
  it("does not enable accept for pending, incomplete, or pronunciation-limited IELTS output", () => {
    expect(canAcceptAssessment(job())).toBe(true);
    expect(canAcceptAssessment(job({ status: "PROCESSING" }))).toBe(false);
    expect(canAcceptAssessment(job({ aiScore: null }))).toBe(false);
    expect(canAcceptAssessment(job({ evaluation: { result: { ...result(), parts: [] } } }))).toBe(false);
    expect(canAcceptAssessment(job({ program: "IELTS_ACADEMIC", evaluation: { result: result({ fluency: 7, lexical: 7, grammar: 7, pronunciation: null }) } }))).toBe(false);
    expect(canAcceptAssessment(job({ program: "IELTS_ACADEMIC", evaluation: { result: result({}) } }))).toBe(false);
  });
  it("identifies teacher-reviewed results without hiding active re-grading", () => {
    expect(assessmentStatusKey(job({ finalScoreSource: "TEACHER" }))).toBe("reviewed");
    expect(assessmentStatusKey(job({ finalScoreSource: "TEACHER", status: "PENDING" }))).toBe("queued");
  });
});

describe("assessment presentation safety", () => {
  it("builds audio access through the protected same-origin proxy with escaped identities", () => {
    expect(assessmentAudioPath("a/b", "q?x=1")).toBe("/api/backend/mock/attempts/a%2Fb/answers/q%3Fx%3D1/audio");
  });
  it("retains feedback line order and removes empty rows", () => {
    expect(splitFeedbackLines("First\r\n\n Second ")).toEqual(["First", "Second"]);
  });
});
