# BESTWAY 5.1.0 progress

Base: `main` at `d53d6948` (PR #228 merge). No newer remote work and no existing 5.1 branch were found.
Branch: `claude/zealous-galileo-5wax7q` (the branch this cloud session is permitted to push; the
owner-suggested name `feat/bestway-51-exam-monitoring-results` was not used for that reason).

## Task matrix

| ID | P | Task | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1.1 | P0 | No server finalization of expired attempts (attempt stayed `in_progress` until the student returned; assignment deadline only gated *starting*) | FIXED | `apps/core/mock_deadline.py`, `scripts/verify_exam51_deadline_postgres.py` |
| 1.2 | P0 | Teacher fixed-closing-time vs individual-duration policy, opens-at, validation, Tashkent display | IMPLEMENTED | migration `0035`, `teacher_views.exam_timing`, `classroom-assignments.tsx` |
| 1.3 | P0 | Worker hand-in via existing `submit` (no 2nd scoring path), audit `mock.attempt.auto_submit`, `submissionKind` | VERIFIED (PostgreSQL) | 31/31 checks |
| 1.4 | P0 | Late answers rejected, 6-min grace for Speaking upload recovery / racing Finish | VERIFIED | same |
| 1.7 | P0 | Production entrypoint `run_assessment_worker` runs the sweep; catch-up `finalize_expired_attempts` | VERIFIED locally | same |
| 1.9A | P0 | Runner: jump targets and instruction line hidden under sticky header + audio panel (fixed `scroll-mt-28` vs real stack height) | IMPLEMENTED, browser screenshot UNVERIFIED | `mock-runner.tsx` measured `--bw-sticky-offset` |
| 2.x | P0 | Teacher-only final W/S grades | Existing 4.1 server rule confirmed (`assessment.finish` never finalizes) | see Phase 2 |
| 2.12/3.7 | P0 | One authoritative exam report (roster, participation × grading, ranks, growth, stage, revision) | VERIFIED | `exam_report.py`, 35/35 |
| 2.12 | P0 | Teacher Result Center page + API + Excel (formula-safe) + confirmed resend + delivery status | IMPLEMENTED (API verified, page build/unit verified) | `exam-result-center.tsx` |
| 3.9/3.14/3.15 | P0 | Private paged teacher leaderboard; durable preliminary/final/revision lifecycle (`ExamReportState`, 30-day catch-up) | VERIFIED (mocked transport) | `exam_report_delivery.py` |
| 3.11 | P0 | Classroom aggregate report | Existing 5.0 report reused (no names, small-group suppression); fields not extended | PARTIAL |
| 3.1/3.2 | P0 | Live monitor | Existing 5.0 live room panel unchanged; Result Center counts refresh every 20 s | PARTIAL |
| 3.4–3.6 | P1 | Student/group progress charts | Only per-exam growth column | NOT DONE |
| 3.10/3.12 | P1 | Telegram teacher menu, callback pagination | Pages sent as separate messages with a web link | NOT DONE |
| 4.2 | P0 | Browser journeys A–E, runner screenshots | Not run | NOT DONE |

## Last verified tests
- Django pytest (local PostgreSQL 16 + Prisma 5.22 migrate): 1731 passed, 4 skipped.
- `verify_exam51_deadline_postgres.py`: 31/31 PASS.
- Frontend: `tsc --noEmit` clean; ESLint 0 errors on changed files; 67 related Vitest specs pass.

See `BESTWAY_51_TEST_REPORT.md` for the latest verified results.

## Next action
Browser journeys (runner layout at 1366×768, full IELTS/Multilevel), progress charts, Telegram menu entries;
check hosted CI on the draft PR.
