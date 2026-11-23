# BESTWAY Learning Experience 3.0 — progress log

Base: `main` = `795bcaa` (NEXT 3.0 + Exam Builder 2.0 merged). Branch: `claude/blissful-planck-wa3s0n`.

## PR A — Exam Builder 2.0 completion

| Feature | Implementation | Verification |
|---|---|---|
| Undo / Redo | `undo-history.ts` (pure reducer + `useUndoableState`), `UndoRedoBar.tsx`; wired into the Reading, Listening and generic group editors. Typing bursts (600 ms) are one step; Save resets history (version boundary); panel switch remounts; Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y outside text fields (inside a field the browser's own text undo applies). Disabled in "Visual paste" mode, which keeps separate state. | `undo-history.spec.ts` 7 tests; browser U1–U8 |
| Question bank | `question_bank.py`: `GET /mock/question-bank/groups` (search, skill, exam type, question type, topic tag, CEFR; own exams for teachers, all for admins; no keys) and `POST /mock/exams/<id>/bank-insert` (copies whole groups, renumbers after the section, rewrites gap tokens, keeps keys/metadata/media references, atomic, IELTS↔Multilevel refused). `QuestionBankDialog.tsx`. | `test_exam_builder_completion.py` (3), PG script, browser Q1–Q5 |
| VALIDATED / ARCHIVED | Prisma migration `20261123000000_exam_lifecycle` (nullable `validatedAt`, `validatedVersion`, `archivedAt`); `mock_lifecycle.py` validate / archive / restore; VALIDATED is tied to `contentVersion` (any edit makes it stale). Archive unpublishes, locks content, keeps attempts and results. List tabs + badges, editor Validate button and archived banner. | backend tests (3), PG script, browser L1–L9 |
| Template export without keys | `GET /mock/exams/<id>/template[?skill=|groupId=]`: empty keys/variants, no evidence/timestamps, `"template": true`, open review issue; importer accepts keyless questions only in templates, as publish blockers. Export dialog "Template (no keys)". | backend tests (3), PG script, browser T1–T3 |

Bug found by the browser run (not by unit tests): `bulk_create` of `MockQuestion` fails on the real
schema because `type` is a PostgreSQL enum (Django-created test tables use varchar). Fixed with
per-row inserts; `scripts/verify_exam_builder_completion_postgres.py` now runs this path on the
Prisma schema in CI.
