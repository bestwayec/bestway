# Stage B scoped lifecycle — STAGE_B_INTEGRATION_BLOCKED

## Checkpoint 4 — local clients, 2026-10-08

**STAGE_B_INTEGRATION_BLOCKED**. Checkpoint 3's 43/43 implemented API contracts
and 702/705 differential result remain valid (three approved security differences,
zero unapproved failures). Real student/teacher/admin browser login and initial
catalogue/setup rendering are verified; full student/staff/media UI coverage and
native desktop E2E are not. Cold Next compilation and document-navigation test
synchronization were isolated; test infrastructure now records timings and screenshots.
Native UI tools fail initialization and native Rust testing exhausted disk space.
Expanded timed Reading UI testing found no autosave request for 90 seconds:
the frontend save debounce depends on an unstable mutation wrapper and is reset
by one-second timer renders. A minimal client fix requires explicit approval;
frontend source is unchanged. Next typecheck/lint pass (31 existing warnings).
Full evidence, regressions and remaining gates: `DJANGO_STAGE_B_INTEGRATION_REPORT.md`.
Do not claim STAGE_B_COMPLETE or begin Stage C.

## Checkpoint 3 — final current result, 2026-10-08

**STAGE_B_CHECKPOINT_3_COMPLETE**. **43/43** active scoped Stage B contracts implemented and registered; **zero missing routes**. All ten newly ported mock access/staff/result-support routes are differentially verified. Baseline `c1f15db` and prior checkpoints preserved. Exact method/path/request/response/roles/side-effect/test matrix: `DJANGO_STAGE_B_CHECKPOINT_3.md`.

- Combined differential: **705 recorded groups**, **702 pass**, **three approved media-security differences**, **zero unapproved failures**. New Checkpoint 3: **153/153 groups pass** (151 API/DB, one PostgreSQL safety group, one audit-record comparison group). Strict runner exits1 to keep raw approved differences visible; this is not an exact parity claim for those unsafe media paths.
- PostgreSQL: **18** new support concurrency/rollback checks pass; prior legacy16 and submission checks rerun. Concurrent force/manual submission finalizes once, extensions accumulate, purchase requests are unique, notification failures roll back, snapshots stay immutable and deletion uses the existing ledger cascades. Equivalent stable Nest results/database state match. Django retains the requested stronger transaction/row-lock safety instead of copying reference races.
- Security: every new route has real-JWT role checks, missing resources and invalid DTO/query cases. Cross-student certificate/detail access and unassigned teacher controls are denied. Purchased entitlement never bypasses Start enrollment. Completed answers/scores are not rewritten; completed reopen/extend are denied. Reopen is the explicit reference grading-only administrative exception, retaining original scores, clocks and snapshots. Certificate authorization includes linked parents/assigned teachers/admins and denies pending work. No answer keys are added to catalogue/queue/certificate output.
- Result support uses persisted deterministic scores. Force-submit reuses Checkpoint1 scoring/snapshot service, bypassing student completeness only as the reference requires; Writing/Speaking pending assessment stay grading. PDF metadata/content/page bounds match reference fixtures; PDF skill render/inspection checked IELTS and Multilevel layouts. Binary generator metadata is not identical.
- Django check clean; **127 pytest +11 subtests**, **578** scoring comparisons preserved. Stage A **268/268** differential and **163/163** local PG checks pass. Nest **421 tests/31 files**, typecheck/build/Prisma validate pass.

Approved differences remain the existing expired IELTS mock audio denial and legacy anonymous/finalized private-audio denials, per attempt-bound media policy. Legitimate playback uses an authorized live own practice/timed context; staff/demo access remains unchanged. No new compatibility exceptions were added. No provider or teacher grading, schema changes, frontend/Tauri/NestJS source edits, production access, merge or deployment. All disposable schemas/storage and PDF scratch files cleaned. **Stop before Stage C.**

Implementation commit: `9389532` — `feat(django): complete mock access and result support`. Verification commit: `test(django): verify Stage B checkpoint 3 parity`; its hash is supplied in the final handoff (a commit cannot embed its own hash). Machine results: `backend-django/STAGE_B_PARITY_REPORT.json`. The historical remaining lists below are superseded, not current blockers.

## Historical Checkpoint 2 (superseded coverage/results)

## Current checkpoint — 2026-10-08

**STAGE_B_CHECKPOINT_2_COMPLETE**. All **15/15** active scoped legacy `/tests` lifecycle/result-support routes are implemented and locally verified. Baseline `0f1a31c` preserved. `/tests` remains separate from `/mock`; existing unmanaged Prisma tables are reused without migrations. Full Stage B: **33/43** registered, **10** remaining mock contracts. Do not start Checkpoint 3 from this handoff.

Latest checks supersede the historical Checkpoint 1 counts below:

| Gate | Result |
|---|---|
| Django check | clean |
| pytest | 113 passed +11 subtests |
| Existing pure mock scoring comparisons | 578 preserved |
| Combined API/DB/PG groups | 552 total; 549 pass; 3 approved differences; 0 unapproved failures |
| Legacy-only groups | 158 total; 156 pass; 2 approved differences; 0 unapproved failures |
| Legacy PostgreSQL concurrency/rollback | 16 checks within one recorded PG group, all pass |
| Stage A differential regression | 268/268 pass |
| Stage A local PostgreSQL regression | 163/163 pass, zero leftovers |
| Nest reference regression | 421 tests in 31 files pass |
| Nest typecheck/build/Prisma validate | all pass |

The differential process still exits 1 because raw approved differences remain visible: existing expired IELTS mock audio, anonymous private legacy audio (Django401/Nest200), and finalized/no-live-attempt private legacy audio (Django404/Nest200). The latter two follow the explicitly approved attempt-bound media policy. Authenticated Tauri playback during a valid selected attempt passes unchanged; public/expired playback is intentionally incompatible and must not be re-enabled for legacy convenience.

Legacy tests cover discovery/detail, persisted randomized start/resume and original timer, answer upsert/autosave, marks, cheat cap/throttle, objective scoring, blank versus pending manual work, duplicate/timeout submission, histories/review, parent/teacher/admin scope, second-student denial, program revocation, protected keys, completed answer/marks immutability, audio Range/header/error behavior, result PDF text/page bounds and certificate permissions. PDF skill render-and-inspect QA verified the generated certificate layout; ReportLab/PDFKit binary metadata differs, while result content is compared exactly. Full request/response/error/DB inventory is in `DJANGO_STAGE_B_CONTRACT.md`.

Separate PostgreSQL connections exercise concurrent starts/saves/submits, timeout-vs-submit and save-vs-submit. Injected notification failure rolls back answer grading, scores, finalization and notifications; retry succeeds. Test row locks prevent duplicate starts and attempt row locks prevent double finalization. Nest's legacy implementation does not provide equivalent locks/notification atomicity; this requested safety hardening is documented rather than advertised as identical concurrent reference behavior. Equivalent stable Nest API results and final database state are verified after each race. No provider jobs, manual grading, invented snapshot/tenant tables or timeout endpoint were added.

All disposable localhost schemas/storage and PDF QA scratch files are cleaned. No frontend, Tauri or Nest source changes; no production access, merge or deployment.

### Exact remaining Stage B routes — not started

All paths below start with `/v1`:

1. POST `/mock/exams/:id/purchase`
2. GET `/mock/attempts`
3. POST `/mock/attempts/:attemptId/force-submit`
4. POST `/mock/attempts/:attemptId/extend`
5. POST `/mock/attempts/:attemptId/reopen`
6. DELETE `/mock/attempts/:attemptId`
7. GET `/mock/purchases`
8. POST `/mock/exams/:id/confirm-purchase`
9. POST `/mock/exams/:id/reject-purchase`
10. GET `/mock/attempts/:attemptId/certificate`

The final full Stage B security/media/concurrency gate remains outstanding with those routes. The historical broader mock verification limitations below are not erased by completing legacy `/tests`.

Checkpoint 2 implementation: `0aa1102` — `feat(django): port legacy tests lifecycle`. Verification: `test(django): verify legacy tests parity`; its hash is supplied in the final handoff (a commit cannot embed its own hash). Machine report: `backend-django/STAGE_B_PARITY_REPORT.json`, including `checkpoint2Verdict`, registered counts and explicit differences. Reproduction commands below remain valid. Overall verdict remains **STAGE_B_BLOCKED** until all 43 scoped contracts and the final gate pass.

## Historical Checkpoint 1 report (superseded counts)

Workspace/branch preserved: `migration/django-backend`, baseline `bba9707`. Stage A was not rewritten. No frontend/Tauri/NestJS source edits, schema migration, production access, deployment or merge.

## Scope and current coverage

43 active scoped lifecycle/access/result-support contracts: 28 `/mock`, 15 legacy `/tests`. 18 registered Django contracts: four pre-existing catalogue/media routes plus 14 new lifecycle routes. 25 missing routes are listed exactly in `DJANGO_STAGE_B_CONTRACT.md` and the machine report. Registration is not a completed parity gate.

Implemented slice: transactional mock Start/resume, single/bulk response saves, own history and scoped detail, annotations, cheat signals, section advance, durable Listening/Speaking phases, Speaking upload, authorized recorded-audio stream and synchronous submit/timeout. Existing tables remain unmanaged. Student audio now binds to an active own attempt even when the request omits attemptId, per explicit user security direction. Post-submit annotations retain exact reference behavior, also explicitly approved.

## Verification

- Django check: pass with the existing local DATABASE_URL. Initial check without DATABASE_URL correctly refused SQLite fallback; rerun with local configuration passed.
- pytest: 94 passed +11 subtests, including 578 direct calls comparing unchanged Nest pure scoring functions (tables, every conversion entry, rounding, answer rules and Unicode). Real database tests are in the separate harness.
- Final combined run: 394 recorded comparisons/check groups, 393 pass and one explicitly approved security mismatch. Stage B contributes 126 groups: 123 API/DB comparisons and three PostgreSQL concurrency groups. The IELTS audio security difference remains Django 400 MOCK_TIME_UP vs NestJS 200 audio bytes. Zero unapproved mismatches. The strict differential process intentionally exits 1 for the retained difference; this is not a clean full-parity gate.
- Stage A regression: 268/268 API/DB comparisons pass in the combined isolated runner.
- PostgreSQL authoring regression: 163/163 pass; disposable fixture cleanup reports zero leftovers.
- NestJS: 421 tests across 31 files pass; TypeScript check, build and Prisma validation pass.
- Both API fixtures use real JWT and two disposable localhost PostgreSQL schemas; the Nest harness loads real attempt/read-detail services, never workers or external AI services.

The final machine report is `backend-django/STAGE_B_PARITY_REPORT.json`. It remains explicitly `STAGE_B_BLOCKED` even if every implemented-slice comparison passes. UUID-keyed savedAnswers/mediaState retain distinct aliases. ISO timestamp normalization alone cannot prove deadline-duration parity; pure clock tests exist, but stronger API-relative clock assertions and full DB identity mapping remain required.

## Security verification limits

Verified for the slice: anonymous and teacher/admin/super_admin mutation denial; student-safe in-progress detail; hidden answer keys/transcript omitted from Start; foreign question and atomic mixed bulk denial; completed answer denial; late timed save denial; unsupported media rejection; upload header rejection; protected recorded-audio scope; immutable timed take logic and safe practice replacement.

Checkpoint 1 additionally verifies submission second-student IDOR, revoked enrollment, duplicate submissions, save-vs-submit races and rollback fault injection. Not yet a full security gate: the cross-route second-student IDOR matrix, assigned-teacher/parent ownership matrix, enrollment across remaining routes, concurrent fresh starts/force-submit, all skill media/timing recovery, and legacy `/tests`. No tenant boundary should be invented where the existing schema has none. Cheat event cap is serialized, but route-specific 30/minute throttle parity is still missing.

## Exact remaining work

1. Complete detailed error/JSON/DB inventory for missing legacy and support routes; decide whether certificate generation is lifecycle support or a separate result-stage artifact without dropping actual client calls from coverage.
2. Checkpoint 1 submission is completed; extend the final Stage B gate with additional profiles/media and staff force-submit concurrency when those routes exist. No DeepSeek/Deepgram/provider execution.
3. Implement force-submit, extend, reopen, delete and staff attempt queue, plus purchase request/list/confirm/reject and certificate support (10 missing mock contracts).
4. Implement and compare all 15 legacy `/tests` lifecycle/support contracts, including persisted random selection, marks, audio, demo scoring, submit and recovery.
5. Finish exact invalid-DTO/Unicode length/first-error parity and multipart limits, Range edge cases, phase ordering/retries, all supported speaking profiles and route throttle.
6. Real concurrent new Start/save/submit tests, timeout-vs-submit races, stale-definition race, rollback injection and second-student/program/staff-scope security matrix.
7. Full local PG lifecycle through Submit per Multilevel skill and IELTS plus legacy tests, interruption/recovery, timeout, duplicate submission and cleanup.
8. Differential every scoped route, relative timer assertions and semantic identity-aware persisted-state comparisons. Keep the approved media mismatch explicit; never report it as exact parity.
9. Rerun all gates after the remaining implementations. Stage C must not begin.

## Commits and reproduction

Checkpoint 1 (2026-10-08): deterministic scoring is isolated in `mock_scoring.py`; submission uses the shared row lock; manual/timeout/duplicate paths preserve persisted result JSON. Full four-skill fixtures compare objective totals, existing manual scores, status transitions, immutable snapshots and exact input hashes. Tests verify denied incomplete/revoked/foreign-owner submissions, rollback after a synthetic snapshot failure, save-vs-submit serialization, duplicate manual/timeout races and no duplicate notifications. The local Nest reference also receives concurrent submits; raw transient claim responses are retained in the machine report, while final persisted results match. Django's stronger atomic snapshot/notification boundary is documented in the contract. Writing/Speaking awaiting assessment retain `grading` status and no invented scores.

One expanded run initially failed with PostgreSQL `DiskFull: No space left on device`. Read-only diagnosis confirmed zero remaining disposable schemas; cleanup recovered sufficient space and the subsequent full run passed all new checks. C: remains low on free space; no existing data was deleted or moved. All verification schemas/storage were cleaned up. Stage C provider execution, jobs and teacher review remain deferred.

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
