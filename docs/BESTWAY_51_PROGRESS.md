# BESTWAY 5.1.0 progress

Base: `main` at `d53d6948` (PR #228 merge). No newer remote work and no existing 5.1 branch were found.
Branch: `feat/bestway-51-exam-monitoring-results` (mirrors the session branch `claude/zealous-galileo-5wax7q`).

## Task matrix

| ID | P | Task | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1.1 | P0 | No server finalization of expired attempts (attempt stayed `in_progress` until the student returned; assignment deadline only gated *starting*) | FIXED | `apps/core/mock_deadline.py`, `scripts/verify_exam51_deadline_postgres.py` |
| 1.2 | P0 | Teacher fixed-closing-time vs individual-duration policy, opens-at, validation, Tashkent display | IMPLEMENTED | migration `0035`, `teacher_views.exam_timing`, `classroom-assignments.tsx` |
| 1.3 | P0 | Worker hand-in via existing `submit` (no 2nd scoring path), audit `mock.attempt.auto_submit`, `submissionKind` | VERIFIED (PostgreSQL) | 31/31 checks |
| 1.4 | P0 | Late answers rejected, 6-min grace for Speaking upload recovery / racing Finish | VERIFIED | same |
| 1.7 | P0 | Production entrypoint `run_assessment_worker` runs the sweep; catch-up `finalize_expired_attempts` | VERIFIED locally | same |
| 1.9A | P0 | Runner: jump targets hidden under sticky header + audio panel (fixed `scroll-mt-28` vs real stack); audio panel took ~360px on phones | FIXED, browser-verified (1366×768, 1280×720, 1920×1080, 390×844, dark) | `mock-runner.tsx`, `docs/screenshots/bestway51/` |
| 2.x | P0 | Teacher-only final W/S grades, manual grading without AI, late AI cannot overwrite | VERIFIED (4.1 rules + new stale-lease check) | grading 87/87, reports 48/48 |
| 2.12/3.7 | P0 | Authoritative exam report dataset | VERIFIED | `exam_report.py` |
| 2.12 | P0 | Result Center page + API + Excel + PDF + confirmed resend + delivery status | VERIFIED (API, browser render) | `exam-result-center.tsx` |
| 3.1/3.2 | P0 | Live monitor: current skill, confirmed answers, last confirmed answer, guard events, staleness | IMPLEMENTED (persisted data only, 20 s refresh) | Result Center "Live monitor" |
| 3.4–3.6 | P1 | Student/group progress API + Recharts (nulls not joined, track/flow separated, sample sizes) | VERIFIED (API) | `exam_progress.py`, `exam-progress-charts.tsx` |
| 3.9/3.14/3.15 | P0 | Private paged leaderboard, durable preliminary/final/revision lifecycle | VERIFIED (mocked transport) | `exam_report_delivery.py` |
| 3.10/3.12 | P1 | Bot `/exams` menu: exam list, paged leaderboard with prev/next, pending list, web links; permission rechecked per tap | VERIFIED (fake transport) | `telegram_teacher.py` |
| 3.11 | P0 | Classroom aggregate adds not-submitted/awaiting/graded counts, no names | VERIFIED | `telegram_notify.exam_group_counts` |
| 3.13 | P0 | Student private auto-submit notice | VERIFIED | `mock_deadline.notify_student` |
| 4.2 | P0 | Full IELTS/Multilevel browser journeys with Speaking capture and Writing typing | NOT RUN (API/PostgreSQL journeys only) | — |

## Last verified tests
See the test report (final cumulative cycle run on the final head).

See `BESTWAY_51_TEST_REPORT.md` for the latest verified results.

## Next action
Owner: review the PR, run the release checklist smoke test on staging data, then merge manually.
