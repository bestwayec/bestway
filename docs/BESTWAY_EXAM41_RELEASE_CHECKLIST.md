# BESTWAY Exam System 4.1 release checklist

## Local checks

- [x] Verified the base ref and tested the Writing defect in Chromium through the normal runner.
- [x] Verified local IELTS and Multilevel task submissions, scoring and recordings in PostgreSQL.
- [x] Verified that a dedicated worker cannot replace a teacher-finalized grade.
- [x] Verified teacher review permissions and rejection of stale grading versions.
- [x] Completed an assigned IELTS exam through the gradebook and validated duplicate-request handling.
- [x] Added server-side opt-ins and bounded routing, budget and retry controls.
- [x] Tested advisory provider behavior using synthetic loopback fixtures.
- [x] Verified shared Redis ownership across separate Gunicorn processes.
- [x] Pushed the implementation branch and checked the remote base and head.
- [x] Checked the deployment workflow triggers. Production deployment requires an explicit manual dispatch.

## Release gates

- [ ] Verify normal Prisma migration workflow in an environment that can fetch the pinned engines.
- [ ] Verify exact live provider identifiers, free pricing, allowed privacy route, and separately verify image support using synthetic submissions.
- [ ] Review institutional authorization and applicable consent for minors before enabling external assessment with student work.
- [ ] Complete teacher-scored calibration and record measured deviation, evidence limits, latency, and billing.
- [ ] Open the pull request, inspect required hosted CI, and merge only after safe checks pass.

The environment blocks the GitHub REST and GraphQL APIs with proxy HTTP 403. The CI workflow runs on pull requests targeting `main`. The repository comparison is [main to feat/bestway-exam41](https://github.com/bestwayec/bestway/compare/main...feat/bestway-exam41?expand=1). Production was never deployed.
