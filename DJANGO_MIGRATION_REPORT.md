# Django migration report — final Stage A gate

## Verdict

**STAGE_A_COMPLETE** as of 2026-10-08. Stage B remains out of scope and has not started.

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
