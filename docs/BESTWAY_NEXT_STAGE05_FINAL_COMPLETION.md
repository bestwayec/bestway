# BESTWAY NEXT — Stage 05 final completion matrix

Session 2026-11-21 (continuation). Every "Done/Verified" row names the evidence; nothing here is
inferred from a passing unit test alone. Earlier rounds: `BESTWAY_NEXT_STAGE05_06_FINAL_REPORT.md`.

**STAGE 05: PARTIAL** — the core flows below are complete and verified; the items marked Partial or
Open remain.

## Feature matrix

| Area | Status | What exists / was done | Evidence |
| --- | --- | --- | --- |
| Public homepage | Done | hero, IELTS/Multilevel formats, placement CTA, courses with actions, student vs teacher benefits, demo-data result, FAQ, CTA, contact/footer; uz/en | Playwright link check, axe 0 violations, `docs/screenshots/stage05/` |
| Responsive layouts | Verified | public, student and teacher pages | 77 page × size combinations (360, 430, 768, 1024×768, 1366×768, 1440×900, 1920×1080): 0 horizontal overflow |
| Shared design system | Partial | semantic tokens enforced by `design-system.spec.ts`; classroom screens moved to one-primary-action + outline secondaries, emoji-icon duplicates removed | screenshots `docs/screenshots/stage05-final/` |
| Student dashboard | Done (web) | today plan, assignments (enrollment-aware), vocabulary, results, exams, recommended test; one shared assignments request | journey: 7 API requests, no duplicates |
| Teacher command center | Done (web) | KPIs, quick actions, live room, group performance, grading queue, payments | journey: 11 API requests, no duplicates |
| Classroom workspace | Done | create/edit, add/remove/transfer with history, schedule, attendance, assignments, analytics, exports, archive/restore | `verify_classroom_postgres.py` incl. cross-teacher 403; classroom now fully localized |
| Vocabulary — teacher | Done (XLSX open) | create/edit, bulk paste, CSV/TSV/TXT import, duplicates, synonyms/definitions/examples/levels, preview, revisions, assign, deadlines, completion and difficult-word reports, formula-safe exports | `verify_vocabulary_homework_postgres.py`; builder jsdom tests |
| Vocabulary — student (desktop) | Done | single-language study view, larger flashcards, progress bars, keyboard shortcuts, modes, daily review/SRS, pronunciation, offline download, restart persistence, exactly-once sync, history | `e2e/real-backend/vocabulary-cross-client.cjs` run (bw-tauri) |
| Cross-platform vocabulary acceptance | Verified (browser build) | web teacher assigns → desktop student offline + restart + sync once → desktop quiz 100% → teacher sees 100% on web and desktop paths | see release verification doc |
| Exams and results UX | Unchanged | secure engine, timers, autosave, recovery and grading untouched (no defect found that justified a change) | browser exam recovery CI green |
| Localization | Partial | homepage, assignments, transfer, classroom, analytics, desktop vocabulary migrated; guard extended | `no-hardcoded-ui-text.spec.ts`; other legacy screens (e.g. AI ranking, smart attendance dialog) still contain Uzbek literals |
| Accessibility | Partial | axe on public pages; roving tabs, labelled dialogs, progressbar roles, aria-hidden icons | no screen-reader session performed |
| Performance | Measured | dashboard request de-duplication; bundle sizes recorded | no 4 GB hardware measurement |

## Open items (owner-visible)

| Pri | Repo / file | Action | Acceptance |
| --- | --- | --- | --- |
| P1 | bestway `frontend/src/components/teacher/{group-ai-ranking,smart-attendance-dialog,group-analytics-dashboard}.tsx` | migrate remaining Uzbek literals to next-intl and add to the guard | guard passes; English classroom dialogs show no Uzbek |
| P2 | both | XLSX import with a reviewed parser dependency | same validation and duplicate rules as CSV |
| P2 | both | screen-reader pass on study view and exam window | issues logged and fixed |
| P2 | bw-tauri | 4 GB Windows memory/startup measurement | recorded working set for idle, study, exam |
