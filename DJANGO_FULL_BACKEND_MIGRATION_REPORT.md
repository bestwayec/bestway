# Full backend migration — resumable checkpoint, 2026-10-09

Verdict: all 173 active HTTP routes are implemented and verified within the recorded scope. The broader web/native migration is not complete: browser staff/login/proxy and native Tauri gates remain open. No production access, deployment or merge was performed.

## Latest route and worker checkpoint

The final missing 44 routes are implemented: gallery (6), teachers (6), videos (10), statistics (5), legacy `/tests` authoring/grading/media (9), Telegram (4), assessment (3), and mock teacher grading (1). The five previously partial user-administration contracts are complete. The generated matrix reports 173 active, 173 implemented, 173 verified within scope, zero missing, zero partial. Three previously approved attempt-bound media differences remain explicitly identified as approved differences, not normalized away.

Fresh Django verification: `python manage.py check` clean; `pytest -q -p no:cacheprovider` reports 207 passed and 356 subtests passed. The isolated local PostgreSQL NestJS/Django differential reports 1,184/1,184 comparisons across 82 grouped contracts, zero differences; its local checks also exercise transactional rollback, concurrency, game scheduler recovery, legacy grading, Telegram link/menu lifecycle, assessment review, provider ledgers, retries and concurrent `SKIP LOCKED` claims. Disposable schemas were removed after each run.

Assessment exposes an explicit `run_assessment_worker` command and bounded DeepSeek/Deepgram providers with validation, durable claims/leases/retries, fixture-based provider tests, and a real loopback HTTP test. Telegram polling/webhook runs through an explicit command; delivery is recorded in parity tests and was never sent externally. Provider credentials or external provider calls were not used. NestJS remained read-only: 421 tests passed, `npx tsc --noEmit`, `npm run build`, and `npx prisma validate` passed.

No frontend or Tauri source was changed in this route batch. Student browser evidence remains scoped to the prior report; staff/login/proxy browser gates have not completed, and native UI testing remains unverified. Preserve these as overall migration blockers rather than treating route parity as an end-to-end release gate.

Commits for this batch:

- `eeef996` — admin, content and media contracts
- `9f20862` — legacy authoring and Telegram lifecycle
- `f1aab87` — assessment grading, worker and providers
- `cdefe56` — full route differential evidence and matrix

Exact remaining blockers for an overall release verdict: complete staff browser E2E and resolve/test the `/login` redirect and transient proxy 502 independently; determine whether sufficient disk space and a local-compatible executable permit Tauri native UI testing; external DeepSeek/Deepgram credentialed smoke calls remain intentionally unrun. No deployment or production verification is authorized.

The historical checkpoint notes below describe earlier verified states; the latest counts and evidence above supersede their “remaining route” and “in progress” statements. `DJANGO_FULL_BACKEND_MATRIX.md` contains the exact active route/status inventory.

## Verified implementation checkpoints

- `1170c3d`: minimal timed React autosave stabilization, serialized saves and regression tests. Frontend 168 tests, typecheck and lint passed (31 existing lint warnings).
- `740602d`: approved IELTS starter sections parity. Stage A differential 279/279; Stage B 713/716, with three explicitly approved attempt-bound media differences and zero unapproved differences; PostgreSQL exam checks 171/171.
- `039284a`: settings (7), audit (1), groups (6); exact DTO/error/role responses, roster privacy, ownership and transactional administration.
- `d372d81`: articles (5), notifications (4), real token-configured Telegram sendMessage adapter. External delivery was disabled in the differential harness; no live Telegram claim.
- `5e686fb`: payments list/debtors, bulk manual records and reminders (4).
- `381448c`: attendance listing, statistics, bulk mutation and the related statistics-module CSV export. Full foundation PostgreSQL suite now passes 461/461 across 31 newly ported contracts, with 13 additional local rollback/history/concurrency checks. Attendance checkpoint: 165/165 comparisons (161 attendance/CSV requests plus four membership-fixture mutations), zero semantic differences. Concurrent winner order is tested separately, not normalized into a differential pass.
- Game/points checkpoint: six additional routes, startup recovery and monthly reset. Full foundation PostgreSQL suite: 603/603 comparisons across 37 newly ported contracts; 24 additional local checks. Game/points evidence: 142/142 comparisons, 11 additional lifecycle/rollback/concurrency checks, zero semantic differences.
- Fresh Django regression: 172 passed, 64 subtests passed. `manage.py check` with local database configuration: no issues. Pytest cache access warning does not affect test results.
- NestJS reference: 421 tests passed; `npx tsc --noEmit`, `npm run build` and `npx prisma validate` passed. Unit tests required a sandbox escalation after Windows `spawn EPERM`; NestJS source remains unchanged.

The PostgreSQL enum bulk-insert failure was reproduced and corrected without schema changes. Null article updates preserve the reference's 500 response and create no audit. Notification read endpoints are owner-scoped and idempotent. Telegram logs omit tokens and message content. Notification batches are atomic; outbound delivery starts only after commit.

## Historical gates at the previous checkpoint (route scope superseded above)

Implement and differentially verify the matrix's missing routes: assessment (3), gallery (6), mock (1), stats (5), teachers (6), Telegram (4), legacy tests administration (9), videos (10). Complete five partial user contracts. Existing auth/exam registrations retain their recorded scope; review global throttling and full-domain dependencies before final parity.

Background jobs: 1/2 scoped-verified — game monthly reset/archive and startup recovery are implemented and tested. Assessment 20-second durable PostgreSQL job polling/claims/retries remains missing. Telegram polling/webhook, menu dispatch, account-link security and shutdown lifecycle are still missing. DeepSeek and Deepgram provider contracts/worker execution remain missing. WebSocket source inventory is 0/0; no Channels implementation is implied. Operating the separate game scheduler alongside Django remains a runtime/deployment gate; no deployment was performed.

All 39 models and 21 enums have unmanaged mappings; domain write/concurrency verification is incomplete. Do not recreate tables or run destructive schema migrations. ParentStudent composite-key writes require exact-column SQL.

Complete protected video/storage/gallery/teacher uploads, remaining statistics exports and full Django-only runtime verification. Game CSV and attendance CSV are scoped-verified. Two abandoned harness schemas from an earlier failed reference startup were removed only after exact-name validation, verifying all eight fixture users and confirming every other table contained only the expected fixture records. No application/public schema data was removed. Every current differential run cleans up its two disposable schemas.

## Client/native gates

Recorded real browser student IELTS/Multilevel timed autosave, reload/resume and submission checks passed. The staff starter assertion was corrected to respect the UI's requested Reading-only skills, but its updated browser run has not completed; current browser report is not an overall pass. Login redirects/proxy failures require separate investigation without unauthorized frontend changes.

Native gate is NOT VERIFIED: no local-compatible debug executable, low disk space, and the existing release binary has a production API URL. Do not launch it against production or start another Rust build until enough space is available. No cache, database or personal-file deletion was performed. Existing unrelated tmp files and browser evidence remain preserved.

## Prior checkpoint next action (completed by the latest route batch)

GameService and PointsService dependencies are complete within this checkpoint. Resume from the matrix's remaining Telegram lifecycle, partial user administration, content/media/statistics, legacy authoring and assessment rows. Do not repeat completed exam, auth, payment, attendance or game/points discovery.

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

## Game/points checkpoint — GAME_POINTS_MIGRATION_COMPLETE

Identified/implemented/scoped-verified: GameController 3/3/3, PointsController 3/3/3, game monthly job 1/1/1 and startup recovery. No independent points job, event consumer or WebSocket handler was invented.

| Contract | Roles | Success |
|---|---|---|
| GET `/v1/game/roster` | Admin, super_admin | 200 JSON; current or historical active qualified students |
| GET `/v1/game/roster/export` | Admin, super_admin | 200 exact BOM/semicolon/CRLF CSV, filename and formula protection |
| GET `/v1/game/status` | Student only | 200 own status; stale period projects initial points without writing |
| GET `/v1/points/leaderboard` | Public | 200 active students, optional group/limit, competition ranks |
| GET `/v1/points/:studentId` | Owner student, linked parent, own-group teacher, admins | 200 current points and newest 100 history entries |
| POST `/v1/points/:studentId/adjust` | Own-group teacher within configured limit, admins | 201 current points; exact number coercion, reason validation and errors |

Rollover covers inactive profiles too. A null period adopts the current month without resetting points or qualification. Stale periods archive prior points/qualification, then reset initial points and clear qualification. Native archive upserts preserve exact original creation timestamps. Qualification remains sticky after points decrease. History reads and public ranking do not reset a stale period. Null settings retain reference coercion and failure behavior.

The row lock, rollover, increment and history write share one transaction. Injected history-write failures roll back archive/reset/points and emit neither audit nor notifications. Concurrent increments and rollover produce one archive, two history rows and correct persisted totals through both APIs. Qualification emits one student/parent notification pair under concurrent adjustments. Safe points-notification failures retain 201; an awaited game-notification failure returns the reference's post-commit 500, preserving points and the qualification flag. These semantics are documented, not normalized away.

Run `python manage.py run_game_scheduler` as a separate process with the same local/runtime configuration as Django. It performs best-effort startup recovery, executes monthly reset at 00:05 Asia/Tashkent, closes database connections and handles shutdown signals. `--once` performs recovery and exits. The actual scheduled callback and command startup were tested against disposable PostgreSQL fixtures. No implicit worker or database mutation is started by app initialization, system checks or test imports. No worker was launched against application data.

Evidence: `backend-django/GAME_POINTS_PARITY_REPORT.json`, `FULL_FOUNDATION_PARITY_REPORT.json`, `tests/test_game_points.py`, `scripts/game_points_contracts.py`. PostgreSQL comparisons preserve response JSON, status/error codes, role/ownership restrictions, persisted state, notification/audit content and transaction failure boundaries. Only nondeterministic IDs/timestamps are canonicalized; fixture identities remain distinct. Both temporary schemas were removed after the run.

Commits: `d792458` implementation; `7e5a53f` tests, differential evidence and matrix. Fresh post-port regressions: Stage A 279/279; Stage B 713/716, three approved attempt-bound media differences and zero unapproved failures. NestJS 421 tests, typecheck, build and Prisma validation passed. An initial Stage B reference startup collided with the concurrent build clearing dist; after build completion the full rerun finished, with both disposable schemas cleaned after each attempt. No source change was needed for that tooling race.

This checkpoint does not authorize deployment, production access, broader scoring work or frontend/Tauri changes. Existing unrelated browser artifacts remain preserved. Full backend replacement still has 44 missing routes, five partial user contracts and the runtime/provider/client/native gates above.
