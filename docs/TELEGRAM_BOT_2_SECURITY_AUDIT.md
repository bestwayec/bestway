# Telegram bot 2.0 — architecture and security audit (milestone 1)

Scope reviewed: `telegram_bot.py`, `telegram_menu.py`, `telegram_fsm.py`, `telegram_delivery.py`, `telegram_links.py`,
`telegram_views.py`, `writing_ocr.py`, `management/commands/ensure_superadmin.py`, `notifications.py`,
`apps/notifications/telegram_tasks.py`, `game_scheduler.py`, deployment compose files.

## Confirmed P0 findings — FIXED in this milestone

| # | Finding | Impact | Fix |
|---|---|---|---|
| 1 | Telegram id `5582178765` was a **built-in default** in 4 places (`telegram_menu`, `telegram_fsm`, `telegram_delivery`, `settings/base.py`). `is_superadmin(chat_id)` compared the chat id with it; `ensure_superadmin_user()` **auto-created** a `super_admin` account and **promoted** (`UPDATE role='super_admin'`) any existing user linked to that id; `send_web_admin_login` then minted a one-click **web-admin SSO** link. | Control of that Telegram identity (or any path that links it) = full super-admin on bot and web; also granted by a plain default with no account validation. | Authorization is now **only** an *active* account with server-side `role='super_admin'` that is validly linked to the chat (`linked_superadmin`, read-only). No built-in id remains; `SUPERADMIN_TELEGRAM_ID` is an optional **alert destination** only. `ensure_superadmin_user` never writes. Web-admin SSO is refused without a linked super admin. |
| 2 | `writing_ocr._ocr_fallback_text` **invented an essay** when OCR failed; the web handwriting endpoint **stored it as the student's answer**; `evaluate_writing_text` fell back to a length-based **heuristic band labelled `gemini`**; a malformed AI answer had missing criteria **defaulted to 6.0**; the bot module carried a hard-coded **Band 6.5** fallback. | Fabricated text and fabricated scores attributed to real students. | OCR fails closed (empty text, provider `none`, `available=false`); evaluation returns **no band** (`available=false`) when no real AI answer exists; a provider answer lacking any of the four criteria is rejected (overall is computed from the four criteria, not trusted); web endpoint answers `503 OCR_UNAVAILABLE` and **does not touch the saved answer**; the bot shows no band and alerts nobody with a score; Gemini tier needs a configured key. |
| 3 | `ensure_superadmin` defaulted to a **hard-coded password** (`BestWaySuperAdmin2026!`) and **reset the password on every run**. | Known credential for the highest role in a public repository. | No default password: explicit `--password`, or a random one generated and shown once on creation; an existing account's password changes only when asked. No default Telegram id. |
| 4 | **No `update_id` de-duplication / replay protection**: webhook retries and polling restarts (offset is process-memory) re-processed updates. | Duplicate actions (double answers, duplicate notifications/points) once exam actions exist. | `TelegramUpdateReceipt` (unique `update_id`, core migration 0018): atomic claim in `bot.handle` for both webhook and polling; 8-way concurrent test; fail-safe if the table is absent. |

## Reviewed — acceptable as is
* **Webhook secret**: required (`TELEGRAM_WEBHOOK_SECRET`), constant-time compare, **fails closed** when unset/missing/wrong (verified over real HTTP).
* **Bot token in logs**: delivery code logs only the method name. One path logged `%r` of a download exception (URL contains the token): now logs the exception *type* only; the `'test-token'` default was removed.
* **Linking**: tokens are hashed, expiring and single-use (`telegram_links`); a chat id is trusted only through that link.

## P1 findings — documented, owner decision or later milestones
* `telegram_views._register_student` (Telegram Login/WebApp, hash-verified) **auto-creates approved student accounts** (`isApproved=true`, initial points). Recommend an approval gate if free self-registration is not intended. Not changed (product decision).
* **FSM dialog state** (superadmin topic dialogs) lives in Django cache / process memory; production Redis runs with `--save "" --appendonly no`, so it is lost on restart. **Exam state will not use it**: quiz attempts are rows in PostgreSQL and the bot derives its position from saved answers (milestones 2–3).
* **Notification delivery** in `notifications.py` uses a process-local `ThreadPoolExecutor` (lost on restart) and `game_scheduler` keeps `last_streak_date` in memory (a restart can resend). New notifications use a durable outbox (milestone 6).
* No per-IP rate limiting on the webhook (Telegram IP allow-listing is done at the proxy/tunnel).
* Account takeover through unrelated Telegram *Login Widget* flows was not re-audited here beyond signature validation.

## Verification
`tests/test_ocr_fail_closed.py`, `tests/test_telegram_state.py`, rewritten superadmin tests in `tests/test_telegram_v070.py`,
and `scripts/verify_telegram_engine_postgres.py` (20 checks on real PostgreSQL: webhook 403/200, duplicate and concurrent updates,
restart re-delivery, unlinked/student/deactivated/teacher identities, no auto-provisioning, no SSO, OCR/AI offline).

## Status after milestones M1–M6 (verified on real PostgreSQL)

| Requirement | Status | Evidence |
|---|---|---|
| No privilege from a built-in Telegram ID; linked + role-checked accounts only | PASS | `verify_telegram_engine_postgres.py` |
| OCR/AI fail closed (no fabricated scores) | PASS | `tests/test_ocr_fail_closed.py` |
| Webhook secret required; update dedupe; replayed callbacks harmless | PASS | engine + quiz + notification scripts (HTTP webhook retry checks) |
| Durable dialog state / no in-memory exam state | PASS | restart checks in quiz, vocab and E2E scripts |
| Student A/B, Teacher A/B, parent, anonymous isolation | PASS | `verify_class_quiz`, `verify_result_cards`, `verify_e2e_journeys` |
| Hostile / oversize callback data (Telegram 64-byte limit enforced by the scripts) | PASS | all Telegram scripts |
| Result cards only from saved results; private delivery; no names in group summaries | PASS | `verify_result_cards_postgres.py`, `tests/test_result_card.py` |
| Grading corrections audited, snapshots immutable | PASS | `ClassQuizCorrection`, snapshot-hash checks |
| Notifications: durable, deduped, retried, rate-limited, opt-out, quiet hours, restart-safe | PASS | `verify_notifications_teacher_postgres.py` |
| Bot token never logged | PASS | delivery logs only the method name / exception type |
| Mini App for very long exams | NOT BUILT | see release notes |
| Real-Telegram staging test | UNVERIFIED | no authorised test bot in this environment |

## Independent final audit (2026-11-21) — findings and fixes

| # | Severity | Finding | Fix | Regression evidence |
|---|---|---|---|---|
| A1 | P1 | `/start <token>` (and contact sharing) in a **group chat** linked the *group* to the student account; `/tests` in that group then listed the student's tests and notifications went to the whole group. | `telegram_links` links only positive (private) chat ids; `/tests` in a group answers "private only". | `verify_telegram_engine_postgres.py` (group link refused, token still usable; group `/tests` shows nothing) |
| A2 | P2 | One-time link token was check-then-act: concurrent `/start` with the same token could link several chats. | Conditional `UPDATE … WHERE used_at IS NULL` inside a transaction; only the winner links. | 6 parallel consumers → exactly 1 linked chat (fails on the old code) |
| A3 | P1 | Class quiz with `maxAttempts > 1`: the review after attempt 1 showed every **correct answer and explanation**, so attempt 2 could be copied from the key. | `keys_visible_to_student()`: keys only after the last attempt or once the assignment is closed/past its deadline; staff views unchanged; Telegram shows "shown after your last attempt". | `verify_class_quiz_postgres.py` (+4), `tests/test_telegram_quiz.py` (+2) |
| A4 | P1 | Outbox: one tick can outlive the 90 s lease (25 × 20 s timeout); a second worker could re-claim rows still queued in the first worker's list → **duplicate sends**. | Per-row lease fencing (`_renew_lease`) right before each row is processed. | `verify_notifications_teacher_postgres.py`: stale worker sends nothing (fails on the old code) |
| A5 | P1 (ops) | `telegram-outbox` was in the shared `workers` compose profile of `docker-compose.django.yml`: `--profile workers up -d` would start live delivery. | Own `telegram-outbox` profile in both compose files — delivery is strictly opt-in. | compose config |
| A6 | P2 | Pending appeals / vocabulary reports filtered in Python after a capped global page (500/200) — another group's backlog could hide a teacher's own requests. | Scoped in SQL to the teacher's groups/sets. | existing teacher-request checks |
| A7 | P1 (CI) | Notification/E2E PG scripts inherited default 22:00–07:00 Tashkent quiet hours → **CI failed 17:00–02:00 UTC**. | Synthetic users start without a quiet window; quiet hours still tested explicitly. | both scripts pass at 22:11 Tashkent |

Reviewed and acceptable: webhook secret (constant-time, fail closed), `update_id` receipts, callback identity from the
sender's linked account only (never from callback data), per-callback re-authorisation of teacher/group ownership,
appeal decisions under row locks (concurrent approvals re-evaluate `is_correct=False` after the first commit), result
cards claimed once per result version (at-most-once: a failed send is not retried automatically, the student can
re-request it), vocabulary answers idempotent per word with a website/bot staleness guard, OCR/AI fail closed.

Known, not changed (P2): a student removed from a group can still finish an attempt already in progress; claimed update
receipts are not rolled back if processing crashes (at-most-once); chats linked to a group before A1 keep working until
re-linked — check with `SELECT id FROM "User" WHERE "telegramChatId" LIKE '-%'`.
