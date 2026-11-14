import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Design-system guard (docs/design/DESIGN_SYSTEM.md).
 *
 * Every file listed here has been moved onto the semantic colour tokens. Running the colour codemod
 * on it again must change nothing; otherwise a raw palette class (fixed colour that ignores the
 * light/dark theme) came back. Fix it with:  node scripts/tokenize-colors.mjs <file>
 */
const MIGRATED: Record<string, { neutralOnly?: boolean }> = {
  // Student shell: landing, login, dashboards, exam list, result
  "src/app/[locale]/(marketing)/page.tsx": {},
  "src/app/[locale]/(auth)/login/page.tsx": {},
  "src/components/auth/login-form.tsx": {},
  "src/components/auth/google-auth-button.tsx": {},
  "src/components/placement/ExpressPlacementTest.tsx": {},
  "src/components/marketing/teacher-card.tsx": {},
  "src/components/mobile/mobile-welcome-screen.tsx": {},
  "src/components/dashboard/StudentAssignmentsWidget.tsx": {},
  "src/components/dashboard/teacher-dashboard.tsx": {},
  "src/components/teacher/live-exam-room-panel.tsx": {},
  "src/components/profile/exam-track-selector.tsx": {},
  "src/components/mock/exam-resume-modal.tsx": {},
  "src/components/mock/mock-result-view.tsx": {},
  "src/components/mock/attempt-score-summary.tsx": {},
  "src/components/mock/assessment-panel.tsx": {},
  "src/components/mock/exam-feedback-modal.tsx": {},
  "src/components/mock/ai-diagnostic-coach.tsx": {},
  "src/components/mock/cefr-result-infographic.tsx": { neutralOnly: true },
  // Exam runner (all 4 sections) and the CD simulator
  "src/components/mock/mock-runner.tsx": {},
  "src/components/mock/cbt-section-stepper.tsx": {},
  "src/components/mock/writing-image-ocr.tsx": {},
  "src/components/mock/submit-confirm-modal.tsx": {},
  "src/components/mock/section-transition-modal.tsx": {},
  "src/components/mock/exam-locker.tsx": {},
  "src/components/mock/multilevel-submit-review.tsx": {},
  "src/components/mock/mic-check-modal.tsx": {},
  "src/components/mock/device-check.tsx": {},
  "src/components/profile/results-progress-card.tsx": {},
  "src/components/dashboard/score-prediction-card.tsx": {},
  "src/components/dashboard/WeakPointsTargetDrillModal.tsx": {},
  "src/components/demo/demo-runner.tsx": {},
  "src/app/[locale]/(marketing)/demo/[id]/page.tsx": {},
  "src/components/mock/ClickToVocabWrapper.tsx": {},
  "src/components/simulator/CDLayout.tsx": {},
  "src/components/mock/cbt-annotated-text.tsx": { neutralOnly: true },
  // Exam Builder, vocabulary, teacher workspace
  "src/components/exam-builder/BulkQuestionImporterModal.tsx": {},
  "src/components/exam-builder/ExamBuilderList.tsx": {},
  "src/components/exam-builder/ExamQuestionsEditorDialog.tsx": {},
  "src/components/exam-builder/ImportPanel.tsx": {},
  "src/components/exam-builder/OverviewPanel.tsx": {},
  "src/components/exam-builder/SmartBulkImportModal.tsx": {},
  "src/components/exam-builder/SpeakingTaskEditor.tsx": {},
  "src/components/exam-builder/WritingTaskEditor.tsx": {},
  "src/components/vocabulary/VocabularyCatalogView.tsx": {},
  "src/components/vocabulary/VocabularyQuizRunner.tsx": {},
  "src/components/vocabulary/VocabBattleHost.tsx": {},
  "src/components/vocabulary/VocabBattlePlayer.tsx": {},
  "src/components/vocabulary/battle-answer-styles.ts": { neutralOnly: true },
  "src/app/[locale]/(app)/vocabulary/[id]/page.tsx": {},
  "src/app/[locale]/(app)/vocabulary/srs/page.tsx": {},
  "src/components/teacher/CohortProgressTable.tsx": {},
  "src/components/teacher/CreateAssignmentModal.tsx": {},
  "src/components/teacher/TeacherCohortList.tsx": {},
  "src/components/teacher/TeacherWorkspaceView.tsx": {},
  "src/components/teacher/VocabularyBuilder.tsx": {},
  "src/components/teacher/VocabularyGroupReport.tsx": {},
  "src/components/exam-builder/visual-editor/QuestionChip.tsx": { neutralOnly: true },
};

const root = path.resolve(__dirname, "..");
type Codemod = {
  tokenizeSource: (src: string, opts?: { neutralOnly?: boolean }) => string;
  fixUndefinedAliases: (src: string) => string;
};
let codemod: Codemod;

beforeAll(async () => {
  const modulePath = pathToFileURL(path.join(root, "scripts/tokenize-colors.mjs")).href;
  codemod = (await import(/* @vite-ignore */ modulePath)) as Codemod;
});

describe("colour codemod", () => {
  it("maps neutrals, brand and status colours to theme tokens", () => {
    expect(codemod.tokenizeSource('className="bg-white dark:bg-slate-900 text-slate-900 border-slate-200"')).toBe(
      'className="bg-surface text-fg border-border"',
    );
    expect(codemod.tokenizeSource('"bg-emerald-500 text-white hover:bg-emerald-600"')).toBe(
      '"bg-brand text-brand-fg hover:bg-brand-hover"',
    );
    expect(codemod.tokenizeSource('"bg-red-50 text-red-700 border-red-200"')).toBe(
      '"bg-danger-bg text-danger border-danger-border"',
    );
    expect(codemod.tokenizeSource('"text-white/60 bg-white/5 border-white/10"')).toBe(
      '"text-fg-muted bg-surface-hover border-border"',
    );
  });

  it("keeps overlays, text on saturated fills and categorical hues", () => {
    expect(codemod.tokenizeSource('"fixed inset-0 bg-black/60"')).toBe('"fixed inset-0 bg-black/60"');
    expect(codemod.tokenizeSource('"bg-red-600 text-white"')).toBe('"bg-danger text-white"');
    expect(codemod.tokenizeSource('"bg-amber-400 text-slate-950"')).toBe('"bg-warning text-slate-950"');
    expect(codemod.tokenizeSource("a text-blue-500\nb text-purple-500 bg-white")).toBe(
      "a text-blue-500\nb text-purple-500 bg-surface",
    );
    expect(codemod.tokenizeSource('"text-red-500 bg-slate-900"', { neutralOnly: true })).toBe(
      '"text-red-500 bg-surface"',
    );
  });
});

describe("no undefined colour names", () => {
  it("maps shadcn names that globals.css never defined", () => {
    expect(codemod.fixUndefinedAliases('"text-muted-foreground bg-destructive/10 hover:bg-muted bg-card text-foreground"')).toBe(
      '"text-fg-muted bg-danger/10 hover:bg-bg-subtle bg-surface text-fg"',
    );
  });

  it("are used nowhere in src (they compile to no CSS)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".spec.ts")) {
          const source = fs.readFileSync(full, "utf8");
          if (codemod.fixUndefinedAliases(source) !== source) offenders.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("migrated screens use theme tokens only", () => {
  for (const [file, opts] of Object.entries(MIGRATED)) {
    it(file, () => {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      const again = codemod.tokenizeSource(source, opts);
      const changed = source
        .split("\n")
        .map((line, i) => [i + 1, line, again.split("\n")[i]] as const)
        .filter(([, before, after]) => before !== after)
        .map(([n, before]) => `${file}:${n}: ${before.trim()}`);
      expect(changed).toEqual([]);
    });
  }
});
