# BESTWAY 5.0 progress

Recovery of [PR #228](https://github.com/bestwayec/bestway/pull/228) began at the fetched head `b25f3d4` on `feat/bestway-5-smart-classroom` with base `main` at `910e7d92`. The pull request remains open for manual review.

| Area | Recovery status |
| --- | --- |
| Classroom and administration | Multi-group access uses active memberships. An explicit transfer closes only the selected source. The PostgreSQL classroom journey and Chromium invitation and transfer checks passed. |
| Result Center and disclosure | The existing review UI shows original evidence when authorized. The skill cards show objective answer counts and distinguish pending grading from a numeric mark. Newly assigned exams record a participant snapshot. |
| Live Exam Guard | The server derives the supervisor from the assignment or live session. Focus and network observations have bounded recovery and are scoped to the current supervisor. |
| Account reconciliation | A super administrator records an internal verification case for both student accounts. A different administrator can use that verification ID within 24 hours. The preview binds the actor, account pair, verification, options and current data. |
| Telegram | Group bindings require a Telegram admin with a linked identity and confirmation in the target chat. Existing bindings require confirmation again. Reports omit named results and suppress the aggregate score for small groups. The PostgreSQL lifecycle suite verifies announcements, reminders, provisional and final reports using synthetic records. |
| Delivery | Review GitHub for the exact-head status of required checks. Merge readiness depends on those checks and the critical acceptance tests. |

## Answer release policy

A new assignment can release answers early when each participant has a finalized result and all relevant timed attempts have ended. A legacy assignment without a participant snapshot uses the published deadline and active attempts. An individual attempt with an extended timer can delay release past that deadline. A linked result whose assignment was removed keeps its answers restricted. Reopening or reviving a closed assigned examination is blocked after the published deadline.

The assigned-exam workflow supports one attempt per participant. Separate scheduled retake slots, advance individual deadline overrides, and explicit excusal or withdrawal waivers have no assignment controls in this release. Membership removal does not shrink a saved participant snapshot.

## Verification

- Hosted CI on `e3fed55` passed Django pytest and the frontend job. The downstream PostgreSQL grading fixture then exposed a missing assignment link. The recovery updates those fixtures to exercise assignment-based access and checks the final SHA separately.
- Focused local checks passed for classroom transfers, assignment-scoped assessment access, account verification, Telegram permissions and outbox invalidation, and live exam observation recovery.
- Telegram delivery checks use mocked provider calls. Browser verification uses Chromium and synthetic accounts.

See [Database audit](BESTWAY_5_DATABASE_AUDIT.md) and [Classroom architecture](BESTWAY_5_CLASSROOM_ARCHITECTURE.md).
