# BESTWAY 5.1 test report

Environment: cloud Linux container, local PostgreSQL 16 (Prisma 5.22 `migrate deploy` + Django `migrate`), local Redis, Python 3.13, Node 22. Hosted CI uses PostgreSQL 17 / Python 3.12 — check the PR's checks for exact-head results.

| Gate | Result | Status |
| --- | --- | --- |
| Django pytest (full) | 1731 passed, 4 skipped | VERIFIED |
| `verify_exam51_deadline_postgres.py` (new) | 32/32 | VERIFIED (real PostgreSQL, controlled clock via DB deadlines) |
| `verify_exam51_reports_postgres.py` (new) | 48/48 (incl. PDF, progress, bot menu, classroom counts) | VERIFIED; Telegram = MOCKED TRANSPORT |
| `verify_grading_consistency_postgres.py` | 87/87 | VERIFIED |
| `verify_exam_window_postgres.py` | 23/23 | VERIFIED |
| `verify_notifications_teacher_postgres.py` | 88/88 | VERIFIED |
| `verify_teacher_workspace_postgres.py` | 61/61 | VERIFIED |
| `verify_telegram_engine_postgres.py` | 23/23 | VERIFIED |
| `verify_e2e_journeys_postgres.py` | 41/41 (needs `JWT_SECRET`; the earlier local failure was the missing secret) | VERIFIED |
| Vitest (full) | 1009 passed (148 files) | VERIFIED |
| `tsc --noEmit`, ESLint (changed files) | clean / 0 errors | VERIFIED |
| `next build` | success | VERIFIED |
| Worker entrypoint | `run_assessment_worker --once` closes an expired exam | VERIFIED locally |
| Browser: runner Listening layout (Chromium, dark, 1366×768 / 1280×720 / 1920×1080 / 390×844), Q10 jump below sticky stack and above footer, no horizontal overflow; Result Center render | screenshots in `docs/screenshots/bestway51/` | VERIFIED |
| Browser: full IELTS/Multilevel journeys with Writing typing and Speaking capture, real audio playback | not run | NOT VERIFIED |
| Live Telegram delivery | not run (no authorized test bot) | NOT VERIFIED |

Covered races: manual Finish vs two concurrent deadline workers; duplicate sweeps; late answer vs deadline; late advisory job (stale lease) vs teacher-final grade; repeated report sweeps; grade correction → one revision.
