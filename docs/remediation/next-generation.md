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
| MANUAL-GRADE | High | `assessment.teacher_grade_attempt` writes jobs, answers and aggregate attempt without the shared attempt lock; it can project a holistic score into individual skills and mark other answers graded. | A transactional, per-skill review contract and concurrent worker/teacher integration coverage are needed. See `speaking-writing-integrity.md`. | Open. |
| MOCK-AUTHOR | High | Historical Phase 3 authoring test failed super-admin-only draft deletion; later checkpoint reports a fix and 171/171 integration. | Re-run `verify_mock_authoring_postgres.py` on current base. | Pending current verification. |

## Production workflow transition

The branch removes the automatic `workflow_run` trigger in the proposed workflow,
but **does not change the current default-branch workflow**. Until merged, the
existing workflow can still deploy on successful main CI. Before any merge, a
repository administrator must independently disable the current automatic
workflow or otherwise prevent runs, examine/cancel already queued deployment
runs, configure the GitHub `production` environment with required reviewers and
`prevent self-review`, and verify those controls and branch protections. The
preflight fails closed if the environment API or reviewer configuration cannot
be verified. Approval and exact successful-CI checks must be tested in GitHub;
local simulated tests do not establish actual repository protection. CI API
access is restricted in this environment. No merge or deploy is authorized while
these and the remaining security gates are unresolved.

## Rollback

Revert the workflow commit on a development branch if necessary. Reinstating
the previous workflow restores automatic deployment after main CI; do not merge
that rollback without a separate production deployment safeguard. No schema
changes are introduced by this milestone.
