# HIGH remediation checkpoint — Phase 0

Base: `993103a4015d98ad557d2d0f0f494ed33e6a0b6f`.
Branch: `codex/bestway-high-priority-fixes`.

## Implemented boundaries

- BW-01: new speaking uploads use `private/speaking_submissions/`. Public
  `/media/` rejects both private uploads and legacy `speaking_submissions/`,
  including traversal and symlink aliases. Existing database keys and files
  are retained. The existing attempt/question audio endpoint remains the
  authorized download path for owners, assigned teachers and administrators.
- BW-02: placement claim ignores body-supplied identity. PostgreSQL transaction
  advisory locks serialize claims by result token, including cache-only record
  restoration. Existing claim ownership is preserved; profile update failure
  rolls back the claim. Profile upsert explicitly casts the legacy enum array.
- BW-03: both Telegram signed authentication branches require an authentication
  timestamp no older than 24 hours and no more than 30 seconds in the future.
  Missing/invalid timestamps are rejected; signature verification is unchanged.
  This bounds captured-data replay; it does not make valid Telegram data one-use.

## Deployment and retained media

No database migration or file movement is required by this phase. Do not bulk
move existing recordings or rewrite stored keys. Existing recordings remain
accessible through `/v1/mock/attempts/<attempt>/answers/<question>/audio`.
Update any historical client using a direct public recording URL to this route.

Before deployment, inventory storage and review any reverse-proxy, object-store
or CDN rules which serve files independently of Django. Explicitly deny
`/media/private/`, `/media/speaking_submissions/` and duplicate `/media/media/`
forms at such layers, and purge previously cached recording URLs. These external
layers were not inspected or changed. Historical copies under unrelated public
paths must be inventoried and removed from public routing by the operator;
no automatic production cleanup is performed.

Do not deploy this branch as a completed HIGH remediation release. BW-04 through
BW-17 are outstanding. BW-01..03 are verified in the local Django workflow;
external edge configuration and real-device checks remain deployment gates.

## Verification

New `tests/test_security_phase0.py` covers signed timestamps and invalid
signatures, old/new authorized recording paths, anonymous/non-owner denial,
traversal/symlink protection, public asset compatibility, anonymous identity
injection, PostgreSQL concurrent claims for existing/cache-only results,
idempotent owner retry, cache owner preservation and transaction rollback.

The existing placement tests now mock the explicit claim-lock boundary instead
of the former transaction implementation and assert strict profile sync. Their
business assertions were retained.

`python scripts/verify_security_phase0_postgres.py` requires a disposable local
`bestway_audit_*` or `bestway_security_*` PostgreSQL database with checked-in Prisma
SQL and Django migrations applied. It uses real JWT verification, real legacy
User/Group/StudentProfile tables and rollback-only synthetic fixtures; attempt
and answer lookup fixtures isolate the download authorization boundary. It
verifies owner/assigned teacher access and denial for other users/teachers.
Never point it at production. It does not call external services.

Local results:
- Phase 0 real JWT/PostgreSQL checks: 17 PASS.
- Focused existing/security suite: 88 PASS and 27 subtests PASS before the final
  two rollback/cache-owner tests were added.
- Full backend suite with all 19 new cases: 669 PASS, 4 SKIP, 1 FAIL.
- The sole failure is the unchanged baseline full-test current_skill assertion
  in `test_fish_audio_stt_and_deepseek_eval.py`; it belongs to BW-09.
- Final dedicated security suite: 19 PASS.
- PostgreSQL grading consistency: 49/49 PASS; AI rankings: 35/35 PASS.
- Readiness and partial-practice suites retain their baseline BW-15/BW-08 failures.
- Django system check and migration dry-run pass. No model/schema changes are introduced.
- Frontend/build, container deployment and real external integrations were not
  rerun for this backend-only phase. Earlier audit results are not fresh release
  verification.

## Remaining HIGH findings

| IDs | Status |
| --- | --- |
| BW-01, BW-02, BW-03 | FIXED in local application workflow; operator edge checks above remain |
| BW-04, BW-05, BW-06, BW-07 | NOT FIXED — Phase 1 AI/STT |
| BW-08, BW-09, BW-10 | NOT FIXED — Phase 2 exam persistence/state |
| BW-11, BW-12, BW-15, BW-16 | NOT FIXED — Phase 3 authentication/application logic |
| BW-13, BW-14, BW-17 | NOT FIXED — Phase 4 deployment/access/final grade |

## Rollback

No data migration needs reversal. Keep old and new recording files and keys.
A source rollback restores the security vulnerabilities, so prefer a forward
fix or temporarily disable the affected public route. Never reopen private
storage to restore client compatibility. Rolling back authentication timestamp
validation also restores acceptance of stale Telegram credentials.
