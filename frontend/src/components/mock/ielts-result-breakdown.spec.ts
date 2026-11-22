// @vitest-environment jsdom
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    type Tree = { [key: string]: Tree | string | undefined };
    const node = namespace.split(".").reduce<Tree | undefined>(
      (tree, part) => tree?.[part] as Tree | undefined,
      en as unknown as Tree
    );
    const template = typeof node?.[key] === "string" ? (node[key] as string) : key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ""));
  },
}));

import { IeltsResultBreakdown } from "./ielts-result-breakdown";
import type { MockAttemptDetail, MockAttemptQuestion } from "@/lib/types";

function makeQuestions(count: number, correctCount: number): MockAttemptQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q${i + 1}`,
    number: i + 1,
    displayNumber: i + 1,
    type: "multiple_choice",
    prompt: `Question prompt ${i + 1}`,
    options: ["A", "B", "C", "D"],
    points: 1,
    wordLimit: null,
    response: i < correctCount ? "A" : i < count - 2 ? "B" : "",
    hasAudio: false,
    audioUrl: null,
    score: i < correctCount ? 1 : 0,
    isCorrect: i < correctCount ? true : i < count - 2 ? false : null,
    isGraded: true,
    feedback: null,
  })) as MockAttemptQuestion[];
}

function makeAttempt(overrides: Partial<MockAttemptDetail> = {}): MockAttemptDetail {
  const p1Qs = makeQuestions(13, 11);
  const p2Qs = makeQuestions(13, 9);
  const p3Qs = makeQuestions(14, 11);

  return {
    id: "attempt-1",
    examId: "exam-1",
    studentId: "student-1",
    examTitle: "IELTS Academic Reading Test 1",
    examType: "ielts_academic",
    status: "completed",
    mode: "timed",
    flowMode: "single_skill",
    currentSkill: "reading",
    overallBand: 7.5,
    startedAt: "2026-11-22T10:00:00Z",
    finishedAt: "2026-11-22T10:56:00Z",
    sections: [
      {
        id: "sec-reading",
        skill: "reading",
        title: "Reading",
        durationMinutes: 60,
        instructions: "Read the passages and answer questions.",
        score: 31,
        max: 40,
        band: 7.5,
        bandBelowRange: false,
        groups: [
          {
            id: "g1",
            title: "Passage 1: The History of Silk",
            instructions: null,
            passageText: "Silk was discovered in ancient China...",
            hasAudio: false,
            questions: p1Qs,
          },
          {
            id: "g2",
            title: "Passage 2: Marine Biology",
            instructions: null,
            passageText: "Deep ocean life forms...",
            hasAudio: false,
            questions: p2Qs,
          },
          {
            id: "g3",
            title: "Passage 3: Renewable Energy",
            instructions: null,
            passageText: "Solar cells have advanced...",
            hasAudio: false,
            questions: p3Qs,
          },
        ],
      },
    ],
    ...overrides,
  } as MockAttemptDetail;
}

describe("IeltsResultBreakdown", () => {
  it("renders correct, incorrect, unanswered counts and IELTS Band for Reading", () => {
    const attempt = makeAttempt();
    const html = renderToStaticMarkup(React.createElement(IeltsResultBreakdown, { attempt }));

    expect(html).toContain("IELTS Reading Natijasi");
    expect(html).toContain("31"); // Correct count
    expect(html).toContain("/ 40");
    expect(html).toContain("7"); // Incorrect count
    expect(html).toContain("2"); // Unanswered count
    expect(html).toContain("Band 7.5");
    expect(html).toContain("56 daqiqa sarflandi");
  });

  it("renders 3 passages breakdown with correct scores", () => {
    const attempt = makeAttempt();
    const html = renderToStaticMarkup(React.createElement(IeltsResultBreakdown, { attempt }));

    expect(html).toContain("Passage 1: The History of Silk");
    expect(html).toContain("11 / 13");
    expect(html).toContain("Passage 2: Marine Biology");
    expect(html).toContain("9 / 13");
    expect(html).toContain("Passage 3: Renewable Energy");
    expect(html).toContain("11 / 14");
  });

  it("renders 4 sections breakdown for Listening", () => {
    const s1 = makeQuestions(10, 9);
    const s2 = makeQuestions(10, 8);
    const s3 = makeQuestions(10, 8);
    const s4 = makeQuestions(10, 9);

    const attempt = makeAttempt({
      examTitle: "IELTS Listening Test 1",
      sections: [
        {
          id: "sec-listening",
          skill: "listening",
          title: "Listening",
          durationMinutes: 40,
          instructions: null,
          score: 34,
          max: 40,
          band: 8.0,
          bandBelowRange: false,
          groups: [
            { id: "g1", title: "Section 1", instructions: null, passageText: null, hasAudio: true, questions: s1 },
            { id: "g2", title: "Section 2", instructions: null, passageText: null, hasAudio: true, questions: s2 },
            { id: "g3", title: "Section 3", instructions: null, passageText: null, hasAudio: true, questions: s3 },
            { id: "g4", title: "Section 4", instructions: null, passageText: null, hasAudio: true, questions: s4 },
          ],
        },
      ],
    });

    const html = renderToStaticMarkup(React.createElement(IeltsResultBreakdown, { attempt }));
    expect(html).toContain("IELTS Listening Natijasi");
    expect(html).toContain("34"); // Correct count
    expect(html).toContain("Band 8.0");
    expect(html).toContain("Section 1");
    expect(html).toContain("9 / 10");
    expect(html).toContain("Section 2");
    expect(html).toContain("8 / 10");
  });

  it("hides Band score in practice mode and displays raw accuracy only", () => {
    const attempt = makeAttempt({ mode: "practice" });
    const html = renderToStaticMarkup(React.createElement(IeltsResultBreakdown, { attempt }));

    expect(html).toContain("IELTS Practice");
    expect(html).toContain("Amaliyot (Raw Score)");
    expect(html).not.toMatch(/Band \d/);
  });
});
