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

PR A merged: [#222](https://github.com/bestwayec/bestway/pull/222) → `7dc2398` (CI 4/4).

## PR B — Pronunciation engine + Vocabulary Exam 3.0

| Feature | Implementation | Verification |
|---|---|---|
| Two-play pronunciation | `lib/pronunciation/engine.ts` + `react.tsx` (see `BESTWAY_VOCAB_AUDIO_ENGINE.md`); quiz, flashcards, teacher builder, battle host and click-to-vocab use it | 15 + 5 unit tests; browser 23/23 ×2 (pause 650–651 ms) |
| New question types | `vocabulary_questions.py`: listen_choose, listen_type, fill_blank, context_meaning, synonym, smart_mix — each only for words whose data supports it; no antonyms (no data) | `test_vocabulary_exam_3.py` (11) |
| Grading | existing snapshot scoring; `accepted_forms` extended per type; teacher variants reused via base direction | same |
| Mode picker | set detail returns `questionTypes` counts; types without data are disabled with the reason | browser V1 |

Bugs found and fixed: answer leak (example sentence sent for uzb→eng/spelling); old speaker read
Uzbek prompts with an English voice; engine bug (cancel during the pause never settled the old
play — found by unit test); mode picker disabled every new type while loading (found in browser);
homework start would return HTTP 500 because pinned word snapshots lacked the new audio fields
(found by `verify_vocabulary_homework_postgres.py`; fixed and covered by a regression test).

PR B merged: [#223](https://github.com/bestwayec/bestway/pull/223) → `40a7cfb` (CI 4/4).

## PR C — Games, teacher question type, audit of SRS/flashcards

| Area | Finding (before) | Change | Verification |
|---|---|---|---|
| Bamboozle 1v1 room | Room state (GET/join/WebSocket) sent every card's `correct_answer`; `/play` and WS `CARD_ACTION` trusted client `is_correct`, `team`, `has_double`; no identity or turn check; the "1v1" button was never wired; production runs WSGI (gunicorn) so the WebSocket never connected and each device scored locally | Per-seat secret token (only its SHA-256 stored), turn/status checks, server judges the chosen option, server-kept 2x bonus, `public_room()` hides unopened answers and token hashes, cache lock per play, contract-shaped errors. New `BamboozleOnlineArena` plays over HTTP + 2 s polling; button added to deck cards; the dead WebSocket client removed. Classroom projector mode (host judges oral answers) unchanged | 5 new backend tests; browser B1–B5 (two browsers) |
| Vocab Battle | Speed bonus from client `elapsedSec` (a negative value gave unbounded points); answers saved without a row lock (simultaneous answers could overwrite each other); malformed input → 500 | Server start time stamped when a question opens; elapsed from the server clock (legacy questions clamp the client value 0..limit, NaN → no bonus); late answers (> limit + 2 s) score 0; `select_for_update`; option range check; 400 on malformed input | 3 new unit tests; PG script; browser `vocab-battle.mjs` 20/20 |
| Vocab Runner | Already server-scored (session replay). Weak words were recorded from the client's mistake list | Weak words come from the mistakes the server counted | `test_runner_game.py` 17/17 |
| Teacher question type | Learner picked the mode at homework start (one session per learner) | `HomeworkAssignment.vocabulary_mode` (migration `0028`), validated against the set's data in preview/assign; start ignores the learner's request; `GET …/vocabulary/settings`; assign-form select; learner page shows the fixed type | PG script 14/14; browser H1–H2 |
| Flashcards / SRS / progress | Audited: SRS sessions are signed, owner-checked, stale-checked and graded server-side; flashcard sync is op-id idempotent; stats and history are read from stored rows | No change needed | existing tests + PG scripts |

Not done (no grounded data or out of scope): antonym questions (no antonym data stored);
pronunciation in Runner/Bamboozle (their content is grammar/general quiz cards, not vocabulary
words with audio).
