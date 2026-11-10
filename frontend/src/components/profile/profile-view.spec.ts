import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import type { MockAttemptSummary } from "@/lib/types";

const fixture = vi.hoisted(() => ({
  attempts: [] as MockAttemptSummary[],
  role: "student",
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    const source = (en as Record<string, unknown>)[namespace];
    let template =
      (key.split(".").reduce<unknown>((value, field) => (value && typeof value === "object" ? (value as Record<string, unknown>)[field] : undefined), source) as string) ?? key;
    if (typeof template === "string" && values) {
      for (const [k, v] of Object.entries(values)) {
        template = template.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return template;
  },
  useFormatter: () => ({
    dateTime: () => "Oct 10, 2026, 12:00",
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children),
}));

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({
    data: {
      user: {
        id: "student-1",
        name: "Test Student",
        phone: "+998901234567",
        role: fixture.role,
        createdAt: "2026-01-01T00:00:00Z",
      },
      telegramLinked: false,
    },
    isLoading: false,
  }),
  useUpdateMe: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-telegram", () => ({
  useTelegramStatus: () => ({ data: { linked: false } }),
  useTelegramLinkToken: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkTelegram: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-mock", () => ({
  useMyMockAttempts: () => ({
    data: fixture.attempts,
    isLoading: false,
  }),
  useStudentScorePrediction: () => ({
    data: {
      studentId: "student-1",
      attemptsAnalyzed: fixture.attempts.length,
      ielts: { currentBand: 7.0, predictedBand: 7.5, targetBand: 7.5, targetProgressPercent: 90, cefrLevel: "C1", skillBreakdown: {} },
      multilevel: { currentScore: 65, predictedScore: 68, targetScore: 65, targetProgressPercent: 100, cefrLevel: "C1", scaleBands: [], skillBreakdown: {} },
      trend: "improving",
      history: [],
      weakModules: [],
    },
    isLoading: false,
  }),
  useUpdatePredictionTarget: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("./exam-track-selector", () => ({
  ExamTrackSelector: () => React.createElement("div", { "data-testid": "exam-track-selector" }),
}));

import { ProfileView } from "./profile-view";

const makeAttempt = (id: string, status: "completed" | "grading" | "in_progress"): MockAttemptSummary => ({
  id,
  examId: "exam-" + id,
  examTitle: "IELTS Mock " + id,
  examType: "ielts_academic",
  status,
  studentId: "student-1",
  mode: "timed",
  flowMode: "full_test",
  deadlineAt: null,
  currentSkill: null,
  sectionDeadlines: null,
  overallDeadlineAt: null,
  sectionBands: null,
  antiCheatCount: 0,
  submittedAt: "2026-10-10T10:00:00Z",
  finishedAt: "2026-10-10T12:00:00Z",
  startedAt: "2026-10-10T09:00:00Z",
  rawScores: null,
  overallBand: 7.5,
  overallScore: null,
  cefrLevel: "C1",
});

describe("ProfileView Data Consistency", () => {
  beforeEach(() => {
    fixture.role = "student";
    fixture.attempts = [];
  });

  it("consumes user attempts and displays completed test count matching dashboard", () => {
    // 8 completed attempts
    fixture.attempts = Array.from({ length: 8 }, (_, i) => makeAttempt(`att-${i}`, "completed"));

    const html = renderToStaticMarkup(React.createElement(ProfileView));

    // Must report 8 completed tests
    expect(html).toContain("8");
    expect(html).toContain("Recent mock results");
    expect(html).toContain("Completed tests");
    // Should display recent mock attempts in the list
    expect(html).toContain("IELTS Mock att-0");
  });

  it("does not display 'Hali natija yo'q' when user has completed attempts", () => {
    fixture.attempts = Array.from({ length: 8 }, (_, i) => makeAttempt(`att-${i}`, "completed"));

    const html = renderToStaticMarkup(React.createElement(ProfileView));
    expect(html).not.toContain("Hali natija yo'q — birinchi testni boshlang");
  });

  it("displays friendly empty state only when student has 0 attempts", () => {
    fixture.attempts = [];

    const html = renderToStaticMarkup(React.createElement(ProfileView));
    expect(html).toContain("No mock attempts yet");
  });
});
