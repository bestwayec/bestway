import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAM_IMPORT_TEMPLATES, createExamImportTemplate, serializeExamImportTemplate } from "./import-templates";
import { MULTILEVEL_LISTENING, MULTILEVEL_READING, MULTILEVEL_SPEAKING, MULTILEVEL_WRITING } from "./template-packages";

/**
 * The backend validates and imports every committed fixture
 * (backend-django/tests/test_exam_templates_and_export.py), so a template the
 * real importer rejects fails CI. Regenerate after editing a template with:
 *   UPDATE_TEMPLATE_FIXTURES=1 npx vitest run src/components/exam-builder/template-packages.spec.ts
 */
const FIXED_NOW = new Date("2026-10-01T08:00:00.000Z");
const FIXTURES = join(__dirname, "../../../../backend-django/tests/fixtures/exam_import_templates");

type Pkg = {
  profile: string;
  exam: { type: string; sections: Array<{ skill: string; groups: Array<{ maxScore?: number; questions: Array<{ number: number; type: string }> }> }> };
  reviewIssues: unknown[];
};

describe("exam import template fixtures", () => {
  it.each(EXAM_IMPORT_TEMPLATES.map((t) => [t.id]))("%s matches its committed backend fixture", (id) => {
    const path = join(FIXTURES, `${id}.json`);
    const text = serializeExamImportTemplate(id, FIXED_NOW);
    if (process.env.UPDATE_TEMPLATE_FIXTURES === "1") {
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(path, text);
    }
    expect(existsSync(path), `missing fixture ${path}`).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  it("declares the exam type each package really uses", () => {
    for (const option of EXAM_IMPORT_TEMPLATES) {
      const pkg = createExamImportTemplate(option.id, FIXED_NOW) as Pkg;
      expect(pkg.exam.type).toBe(option.examType);
      expect(pkg.reviewIssues.length).toBeGreaterThan(0); // never publication-ready
      if (option.skill === "full") {
        expect(pkg.profile).toBe("full_mock");
        expect(pkg.exam.sections.map((s) => s.skill)).toEqual(["listening", "reading", "writing", "speaking"]);
      } else {
        expect(pkg.profile).toBe("practice");
        expect(pkg.exam.sections.map((s) => s.skill)).toEqual([option.skill]);
      }
    }
  });

  it("builds the Multilevel full mock from the configured blueprint (35 + 35 + 3 + 8)", () => {
    const pkg = createExamImportTemplate("multilevel-full", FIXED_NOW) as Pkg;
    const [listening, reading, writing, speaking] = pkg.exam.sections;
    expect(listening.groups.map((g) => g.questions.length)).toEqual(MULTILEVEL_LISTENING.map((p) => p.count));
    expect(reading.groups.map((g) => g.questions.length)).toEqual(MULTILEVEL_READING.map((p) => p.count));
    expect(writing.groups.map((g) => g.maxScore)).toEqual(MULTILEVEL_WRITING.map((t) => t.maxScore));
    expect(speaking.groups.map((g) => g.questions.length)).toEqual(MULTILEVEL_SPEAKING.map((p) => p.count));
    // Numbering restarts per section.
    for (const section of pkg.exam.sections) {
      const nums = section.groups.flatMap((g) => g.questions.map((q) => q.number));
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    }
  });

  it("offers both families for every skill tab", () => {
    for (const family of ["ielts", "multilevel"] as const) {
      for (const skill of ["full", "listening", "reading", "writing", "speaking"] as const) {
        expect(EXAM_IMPORT_TEMPLATES.some((t) => t.family === family && t.skill === skill), `${family}/${skill}`).toBe(true);
      }
    }
  });
});
