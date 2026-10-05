import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { toPreviewGroup, type PreviewGroupSource } from "./preview-group";
import { clusterDisplayPassages, unavailablePreviewOptions } from "./reading-preview-model";
import type { PreviewGroup } from "./StudentPreview";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { ReadingTaskGroup } from "./reading-task-group";
import { StudentPreview } from "./StudentPreview";

function group(id: string, numbers: number[], optionsReusable: boolean | null = false): PreviewGroup {
  return toPreviewGroup({
    id, passageText: "Shared passage.", instructions: "Match each paragraph.",
    contentLayout: "paragraphs", optionsReusable,
    questions: numbers.map((number) => ({
      id: `q${number}`, number, type: "matching", prompt: `Paragraph ${number}`,
      options: ["River", "Station", "Park"],
    })),
  });
}

describe("full-exam preview adapter", () => {
  it("retains layout, reuse and explicit answer rules without exposing keys or source scripts", () => {
    const authored = {
      id: "g1", contentLayout: "notes", optionsReusable: false, audioScript: "Source script",
      questions: [{ id: "q1", number: 1, type: "note_completion", prompt: "Location",
        answerRule: "ONE_WORD", wordLimit: 3, correctAnswers: ["secret"], acceptedVariants: ["hidden"] }],
    };
    const preview = toPreviewGroup(authored as PreviewGroupSource);
    expect(preview).toMatchObject({ contentLayout: "notes", optionsReusable: false,
      questions: [{ answerRule: "ONE_WORD", wordLimit: 3 }] });
    expect(JSON.stringify(preview)).not.toMatch(/correctAnswers|acceptedVariants|audioScript|secret|hidden/);
  });

  it("keeps null rules and reuse metadata compatible with legacy previews", () => {
    const preview = toPreviewGroup({ id: "legacy", questions: [{ id: "q1", number: 1,
      type: "short_answer", prompt: "Answer", wordLimit: 2 }] });
    expect(preview.optionsReusable).toBeNull();
    expect(preview.contentLayout).toBeNull();
    expect(preview.questions[0]).toMatchObject({ wordLimit: 2, answerRule: null, points: 1 });
    expect(toPreviewGroup({ id: "empty" }).questions).toEqual([]);
  });
});

describe("reading matching preview scope", () => {
  it("retains separate banks when two source groups merge into a single task block", () => {
    const [passage] = clusterDisplayPassages([group("a", [1, 2]), group("b", [3, 4])]);
    const [block] = passage.blocks;
    expect(passage.blocks).toHaveLength(1);
    expect(block.matchingGroups.map((g) => g.id)).toEqual(["a", "b"]);
    const answers = { q1: "River", q3: "Station" };
    expect(unavailablePreviewOptions(block, answers, "q2")).toEqual(["River"]);
    expect(unavailablePreviewOptions(block, answers, "q4")).toEqual(["Station"]);
    expect(unavailablePreviewOptions(block, answers, "q1")).toEqual([]);
  });

  it("uses siblings in other displayed task blocks while excluding unrelated choice answers", () => {
    const mixed = group("a", [1, 2, 3]);
    mixed.questions[1].type = "multiple_choice";
    mixed.questions[2].type = "matching_headings";
    const [passage] = clusterDisplayPassages([mixed]);
    expect(passage.blocks).toHaveLength(3);
    expect(unavailablePreviewOptions(passage.blocks[2], { q1: "River", q2: "Station" }, "q3"))
      .toEqual(["River"]);
  });

  it.each([true, null] as const)("allows repeated options when reuse is %s", (reuse) => {
    const [passage] = clusterDisplayPassages([group("a", [1, 2], reuse)]);
    expect(unavailablePreviewOptions(passage.blocks[0], { q1: "River" }, "q2")).toEqual([]);
  });

  it("renders the shared objective control with an already-used option disabled", () => {
    const [passage] = clusterDisplayPassages([group("a", [1, 2])]);
    const html = renderToStaticMarkup(React.createElement(ReadingTaskGroup, {
      block: passage.blocks[0], answers: { q1: "River" }, onAnswer: () => {},
    }));
    const inputs = html.match(/<input\b[^>]*>/g) ?? [];
    const selected = inputs.find((tag) => tag.includes('name="objective-answer-q1"') && tag.includes('value="River"'));
    const unavailable = inputs.find((tag) => tag.includes('name="objective-answer-q2"') && tag.includes('value="River"'));
    expect(selected).toContain('checked=""');
    expect(selected).not.toContain('disabled=""');
    expect(unavailable).toContain('disabled=""');
    expect(html).toContain("Already used");
  });
});

describe("inline gap rule metadata", () => {
  const gap = toPreviewGroup({ id: "notes", contentLayout: "notes",
    contentHtml: '<p>Room <span data-gap="7"></span></p>',
    questions: [{ id: "q7", number: 7, type: "note_completion", prompt: "Room",
      answerRule: "ONE_WORD_AND_OR_NUMBER" }],
  });

  it("keeps the rule on the reading document input", () => {
    const [passage] = clusterDisplayPassages([gap]);
    const html = renderToStaticMarkup(React.createElement(ReadingTaskGroup, {
      block: passage.blocks[0], answers: {}, onAnswer: () => {},
    }));
    expect(html).toContain('title="ONE WORD AND/OR A NUMBER"');
    expect(html.match(/<input\b/g)).toHaveLength(1);
  });

  it("keeps the same rule on the listening preview input", () => {
    const html = renderToStaticMarkup(React.createElement(StudentPreview, { group: gap, skill: "listening" }));
    expect(html).toContain('title="ONE WORD AND/OR A NUMBER"');
    expect(html.match(/<input\b/g)).toHaveLength(1);
  });
});
