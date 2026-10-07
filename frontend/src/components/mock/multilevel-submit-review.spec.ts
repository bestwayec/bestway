import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { multilevelMissingWork, type CompletenessSection, type MultilevelMissingWork } from "@/lib/multilevel-completeness";
import { MultilevelSubmitReview } from "./multilevel-submit-review";

const h = React.createElement;

const sections: CompletenessSection[] = [
  { skill: "listening", groups: [{ questions: [{ id: "l1", type: "multiple_choice" }, { id: "l2", type: "multiple_choice" }] }] },
  { skill: "reading", groups: [{ questions: [{ id: "r1", type: "true_false_notgiven" }, { id: "r2", type: "summary_completion" }] }] },
  { skill: "writing", groups: [{ questions: [{ id: "w1", type: "essay_task1" }] }] },
  { skill: "speaking", groups: [{ questions: [{ id: "s1", type: "speaking_task" }] }] },
];
const NOW = new Date("2026-10-07T10:00:00Z");
/** react-dom/server renders `disabled={true}` as this exact attribute. */
const DISABLED = 'disabled=""';
const completeAnswers = { l1: "library", l2: "library", r1: "TRUE", r2: "library", w1: "Dear friend," };

function render(work: MultilevelMissingWork, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(h(MultilevelSubmitReview, { work, onClose: vi.fn(), onConfirm: vi.fn(), onJump: vi.fn(), ...extra }));
}

describe("Multilevel pre-submit review surface", () => {
  it("allows the hand-in once every required section is complete", () => {
    const work = multilevelMissingWork(sections, completeAnswers, new Set(["s1"]), {}, NOW);
    const html = render(work);
    expect(html).toContain("Before you submit");
    expect(html).toContain("Every required section is complete.");
    expect(html).toContain("Complete · 2 / 2");
    expect(html).toContain("Submit exam");
    expect(html).not.toContain(DISABLED);
  });

  it("lists what is missing per section and blocks the hand-in", () => {
    const work = multilevelMissingWork(sections, { ...completeAnswers, r2: "" }, new Set(["s1"]), {}, NOW);
    const html = render(work);
    expect(html).toContain("1 of 6 required answer is still missing.");
    expect(html).toContain("📖 Reading");
    expect(html).toContain("1 of 2 unanswered");
    expect(html).toContain("Go to section");
    expect(html).toContain(DISABLED);
  });

  it("names an unrecorded speaking section as recordings, not answers", () => {
    const work = multilevelMissingWork(sections, completeAnswers, new Set(), {}, NOW);
    const html = render(work);
    expect(html).toContain("🎙️ Speaking");
    expect(html).toContain("1 of 1 not recorded");
  });

  it("marks a section whose clock ran out as not counted", () => {
    const work = multilevelMissingWork(sections, { ...completeAnswers, r1: "", r2: "" }, new Set(["s1"]), { sectionDeadlines: { reading: "2026-10-07T09:59:00Z" } }, NOW);
    const html = render(work);
    expect(html).toContain("Time ended — not counted");
    expect(html).not.toContain("2 of 2 unanswered");
    expect(html).toContain("Submit exam");
    expect(html).not.toContain(DISABLED);
  });

  it("warns before a one-way section move without blocking it", () => {
    const work = multilevelMissingWork(sections, completeAnswers, new Set(), {}, NOW);
    const html = render(work, { advance: true });
    expect(html).toContain("Before you move on");
    expect(html).toContain("Move on anyway");
    expect(html).toContain("closed behind you");
    expect(html).not.toContain(DISABLED);
  });

  it("shows the full-test sections that are not reached yet", () => {
    const work = multilevelMissingWork(sections, { w1: "Dear friend," }, new Set(["s1"]), { flowMode: "full_test", currentSkill: "writing" }, NOW);
    const html = render(work);
    expect(html).toContain("Not reached yet");
    expect(html).toContain("Every required section is complete.");
  });

  it("tells the student that a timed exam submits itself when the timer ends", () => {
    const work = multilevelMissingWork(sections, completeAnswers, new Set(["s1"]), { overallDeadlineAt: "2026-10-07T10:30:00Z" }, NOW);
    expect(render(work)).toContain("when the timer ends it submits by itself");
  });
});
