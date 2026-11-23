# BESTWAY Learning Experience 3.0 — audit

Scope: Exam Builder completion, vocabulary pronunciation, vocabulary exams and practice, Vocab
Runner, Vocab Battle, Bamboozle, teacher assignment, flashcards/SRS/progress. Each finding was
checked against the code and, where possible, reproduced (test, PostgreSQL script or browser).

Severity: **High** = wrong scores, leaked answers or a crash on a normal path; **Medium** = a
working feature that misleads or can be abused with effort; **Low** = quality.

## Findings and their state

| # | Area | Finding | Severity | State |
|---|---|---|---|---|
| 1 | Vocabulary quiz | Server sent the example sentence (contains the English answer) for Uzbek→English and spelling questions | High | Fixed (PR B), regression test |
| 2 | Vocabulary audio | Speaker read Uzbek prompts with an English voice; four separate single-play implementations, overlapping playback on repeated clicks | Medium | Fixed (PR B), shared engine |
| 3 | Vocabulary homework | Start would return 500 after PR B for revisions pinned before 3.0 (missing audio fields) | High | Found by PG script before merge, fixed in PR B |
| 4 | Exam Builder | `bulk_create` of `MockQuestion` fails on the Prisma enum column (tests used varchar) | High | Fixed (PR A), PG script in CI |
| 5 | Bamboozle | Room state exposed every card's correct answer to any client | High | Fixed (PR C) |
| 6 | Bamboozle | Play endpoints trusted client `is_correct`, `team`, `has_double`; anyone with the room code could play for either side | High | Fixed (PR C): seat tokens, turn check, server judging |
| 7 | Bamboozle | Online 1v1 never worked in production: WSGI serves no WebSocket, the "1v1" handler had no button, each device scored locally | Medium | Fixed (PR C): HTTP + polling arena |
| 8 | Vocab Battle | Speed bonus from client `elapsedSec`; a negative value gave unbounded points | High | Fixed (PR C): server clock |
| 9 | Vocab Battle | Answers saved without a row lock: two simultaneous answers could lose one score | Medium | Fixed (PR C): `select_for_update` |
| 10 | Vocab Battle | Malformed `selectedIndex` → HTTP 500 | Low | Fixed (PR C) |
| 11 | Vocab Runner | Weak words recorded from the client's mistake list | Low | Fixed (PR C) |
| 12 | Homework | Teacher could not fix the question type; the learner chose at start | Medium (feature gap) | Added (PR C) |
| 13 | Listening questions | The word text (browser speech) or a stored audio URL must reach the browser | Medium | **Accepted limitation**, documented: practice-grade, not high-stakes; grading stays server-side |
| 14 | Vocab Runner | The client renders the game, so it knows each gate's answer | Medium | **Accepted limitation** (pre-existing design): points come only from server replay of issued questions with time bounds and a daily cap |
| 15 | Bamboozle projector mode | The host judges oral answers on one screen; scores are local and never saved | — | By design; no points are awarded |
| 16 | Antonym questions | No antonym data exists | — | Not built (no fabricated keys) |

## Checked and found sound (no change)

- Vocabulary sessions and homework: questions and accepted answers are snapshotted server-side;
  grading never trusts client claims; one session per learner per homework.
- SRS: signed, owner-bound, expiring sessions; stale review state is refused (409); grading uses
  teacher-approved variants.
- Flashcard progress: op-id idempotent batch sync, cross-device last-writer rules.
- Deploy: `deploy.yml` and `deploy-django.yml` are `workflow_dispatch` only with a typed
  confirmation and an environment approval; pushes to `main` run CI and CodeQL only.
