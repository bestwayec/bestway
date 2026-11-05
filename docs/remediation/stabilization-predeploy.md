# Stabilization pre-deployment checkpoint

Base: main merge `3511d9fed4c00bb55dbead5aee835d5c62093bc7`, which
includes Phase 0–3 and PR #93. This branch is not production-ready and must not
be deployed without separately verified migration and security gates.

- Mock authoring deletion now checks the original actor's super-admin role and
  uses the transactional deletion service. It no longer elevates draft-delete
  requests or silently deletes after an exception. The existing PostgreSQL
  authoring integration passed 171/171.
- BW-17: only high-confidence `PRACTICE_AUTO_AI` results are automatically
  projected; low-confidence results and `FULL_MOCK_AI_WITH_REVIEW` wait for a
  teacher. The proposal remains in the evaluation ledger, and latest pending
  or unapproved assessments block certificates. PostgreSQL tests cover the
  low-confidence proposal, no projected answers, certificate denial and teacher
  acceptance. Historical previously projected scores are not automatically
  revalidated; concurrent review/worker completion needs further integration
  coverage before declaring BW-17 fully resolved.
- BW-14: CD session lookup and active selection check publication and legacy
  entitlement. A teacher may preview a matched legacy exam only when its owner;
  independent CD drafts have no owner metadata, so only admins may preview.
  Nested answer metadata is stripped from question payloads. Verify existing
  clients that depend on non-whitelisted CD payload fields before release.
- BW-16 remains open: competing legitimate refreshes can revoke the family or
  receive 409 without automatic recovery. The existing WIP is retained.
- BW-13 remains open: the current default deployment still does not run a
  separately guarded Django migration stage after Prisma. Do not deploy until
  migration ownership, locking, fresh-install and upgrade rehearsals pass.

## Deployment investigation

GitHub run 42030164865 failed in `Deploy over SSH` after approximately 10m10s.
Public job annotations only report exit code 1; step logs were not accessible,
so the exact remote command and build duration were not independently verified.
The workflow now refuses a non-fast-forward checkout rather than hard-resetting
local work, builds the migrator/backend/frontend once, starts services from
those images with bounded build/start stages and waits for health. Worker
services share the backend image. Image pruning was removed to preserve rollback
images. Stage timing is observable through logs. These are preparatory changes,
not proof that deployment or migrations work on the VPS.

Before any future deployment: verify a restorable backup and migration plan,
run a fresh schema bootstrap and synthetic upgrade, verify current images and
release health, and prepare a rollback to prior application images. Schema
rollback may require restoring a verified backup and must not be improvised.
No production deployment or migration was executed for this checkpoint.
