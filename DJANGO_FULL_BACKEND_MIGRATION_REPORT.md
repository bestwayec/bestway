# Full backend migration — resumable checkpoint, 2026-10-09

Verdict: NOT COMPLETE. No production access, deployment or merge performed.

Source inventory: 173 active HTTP contracts, 35 services, 39 Prisma models and 21 enums. Django registers 115 matching contracts; 110 have recorded scoped verification, 58 are missing and five user-administration contracts remain partial. Registration is not a global parity claim. Exact missing method/path rows are in `DJANGO_FULL_BACKEND_MATRIX.md`.

## Verified implementation checkpoints

- `1170c3d`: minimal timed React autosave stabilization, serialized saves and regression tests. Frontend 168 tests, typecheck and lint passed (31 existing lint warnings).
- `740602d`: approved IELTS starter sections parity. Stage A differential 279/279; Stage B 713/716, with three explicitly approved attempt-bound media differences and zero unapproved differences; PostgreSQL exam checks 171/171.
- `039284a`: settings (7), audit (1), groups (6); exact DTO/error/role responses, roster privacy, ownership and transactional administration.
- Current content checkpoint: articles (5), notifications (4), real token-configured Telegram sendMessage adapter. Strict local two-API PostgreSQL comparisons: 241/241 across all 23 new contracts, including persisted rows, role denials, ownership, validation and failed transactions. External delivery was disabled in the differential harness; no live Telegram claim.
- Django regression: 142 passed, 32 subtests passed. `manage.py check` with local database configuration: no issues. Pytest cache access warning does not affect test results.

The PostgreSQL enum bulk-insert failure was reproduced and corrected without schema changes. Null article updates preserve the reference's 500 response and create no audit. Notification read endpoints are owner-scoped and idempotent. Telegram logs omit tokens and message content. Notification batches are atomic; outbound delivery starts only after commit.

## Remaining gates

Implement and differentially verify the matrix's missing routes: assessment (3), attendance (3), gallery (6), game (3), payments (4), points (3), stats (6), teachers (6), Telegram (4), videos (10). Complete five partial user contracts. Existing auth/exam registrations retain their recorded scope; review global throttling and full-domain dependencies before final parity.

Background jobs: 0/2 verified — assessment 20-second durable PostgreSQL job polling/claims/retries and monthly game reset/archive. Game startup recovery and Telegram polling/webhook, menu dispatch, account-link security and shutdown lifecycle are still missing. DeepSeek and Deepgram provider contracts/worker execution remain missing. WebSocket source inventory is 0/0; no Channels implementation is implied.

All 39 models and 21 enums have unmanaged mappings; domain write/concurrency verification is incomplete. Do not recreate tables or run destructive schema migrations. ParentStudent composite-key writes require exact-column SQL.

Complete protected video/storage/gallery/teacher uploads, statistics/game exports and full Django-only runtime verification. Re-run NestJS unit tests, typecheck, build and Prisma validation at the next verified milestone; no fresh full-reference result is claimed here.

## Client/native gates

Recorded real browser student IELTS/Multilevel timed autosave, reload/resume and submission checks passed. The staff starter assertion was corrected to respect the UI's requested Reading-only skills, but its updated browser run has not completed; current browser report is not an overall pass. Login redirects/proxy failures require separate investigation without unauthorized frontend changes.

Native gate is NOT VERIFIED: no local-compatible debug executable, low disk space, and the existing release binary has a production API URL. Do not launch it against production or start another Rust build until enough space is available. No cache, database or personal-file deletion was performed. Existing unrelated tmp files and browser evidence remain preserved.

## Exact next action

Port `backend/src/payments/payments.service.ts` and DTOs into Django: GET `/v1/payments`, GET `/v1/payments/debtors`, PUT `/v1/payments/bulk`, POST `/v1/payments/remind`. Preserve student/parent/teacher ownership, blocked-student restrictions, `empty` deletion, duplicate-record ordering, atomic upserts/clears, audit snapshots and student/parent reminder notifications. Extend the isolated PostgreSQL differential harness with the real Nest PaymentsService and fault-injection rollback tests. Then implement attendance and points/game; do not repeat completed exam discovery.
