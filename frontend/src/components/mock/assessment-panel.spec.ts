import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import type { AssessmentJobView, AssessmentPartFeedback, AssessmentResult } from "@/lib/assessment-types";

const hookState = vi.hoisted(() => ({ data: undefined as unknown, error: false, loading: false, pollingStopped: false }));
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const lookup = (path: string) => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, en.assessment);
    return Object.assign((key: string, values?: Record<string, unknown>) => {
      const value = lookup(key);
      return typeof value === "string" ? value.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? name)) : key;
    }, { has: (key: string) => typeof lookup(key) === "string" });
  },
}));
vi.mock("@/hooks/use-assessment", () => ({
  useAttemptAssessments: () => ({ data: hookState.data, isLoading: hookState.loading, isError: hookState.error, isFetching: false, pollingStopped: hookState.pollingStopped, refresh: vi.fn() }),
  useReviewAssessment: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { AssessmentCard, AssessmentPanel } from "./assessment-panel";

const feedback: AssessmentPartFeedback = {
  taskCoverage: "Discussed familiar everyday topics.", grammar: "Improve verb agreement.", vocabulary: "Add precise descriptions.", fluencyCohesion: "Develop connected responses.", ideaDevelopment: "Use reasons and examples.", register: "", spellingPunctuation: "", strengths: ["Clear position"], issues: ["Short explanations"], missedPrompts: ["Compare the second image"], usefulPhrases: ["On the other hand"], forCovered: true, againstCovered: false, position: "Supports public transport", argumentBalance: "The opposing side needs development",
};
const result: AssessmentResult = {
  parts: [{ id: "1.1", rawScore: 4, criteria: { grammar: 4, pronunciation: null }, evidence: { grammar: "Verb agreement in the introduction" }, feedback }],
  overallStrengths: ["Communicates a position"], priorityImprovements: ["Address both sides"], grammarCorrections: [{ original: "She go", corrected: "She goes", explanation: "Third-person singular" }], vocabularyUpgrades: [{ original: "good", alternative: "effective", explanation: "More precise" }], improvedExamples: [{ partId: "1.1", text: "Improved example only <script>unsafe()</script>" }], recommendedPractice: ["Record a comparison with two reasons"], confidence: 0.84, pronunciationEvidence: "UNAVAILABLE",
};
const speakingJob: AssessmentJobView = {
  id: "assessment-1", skill: "speaking", program: "MULTILEVEL", status: "NEEDS_REVIEW", policyMode: "FULL_MOCK_AI_WITH_REVIEW", version: 3,
  aiScore: 61, teacherScore: null, finalScore: null, finalScoreSource: null, confidence: 0.84, rubricVersion: "ML_V1", promptVersion: "PROMPT_V1", evaluation: { result }, approvedFeedback: null,
  parts: [{ id: "1.1", max: 5, task: "Part 1.1 personal questions", context: "Describe your everyday life" }],
  submissions: [1, 2, 3].map((index) => ({ questionId: `q-${index}`, partId: "1.1", prompt: `Personal question ${index}`, context: "", originalResponse: "", wordCount: 0, audioUrl: "https://untrusted.invalid/recording", transcript: { text: `Transcript ${index} <img src=x onerror=unsafe()>`, confidence: 0.9, segments: [{ start: 0, end: 1.5, text: "A short answer", confidence: 0.9 }], pronunciationEvidence: "UNAVAILABLE" } })),
};

const render = (job: AssessmentJobView, isStaff = false) => renderToStaticMarkup(React.createElement(AssessmentCard, { job, attemptId: "attempt-1", isStaff }));

describe("assessment feedback presentation", () => {
  it("keeps three original recordings with one formal holistic /5 part score", () => {
    const html = render(speakingJob);
    expect((html.match(/<audio /g) ?? []).length).toBe(3);
    expect((html.match(/AI raw task\/part estimate/g) ?? []).length).toBe(1);
    expect(html).toContain("One holistic part score covers all these recordings");
    expect(html).toContain("Estimated Multilevel Speaking Score");
    expect(html).toContain("61 /75");
    expect(html).toContain("Teacher review required");
    expect(html).toContain("The final result remains pending");
  });
  it("escapes transcripts and examples and restricts audio to the authorized proxy", () => {
    const html = render(speakingJob);
    expect(html).toContain("&lt;img src=x onerror=unsafe()&gt;");
    expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("untrusted.invalid");
    expect(html).toContain("/api/backend/mock/attempts/attempt-1/answers/q-1/audio");
  });
  it("displays pronunciation limitations and separates original, transcript, feedback and example", () => {
    const html = render(speakingJob);
    expect(html).toContain("A transcript cannot establish a pronunciation band");
    expect(html).toContain("Original submitted audio");
    expect(html).toContain("Transcript timing");
    expect(html).toContain("Improved example");
    expect(html).toContain("from your unchanged original submission");
    expect(html).toContain("Supporting side");
    expect(html).toContain("Opposing side");
    expect(html).toContain("Missing");
  });
  it("preserves writing content and word count independently from the learning example", () => {
    const writing = { ...speakingJob, skill: "writing" as const, submissions: [{ questionId: "writing-1", partId: "1.1", prompt: "Informal email", context: "Reply to your friend", originalResponse: "My original essay <b>keep it</b>", wordCount: 52, audioUrl: null, transcript: null }] };
    const before = JSON.stringify(writing);
    const html = render(writing);
    expect(html).toContain("My original essay &lt;b&gt;keep it&lt;/b&gt;");
    expect(html).toContain("52 words");
    expect(html).toContain("Improved example only");
    expect(html).not.toContain("<audio");
    expect(JSON.stringify(writing)).toBe(before);
  });
  it("does not render teacher actions to students", () => {
    const html = render(speakingJob);
    expect(html).not.toContain("Teacher assessment review");
    expect(html).not.toContain("Accept AI result");
    expect(html).not.toContain("Override score");
    expect(html).not.toContain("Request re-grade");
  });
  it("offers all five teacher actions with a reason and raw holistic override fields", () => {
    const html = render(speakingJob, true);
    for (const action of ["Accept AI result", "Override score", "Edit / approve student feedback", "Request re-grade", "Mark needs review"]) expect(html).toContain(action);
    expect(html).toContain("Review reason");
    expect(html).toContain("original AI evaluation");
  });
  it("retains original AI feedback alongside teacher-approved feedback", () => {
    const approved = { ...result, priorityImprovements: ["Teacher-approved advice"] };
    const html = render({ ...speakingJob, approvedFeedback: approved, status: "SUCCEEDED", teacherScore: 65, finalScore: 65, finalScoreSource: "TEACHER" }, true);
    expect(html).toContain("Teacher-approved advice");
    expect(html).toContain("Original AI feedback (retained)");
    expect(html).toContain("Address both sides");
    expect(html).toContain("Teacher reviewed");
  });
  it("keeps IELTS pronunciation pending and prevents incomplete accept", () => {
    const html = render({ ...speakingJob, program: "IELTS_ACADEMIC", aiScore: null, evaluation: { result: { ...result, parts: [{ ...result.parts[0], rawScore: null, criteria: { fluency: 7, lexical: 7, grammar: 6.5, pronunciation: null } }] } } }, true);
    expect(html).toContain("Estimated IELTS Speaking Band");
    expect(html).not.toContain(" /75");
    expect(html).toContain("Listen to the original audio before assigning pronunciation");
    expect(html).toContain('max="9"');
    expect(html).toContain('value="OVERRIDE"');
  });
});

describe("assessment status resilience", () => {
  it("shows a failure fallback without hiding original recordings", () => {
    const html = render({ ...speakingJob, status: "FAILED", evaluation: null, aiScore: null, submissions: speakingJob.submissions.map((submission) => ({ ...submission, transcript: null })) });
    expect(html).toContain("Failed — manual review pending");
    expect(html).toContain("Teacher review can complete this assessment");
    expect(html).toContain("No transcript");
    expect(html).toContain("/answers/q-1/audio");
  });
  it("shows a saved-submission fallback when status loading fails", () => {
    hookState.error = true; hookState.data = undefined;
    const html = renderToStaticMarkup(React.createElement(AssessmentPanel, { attemptId: "attempt-1", isStaff: false }));
    expect(html).toContain("Your submission is saved");
    expect(html).toContain("Refresh assessment");
    hookState.error = false;
  });
  it("shows a manual refresh state after bounded polling pauses", () => {
    hookState.pollingStopped = true;
    hookState.data = { attemptId: "attempt-1", assessments: [{ ...speakingJob, status: "PROCESSING" }] };
    const html = renderToStaticMarkup(React.createElement(AssessmentPanel, { attemptId: "attempt-1", isStaff: false }));
    expect(html).toContain("Automatic updates have paused");
    expect(html).toContain("Refresh assessment");
    hookState.pollingStopped = false; hookState.data = undefined;
  });
});
