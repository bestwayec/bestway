# Exam Builder audit (2026-11-22)

Scope: `/[locale]/exam-builder` (list, editor, Import JSON dialog), the schema-1.0 import
service, templates, export, and the paths from an imported exam to a student result.
Method: read the code, run every template through the real backend validator, run the
backend suite on PostgreSQL 16, the frontend suite, and real-browser journeys (Playwright,
Chromium, Next production build, Django, PostgreSQL). Nothing below is assumed; each item
lists how it was reproduced.

## Current architecture

| Layer | Where | Notes |
|---|---|---|
| Routes | `frontend/src/app/[locale]/(app)/exam-builder/{page,new/page,[id]/page}.tsx` | List, create wizard (`ExamSetup`), editor (`ExamBuilder`) |
| Editor | `frontend/src/components/exam-builder/*` (~20k lines) | Sidebar (sections/parts), centre editors per skill (`ReadingPassageEditor`, `ListeningPartEditor`, `WritingTaskEditor`, `SpeakingTaskEditor`, `GroupEditor`), right Review panel, `BuilderStepper`, preview, Smart/Excel/bulk paste importers, autosave with version checks |
| JSON import UI | `JsonImportDialog.tsx`, `import-json.ts`, `import-templates.ts` | |
| Import API | `backend-django/apps/core/mock_import_views.py`, `mock_import_validate.py`, `mock_imports.py` | schema 1.0, dry-run checksum, staged media, atomic commit, replay/idempotency, provenance + review issues |
| Content models | `apps/legacy_schema/models.py` (`MockExam → MockSection → MockQuestionGroup → MockQuestion`; Prisma-owned tables, `managed=False`) | Answer keys live on `MockQuestion.correctAnswers`; student shapes strip them (`mock_catalog.shape_exam`) |
| Blueprints | `apps/core/multilevel.py` (`UZBMB_MULTILEVEL_EN_2026_V2`), `apps/core/exam_blueprint.py` (IELTS, `isOfficial: False`) | Publish readiness in `mock_authoring.readiness` |
| Attempts | `mock_attempts.py`, `mock_attempt_views.py`, `mock_scoring.py` | Server timer, autosave, idempotent submit, scoring |

## Confirmed defects (fixed)

| # | Severity | Defect | Reproduction | Root cause | Fix |
|---|---|---|---|---|---|
| 1 | Critical | 3 of 12 advertised templates — **Full CBT** (the one selected by default in the reported screenshot), **Writing**, **Speaking** — were rejected by the importer (46 / 26 / 20 import-blocking issues). | Load template → Check import → "Needs corrections". Reproduced by feeding each template to `validate_package`. | The generators emitted fields the importer never accepted (`maxScore`, `stimulusRef`), omitted required strings (`passageText`, `contentHtml`, `audioScript`, `contentLayout`, `sourceRef`) and put `wordLimit` on essays. | Templates rebuilt; importer learned `maxScore`/`stimulusRef` (existing DB columns). All 18 templates now import (tests). |
| 2 | Critical | The "Multi-Level CBT Full" template was not a Multilevel exam: IELTS Listening (4 parts/40 Q) + IELTS Reading (3 passages/40 Q) + 3 writing + 5 speaking = 88 questions, labelled "Official 4-section", Speaking "15 min". | Inspect template JSON; `blueprint_issues` reported 133 structural problems. | Template assembled from the IELTS generators. | Rebuilt from the platform's own configured spec (`UZBMB_MULTILEVEL_EN_2026_V2`): Listening 6 parts/35, Reading 5 parts/35, Writing 3 tasks (5/5/6, shared stimulus), Speaking 4 parts (1.1, 1.2, 2, 3), 45/60/60/30 min. Only "upload audio" items remain. Not labelled official. |
| 3 | High | A four-skill IELTS package could never be imported. | Any package with Listening 1–40 and Reading 1–40 → `NUMBER_COLLISION` ×40. | Validator checked number uniqueness across the whole package for IELTS (per skill only for Multilevel), while the commit, the editor and existing exams (Mock 27 stores Listening 1–40 and Reading 1–40) number per skill. | Uniqueness is per skill for every exam type. |
| 4 | High | An IELTS Reading section authored as several task groups per passage (how every Reading template and the Smart importer build it) could never pass full-mock readiness. | Import the IELTS full mock → readiness `reading_groups` "13/3 passages". | Readiness and the validator counted groups, not passages; the student UI already clusters groups with identical passage text. | Count passages (`reading_passage_count`), keeping the old "exactly 3 groups" rule passing unchanged. A first version regressed `verify_mock27_postgres.py` (fixture with identical filler passages); fixed and covered by a test. |
| 5 | High | No JSON export existed: the round trip import → export → re-import was impossible; there was no way to back up or move an exam as JSON. | No route; no button. | Not implemented. | `GET /mock/exams/<id>/export[?skill=]`, Export buttons in list and editor. |
| 6 | Medium | The dialog footer (Create draft) scrolled out of view on laptop screens; issue list had its own nested scrollbar inside the scrolling dialog. | 1366×768, long report. | Whole `DialogContent` scrolled; `max-h-48 overflow-y-auto` list inside. | Fixed header/footer, one scroll region; verified at 1366×768 and 390×844 in Playwright. |
| 7 | Medium | JSON syntax errors said only "This is not valid JSON". | Paste JSON with a missing comma. | `JSON.parse` error discarded. | "JSON syntax error at line X, column Y", engine message, "Show in editor" selects the spot. |
| 8 | Medium | Issue paths were raw JSON pointers (`/exam/sections/1/groups/0/questions/4/correctAnswers`). | Any semantic error. | — | Shown as `Reading › group 1 “title” › Q5 › correctAnswers` with the pointer underneath. |
| 9 | Medium | Destination chosen before validation; drafts of another exam type were offered and failed only on commit (409). | Select an IELTS draft, import a Multilevel package. | No client-side compatibility check. | Destination chosen after validation; incompatible drafts disabled with the reason; appending to an existing skill is explained. Server still enforces (409). |
| 10 | Low | "Full CBT", "Writing", "Speaking" tab labels hard-coded in English; Writing/Speaking tabs contained only Multilevel templates; no IELTS Writing, IELTS General Training, IELTS Speaking or IELTS full-mock template. | Switch UI to Uzbek. | — | Family toggle (IELTS / CEFR Multilevel) × skill (Full mock, Listening, Reading, Writing, Speaking); 18 templates; strings in `en.json`/`uz.json`. |
| 11 | Low | A `.json` file was read into memory without a size check. | Choose a large file. | — | Refused above 2 MiB before reading. |

## Checked and not defective

- Atomicity: a rejected merge (number collision, type mismatch) leaves the draft and its
  `contentVersion` unchanged (test `test_rejected_merge_rolls_back_completely`).
- Replay/idempotency of the same package revision; checksum-bound commit (`MOCK_IMPORT_STALE`).
- Students: 403 on validate, commit, stage and export; the student exam and attempt payloads
  carry no `correctAnswers` (Playwright scenario E, existing `test_mock_authoring`).
- HTML sanitiser allow-list; media file names cannot contain paths; storage keys cannot escape
  the media root (existing tests).
- Autosave, resume and duplicate submit for an imported exam (scenario F): answer survives a
  reload, second submit is idempotent, a save after submission is refused.

## Data compatibility risks

- New package fields are optional; old packages validate exactly as before (all pre-existing
  import tests pass).
- The numbering rule is relaxed, never tightened: no package that imported before is now refused.
- The Reading passage rule only adds a way to pass; no exam that passed readiness now fails
  (`verify_readiness_contract_postgres.py` 65/65, `verify_mock27_postgres.py` 81/81).
- No database migration was needed (all columns existed).

## Security notes

- Export carries answer keys: `assert_author` (owner teacher or admin). Teacher → another
  teacher's exam: 403. Student: 403. Anonymous: 401.
- Export never includes media bytes or storage paths, only basenames.
- Untrusted JSON: size limit (client and server), duplicate-key rejection, unknown-field
  rejection, depth bounded by the fixed schema, sanitised HTML, no deserialisation beyond JSON.

## Not done in this pass (see `EXAM_BUILDER_TEST_REPORT.md` → Remaining)

Replace-a-section import, question-bank import destination, undo/redo, drag-and-drop
reordering beyond what the editor already has, rich-text tables in Writing prompts, and a
CEFR score conversion (none is invented).
