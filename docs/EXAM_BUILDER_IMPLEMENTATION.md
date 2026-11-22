# Exam Builder 2.0 — implementation notes

What changed in this pass and why. The existing editor, autosave, attempt engine and
scoring were kept; the work concentrated on the JSON import/export path and the templates,
where the audit found the defects (`EXAM_BUILDER_AUDIT.md`).

## Backend (`backend-django/apps/core`)

| File | Change |
|---|---|
| `mock_export.py` (new) | `export_package(actor, exam_id, skill=None)`: rows → schema-1.0 package. Deterministic keys (import source map first), one media declaration per distinct file, `requiredForPublish` for Listening audio, optional metadata, `practice` profile for single-skill exports. A fixed number of queries (≤ 7) whatever the exam size — no N+1 (test `test_export_uses_a_fixed_number_of_queries`). |
| `mock_import_views.py`, `urls.py` | `GET mock/exams/<id>/export` (also under `/v1/`). |
| `mock_import_validate.py` | Optional question fields `cefrLevel`, `skillTags`, `evidenceText`, `audioStartSec` (validated with the editor's own rules: `item_metadata`, `review_evidence`); optional group `maxScore` (Writing/Speaking 1–100) and `stimulusRef` (Writing); question-number uniqueness per skill; IELTS full-mock Reading counts passages. |
| `mock_imports.py` | `replaceExisting` (controlled replacement of the target draft's sections of the package's skills, same transaction, audit `mock.exam.import.replace`). Persists the new fields (`optional_question_columns`; evidence offset recomputed), `max_score`, `stimulus_ref`. |
| `multilevel.py` | Import-time blueprint check uses the package's `maxScore`/`stimulusRef` instead of forcing `None`. |
| `mock_content.py` | `reading_passage_count()` — mirror of the frontend `clusterReadingPassages`. |
| `mock_authoring.py` | Readiness `reading_groups` passes for 3 groups (unchanged) or 3 clustered passages. |

No migrations: every column already existed.

## Frontend (`frontend/src`)

| File | Change |
|---|---|
| `components/exam-builder/template-packages.ts` (new) | Multilevel templates generated from one spec table mirroring `multilevel.py`; IELTS Academic/General Writing, IELTS Speaking, IELTS full mock. |
| `components/exam-builder/import-templates.ts` | 18 templates with `family`, `skill`, `examType`; dispatcher; broken generators removed. |
| `components/exam-builder/import-json.ts` | `parsePackageWithLocation`/`locateJsonError` (line/column across V8 and Firefox messages), `summarizePackage`, `describeIssuePath`, `checkDraftDestination`, `formatJson`, `downloadJsonText`, `exportFileName`. Pure and unit-tested. |
| `components/exam-builder/JsonImportDialog.tsx` | Rebuilt: 3-step indicator; fixed header/footer with one scroll region; two-column source step (template family × skill, load/copy/download; editor with line/size counter, drag-and-drop, Format JSON, Ctrl/⌘+Enter); report step with package preview table, readable issues, destination after validation with compatibility, media binding; `initialTargetExamId` for importing into the open draft. |
| `components/exam-builder/ExportExamDialog.tsx` (new) | Whole exam or one skill. |
| `components/exam-builder/ExamBuilder.tsx` | Editor toolbar: **Import JSON** (drafts only, destination pre-selected) and **Export JSON**. |
| `components/exam-builder/ExamBuilderList.tsx` | Export action per exam (owner/admin). |
| `hooks/use-mock.ts` | `exportExamPackage`, `useExportExam`. |
| `messages/en.json`, `messages/uz.json` | 41 new `examBuilder.*` strings in both languages. |

## API changes

Additive only: one new GET route; new optional package fields. Existing request/response
shapes are unchanged.

## Rollback

Revert the two commits. No data migration to undo. Drafts imported with the new optional
fields keep their values in existing columns; exams imported as four-skill IELTS packages
remain valid exams (identical to exams imported skill by skill).
