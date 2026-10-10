# Django migration report — final Stage A gate

## Verdict

**STAGE_A_COMPLETE**; Stage B API **STAGE_B_CHECKPOINT_3_COMPLETE**, but final client gate **STAGE_B_INTEGRATION_BLOCKED** as of 2026-10-08. All **43/43** scoped Stage B lifecycle/access/result-support routes are registered and API-verified, including legacy15 and mock28; zero missing. Three approved media-security restrictions remain explicit differences, not exact parity. Real browser login/catalogue smoke evidence exists; full lifecycle/native desktop gates remain unverified. Native UI initialization and disk-space failures block completion. See `DJANGO_STAGE_B_INTEGRATION_REPORT.md`. Stage C has not started.

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

## Stage B — scoped Checkpoints 1–3 complete

See `DJANGO_STAGE_B_CONTRACT.md`, `DJANGO_STAGE_B_REPORT.md` and the exact ten-item `DJANGO_STAGE_B_CHECKPOINT_3.md` matrix. Scope: **43 active contracts, 43 registered, zero missing**. Checkpoint1 deterministic submission/snapshot handoff and Checkpoint2 legacy15 remain preserved. Checkpoint3 ports the remaining ten mock purchase/staff/certificate contracts. Verdict: **STAGE_B_CHECKPOINT_3_COMPLETE**. No Stage C provider/worker/teacher execution; no schema migrations.

Latest verification: **705** combined groups, **702 pass**, **three approved media-policy differences**, **zero unapproved mismatches**. New Checkpoint3 **153/153 groups pass**, including **18** PostgreSQL support safety checks and actual audit-record parity. Legacy158 groups/16 PG checks and original submission races/scoring tests rerun. Strict differential exits1 to retain approved raw differences. Stage A: **268/268** API/DB and freshly rerun **163/163** local PG authoring checks. Django: **127 pytest +11 subtests**, check clean, original **578** scoring comparisons preserved. Nest: **421 tests/31 files**, typecheck/build/Prisma validate pass. Authorized certificates consume persisted IELTS/Multilevel results, deny pending work, and match text/page bounds/HTTP metadata; rendered layouts inspected under the PDF skill. PDF binary metadata differs by generator. Requested stronger locks/atomicity and approved media restrictions are documented. Disposable schemas/storage/scratch files cleaned. Frontend/Tauri/NestJS source and production untouched; no merge/deploy. Stop before Stage C.
