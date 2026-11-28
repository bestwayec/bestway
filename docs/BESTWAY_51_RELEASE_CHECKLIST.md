# BESTWAY 5.1 release checklist (owner)

**Do not deploy during an active exam.** If these checks cannot finish before a scheduled exam, run that exam on the last verified 5.0 workflow (individual duration; teacher hands in via existing controls).

## Deploy
1. Back up PostgreSQL (existing `backend/scripts/backup.sh`).
2. Migration `core.0035_exam_timing_policy_and_report_state` is additive (2 nullable/defaulted columns + 1 table); existing assignments stay `individual`. Rollback: previous image ignores the new columns/table.
3. `backend-django/scripts/deploy_django.sh` already restarts `assessment-worker` — this process now also closes expired exams. Confirm it is running: `docker compose -f docker-compose.django.yml -f docker-compose.django.cutover.yml --profile workers ps`.
4. Telegram reports are delivered only by the **opt-in** `telegram-outbox` service (`--profile telegram-outbox up -d telegram-outbox`). Without it reports stay queued in PostgreSQL.
5. Optional env: `EXAM_AUTO_SUBMIT_ENABLED` (default true), `EXAM_AUTO_SUBMIT_GRACE_SECONDS` (360, Speaking), `EXAM_AUTO_SUBMIT_OBJECTIVE_GRACE_SECONDS` (60), `EXAM_AUTO_SUBMIT_INTERVAL` (15).
6. Telegram: confirm `TELEGRAM_BOT_TOKEN` is configured and start `telegram-outbox`; confirm the teacher's private chat is linked and the classroom binding is re-verified. Live delivery was **not** verified in the release environment.
7. Desktop (BW-Tauri): run the installed app against staging once (login, assigned exam, answers, Speaking upload, result) — not verified in this release cycle.

## Smoke test (synthetic accounts)
- [ ] Create a short fixed-close exam assignment for a test group; confirm participant count.
- [ ] Start as a test student, answer, close the browser; after deadline + 6 min the attempt is `auto_submitted`.
- [ ] Result Center shows the student; Writing/Speaking show "Awaiting teacher assessment"; grade them; stage becomes Final.
- [ ] Teacher's private Telegram receives preliminary then final leaderboard; classroom chat receives totals only.
- [ ] Excel matches the Result Center.
- [ ] Fallback if Telegram fails: website Result Center + Excel are authoritative; do not mark delivery complete.
