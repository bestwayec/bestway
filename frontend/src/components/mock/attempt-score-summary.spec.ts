import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import type { MockAttemptSummary, MockExamDetail } from "@/lib/types";

const fixture = vi.hoisted(() => ({ attempts: [] as MockAttemptSummary[], program: "MULTILEVEL", exam: {} as MockExamDetail }));
vi.mock("next-intl", () => ({ useTranslations: (namespace: string) => (key: string) => {
  const source = (en as Record<string, unknown>)[namespace];
  return key.split(".").reduce<unknown>((value, field) => value && typeof value === "object" ? (value as Record<string, unknown>)[field] : undefined, source) ?? key;
} }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), Link: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children) }));
vi.mock("@/hooks/use-me", () => ({ useMe: () => ({ data: { user: { role: "student" } } }) }));
vi.mock("@/hooks/use-exam-programs", () => ({ useStudentProgramScope: () => ({ program: fixture.program }) }));
vi.mock("@/hooks/use-mock", () => ({
  useMyMockAttempts: () => ({ data: fixture.attempts }),
  useMockExams: () => ({ data: [] }),
  useMockExam: () => ({ data: fixture.exam }),
  useStartMock: () => ({ mutate: vi.fn(), isPending: false }),
  usePurchaseMock: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AttemptScoreSummary } from "./attempt-score-summary";
import { ExamTrackDashboard } from "./exam-track-dashboard";
import { MockExamDetailView } from "./mock-exam-detail-view";

const attempt = (): MockAttemptSummary => ({
  id: "attempt", examId: "exam", examTitle: "History fixture", examType: "multilevel", status: "completed",
  studentId: "student", mode: "practice", deadlineAt: null, currentSkill: null, sectionDeadlines: null,
  overallDeadlineAt: null, sectionBands: null, antiCheatCount: 0, submittedAt: "2026-10-10T00:10:00Z", finishedAt: "2026-10-10T00:12:00Z",
  flowMode: "full_test", overallBand: null, overallScore: 75, cefrLevel: "C1", startedAt: "2026-10-10T00:00:00Z",
  rawScores: { writing: { score: 4, max: 5, practiceGrade: { policyId: "BESTWAY_INTERNAL_PRACTICE_35_50_V1", score: 47, scaleMax: 75, rangeMin: 35, rangeMax: 50, rawScore: 4, rawMax: 5, isOfficial: false } }, speaking: { score: 3, max: 5, practiceGrade: { policyId: "BESTWAY_INTERNAL_PRACTICE_35_50_V1", score: 44, scaleMax: 75, rangeMin: 35, rangeMax: 50, rawScore: 3, rawMax: 5, isOfficial: false } } },
} satisfies MockAttemptSummary);
const summary = (value: MockAttemptSummary) => renderToStaticMarkup(React.createElement(AttemptScoreSummary, { attempt: value }));

beforeEach(() => {
  fixture.program = "MULTILEVEL"; fixture.attempts = [attempt()];
  fixture.exam = { id: "exam", type: "multilevel", title: "Exam fixture", ready: false, isDemo: true, access: "granted", price: 0, sections: [], questionCount: 0 } as unknown as MockExamDetail;
});

describe("persisted grades in attempt history", () => {
  it("shows separate server practice grades without the native overall or a fabricated average", () => {
    const html = summary(attempt());
    expect(html).toContain("Writing"); expect(html).toContain("47 /75"); expect(html).toContain("Speaking"); expect(html).toContain("44 /75");
    expect(html).not.toContain("75/75"); expect(html).not.toContain("C1"); expect(html).not.toContain("45.5");
  });

  it("keeps a missing practice result pending while showing an already persisted grade", () => {
    const value = attempt(); value.status = "grading"; value.flowMode = "partial_practice";
    value.practiceScope = { skills: ["writing", "speaking"], questionIds: ["w", "s"] };
    delete value.rawScores!.speaking.practiceGrade;
    const html = summary(value);
    expect(html).toContain("47 /75"); expect(html).toContain(en.mock.awaitingGrade); expect(html).not.toContain("3 /5");
    expect(html).not.toContain("C1");
  });

  it("does not turn ungraded raw zero aggregates into saved grades", () => {
    const value = attempt(); value.status = "grading"; value.flowMode = "partial_practice";
    value.rawScores = { writing: { score: 0, max: 16 }, speaking: { score: 0, max: 5 } };
    const html = summary(value);
    expect(html).toContain(en.mock.awaitingGrade); expect(html).not.toContain("0 /16"); expect(html).not.toContain("35 /75");
    expect(html).not.toContain("C1");
  });

  it("preserves completed historical partial raw results, including a legitimate zero", () => {
    const value = attempt(); value.flowMode = "partial_practice"; value.rawScores = { speaking: { score: 0, max: 5 } };
    const html = summary(value);
    expect(html).toContain("0 /5"); expect(html).not.toContain("35 /75"); expect(html).not.toContain("C1");
  });

  it("preserves legacy Multilevel overall and CEFR values when there is no new policy", () => {
    const value = attempt(); value.rawScores = { writing: { score: 4, max: 5 } };
    const html = summary(value);
    expect(html).toContain("75/75"); expect(html).toContain("C1");
  });

  it("preserves IELTS bands and keeps a missing band pending", () => {
    const value = attempt(); value.examType = "ielts_academic"; value.overallBand = 7.5;
    const html = summary(value);
    expect(html).toContain("Overall band: 7.5"); expect(html).not.toContain("47 /75"); expect(html).not.toContain("C1");
    value.overallBand = null; expect(summary(value)).toContain(en.mock.awaitingGrade);
  });

  it.each(["dashboard", "exam detail"])("uses the persisted policy grade in %s history", (surface) => {
    const html = renderToStaticMarkup(surface === "dashboard" ? React.createElement(ExamTrackDashboard) : React.createElement(MockExamDetailView, { examId: "exam" }));
    expect(html).toContain("47 /75"); expect(html).toContain("44 /75"); expect(html).not.toContain("75/75"); expect(html).not.toContain("C1");
    expect(html).toContain("/mock/attempt/attempt#assessment-feedback");
  });
});
