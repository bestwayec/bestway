# Django migration report — final Stage A gate

## Verdict

**STAGE_A_COMPLETE** as of 2026-10-08. Stage B Checkpoints 1 and 2 are now implemented; Stage B overall remains **STAGE_B_BLOCKED** with ten scoped mock routes outstanding. Stage C has not started.

Workspace command execution was restored and all work stayed on `migration/django-backend`. Existing committed and uncommitted work was preserved; no reset, stash, discard, production access or deployment occurred.

## Final results

| Gate | Result |
|---|---|
| Active Stage A endpoints | 33 |
| Implemented and route-registered | 33/33 |
| Differentially verified contracts | 33/33 |
| Differential API/database cases | 268/268 pass |
| Import-validation and HTML exact reference cases | 61/61 pass |
| JSON-package imports | 6/6 complete |
| Media endpoints | 3/3 complete |
| Django pytest | 71 passed, 11 subtests passed |
| Django check | no issues |
| Local PostgreSQL authoring/repair E2E | 163/163 pass; fixtures cleaned |
| NestJS regression | 421 tests in 31 files pass |
| Nest TypeScript/build/Prisma | all pass |

The local PostgreSQL flows use only generated fixtures and reject non-loopback database hosts. The final full Multilevel flow authors and publishes 35 Listening questions, 35 Reading questions, Writing /16 and Speaking /21, validates media references and versioning, and verifies legacy repair/corrected-clone behavior.

Readiness intentionally follows the confirmed NestJS contract: catalogue/detail Start readiness differs from stricter Review/publish readiness. This is not a semantic normalization or divergence.

## Reproduce

From `backend-django`, load only the existing local `DATABASE_URL` and run:

```powershell
python manage.py check
pytest -q -p no:cacheprovider
python scripts/verify_stage_a_inventory.py
python scripts/verify_content_import_differential.py
python scripts/verify_stage_a_differential.py
python scripts/verify_mock_authoring_postgres.py
```

From `backend`:

```powershell
npm test
npx tsc --noEmit
npm run build
npx prisma validate
```

The differential run writes [STAGE_A_PARITY_REPORT.json](backend-django/STAGE_A_PARITY_REPORT.json), a machine-readable 33-contract report. It starts a loopback-only NestJS reference harness and drops only its own validated disposable schemas and storage directory.

Frontend and Tauri are unchanged. NestJS is read-only reference code. Remaining Stage A blockers: **none**.

## Stage B — partial student lifecycle, not complete

See `DJANGO_STAGE_B_CONTRACT.md` and `DJANGO_STAGE_B_REPORT.md`. Scope: 43 active lifecycle/access/result-support contracts, **33 registered**, **10 missing**, all remaining mock management/purchase/certificate routes. Checkpoint 1 submission/timeout includes the approved deterministic scoring and immutable assessment handoff. Checkpoint 2 adds all **15/15 legacy `/tests` lifecycle/result-support contracts**, separate from `/mock`, without schema migrations. Verdict: **STAGE_B_CHECKPOINT_2_COMPLETE**, overall **STAGE_B_BLOCKED**. No Checkpoint 3 or Stage C provider/worker/teacher execution.

Latest verification: **552** combined groups, **549 pass**, **three approved media-policy differences**, **zero unapproved mismatches**. Legacy adds 158 groups: 156 pass, two approved private-audio denials. Strict differential exits 1 to retain the differences, not to conceal them. Stage A: **268/268** API/DB and freshly rerun **163/163** local PostgreSQL authoring checks. Django: **113 pytest +11 subtests**, check clean, original **578** scoring comparisons preserved. Nest: **421 tests/31 files**, typecheck/build/Prisma validate pass. Legacy PostgreSQL group contains **16** checks for starts, duplicate saves, concurrent/timeout submits, save-vs-submit, rollback, immutable submitted answers and notification uniqueness. Result PDF text/page geometry/headers are compared and visually inspected; binary generator metadata is not byte-identical. Disposable schemas/files cleaned. Django's requested stronger locks/notification atomicity and the approved unsafe-audio compatibility restrictions are documented. Frontend/Tauri/NestJS source and production unchanged; no merge/deploy.
