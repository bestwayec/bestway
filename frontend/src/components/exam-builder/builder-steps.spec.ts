import { describe, expect, it } from "vitest";
import type { MockExamDetail } from "@/lib/types";
import { builderSteps, neighbourStep, stepForSelection, STEP_ORDER } from "./builder-steps";
import { examClientChecks } from "./checks";

const q = (over: Record<string, unknown> = {}) => ({ id: "q", number: 1, type: "short_answer", prompt: "Where?", options: [], correctAnswers: ["Paris"], points: 1, ...over });
const group = (id: string, over: Record<string, unknown> = {}) => ({ id, sortOrder: 0, title: id, hasAudio: true, passageText: "text", questions: [q()], ...over });
const exam = (sections: unknown[], over: Record<string, unknown> = {}) =>
  ({ id: "e", title: "Mock", type: "ielts_academic", profile: "practice", isPublished: false, questionCount: 1, sections, ...over }) as unknown as MockExamDetail;
const section = (id: string, skill: string, groups: unknown[]) => ({ id, skill, groups });
const by = (steps: ReturnType<typeof builderSteps>, id: string) => steps.find((s) => s.id === id)!;

describe("builderSteps", () => {
  it("always lists the seven steps in order", () => {
    expect(builderSteps(exam([]), { previewed: false, blockers: 0 }).map((s) => s.id)).toEqual(STEP_ORDER);
  });

  it("an empty exam needs sections and questions before anything else", () => {
    const steps = builderSteps(exam([], { questionCount: 0 }), { previewed: false, blockers: 1 });
    expect(by(steps, "track")).toMatchObject({ status: "attention", issues: 1 });
    expect(by(steps, "questions").status).toBe("attention");
    expect(by(steps, "publish").status).toBe("attention");
  });

  it("a complete exam is done up to the preview, and publishing is open", () => {
    const steps = builderSteps(exam([section("s1", "reading", [group("g1")])]), { previewed: false, blockers: 0 });
    expect(["info", "track", "questions", "material", "keys"].map((id) => by(steps, id).status)).toEqual(["done", "done", "done", "done", "done"]);
    expect(by(steps, "preview").status).toBe("todo");
    expect(by(steps, "publish").status).toBe("todo");
  });

  it("points each concern at the first block that needs it", () => {
    const steps = builderSteps(
      exam([
        section("s1", "listening", [group("ok"), group("noAudio", { hasAudio: false })]),
        section("s2", "reading", [group("noKey", { questions: [q({ correctAnswers: [] })] }), group("empty", { questions: [] })]),
      ]),
      { previewed: true, blockers: 0 },
    );
    expect(by(steps, "material")).toMatchObject({ status: "attention", issues: 1, target: { kind: "select", selection: { kind: "group", groupId: "noAudio" } } });
    expect(by(steps, "keys")).toMatchObject({ status: "attention", issues: 1, target: { kind: "select", selection: { kind: "group", groupId: "noKey" } } });
    expect(by(steps, "questions")).toMatchObject({ status: "attention", target: { kind: "select", selection: { kind: "group", groupId: "empty" } } });
    expect(by(steps, "preview").status).toBe("done");
  });

  it("a section without blocks is a structure problem", () => {
    const steps = builderSteps(exam([section("s1", "writing", [])], { questionCount: 0 }), { previewed: false, blockers: 0 });
    expect(by(steps, "track")).toMatchObject({ status: "attention", target: { kind: "select", selection: { kind: "section", sectionId: "s1" } } });
  });

  it("accepts linked task groups and source-only groups in readiness", () => {
    const detail = exam([
      section("r", "reading", [
        group("passage", { stimulusRef: "source", questions: [] }),
        group("reading-task", { stimulusRef: "source", passageText: "" }),
      ]),
      section("l", "listening", [
        group("part", { partNumber: 1, questions: [] }),
        group("listening-task", { partNumber: 1, hasAudio: false }),
      ]),
    ]);
    const steps = builderSteps(detail, { previewed: true, blockers: 0 });
    expect(by(steps, "material").status).toBe("done");
    expect(by(steps, "questions").status).toBe("done");
    expect(examClientChecks(detail.sections).filter((check) => check.level === "error")).toEqual([]);
  });

  it("publishing is done only when published and nothing blocks it", () => {
    const published = exam([section("s1", "reading", [group("g1")])], { isPublished: true });
    expect(by(builderSteps(published, { previewed: true, blockers: 0 }), "publish").status).toBe("done");
    expect(by(builderSteps(published, { previewed: true, blockers: 2 }), "publish")).toMatchObject({ status: "attention", issues: 2 });
  });
});

describe("step navigation", () => {
  it("maps a selection to its step and keeps a chosen material/keys step on a block", () => {
    expect(stepForSelection({ kind: "overview" }, null)).toBe("info");
    expect(stepForSelection({ kind: "section", sectionId: "s" }, null)).toBe("track");
    expect(stepForSelection({ kind: "group", groupId: "g" }, null)).toBe("questions");
    expect(stepForSelection({ kind: "group", groupId: "g" }, "keys")).toBe("keys");
    expect(stepForSelection({ kind: "review" }, null)).toBe("publish");
  });
  it("clamps at both ends", () => {
    expect(neighbourStep("info", -1)).toBe("info");
    expect(neighbourStep("publish", 1)).toBe("publish");
    expect(neighbourStep("questions", 1)).toBe("material");
  });
});
