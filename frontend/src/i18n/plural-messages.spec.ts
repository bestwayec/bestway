import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import uz from "../../messages/uz.json";

/**
 * Count messages run through the real ICU formatter. A plural only works with a number:
 * "Target: {target, plural, …}" with target "150+" printed "Target: NaN words".
 */
describe("count messages with the real formatter", () => {
  const t = createTranslator({ locale: "en", messages: en });
  const tu = createTranslator({ locale: "uz", messages: uz });

  it("plural messages say 1 thing and 2 things", () => {
    expect(t("mock.runnerUx.wordCount", { count: 1 })).toBe("1 word");
    expect(t("mock.runnerUx.wordCount", { count: 2 })).toBe("2 words");
    expect(t("groups.studentsCount", { count: 1 })).toBe("1 student");
    expect(t("mock.examTools.timeWarning", { minutes: 1 })).toBe("1 minute left.");
    expect(t("mock.examTools.timeWarning", { minutes: 5 })).toBe("5 minutes left.");
    expect(t("mock.runnerUx.paragraphCount", { count: 1 })).toBe("1 paragraph");
    expect(t("mock.runnerUx.paragraphCount", { count: 3 })).toBe("3 paragraphs");
    expect(t("mock.runnerUx.timeOnTaskOf", { minutes: 12, suggested: 20 })).toBe("12 min on this task · suggested 20 min");
  });

  it("a word target is text (150+, ~150, 150–250), never a plural", () => {
    for (const target of ["150+", "~150", "150–250"]) {
      expect(t("mock.runnerUx.wordTarget", { target })).toBe(`Target: ${target} words`);
      expect(tu("mock.runnerUx.wordTarget", { target })).not.toContain("NaN");
    }
  });

  it("no English plural message prints NaN for a number", () => {
    const failures: string[] = [];
    const walk = (node: Record<string, unknown>, path: string[]) => {
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === "object") walk(value as Record<string, unknown>, [...path, key]);
        else if (typeof value === "string" && value.includes(", plural,")) {
          const names = [...value.matchAll(/\{(\w+)/g)].map((m) => m[1]);
          const values = Object.fromEntries(names.map((name) => [name, 2]));
          const out = t(([...path, key].join(".")) as never, values as never) as string;
          if (out.includes("NaN")) failures.push([...path, key].join("."));
        }
      }
    };
    walk(en as unknown as Record<string, unknown>, []);
    expect(failures).toEqual([]);
  });
});
