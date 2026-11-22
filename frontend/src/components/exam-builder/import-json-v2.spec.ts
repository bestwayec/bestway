import { describe, expect, it } from "vitest";
import {
  checkDraftDestination,
  describeIssuePath,
  formatJson,
  locateJsonError,
  parsePackageWithLocation,
  summarizePackage,
} from "./import-json";
import { createExamImportTemplate } from "./import-templates";

const NOW = new Date("2026-10-01T08:00:00.000Z");

describe("JSON syntax errors carry a line and column", () => {
  it("finds a missing comma on the right line (engine message)", () => {
    const text = '{\n  "a": 1\n  "b": 2\n}';
    const result = parsePackageWithLocation(text);
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "invalid-json") throw new Error("expected syntax error");
    expect(result.location.line).toBe(3);
    expect(result.location.column).toBeGreaterThanOrEqual(3);
    expect(text.slice(result.location.offset)).toMatch(/^"b"/);
  });

  it("understands Firefox-style messages", () => {
    const text = '{\n"a": }';
    const loc = locateJsonError(text, new SyntaxError("JSON.parse: unexpected character at line 2 column 6 of the JSON data"));
    expect(loc).toMatchObject({ line: 2, column: 6, offset: 7 });
    expect(loc.message).not.toMatch(/JSON data$/);
  });

  it("puts a truncated document at its end", () => {
    const text = '{\n  "a": [1, 2';
    const loc = locateJsonError(text, new SyntaxError("Unexpected end of JSON input"));
    expect(loc.line).toBe(2);
    expect(loc.offset).toBe(text.length);
  });

  it("keeps Uzbek and other Unicode text intact", () => {
    const result = parsePackageWithLocation('{"title": "Oʻzbekcha matn — ʼqoʻshtirnoqʼ"}');
    expect(result.ok && (result.value as { title: string }).title).toBe("Oʻzbekcha matn — ʼqoʻshtirnoqʼ");
  });

  it("rejects oversized input before parsing", () => {
    expect(parsePackageWithLocation(`"${"x".repeat(2 * 1024 * 1024)}"`)).toEqual({ ok: false, error: "too-large" });
  });
});

describe("package summary", () => {
  it("detects a full Multilevel mock", () => {
    const s = summarizePackage(createExamImportTemplate("multilevel-full", NOW));
    expect(s.kind).toBe("full_exam");
    expect(s.examType).toBe("multilevel");
    expect(s.sections.map((x) => [x.skill, x.questions, x.firstNumber, x.lastNumber])).toEqual([
      ["listening", 35, 1, 35],
      ["reading", 35, 1, 35],
      ["writing", 3, 1, 3],
      ["speaking", 8, 1, 8],
    ]);
    expect(s.durationMinutes).toBe(195);
  });

  it("detects a single skill and never throws on junk", () => {
    expect(summarizePackage(createExamImportTemplate("reading-passage-2", NOW)).kind).toBe("single_skill");
    expect(summarizePackage(null).kind).toBe("unknown");
    expect(summarizePackage({ exam: { sections: [1, null, { groups: "x" }] } }).sections).toHaveLength(3);
  });
});

describe("issue paths are readable", () => {
  const pkg = createExamImportTemplate("ielts-academic-full", NOW);
  it("names skill, group and question number", () => {
    const text = describeIssuePath("/exam/sections/1/groups/0/questions/2/correctAnswers", pkg);
    expect(text).toMatch(/^Reading › group 1 “.+” › Q3 › correctAnswers$/);
  });
  it("falls back gracefully", () => {
    expect(describeIssuePath("/exam/sections/9/groups/0", pkg)).toBe("sections[9] › group 1");
    expect(describeIssuePath("", pkg)).toBe("package");
    expect(describeIssuePath("/media/0/fileName", pkg)).toBe("media “writing-task-1-visual” › fileName");
  });
});

describe("draft destination check", () => {
  const reading = summarizePackage(createExamImportTemplate("reading-passage-1", NOW));
  it("blocks a different exam type", () => {
    expect(checkDraftDestination(reading, { id: "1", type: "multilevel", title: "M", skills: [], questionCount: 0 })).toMatchObject({ ok: false, reason: "type-mismatch" });
  });
  it("explains appending to an existing section", () => {
    expect(checkDraftDestination(reading, { id: "1", type: "ielts_academic", title: "I", skills: ["reading"], questionCount: 13 })).toEqual({ ok: true, reason: "appends-to-existing", sharedSkills: ["reading"] });
    expect(checkDraftDestination(reading, { id: "1", type: "ielts_academic", title: "I", skills: ["listening"], questionCount: 40 }).reason).toBe("adds-sections");
  });
});

it("formats JSON and refuses invalid input", () => {
  expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}\n');
  expect(formatJson("{")).toBeNull();
});
