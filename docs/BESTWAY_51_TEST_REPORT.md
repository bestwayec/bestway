# BESTWAY 5.1 test report

Environment: cloud Linux container, local PostgreSQL 16 (Prisma 5.22 `migrate deploy` + Django `migrate`), local Redis, Python 3.13, Node 22. Hosted CI uses PostgreSQL 17 / Python 3.12 — check the PR's checks for exact-head results.

| Gate | Result | Status |
| --- | --- | --- |
| Django pytest (full) | 1731 passed, 4 skipped | VERIFIED |
| `verify_exam51_deadline_postgres.py` (new) | 31/31 | VERIFIED (real PostgreSQL, controlled clock via DB deadlines) |
| `verify_exam51_reports_postgres.py` (new) | 35/35 | VERIFIED; Telegram = MOCKED TRANSPORT (outbox rows only) |
| `verify_grading_consistency_postgres.py` | 87/87 | VERIFIED |
| `verify_exam_window_postgres.py` | 23/23 | VERIFIED |
| `verify_notifications_teacher_postgres.py` | 88/88 | VERIFIED |
| `verify_teacher_workspace_postgres.py` | 61/61 | VERIFIED |
| `verify_telegram_engine_postgres.py` | 23/23 | VERIFIED |
| `verify_e2e_journeys_postgres.py` | fails at "TEACHER: real HTTP login" **with and without** the 5.1 changes | BLOCKED locally (environment); rely on hosted CI |
| Vitest (full) | 1005 passed (148 files) | VERIFIED |
| `tsc --noEmit`, ESLint (changed files) | clean / 0 errors | VERIFIED |
| `next build` | success | VERIFIED |
| Worker entrypoint | `run_assessment_worker --once` closes an expired exam | VERIFIED locally |
| Browser journeys (IELTS/Multilevel full, Speaking capture, runner screenshots at 1366×768) | not run | NOT VERIFIED |
| Live Telegram delivery | not run (no authorized test bot) | NOT VERIFIED |

Covered races: manual Finish vs two concurrent deadline workers; duplicate sweeps; late answer vs deadline; late advisory job (stale lease) vs teacher-final grade; repeated report sweeps; grade correction → one revision.
