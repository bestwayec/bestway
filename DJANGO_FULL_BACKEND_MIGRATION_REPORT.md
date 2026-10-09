# Full backend migration — resumable checkpoint, 2026-10-09

Verdict: NOT COMPLETE. No production access, deployment or merge performed.

Source inventory: 173 active HTTP contracts, 35 services, 39 Prisma models and 21 enums. Django implements 123 matching contracts; 118 have recorded scoped verification, 50 are missing and five user-administration contracts remain partial. Registration is not a global parity claim. Exact missing method/path rows are in `DJANGO_FULL_BACKEND_MATRIX.md`.

## Verified implementation checkpoints

- `1170c3d`: minimal timed React autosave stabilization, serialized saves and regression tests. Frontend 168 tests, typecheck and lint passed (31 existing lint warnings).
- `740602d`: approved IELTS starter sections parity. Stage A differential 279/279; Stage B 713/716, with three explicitly approved attempt-bound media differences and zero unapproved differences; PostgreSQL exam checks 171/171.
- `039284a`: settings (7), audit (1), groups (6); exact DTO/error/role responses, roster privacy, ownership and transactional administration.
- `d372d81`: articles (5), notifications (4), real token-configured Telegram sendMessage adapter. External delivery was disabled in the differential harness; no live Telegram claim.
- `5e686fb`: payments list/debtors, bulk manual records and reminders (4).
- `381448c`: attendance listing, statistics, bulk mutation and the related statistics-module CSV export. Full foundation PostgreSQL suite now passes 461/461 across 31 newly ported contracts, with 13 additional local rollback/history/concurrency checks. Attendance checkpoint: 165/165 comparisons (161 attendance/CSV requests plus four membership-fixture mutations), zero semantic differences. Concurrent winner order is tested separately, not normalized into a differential pass.
- Fresh Django regression: 156 passed, 48 subtests passed. `manage.py check` with local database configuration: no issues. Pytest cache access warning does not affect test results.
- NestJS reference: 421 tests passed; `npx tsc --noEmit`, `npm run build` and `npx prisma validate` passed. Unit tests required a sandbox escalation after Windows `spawn EPERM`; NestJS source remains unchanged.

The PostgreSQL enum bulk-insert failure was reproduced and corrected without schema changes. Null article updates preserve the reference's 500 response and create no audit. Notification read endpoints are owner-scoped and idempotent. Telegram logs omit tokens and message content. Notification batches are atomic; outbound delivery starts only after commit.

## Remaining gates

Implement and differentially verify the matrix's missing routes: assessment (3), gallery (6), game (3), mock (1), points (3), stats (5), teachers (6), Telegram (4), legacy tests administration (9), videos (10). Complete five partial user contracts. Existing auth/exam registrations retain their recorded scope; review global throttling and full-domain dependencies before final parity.

Background jobs: 0/2 verified — assessment 20-second durable PostgreSQL job polling/claims/retries and monthly game reset/archive. Game startup recovery and Telegram polling/webhook, menu dispatch, account-link security and shutdown lifecycle are still missing. DeepSeek and Deepgram provider contracts/worker execution remain missing. WebSocket source inventory is 0/0; no Channels implementation is implied.

All 39 models and 21 enums have unmanaged mappings; domain write/concurrency verification is incomplete. Do not recreate tables or run destructive schema migrations. ParentStudent composite-key writes require exact-column SQL.

Complete protected video/storage/gallery/teacher uploads, statistics/game exports and full Django-only runtime verification. Two abandoned harness schemas from an earlier failed reference startup were removed only after exact-name validation, verifying all eight fixture users and confirming every other table contained only the expected fixture records. No application/public schema data was removed. Every current differential run cleans up its two disposable schemas.

## Client/native gates

Recorded real browser student IELTS/Multilevel timed autosave, reload/resume and submission checks passed. The staff starter assertion was corrected to respect the UI's requested Reading-only skills, but its updated browser run has not completed; current browser report is not an overall pass. Login redirects/proxy failures require separate investigation without unauthorized frontend changes.

Native gate is NOT VERIFIED: no local-compatible debug executable, low disk space, and the existing release binary has a production API URL. Do not launch it against production or start another Rust build until enough space is available. No cache, database or personal-file deletion was performed. Existing unrelated tmp files and browser evidence remain preserved.

## Exact next action

Port `backend/src/game/game.service.ts` and its controller/DTOs: GET `/v1/game/roster`, GET `/v1/game/roster/export`, GET `/v1/game/status`. Implement monthly archive/reset, startup recovery and sticky qualification together with those routes; PointsService.adjust calls GameService.ensureCurrentPeriod inside its transaction, making game the next dependency to complete before points. Then port GET `/v1/points/leaderboard`, GET `/v1/points/:studentId`, POST `/v1/points/:studentId/adjust`. Do not repeat completed exam, auth, payment or notification discovery.

## Attendance checkpoint — ATTENDANCE_MIGRATION_COMPLETE

Identified/implemented/verified: AttendanceController 3/3/3; related attendance CSV export 1/1/1. No attendance jobs, event consumers or WebSocket handlers exist (0/0). Shared notification delivery is reused; no new queue, reminder job or provider feature was invented.

| Contract | Roles | Exact success contract |
|---|---|---|
| GET `/v1/attendance` | All five actual roles, authenticated | 200, `{success:true,data:[{studentId,date,state}]}`, date ascending; optional groupId/month/studentId; no pagination |
| GET `/v1/attendance/stats` | Teacher, admin, super_admin | 200, `{success:true,data:[{studentId,name,present,absent,late}]}`; required groupId, optional month; host ICU name ordering |
| PUT `/v1/attendance/bulk` | Teacher, admin, super_admin | 200, `{success:true,data:{updated,cleared}}`; required groupId/date/nonempty records of studentId/state |
| GET `/v1/stats/export/attendance` | Admin, super_admin | 200 raw UTF-8 BOM CSV; exact semicolon cells, CRLF, formula protection, content type and filename; required string groupId, optional month |

Student queries cannot override their identity. Parent queries are limited to linked children, reject a foreign studentId and deliberately ignore groupId exactly as Nest does. Teachers require group ownership for list/stats/bulk; admin roles still require an existing group for these operations. The CSV reference does not require group existence and returns a header-only file for missing groups. No receptionist enum exists; no new role was created or granted permissions. Forged admin/receptionist token claims cannot override the actual student database role.

The existing Attendance table, DateField, foreign keys and `(studentId,groupId,date)` unique key are retained without migrations. present/absent/late remain the only database states; empty/blank delete records. Upserts precede clears even for conflicting duplicates. Inactive students cannot be marked, while their historical rows remain readable to authorized parents. Membership moves preserve history and prevent further marks in the former group.

Raw PostgreSQL upsert preserves exact creation timestamps and atomically handles unique-key races; Django update_or_create was found to rewrite naive Prisma UTC creation timestamps, so attendance does not use that path. A second-write fault rolls back every attendance change and emits neither audit nor parent notification. Sequential repeated absence emits no extra notification. Concurrent present/present, absent/late and already-absent/absent requests through both APIs succeed with one row and exactly 0/1/0 additional notifications respectively. Same-payload duplicate absences and the reference's pre-transaction snapshot behavior are preserved, not silently deduplicated.

Date validation ports the installed validator.js non-strict ISO expression. Tests preserve invalid formats, valid-but-unparseable basic/week/ordinal ISO errors, February overflow, partial dates, signed-year V8 parsing, time-zone slicing, UTC month edges and Date.UTC year quirks. Extreme month 9999-12 preserves Prisma's 500 rather than accepting an expanded-year query. Calendar dates and semantic errors are never normalized; only genuinely nondeterministic identifiers/timestamps are canonicalized. Known fixture identities remain distinct to detect cross-student leakage.

Statistics use PostgreSQL ICU matching the reference's host locale (ru-RU on this Windows machine), including case/accent/Latin/Cyrillic comparisons. `REFERENCE_NAME_COLLATION` can explicitly select the same PostgreSQL ICU collation for a runtime with a differing host locale. A matching installed ICU collation is a runtime prerequisite; no collation or schema was created by this checkpoint.

Evidence: `backend-django/ATTENDANCE_PARITY_REPORT.json`, `FULL_FOUNDATION_PARITY_REPORT.json`, `tests/test_attendance.py`, `scripts/attendance_contracts.py`. Fresh Stage A regression: 279/279. Fresh Stage B: 713/716 with the same three explicitly approved attempt-bound media differences and zero unapproved failures. Sandbox temp-media access initially failed with WinError 5; both regressions were rerun successfully outside that sandbox (Stage B returns exit 1 because it retains the approved raw differences). NestJS 421 tests, typecheck, build and Prisma validation passed. Disk free space was approximately 1.19 GiB; no Rust/Tauri build or cache cleanup was attempted.

Frontend, Tauri and NestJS source were not changed by this checkpoint. Existing browser evidence and unrelated files remain uncommitted and preserved. Full backend replacement and Web/native integration remain incomplete; this is not DJANGO_BACKEND_PARITY_COMPLETE.
