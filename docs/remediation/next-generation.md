# Next-generation engineering checkpoint

Base: `fbc62396757c6566ff2eb988c9e41b0022ed9141` (latest `origin/main`
at branch creation). Previous Speaking/Writing commit `7100ac2` is an ancestor.
No production data, deployment or migration has been touched.

## Evidence-based inventory

| ID | Severity | Evidence and cause | Correction and regression | Status |
| --- | --- | --- | --- | --- |
| DEPLOY-AUTO | Critical | `.github/workflows/deploy.yml` on the base uses `workflow_run` on successful main CI and can immediately SSH into the VPS. | Manual dispatch with confirmation, preflight verifies production reviewers and disallows self-approval, protected environment gates deployment, exact successful CI remains required. `test_production_approval.py`. | Implemented on feature branch; live GitHub protection and merge transition not verified. |
| BW-16 | High | Previous checkpoint and `verify_phase3_refresh_race_postgres.py`: a concurrent refresh can get 409 without recovery or revoke the rotated family. A refresh bearer alone cannot reliably identify a legitimate retry versus theft. | Needs an authenticated, cross-process design, replay and stale-cookie tests; do not use unrestricted grace or a session identifier alone as proof. | Open. |
| BW-13 | High | Default deployment does not provide the fully verified ordered/locked Prisma and Django migration stage described in `stabilization-predeploy.md`. | Fresh-install and synthetic upgrade rehearsal, migration ownership, coordination and rollback need separate verification. | Open. |
| BW-14 | High | Prior CD access changes are documented in `stabilization-predeploy.md`; entitlement and role boundaries still need complete verification. | PostgreSQL and client integration across publication, ownership and entitlement. | Partial, not verified complete. |
| BW-17 | High | Prior worker checks prevent several unapproved projections, but `stabilization-predeploy.md` identifies historical and concurrent review/worker gaps. | Run concurrent ledger, projection and certificate regressions; handle historical evidence. | Partial, not verified complete. |
| MANUAL-GRADE | High | `assessment.teacher_grade_attempt` wrote jobs, answers and aggregate attempt without the shared attempt lock; it can also project a holistic score into individual skills and mark other answers graded. | The operation now locks the attempt in a transaction, rolls back together and invalidates stale worker leases. `verify_manual_grade_concurrency_postgres.py` verifies the real lock wait, concurrent reopen, rollback and stale lease. A per-skill scoring contract and consistency coverage are still needed. | Partial: concurrency improved, scoring semantics remain open. |
| ASSESS-READ | High | An authenticated caller could GET another student's assessment and invoke the global assessment worker before the endpoint performed authorization. | Verify ownership and program before checking pending jobs or invoking a worker; retain processing for authorized users. Unit tests and the PostgreSQL grading fixture cover foreign teacher denial and unchanged jobs. | Fixed and locally verified on this branch. |
| ATTN-SCOPE | Critical | `attendance.bulk` looked up any missing user and created or reassigned their student profile to the teacher's group before validating the batch. A mixed batch could therefore move a foreign student. | Reject the whole batch if any student is outside the group, never create profiles there, and lock the group and matching profiles until the write commits. Unit tests and `verify_attendance_scope_postgres.py` cover foreign students, nonstudents, mixed batches, unauthorized teachers and valid attendance. `verify_attendance_concurrency_postgres.py` verifies concurrent group-owner and student-transfer changes. | Fixed and locally verified for these paths. |
| ATTN-SUMMARY | High | Real browser teacher-dashboard requests to `/attendance/group-summary/<groupId>` returned 404; the existing query-based route exposed a different monthly response. | Add a separately authorized daily summary route with date validation, measured counts, and null for unmarked rates and unavailable metadata. Existing monthly route stays unchanged. PostgreSQL and Chromium teacher-dashboard checks pass. | Dashboard 404 fixed; excuse handling remains open below. |
| ATTN-REASON | High | The legacy `Attendance` table does not persist `isExcused` or notes; the smart-attendance UI offers a reason but omits it from the save payload. | Unknown is shown as unknown, the UI states the limitation, and the API rejects attempts to save unsupported details instead of silently dropping them. Complete persistence requires an authoritative storage migration, validated API, UI changes and rollback/upgrade tests. | Partial; do not claim excused/unexcused attendance is persisted. |
| ATTN-RETRY | High | The smart-attendance UI retried every failed PUT with POST, including network errors after a possible commit and forbidden responses. | POST fallback is now limited to explicit 405/501 unsupported-method responses; network, authorization and server errors propagate without duplicate submission. Frontend tests cover successful save, supported fallback and failure cases. | Fixed and locally verified. |
| MOCK-AUTHOR | High | Historical Phase 3 authoring test failed super-admin-only draft deletion; later checkpoint reports a fix. | `verify_mock_authoring_postgres.py` re-run against isolated PostgreSQL with synthetic fixtures. | The original deletion regression passes (171/171 script checks); complete authoring RBAC not independently certified. |

## Production workflow transition

The branch removes the automatic `workflow_run` trigger in the proposed workflow,
but **does not change the current default-branch workflow**. Until merged, the
existing workflow can still deploy on successful main CI. Before any merge, a
repository administrator must independently disable the current automatic
workflow or otherwise prevent runs, examine/cancel already queued deployment
runs, configure the GitHub `production` environment with required reviewers and
`prevent self-review`, and verify those controls and branch protections. The
preflight fails closed if the environment API or reviewer configuration cannot
be verified. Both workflows must be dispatched from `main`, so an unreviewed
feature-branch copy of the preflight cannot satisfy the deployment gate. The
cutover's separately selected target commit still requires its existing CI gate.
Approval and exact successful-CI checks must be tested in GitHub;
local simulated tests do not establish actual repository protection. CI API
access is restricted in this environment. No merge or deploy is authorized while
these and the remaining security gates are unresolved.

## Rollback

Revert the workflow commit on a development branch if necessary. Reinstating
the previous workflow restores automatic deployment after main CI; do not merge
that rollback without a separate production deployment safeguard. No schema
changes are introduced by this milestone.
