import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import type { MockAttemptDetail } from "@/lib/types";

vi.mock("next-intl", () => ({ useTranslations: (namespace: string) => (key: string) => {
  const source = namespace === "mock" ? en.mock : en.common;
  return key.split(".").reduce<unknown>((value, field) => value && typeof value === "object" ? (value as Record<string, unknown>)[field] : undefined, source) ?? key;
} }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children) }));
const viewer = vi.hoisted(() => ({ role: "teacher" }));
vi.mock("@/hooks/use-me", () => ({ useMe: () => ({ data: { user: { role: viewer.role } } }) }));
vi.mock("@/hooks/use-mock", () => {
  const useMutation = () => ({ isPending: false, mutate: vi.fn() });
  return Object.fromEntries(["useGradeMock", "useDeleteMockAttempt", "useExtendMockDeadline", "useForceSubmitMock", "useReopenMock"].map((name) => [name, useMutation]));
});
vi.mock("./assessment-panel", () => ({ AssessmentPanel: () => null }));
import { MockResultView, MultilevelResultBreakdown } from "./mock-result-view";

const attempt = (partial = true) => ({
  id: "attempt-1", examTitle: "Selected work", examType: "multilevel", status: "completed",
  flowMode: partial ? "partial_practice" : "single_skill", specificationVersion: "UZBMB_MULTILEVEL_EN_2026_V2",
  overallScore: null, cefrLevel: null, scoreMethod: "PRACTICE_PARTIAL",
  sections: [{ id: "speaking", skill: "speaking", score: 4, max: 5, standardScore: null, band: null, groups: [{ id: "part-1", title: "Personal questions", questions: [3, 4, 5].map((score, index) => ({
    id: `q-${index}`, number: index + 1, type: "speaking_task", prompt: "Describe your day", points: 9,
    guidance: { taskKey: "1.1", displayLabel: "Part 1.1", rawMax: 5 }, isGraded: true, score,
    response: "", feedback: null, rubricScores: null, audioUrl: null, hasAudio: false,
  })) }] }],
} as MockAttemptDetail);

describe("partial teacher result presentation", () => {
  beforeEach(() => { viewer.role = "teacher"; });
  it("shows learner response marks as pending with their true rubric maximum until graded", () => {
    viewer.role = "student";
    const value = attempt(); value.status = "grading"; value.sections[0].score = 0;
    value.sections[0].groups[0].questions.forEach((question) => { question.isGraded = false; question.score = 0; });
    const pending = renderToStaticMarkup(React.createElement(MockResultView, { attempt: value }));
    expect(pending).toMatch(/Score: <span[^>]*>—<\/span> \/ 5/);
    expect(pending).not.toMatch(/Score: <span[^>]*>0<\/span>/);
    value.sections[0].groups[0].questions.forEach((question) => { question.isGraded = true; });
    const graded = renderToStaticMarkup(React.createElement(MockResultView, { attempt: value }));
    expect(graded).toMatch(/Score: <span[^>]*>0<\/span> \/ 5/);
  });
  it.each(["writing", "speaking"] as const)("shows pending %s as awaiting/blank rather than the aggregate zero", (skill) => {
    const value = attempt();
    value.status = "grading";
    const section = value.sections[0]; section.skill = skill; section.score = 0; section.standardScore = 0;
    section.groups[0].questions.forEach((question) => {
      question.type = skill === "writing" ? "essay_task1" : "speaking_task";
      question.isGraded = false; question.score = 0;
    });
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: value }));
    const breakdown = renderToStaticMarkup(React.createElement(MultilevelResultBreakdown, { attempt: value }));
    expect(html).toContain(en.mock.awaitingGrade);
    expect(html).not.toContain(">0/5<");
    expect(html).not.toContain("Standardized 0");
    expect(breakdown).toContain("— / 5");
    expect(breakdown).not.toContain("0 / 5");
  });

  it("preserves a genuine zero after the selected responses have been graded", () => {
    const value = attempt(); value.sections[0].score = 0;
    value.sections[0].groups[0].questions.forEach((question) => { question.isGraded = true; question.score = 0; });
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: value }));
    expect(html).toContain(">0/5<");
    expect(html).toContain("0 / 5");
    expect(html).not.toContain(en.mock.awaitingGrade);
  });

  it("keeps graded skill and task scores visible while another response awaits review", () => {
    const value = attempt(); value.status = "grading";
    const writing = structuredClone(value.sections[0]); writing.id = "writing"; writing.skill = "writing";
    writing.score = 3; writing.max = 10;
    writing.groups = writing.groups.slice(0, 1);
    writing.groups[0].questions = writing.groups[0].questions.slice(0, 2);
    writing.groups[0].questions.forEach((question, index) => { question.type = "essay_task1"; question.isGraded = index === 0; question.score = index === 0 ? 3 : 0; });
    writing.groups = writing.groups[0].questions.map((question, index) => ({ ...writing.groups[0], id: `writing-task-${index}`, questions: [{ ...question, id: `writing-q-${index}` }] }));
    value.sections.push(writing);
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: value }));
    const breakdown = renderToStaticMarkup(React.createElement(MultilevelResultBreakdown, { attempt: value }));
    expect(html).toContain(">4/5<");
    expect(html).toContain(en.mock.awaitingGrade);
    expect(html).not.toContain(">3/10<");
    expect(breakdown).toContain("3 / 5");
    expect(breakdown).toContain("— / 5");
    expect(breakdown).toContain("— / 10");
    expect(breakdown).not.toContain("3 / 10");
  });
  it("shows observed raw results with skill practice report certificate link", () => {
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: attempt() }));
    expect(html).toContain("Selected task practice result");
    expect(html).not.toContain("no overall Multilevel score");
    expect(html).toContain("4/5");
    expect(html).not.toContain(" /75");
    expect(html).toContain("/certificate");
    expect(html).toContain('max="5"');
    expect(html).not.toContain('max="9"');
  });
  it("shows one mean Speaking part score rather than the first response or summed responses", () => {
    const html = renderToStaticMarkup(React.createElement(MultilevelResultBreakdown, { attempt: attempt() }));
    expect(html).toContain("4 / 5");
    expect(html).not.toContain("3 / 5");
    expect(html).not.toContain("12 / 5");
    expect(html).not.toContain("Standardized");
  });
  it("preserves the full-result certificate flow", () => {
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: attempt(false) }));
    expect(html).toContain("/mock/attempts/attempt-1/certificate");
    expect(html).toContain("Estimated Multilevel Result");
  });
  it("shows the same persisted website practice grade in the result and breakdown", () => {
    const value = attempt();
    value.rawScores = { speaking: { score: 4, max: 5, practiceGrade: { policyId: "BESTWAY_INTERNAL_PRACTICE_35_50_V1", score: 47, scaleMax: 75, rangeMin: 35, rangeMax: 50, rawScore: 4, rawMax: 5, isOfficial: false } } };
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: value }));
    expect((html.match(/47 \/75/g) ?? []).length).toBe(2);
    expect(html).not.toContain("35–50");
    expect(html).not.toContain("75 /75");
    expect(html).not.toContain("/certificate");
  });
  it("keeps new internal full-attempt grades separate from derived CEFR and certificates", () => {
    const value = attempt(false);
    value.flowMode = "full_test";
    value.overallScore = 75;
    value.cefrLevel = "C1";
    value.rawScores = { speaking: { score: 4, max: 5, practiceGrade: { policyId: "BESTWAY_INTERNAL_PRACTICE_35_50_V1", score: 47, scaleMax: 75, rangeMin: 35, rangeMax: 50, rawScore: 4, rawMax: 5, isOfficial: false } } };
    const html = renderToStaticMarkup(React.createElement(MockResultView, { attempt: value }));
    expect(html).toContain("47 /75");
    expect(html).not.toContain("Estimated Multilevel Result");
    expect(html).not.toContain("75 /75");
    expect(html).not.toContain("C1");
    expect(html).not.toContain("/certificate");
  });
});
