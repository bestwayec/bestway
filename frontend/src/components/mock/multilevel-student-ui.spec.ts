import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MockAttemptDetail, MockExamListItem, MockGroup } from "@/lib/types";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ href, children, ...props }: React.ComponentProps<"a">) => React.createElement("a", { href, ...props }, children) }));

import { MockExamCard } from "./mock-exams-view";
import { GuidedMultilevelGroups } from "./mock-runner";
import { MultilevelResultBreakdown } from "./mock-result-view";
import {
  MultilevelReadiness,
  MultilevelSectionProgress,
  MultilevelTaskMeta,
  MultilevelTaskProgress,
  multilevelTaskName,
  studentStartMessage,
  studentSaveMessage,
  taskDuration,
} from "./multilevel-student-ui";

const h = React.createElement;
const notReadyExam: MockExamListItem = {
  id: "not-ready", type: "multilevel", profile: "full_mock", title: "Multilevel Full Mock", description: null, level: "C1",
  isDemo: false, isPublished: true, ready: false, canEdit: false, skills: ["listening", "reading", "writing", "speaking"],
  questionCount: 70, durationMinutes: 176, price: 0, access: "granted", imported: null,
};

describe("Multilevel student UX", () => {
  it("uses backend readiness to disable the card start action without exposing a raw reason", () => {
    const html = renderToStaticMarkup(h(MockExamCard, { exam: notReadyExam, isStaff: false, isStudent: true, buying: false, onBuy: vi.fn(), attempts: [] }));
    expect(html).toContain("Not ready");
    expect(html).toContain("This exam is still being prepared.");
    expect(html).toContain("disabled");
    expect(html).not.toContain("MOCK_NOT_READY");
    expect(html).not.toContain("writing informal_email");
  });

  it("uses student-safe readiness errors for start failures", () => {
    expect(studentStartMessage({ code: "MOCK_NOT_READY", message: "writing informal_email: points must be 5" })).toBe("Exam is not ready yet.");
  });

  it("renders the current Writing terminology, shared task progress, and score metadata", () => {
    const guidance = { taskKey: "informal_email", displayLabel: "Task 1.1 — Informal Letter", wordMin: 50, wordMax: 50, rawMax: 5 };
    const html = renderToStaticMarkup(h(React.Fragment, null,
      h(MultilevelTaskProgress, { skill: "writing", current: 0, total: 3, labels: ["1.1", "1.2", "2"] }),
      h(MultilevelTaskMeta, { question: { guidance, points: 5 } }),
    ));
    expect(multilevelTaskName(guidance, "fallback")).toBe("Task 1.1 — Informal Letter");
    expect(html).toContain("1.1");
    expect(html).toContain("1.2");
    expect(html).toContain("~50 words");
    expect(html).toContain("/5");
    expect(html).not.toContain("Email");
  });

  it("keeps Task 1.1 and Task 1.2 on the same visible source situation", () => {
    const groups = [
      { id: "one", passageText: "You have moved to a new neighbourhood.", instructions: null, questions: [{ id: "q1", number: 1, type: "essay_task1", prompt: "Write an informal letter.", points: 5, guidance: { taskKey: "informal_email", displayLabel: "Task 1.1 — Informal Letter", wordMin: 50, wordMax: 50, rawMax: 5 } }] },
      { id: "two", passageText: null, instructions: null, questions: [{ id: "q2", number: 2, type: "essay_task1", prompt: "Write a formal letter.", points: 5, guidance: { taskKey: "formal_email", displayLabel: "Task 1.2 — Formal Letter", wordMin: 120, wordMax: 150, rawMax: 5 } }] },
      { id: "three", passageText: "A publication request", instructions: null, questions: [{ id: "q3", number: 3, type: "essay_task2", prompt: "Write a publication.", points: 6, guidance: { taskKey: "publication", displayLabel: "Task 2 — Publication", wordMin: 180, wordMax: 200, rawMax: 6 } }] },
    ] as unknown as MockGroup[];
    const html = renderToStaticMarkup(h(GuidedMultilevelGroups, { skill: "writing", groups, activeTask: 1, setActiveTask: vi.fn(), strict: false, timed: false, attemptId: "attempt", answers: {}, audioSet: new Set<string>(), onAnswer: vi.fn() }));
    expect(html).toContain("Shared situation");
    expect(html).toContain("You have moved to a new neighbourhood.");
    expect(html).toContain("Formal Letter");
    expect(html).not.toContain("Formal Email");
  });

  it("shows all four speaking parts with their server timing metadata", () => {
    const html = renderToStaticMarkup(h(React.Fragment, null,
      h(MultilevelTaskProgress, { skill: "speaking", current: 1, total: 4, labels: ["1.1", "1.2", "2", "3"] }),
      h(MultilevelTaskMeta, { question: { guidance: { taskKey: "1.1", responseSeconds: 30, rawMax: 5 }, points: 5 } }),
      h(MultilevelTaskMeta, { question: { guidance: { taskKey: "1.2", prepSeconds: 15, responseSeconds: 45, rawMax: 5 }, points: 5 } }),
    ));
    expect(html).toContain("1.1");
    expect(html).toContain("1.2");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
    expect(taskDuration({ taskKey: "1.1", responseSeconds: 30 })).toBe("30 sec each · no official prep");
    expect(taskDuration({ taskKey: "1.2", prepSeconds: 15, responseSeconds: 45 })).toBe("15 sec prep · 45 sec response");
  });

  it("renders an explicit ready state and section navigation", () => {
    const html = renderToStaticMarkup(h(React.Fragment, null, h(MultilevelReadiness, { ready: true }), h(MultilevelSectionProgress, { current: "writing" })));
    expect(html).toContain("Ready");
    expect(html).toContain("Listening");
    expect(html).toContain("Writing");
    expect(html).toContain("Speaking");
  });

  it("makes autosave states and Multilevel raw/standardized results understandable", () => {
    expect(studentSaveMessage("saving")).toBe("Saving…");
    expect(studentSaveMessage("saved")).toBe("Saved");
    expect(studentSaveMessage("error")).toBe("Save failed — Retry");
    const attempt = {
      specificationVersion: "UZBMB_MULTILEVEL_EN_2026_V1",
      sections: [{ id: "writing", skill: "writing", score: 13, max: 16, standardScore: 55, groups: [
        { id: "writing-1", questions: [{ id: "w1", points: 5, score: 4, guidance: { taskKey: "informal_email", displayLabel: "Task 1.1 — Informal Letter", rawMax: 5 } }] },
        { id: "writing-2", questions: [{ id: "w2", points: 5, score: 4, guidance: { taskKey: "formal_email", displayLabel: "Task 1.2 — Formal Letter", rawMax: 5 } }] },
        { id: "writing-3", questions: [{ id: "w3", points: 6, score: 5, guidance: { taskKey: "publication", displayLabel: "Task 2 — Publication", rawMax: 6 } }] },
      ] }],
    } as unknown as MockAttemptDetail;
    const html = renderToStaticMarkup(h(MultilevelResultBreakdown, { attempt }));
    expect(html).toContain("Task 1.1 — Informal Letter");
    expect(html).toContain("Raw");
    expect(html).toContain("13 / 16");
    expect(html).toContain("55 /75");
  });
});
