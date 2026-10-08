# Django migration report — final Stage A gate, 2026-10-08

## Verdict

**STAGE_A_BLOCKED**. Stage B remains untouched.

Workspace execution works in `C:\Users\user\Desktop\bwww\bestway`, branch `migration/django-backend`. Git status, diff and recent commits were recovered without reset/stash/discard. Repository safe-directory ownership is handled only by command-local `git -c safe.directory=...`, not a global trust change.

Prior committed and uncommitted authoring/preview/repair work was preserved. This pass added missing paste parse/import routes, aligned points resolution and parse validation errors, and added reproducible inventory/differential/local-PostgreSQL checks. It did **not** complete package imports or media.

## Results

- Active Stage A reference endpoints: **33**.
- Django matching registered endpoints: **24/33**; **9 absent**.
- Fully compatible endpoint total: **unverified**, not synonymous with registered routes.
- Exact differential coverage: **1 endpoint**, **27/27** parse API fixtures; injected identities, no JWT comparison.
- Django pytest: **55 passed**, plus **5 subtests**.
- Django system check: no issues with explicit local PostgreSQL settings.
- Real local PostgreSQL E2E: **139/139** checks; disposable fixtures cleaned, zero exam leftovers. Includes paste-import post-write fault rollback and prior author/review/publish/repair/clone checks.
- Nest reference: **421 tests / 31 files pass**, TypeScript check/build/Prisma validation pass.
- Import: paste implemented and locally tested; six package-import endpoints remain absent.
- Media: three group upload/access endpoints absent; storage and cleanup contracts not certified.
- Security: verified subset passes (student/ownership denial, preview key and Multilevel transcript removal, attempted repair lock, historical source preservation, paste rollback). Full security gate remains open.

## Exact missing endpoints

All use `/v1/mock` prefix:

1. GET /groups/:groupId/audio
2. GET /groups/:groupId/image
3. POST /groups/:groupId/media
4. POST /exam-imports/validate
5. POST /exam-imports/media
6. POST /exam-imports
7. GET /exam-imports/by-package/:packageId/revisions/:revision
8. GET /exam-imports/by-exam/:examId
9. POST /exam-imports/issues/:issueId/resolve

Additional blockers: reference readiness/publish checklist and media existence checks; definition/mutation JSON and nested validation parity; rich-HTML/gap security; full cross-API differential fixtures for the other 32 endpoints and complete permissions/leak/rollback matrices. These are unfinished implementation/verification items, not a terminal outage.

See DJANGO_EXAM_PARITY.md for all 33 paths/methods/roles/statuses, known error/response differences, limitations and reproduction commands. Passing the existing structural/full-authoring PG fixtures does not prove compatibility with the richer reference readiness or physical-media contracts.

## Reproduce safely

From backend-django:

```powershell
python scripts/verify_stage_a_inventory.py
python scripts/verify_parse_differential.py
python -m pytest -q -p no:cacheprovider
```

For system check and PostgreSQL runner, supply the existing **local-only** DATABASE_URL and `DJANGO_SETTINGS_MODULE=config.settings.local`; set ALLOWED_HOSTS to testserver,localhost,127.0.0.1. The runner refuses non-loopback database hosts and cleans only its exact fixture IDs. Never copy credentials into reports.

Build the reference before inventory/differential runs so backend/dist matches source. The Nest harness binds an ephemeral loopback port and does not bootstrap production integrations.

## Git and scope

Logical commits group Django authoring/paste compatibility, gate verification fixtures, and this blocked-gate report. Record final hashes in the handoff; no commit should be labeled Stage A complete.

- `c37a059`: preserve Django authoring integration and add paste import parity.
- `d1100b0`: Stage A inventory, exact parse API differential and PostgreSQL gate fixtures.
- Report commit: contains this file and DJANGO_EXAM_PARITY.md; its hash is supplied in the final handoff.

Baseline HEAD before this gate was 030ed89 (shared authoring rules), following 9bc4236 (transactional authoring foundation) and db9747f (catalogue reads). Existing uncommitted authoring wiring was included in the requested logical commits without discarding it.

NestJS source, frontend and Tauri were not edited. No production access or deployment. No Stage B work.
