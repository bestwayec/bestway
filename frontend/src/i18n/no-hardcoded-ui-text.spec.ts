import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Files moved onto next-intl must not regain hard-coded Uzbek UI text (English users saw it mid-exam).
 * Comments are stripped first: code comments in Uzbek are fine. Extend FILES as more screens are migrated.
 */
const FILES = [
  "src/components/mock/mock-runner.tsx",
  "src/components/mock/section-transition-modal.tsx",
  "src/components/dashboard/student-dashboard.tsx",
  "src/components/dashboard/today-card.tsx",
  "src/components/mock/exam-launcher-modal.tsx",
  "src/components/mock/mic-check-modal.tsx",
  "src/components/mock/live-exam-pin-card.tsx",
  "src/components/mock/mock-result-view.tsx",
  "src/components/vocabulary/VocabularyQuizRunner.tsx",
  "src/components/vocabulary/VocabularyCatalogView.tsx",
  "src/app/[locale]/(app)/vocabulary/[id]/page.tsx",
  "src/app/[locale]/(app)/vocabulary/srs/page.tsx",
  "src/components/mock/submit-confirm-modal.tsx",
  "src/components/mock/exam-resume-modal.tsx",
  "src/components/mock/mock-exams-view.tsx",
  "src/components/mock/device-check.tsx",
  "src/components/profile/results-progress-card.tsx",
  "src/components/profile/profile-view.tsx",
  "src/components/mock/attempt-score-summary.tsx",
  "src/components/vocabulary/VocabBattleHost.tsx",
  "src/components/vocabulary/VocabBattlePlayer.tsx",
  "src/components/teacher/VocabularyBuilder.tsx",
  "src/components/mock/exam-toolbar.tsx",
  "src/components/mock/listening-engine.tsx",
  "src/components/mock/cbt-annotated-text.tsx",
  "src/components/mock/exam-notes-panel.tsx",
];
const UZBEK_UI = /\b(Ulanish|Yopish|hisoboti|Chop etish|tekshirilmoqda|tkazib|kiriting|urinish|savol|o&apos;tish|o'tish|jarayonda|davom ettir\w*|natijangiz|Belgila\w*|Belgini|daqiqa\w*|soniya\w*|yakunlandi|Keyingi|boshlash\w*|saqlandi|bo&apos;lim\w*|bo'lim\w*|bo‘lim\w*|Lug'at\w*|Lug&apos;at\w*|so'z\w*|so&apos;z\w*|to'plam\w*|to&apos;plam\w*|Mashq\w*|Xato\w*|xato\w*|Yangilash|Tanla\w*|yuklanmoqda|javob\w*|Hammasi|zlashtir\w*|marta|Holati|topshir\w*|Imtihon\w*|imtihon\w*|qaytish)\b/;

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
