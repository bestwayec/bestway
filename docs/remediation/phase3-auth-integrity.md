# Phase 3 — authentication and application integrity

Base: `add984286c24c1c0725071dba5224881a297f911` on
`codex/bestway-phase2-exam-integrity`; Phase 0, Phase 1 and Phase 2 commits
are ancestors. All verification uses synthetic data and disposable local
PostgreSQL databases. No migration is introduced.

## BW-11 and BW-12

Both authentication helpers return the already-authenticated request identity
and reject anonymous requests. Parent invitation and lesson progress now obtain
the identity; parent invitation is restricted to the student role. HLS transcoding checks the request role, and its route and the
status route precede the filename catch-all. LMS and teacher ORM writes/queries
use authenticated user IDs rather than assigning the JWT `LegacyUser`
dataclass to a Django foreign key. Teacher cohort creation additionally checks
that the active user exists; teachers and instructors are restricted to their
own cohort for analytics and assignment. Other newly reachable vocabulary
battle and SRS handlers use compatible IDs and response status arguments.

BW-15 was resolved in the Phase 2 base (`f99822b`) and reverified with the
PostgreSQL readiness (62/62) and partial-practice (74/74) contracts.

## BW-16: partial only — unresolved

Token rotation still revokes a family when a previously used refresh token is
presented. Logout now takes a row lock and revokes the whole token family,
including a replacement created by a concurrent rotation. Legacy tokens with a
null family get a family assigned during rotation. This preserves replay
protection and fixes the old logout/rotation race for authenticated logout.

The general parallel-refresh race remains open: two legitimate requests sent
to the backend with the same refresh token can still cause family revocation.
`verify_phase3_refresh_race_postgres.py` runs two independent PostgreSQL
connections and exits with failure when it reproduces that behavior. A
process-local singleflight alone is insufficient across workers and would hide
some simultaneous genuine replays at the proxy. A safe distributed solution
needs a separately authenticated, session-bound coordination protocol and
shared durable coordination; it is not safe to introduce a token reuse window
without that design. Logout through the Next.js route also still depends on a
valid access token; when it has expired, browser cookie removal is not proof of
server-side revocation. BW-16 is **not fixed** and blocks prerelease.

## Verification and rollback

Real JWT/PostgreSQL checks cover owner/other-teacher authorization, assignment,
invalid and missing JWT, HLS roles, parent invitation, lesson progress, genuine
replay, expiry and logout after rotation. A separate parallel test validates
logout versus refresh and deliberately reports the unresolved refresh race.
The existing independent PostgreSQL mock-authoring integration still fails
`delete_exam route is super-admin-only`: admin can delete a synthetic draft.

Revert the Phase 3 commits to restore the prior source; no schema rollback is
required. That restores the helper/ORM failures and logout/rotation weakness.
Revoked token rows remain revoked and should not be manually reactivated.

Final verification: Django suite 715 passed, 4 skipped (missing legacy
NestJS build); Phase 0–3 focused security 73 passed; real-JWT PostgreSQL
16 passed; logout versus refresh passed and the parallel refresh race failed
as documented above. Django system check and migration dry-run passed.
Frontend: 390 tests passed, TypeScript passed, ESLint 0 errors / 466 warnings,
and production build passed. PostgreSQL grading 65/65 and AI rankings 35/35
passed. No tests against production were performed.
