import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Files moved onto next-intl must not regain hard-coded Uzbek UI text (English users saw it mid-exam).
 * Comments are stripped first: code comments in Uzbek are fine. Extend FILES as more screens are migrated.
 */
const FILES = ["src/components/mock/mock-runner.tsx", "src/components/mock/section-transition-modal.tsx"];
const UZBEK_UI = /\b(Belgila\w*|Belgini|daqiqa\w*|soniya\w*|yakunlandi|Keyingi|boshlash\w*|saqlandi|bo&apos;lim\w*|bo'lim\w*|bo‘lim\w*)\b/;

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("no hard-coded Uzbek UI text in migrated files", () => {
  for (const file of FILES) {
    it(file, () => {
      const code = stripComments(fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"));
      const hits = code.split("\n").map((line, i) => [i + 1, line] as const).filter(([, line]) => UZBEK_UI.test(line));
      expect(hits.map(([n, line]) => `${n}: ${line.trim()}`)).toEqual([]);
    });
  }
});
