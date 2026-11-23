# BESTWAY Learning Experience 3.0 — implementation

Three pull requests, merged in order. Details per PR are in `BESTWAY_LEARNING_3_PROGRESS.md`;
the audio engine is described in `BESTWAY_VOCAB_AUDIO_ENGINE.md`.

## PR A — Exam Builder completion ([#222](https://github.com/bestwayec/bestway/pull/222))

- Undo/redo (`undo-history.ts`, `UndoRedoBar.tsx`) in the Reading, Listening and group editors.
- Question bank: search own (teacher) / all (admin) groups without keys; insert copies whole
  groups atomically and renumbers.
- Lifecycle: DRAFT → VALIDATED (tied to `contentVersion`) → PUBLISHED → ARCHIVED (Prisma migration
  `20261123000000_exam_lifecycle`).
- Template export without answer keys; importer accepts keyless questions only in templates.

## PR B — Pronunciation and Vocabulary Exam 3.0 ([#223](https://github.com/bestwayec/bestway/pull/223))

- `frontend/src/lib/pronunciation/`: one app-wide engine, two sequential plays by default (650 ms
  pause), stored audio → browser speech, owner-scoped cancellation, blocked-autoplay state.
- `backend-django/apps/core/vocabulary_questions.py`: `listen_choose`, `listen_type`,
  `fill_blank`, `context_meaning`, `synonym`, `smart_mix`; each built only from data the word has.
- Mode picker shows per-type word counts (`questionTypes` on set detail).
- Migration `0027` (choices only).

## PR C — Games, teacher question type

### Bamboozle online 1v1 (`apps/bamboozle/views.py`, `BamboozleOnlineArena.tsx`)

```
host  POST /v1/bamboozle/rooms/create        → room + player_token (team 1, shown once)
guest POST /v1/bamboozle/rooms/<code>/join   → room + player_token (team 2); later calls with the
                                               token return the same seat; a third person → 409 ROOM_FULL
any   GET  /v1/bamboozle/rooms/<code>        → public room: no token hashes, no unopened answers
seat  POST /v1/bamboozle/rooms/<code>/play   {card_id, answer, player_token}
```

`apply_play()` (shared by HTTP and the WebSocket consumer) checks the token → team, room status,
turn, card state; judges `answer` against the card's options and key; applies swap/steal/bomb/double
with the server-kept `_double` flag; records `last_play`; increments `version`. A cache lock
(`add`, 5 s) serialises plays in one room. Seats are kept in `sessionStorage` per room code. Each
device polls every 2 s (skipped while the tab is hidden) and keeps the newest `version`.

### Vocab Battle (`vocab_battle.py`)

Opening a question stamps `questions[i].startedAt`. `server_elapsed()` measures from it; answers
later than `timeLimit + 2 s` score 0 (`late: true`). Answers run in `transaction.atomic()` with
`select_for_update()`.

### Teacher-chosen question type

`HomeworkAssignment.vocabulary_mode` (migration `0028_homework_vocabulary_mode`, nullable). The
teacher workspace plan accepts `vocabularyMode`, refuses unknown types and types for which no word
in the set has data (`question_type_counts`). `start_view` issues the teacher's type whatever the
learner requests; `GET /student/assignments/<id>/vocabulary/settings` returns
`{mode, startedMode}`. Words without the data get a grounded fallback type (unchanged
`plan_types` rule), so every word is still tested.

### Runner

Weak words are recorded from the server's own mistake list (issued prompts), not the client's.
