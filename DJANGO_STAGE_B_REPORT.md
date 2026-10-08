# Stage B partial implementation — STAGE_B_BLOCKED

Workspace/branch preserved: `migration/django-backend`, baseline `bba9707`. Stage A was not rewritten. No frontend/Tauri/NestJS source edits, schema migration, production access, deployment or merge.

## Scope and current coverage

43 active scoped lifecycle/access/result-support contracts: 28 `/mock`, 15 legacy `/tests`. 17 registered Django contracts: four pre-existing catalogue/media routes plus 13 new lifecycle routes. 26 missing routes are listed exactly in `DJANGO_STAGE_B_CONTRACT.md` and the machine report. Registration is not a completed parity gate.

Implemented slice: transactional mock Start/resume, single/bulk response saves, own history and scoped detail, annotations, cheat signals, section advance, durable Listening/Speaking phases, Speaking upload and authorized recorded-audio stream. Existing tables remain unmanaged. Student audio now binds to an active own attempt even when the request omits attemptId, per explicit user security direction. Post-submit annotations retain exact reference behavior, also explicitly approved.

## Verification

- Django check: pass with the existing local DATABASE_URL. Initial check without DATABASE_URL correctly refused SQLite fallback; rerun with local configuration passed.
- pytest: 88 passed +11 subtests. Seventeen new lifecycle clock/boundary tests; real database tests are in the separate harness.
- Final combined run: 356 comparisons, 355 exact matches and one explicitly approved security mismatch. Stage B contributes 88 comparisons: 87 matches plus the IELTS audio security difference (Django 400 MOCK_TIME_UP vs NestJS 200 audio bytes). Zero unapproved mismatches. The strict differential process intentionally exits 1 for the retained difference; this is not a clean full-parity gate.
- Stage A regression: 268/268 API/DB comparisons pass in the combined isolated runner.
- PostgreSQL authoring regression: 163/163 pass; disposable fixture cleanup reports zero leftovers.
- NestJS: 421 tests across 31 files pass; TypeScript check, build and Prisma validation pass.
- Both API fixtures use real JWT and two disposable localhost PostgreSQL schemas; the Nest harness loads real attempt/read-detail services, never workers or external AI services.

The final machine report is `backend-django/STAGE_B_PARITY_REPORT.json`. It remains explicitly `STAGE_B_BLOCKED` even if every implemented-slice comparison passes. UUID-keyed savedAnswers/mediaState retain distinct aliases. ISO timestamp normalization alone cannot prove deadline-duration parity; pure clock tests exist, but stronger API-relative clock assertions and full DB identity mapping remain required.

## Security verification limits

Verified for the slice: anonymous and teacher/admin/super_admin mutation denial; student-safe in-progress detail; hidden answer keys/transcript omitted from Start; foreign question and atomic mixed bulk denial; completed answer denial; late timed save denial; unsupported media rejection; upload header rejection; protected recorded-audio scope; immutable timed take logic and safe practice replacement.

Not yet a full security gate: second-student IDOR matrix, assigned-teacher/parent ownership matrix, revoked enrollment, concurrent fresh starts, concurrent save/submit/force-submit, rollback fault injection, all skill media/timing recovery, and legacy `/tests`. No tenant boundary should be invented where the existing schema has none. Cheat event cap is serialized, but route-specific 30/minute throttle parity is still missing.

## Exact remaining work

1. Complete detailed error/JSON/DB inventory for missing legacy and support routes; decide whether certificate generation is lifecycle support or a separate result-stage artifact without dropping actual client calls from coverage.
2. Implement `/mock/attempts/:attemptId/submit`: completeness, timed exception, objective-score compatibility, saved result idempotency, notifications and AssessmentJob snapshot enqueue. No DeepSeek/Deepgram/provider execution.
3. Implement force-submit, extend, reopen, delete and staff attempt queue, plus purchase request/list/confirm/reject and certificate support (11 missing mock contracts).
4. Implement and compare all 15 legacy `/tests` lifecycle/support contracts, including persisted random selection, marks, audio, demo scoring, submit and recovery.
5. Finish exact invalid-DTO/Unicode length/first-error parity and multipart limits, Range edge cases, phase ordering/retries, all supported speaking profiles and route throttle.
6. Real concurrent new Start/save/submit tests, timeout-vs-submit races, stale-definition race, rollback injection and second-student/program/staff-scope security matrix.
7. Full local PG lifecycle through Submit per Multilevel skill and IELTS plus legacy tests, interruption/recovery, timeout, duplicate submission and cleanup.
8. Differential every scoped route, relative timer assertions and semantic identity-aware persisted-state comparisons. Keep the approved media mismatch explicit; never report it as exact parity.
9. Rerun all gates after the remaining implementations. Stage C must not begin.

## Commits and reproduction

- `b4e48c7` — initial mock attempt lifecycle and approved media policy.
- `0484bfb` — lifecycle tests, scoped inventory and local PG differential report.
- Documentation commit hash is supplied in the final handoff (a commit cannot embed its own content hash).

Load only the existing local DATABASE_URL from `backend/.env`, then run from `backend-django`:

```powershell
python manage.py check
pytest -q -p no:cacheprovider
node scripts/stage_b_inventory.cjs
python scripts/verify_stage_b_differential.py
python scripts/verify_mock_authoring_postgres.py
```

The Stage B differential intentionally returns exit 1 while the approved audio mismatch is retained. Its JSON distinguishes zero unapproved failures from that observable security difference. It does not claim every missing contract has been exercised. Temporary schemas/media and authoring fixtures were cleaned up after the final runs.

This report records partial progress, not completion; repository history is the authoritative hash source.
