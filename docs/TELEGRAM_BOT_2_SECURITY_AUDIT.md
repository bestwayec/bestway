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
