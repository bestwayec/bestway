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

## CBT 2.0 additions (smoke test)
- [ ] Open an assigned exam: the readiness screen shows the assignment's closing time and timing policy; nothing starts until "Start the exam".
- [ ] Speaking: pass the microphone check, reload — it is not asked again in the same browser; a different browser asks again.
- [ ] Go offline mid-exam: the header says "kept on this device"; reconnect: "Saved to server".
- [ ] Finish: the review lists unanswered numbers of the open section only and warns about unsaved answers.
- [ ] Builder: the Review panel shows the new publication checks on a draft exam; fix or knowingly accept warnings before publishing.
- No new migration. One additive API change: `/student/assignments/<id>/exam` also returns `assignmentTitle`, `timingPolicy`, `opensAt`, `deadline` (older desktop builds ignore extra fields).

## Final stabilization (routing and workers)

### Frontend startup (Uzbek routing)
- Production starts Next exactly as the image does: `HOSTNAME=0.0.0.0 PORT=3000 npm start` (`next start` binds 0.0.0.0).
  Verified locally with nginx-style headers (`Host: bestwayec.uz`, `X-Forwarded-Proto: https`): `/`, `/login`, `/en/login` 200;
  `/uz/login` → `/login`; protected pages → login; container healthcheck `wget -qO- http://localhost:3000/` succeeds.
- **Never start Next with a loopback IP literal** (`-H 127.0.0.1`, `-H ::1`): Next 16.4.6 then treats next-intl's default-locale
  rewrite as cross-origin and every unprefixed Uzbek page loops (307) or returns 500 behind HTTPS. Use no `-H`, `-H 0.0.0.0` or
  `-H localhost`. `scripts/local-start.ps1` was fixed; `routing-regressions.spec.ts` guards all startup files.
- Language switch: after this release a switch is a full page load of the prefixed URL; the choice now sticks (before, choosing
  O'zbekcha after English was undone by the next link click).

### Workers (docker-compose.django.yml + cutover file)
| Service | Start | Check |
| --- | --- | --- |
| django-cache (Redis) | started by `deploy_django.sh` (`up -d --wait django-cache django-api assessment-worker game-scheduler`) | `docker compose -f docker-compose.django.yml exec django-cache redis-cli ping` → `PONG` |
| django-api | same | container healthcheck `python -m config.healthcheck` (PostgreSQL `SELECT 1`, cache read, `/v1/health` 200) |
| assessment-worker (AI queue **and** expired-exam hand-in every `EXAM_AUTO_SUBMIT_INTERVAL`=15 s) | `--profile workers` | `docker compose -f docker-compose.django.yml -f docker-compose.django.cutover.yml --profile workers ps assessment-worker` (Up); one-off: `docker compose … run --rm assessment-worker python manage.py run_assessment_worker --once` |
| telegram-outbox (delivery **and** the exam-report scheduler: preliminary / final / revision) | opt-in: `docker compose -f docker-compose.django.yml -f docker-compose.django.cutover.yml --profile telegram-outbox up -d telegram-outbox` | `… run --rm telegram-outbox python manage.py run_telegram_outbox --once` prints `{'deadlines':…, 'delivery': {'sent':…}}` |
| catch-up hand-in after downtime | — | `… run --rm assessment-worker python manage.py finalize_expired_attempts` |

Locally verified with `config.settings.production` (strong secrets, HTTPS `PUBLIC_URL`, gunicorn, Redis): healthcheck exit 0,
`run_assessment_worker --once` exit 0, `run_telegram_outbox --once` exit 0 with no bot token (nothing sent, nothing failed),
Redis holds the throttle keys. No `TELEGRAM_BOT_TOKEN` → reports stay queued; the website and Excel stay authoritative.

### Remaining staging gates (cannot be verified in this environment)
- [ ] Live Telegram: start `telegram-outbox` with the real bot on staging; confirm the teacher's private chat gets the preliminary and final leaderboard, the classroom chat only totals.
- [ ] Installed BW-Tauri desktop app against staging: login, assigned exam, readiness screen, answers, Speaking upload, result.
- [ ] Physical microphone (all browser checks used Chromium's fake device; Multilevel 8/8 positions verified with it).
- [ ] Production: open https://bestwayec.uz/login in Uzbek, switch to English and back, click a menu link — the language must stay.
