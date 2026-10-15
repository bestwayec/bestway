import { describe, expect, it } from "vitest";
import {
  EXAM_IMPORT_TEMPLATES,
  createExamImportTemplate,
  serializeExamImportTemplate,
} from "./import-templates";
import { clusterReadingPassages } from "./reading-passage-clusters";

interface TemplateQuestion {
  number: number;
  type: string;
  correctAnswers: string[];
}

interface TemplateGroup {
  passageText: string;
  contentHtml: string;
  partNumber?: number;
  audioPlayLimit?: number;
  audioRef?: string;
  questions: TemplateQuestion[];
}

interface TemplatePackage {
  packageId: string;
  exam: { sections: Array<{ groups: TemplateGroup[] }> };
}

describe("exam import templates", () => {
  it.each([
    ["reading-passage-1", 1, 13],
    ["reading-passage-2", 14, 26],
    ["reading-passage-3", 27, 40],
  ] as const)("builds %s with one passage range", (id, start, end) => {
    const pkg = createExamImportTemplate(
      id,
      new Date("2026-10-01T08:00:00.000Z"),
    ) as unknown as TemplatePackage;
    const groups = pkg.exam.sections[0].groups;
    const questions = groups.flatMap((group) => group.questions);

    expect(pkg.packageId).toBe(`${id}-20261001080000`);
    expect(questions.map((q) => q.number)).toEqual(
      Array.from({ length: end - start + 1 }, (_, offset) => start + offset),
    );
    expect(new Set(groups.map((group) => group.passageText)).size).toBe(1);
    expect(clusterReadingPassages(groups)).toHaveLength(1);
    expect(groups.some((group) => group.contentHtml.includes("data-gap="))).toBe(true);
    expect(questions.every((q) => q.correctAnswers.length > 0)).toBe(true);

    for (const group of groups.filter((item) => item.contentHtml)) {
      const gaps = [...group.contentHtml.matchAll(/data-gap="(\d+)"/g)].map((match) => Number(match[1]));
      expect(gaps).toEqual(group.questions.map((question) => question.number));
    }
  });

  it("builds one complete Academic Reading package with three passages and 40 questions", () => {
    const pkg = createExamImportTemplate(
      "academic-reading-full",
      new Date("2026-10-01T08:00:00.000Z"),
    ) as unknown as TemplatePackage;
    const groups = pkg.exam.sections[0].groups;
    const questions = groups.flatMap((group) => group.questions);

    expect(pkg.packageId).toBe("academic-reading-full-20261001080000");
    expect(new Set(groups.map((group) => group.passageText)).size).toBe(3);
    expect(clusterReadingPassages(groups)).toHaveLength(3);
    expect(questions).toHaveLength(40);
    expect(questions.map((question) => question.number)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(questions.every((question) => question.correctAnswers.length > 0)).toBe(true);
    expect(new Set(questions.map((question) => question.type))).toEqual(
      new Set([
        "multiple_choice",
        "multi_select",
        "true_false_notgiven",
        "yes_no_notgiven",
        "matching",
        "matching_headings",
        "sentence_completion",
        "note_completion",
        "summary_completion",
        "table_completion",
        "short_answer",
        "map_labelling",
      ]),
    );
  });

  it("builds a complete Listening package with four parts and 40 questions", () => {
    const pkg = createExamImportTemplate(
      "listening-full",
      new Date("2026-10-01T08:00:00.000Z"),
    ) as unknown as TemplatePackage & { media: unknown[] };
    const groups = pkg.exam.sections[0].groups;
    const questions = groups.flatMap((group) => group.questions);

    expect(pkg.packageId).toBe("listening-full-20261001080000");
    expect(groups).toHaveLength(4);
    expect(groups.map((group) => group.partNumber)).toEqual([1, 2, 3, 4]);
    expect(groups.every((group) => group.audioPlayLimit === 1)).toBe(true);
    expect(groups.every((group) => group.audioRef === undefined)).toBe(true);
    expect(pkg.media).toEqual([]);
    expect(questions).toHaveLength(40);
    expect(questions.map((question) => question.number)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(questions.every((question) => question.correctAnswers.length > 0)).toBe(true);
  });

  it.each([
    ["listening-part-1", 1, 10, 1],
    ["listening-part-2", 11, 20, 2],
    ["listening-part-3", 21, 30, 3],
    ["listening-part-4", 31, 40, 4],
  ] as const)("builds %s as one editable Part without embedded audio", (id, start, end, partNumber) => {
    const pkg = createExamImportTemplate(
      id,
      new Date("2026-10-01T08:00:00.000Z"),
    ) as unknown as TemplatePackage & { media: unknown[] };
    const groups = pkg.exam.sections[0].groups;

    expect(groups).toHaveLength(1);
    expect(groups[0].partNumber).toBe(partNumber);
    expect(groups[0].audioRef).toBeUndefined();
    expect(pkg.media).toEqual([]);
    expect(groups[0].questions.map((question) => question.number)).toEqual(
      Array.from({ length: end - start + 1 }, (_, offset) => start + offset),
    );
  });

  it("exposes every template and serializes valid JSON", () => {
    expect(EXAM_IMPORT_TEMPLATES).toHaveLength(12);
    expect(EXAM_IMPORT_TEMPLATES.filter((template) => template.skill === "reading")).toHaveLength(4);
    expect(EXAM_IMPORT_TEMPLATES.filter((template) => template.skill === "listening")).toHaveLength(5);
    expect(EXAM_IMPORT_TEMPLATES.filter((template) => template.skill === "multilevel")).toHaveLength(1);
    expect(EXAM_IMPORT_TEMPLATES.filter((template) => template.skill === "writing")).toHaveLength(1);
    expect(EXAM_IMPORT_TEMPLATES.filter((template) => template.skill === "speaking")).toHaveLength(1);
    for (const template of EXAM_IMPORT_TEMPLATES) {
      expect(() => JSON.parse(serializeExamImportTemplate(template.id))).not.toThrow();
    }
  });
});
