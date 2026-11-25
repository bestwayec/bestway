# Phase 3 · CBT, result review and classroom analytics

Branch `feat/bestway-exam4-cbt-analysis` is stacked on Phase 2 commit `16d0ea90a99b81682eed8bb5a19a12f756119e3e`. The starting Phase 3 commit was `e7cfd90c116d4027582398a077ea6a557f4fd611`.

## Implementation checkpoint

- Reading and Listening results use the original question IDs and the canonical passage or recording association. The review shows status, the student's answer, accepted answers and points. It offers authorized audio and transcript, verified evidence, and optional teacher-authored explanations. The explanation field is included in full JSON exports and excluded from reusable exam templates.
- Reading keeps the selected mobile panel and per-passage scroll positions in the current browser session. Writing indicates local storage only after a successful write. Speaking progress is announced to assistive technology. Server receipts, section clocks and playback guards stay authoritative.
- Profile charts show the learner's submitted attempts, with separate IELTS bands, Multilevel scores, raw practice accuracy and full-mock skill trends. Prediction requires two graded full mocks on the same scale. Targets persist the selected IELTS band, Multilevel score and CEFR level independently.
- Classroom reports use dated enrollment or an explicit assignment association. Date, track, assessment, assignment, skill, status and retake policy filter the report. Latest and best use only comparable results and retain shared ranks for equal scores. The dashboard and downloads share the same report service. Undated legacy enrollment contributes attributable records only.
- Separate counts distinguish started, submitted, pending and graded students. Attendance comes from recorded present, late and absent marks. Objective statistics show answered and unanswered counts, and compare graded answers with the actual question definitions. No phone numbers are in the analytics downloads.

## Verification at checkpoint

| Check | Evidence |
| --- | --- |
| PostgreSQL Django | 1,698 passed, 325 subtests passed. Four NestJS comparison checks skipped because the legacy distribution was unavailable. |
| Vitest | 987 passed across 146 files. |
| TypeScript and production build | Standalone TypeScript and Next.js webpack production build passed. |
| ESLint | 0 errors and 405 warnings at the previous run. |
| PostgreSQL reporting | Assignment participation, mixed scales, zero and pending, tie policy, historical membership, XLSX cells and unauthorized HTTP responses were checked against disposable rows. |
| IELTS Chromium | First run passed all 10 steps with overall 8.0. Final production-build rerun includes persisted teacher explanation. |
| Phase 2 Chromium | Canonical Reading/Listening, scores, reload, Builder duplication/reordering, preview, and publication passed on the production build. |
| Multilevel Chromium | Prior run reached Speaking after 35 Listening, 35 Reading and three Writing responses. It stalled after three uploads. A production-build rerun is in progress. |
| Delivery | Initial implementation checkpoint `c6f604cd00f757762fd1e27787751dc32b32260c`. GitHub GraphQL returned HTTP 403 on PR discovery. |

## Browser follow-up

- Production-build IELTS passed 10 of 10 steps, including the persisted teacher explanation. The result uses band 8.0. PostgreSQL counted 86 distinct answer rows and three recordings, with the fourth speaking answer entered in the live interview.
- The report browser journey checked assignment participation, private result and audio denial, target persistence, ranking, PDF/XLSX and archive reopening. The latest rerun exercises assignment resume and both-track profile history.
- Phase 1 passed the reliability and 22 takeover assertions. The Phase 2 browser suite verified canonical continuation review on the release build.
- A second Multilevel run reached Speaking and rejected one recorded file with `SPEAKING_AUDIO_DURATION_INVALID`. Production-build retest with rejected synthetic clip capture is underway. The server duration thresholds were preserved.
- Django checks and Prisma manifest matched. Prisma's engine checksum request returned HTTP 403. The additive SQL applied on local PostgreSQL and full tests exercised that schema.

## Continuation point

Finish the production-build IELTS, Multilevel, Phase 1 and Phase 3 browser checks. Inspect screenshots and downloaded reports. Verify runtime database receipts and assignment data, migration consistency, remote branch SHA and GitHub PR access. Use the checked-in report and test logs when passing the change to Phase 4.
