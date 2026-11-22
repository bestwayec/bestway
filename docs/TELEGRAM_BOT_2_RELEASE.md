# Telegram Bot 2.0 + unified exam engine — release notes and deployment prerequisites

Branch `feat/bestway-telegram-exam-engine-2`. Nothing in this document has been deployed; production deployment and any
message to real students/groups need the owner's explicit approval.

## What ships
| Area | Files | Status |
|---|---|---|
| Security hardening (no built-in super admin, fail-closed OCR/AI, webhook secret + update dedupe) | `telegram_menu.py`, `telegram_bot.py`, `writing_ocr.py`, `telegram_state.py` | PASS (PostgreSQL-verified) |
| Classroom quiz engine shared by website + bot | `class_quiz.py`, `class_quiz_views.py` | PASS (HTTP + bot verified) |
| Telegram quiz flow | `telegram_quiz.py` | PASS |
| Vocabulary `/lugat /mashq /takror /natija /yordam`, modes A–E, SRS | `vocabulary_bot.py`, `telegram_vocab.py`, `vocabulary_answers.py` | PASS |
| Result cards + appeals + audited corrections | `result_card.py`, `class_quiz_appeals.py` | PASS |
| Teacher tools, settings, menus | `telegram_teacher.py`, `telegram_settings.py` | PASS (Telegram); website teacher UI not built |
| Durable notification outbox + worker | `telegram_outbox.py`, `telegram_notify.py`, `run_telegram_outbox` | PASS (worker is opt-in) |

## Database migrations (all additive: new tables / one new column, no data rewrite)
`0018` update receipts · `0019` class quiz engine · `0020` dialog state + preferences · `0021` vocabulary variants + bot runs ·
`0022` vocabulary answer reports · `0023` quiz appeals + accepted answers + corrections · `0024` result card deliveries ·
`0025` outbox + `TelegramPreference.muted_kinds`.

**Merge order (decided in the final audit):** merge this PR (#210) **first**. PR #209 (Mock 27) also owns a `core.0018`;
its branch already contains this PR plus the join `core.0026_merge_mock27_and_telegram_bot2` (no operations), verified on
PostgreSQL in both upgrade orders. Do **not** run `makemigrations --merge` by hand.

Rollback: every migration only adds objects. To roll back code, deploy the previous image; the new tables stay unused.
To drop them: `python manage.py migrate core 0017` on a database that is not running the Mock 27 migration chain
(this destroys quiz/outbox/appeal data — export first).

## Required configuration
* `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (webhook refuses requests without it — fail closed).
* `SUPERADMIN_TELEGRAM_ID` is now only an **alert destination**. Super-admin rights come from a linked `super_admin` account.
  Run `python manage.py ensure_superadmin --telegram-id … ` only deliberately; it no longer has a default ID or password.
* `Pillow` (now explicit in `requirements/base.txt`) and `fonts-dejavu-core` (added to the Dockerfile) for result cards.
* Run `python manage.py check_legacy_schema` after `migrate` (the entrypoint does this for workers).

## Enabling notifications (owner decision)
Notifications queue in PostgreSQL as soon as the code is live, but **nothing is sent** until the worker runs:

```bash
docker compose --profile telegram-outbox up -d telegram-outbox
```

Before enabling: confirm quiet hours (default 22:00–07:00 Asia/Tashkent), review the queue
(`SELECT status, kind, count(*) FROM "TelegramOutbox" GROUP BY 1,2;`), and consider purging old rows if the code was live for a while.
Stop the worker to pause delivery; messages stay queued (`status='pending'`).

## Verification performed
Disposable PostgreSQL + synthetic Telegram users, Telegram network replaced by a recorder (no real chat was contacted):
`scripts/verify_telegram_engine_postgres.py` (20), `verify_class_quiz_postgres.py` (57), `verify_telegram_quiz_postgres.py` (33),
`verify_vocab_bot_postgres.py` (65), `verify_result_cards_postgres.py` (47), `verify_notifications_teacher_postgres.py` (87),
`verify_e2e_journeys_postgres.py` (41) — all wired into `.github/workflows/ci.yml`; Django unit tests 1540 passed;
frontend `tsc` 0 errors, ESLint 0 errors, Vitest 865 passed.

## Known gaps (reported, not hidden)
* **Mini App** for very long exams is not built. 40-question quizzes run natively in the bot (verified); IELTS/Multilevel mocks stay on the website.
* **Website UI for teachers** to author class quizzes is not built; the HTTP API exists and is tested, the bot wizard covers creation.
* **Group chat summaries:** `Group` has no Telegram chat mapping, so a summary card goes to the teacher's private chat (aggregates only)
  and announcements go to students privately. Telegram cannot prevent screenshots or forwarding.
* Teacher feedback on IELTS/Multilevel grading is not wired to the outbox (`telegram_notify.teacher_feedback` exists for callers).
* Existing P1 items from the audit (auto-registration creates approved students, non-persistent Redis FSM cache, in-process
  notification thread pool of the legacy notifier, no webhook rate limit) are documented in `TELEGRAM_BOT_2_SECURITY_AUDIT.md`.
* Staging with a dedicated authorised bot was not available in this environment; Telegram API behaviour was verified through
  a recorder, not against api.telegram.org.
