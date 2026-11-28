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
| 4.2 | P0 | Full IELTS/Multilevel browser journeys: playback, typing, native Speaking capture, Finish, teacher UI grading, auto hand-in, Result Center/Telegram agreement | VERIFIED (local Chromium; fake mic; emulated fullscreen) | `scripts/browser-acceptance-51/`, `docs/screenshots/bestway51-final/` |
| UI-R | P0 | Owner feedback: keep original CBT look; compact inline text-entry rows, compact choices, tighter audio panel, navigator "saving" state, premium Result Center + live monitor, <4.0 rule | DONE, browser-verified light/dark at 4 viewports | see test report |
| G-1 | P1 | Objective-only attempts close after 60 s grace; Speaking keeps 6 min | VERIFIED 35/35 | `mock_deadline.attempt_grace` |
| T-L | — | Live Telegram delivery, installed BW-Tauri | NOT VERIFIED (no test bot / desktop here) | release checklist §6–7 |

## CBT Exam Experience 2.0 (continuation on the same PR, from `91d6a8b`)

| ID | Task | Status | Evidence |
| --- | --- | --- | --- |
| C1.1 | Readiness screen before a timed start: exam type, sections + minutes, positions, assignment window (opens/closes, fixed-close vs individual) and eligibility from the server, rules, device check with Required/Recommended rows (browser features + answer storage, 3-request connection sample, sign-in, synthetic test tone with volume, live microphone level only when Speaking is required). Nothing creates the attempt until Start | DONE | `exam-readiness-dialog.tsx`, `device-check.tsx`, `student_assignment_exam_view` (+timing fields), `cbt2-phase1.spec.ts`, `test_exam51_readiness.py` |
| C1.3 | Speaking microphone check re-opened after reload / browser restart | FIXED: a passed check is reused per attempt only while the same browser still reports the permission as `granted` (12 h, per user agent); denied/prompt/unknown asks again | `lib/mic-readiness.ts` + spec |
| C1.4 | Scheduled Listening: buffering, load failure and retry states; retry rejoins the server clock (no restart, no extra play) | DONE | `listening-engine.tsx` |
| C1.5 | Calm save status: "saving" shown only when a save lasts >0.7 s; offline label says where edits are kept; hand-in / handed-in / locked states; never "saved" without a receipt | DONE | `useCalmSaveState`, `saveLabelKey` |
| C1.6 | After the server deadline: answer controls disabled in place, "Time is up" chip instead of a stopped clock, finalizing / next-section / Speaking-upload notice | DONE | `mock-runner.tsx` |
| C2.2 | Exam Settings 2.0 (extends the existing settings): theme (as site / light / dark), comfortable line spacing, reduce motion, strong focus outline, Restore defaults (also resets Reading/Writing panel widths and volume); 5.0 settings load unchanged; applied as classes in place (no remount) | DONE | `lib/exam-settings.ts`, `exam-toolbar.tsx`, `globals.css` |
| C2.3 | Smart navigator: All / Unanswered / Answered / Flagged / Not yet saved filters with counts in the overview; states independent; `O` opens the overview; jump-to-question event | DONE | `cbt-section-stepper.tsx`, `cbt2-phase2.spec.ts` |
| C2.4 | Shortcut help lists the new `O` key; existing typing/IME guard reused unchanged | DONE | `runner-shortcuts.tsx` |
| C2.7 | Task pictures (charts, maps, diagrams): accessible Enlarge dialog using the same protected file | DONE | `group-image.tsx` |
| C2.9 | Submission review: unanswered and flagged numbers of still-open sections only (tap to jump), Writing tasks answered, Speaking recordings held by the server, unsynchronised / offline warning | DONE | `lib/submit-review.ts`, `submit-confirm-modal.tsx` |
| C2.6 | Reading passage scroll restore, split preference persistence | ALREADY PRESENT (reused, not duplicated) | `mock-runner.tsx` `readingPositionKey` |
| C3.2 | Pre-publication checks added to the builder's Review panel: duplicate question identifiers, answer keys the scorer could never match (same rule as `mock_rules.choice_index`), T/F/NG and Y/N/NG keys (same canonical form as the scorer), more answers than options, gap placeholders without a question / used twice, completion questions without a gap, numbering holes, missing instructions, IELTS Task 1 without its visual. Nothing is invented or auto-fixed | DONE | `exam-builder/checks.ts`, `publication-checks.spec.ts` |
| C3.3/3.4 | Result review: "My mistakes" filter (wrong + unanswered, never pending marks), mistake summary with "Review my mistakes" (`?review=mistakes`); keys still only when the server discloses them | DONE | `result-review-table.tsx`, `mock-result-view.tsx` |
| C3.5 | Live monitor: in-progress / quiet / incident counts, "only those needing a look" filter, minutes since the last confirmed answer, explicit note that quiet ≠ disconnected and incidents ≠ penalties | DONE | `exam-result-center.tsx`, `exam-control-center.spec.ts` |
| C3.6 | Assessment queue on the Result Center: pending Writing/Speaking students on the page and "Assess next" into the existing teacher-only grading view | DONE | same |
| C3.1 | Builder student preview: existing production renderers reused; a phone-width preview was NOT added (the runner uses viewport breakpoints, so a narrowed box would show a misleading desktop layout) | NOT DONE — limitation | — |
| C3.8 | Telegram reports, `/exams` menu and outbox untouched | PRESERVED | — |

## Last verified tests
See the test report (final cumulative cycle run on the final head).

See `BESTWAY_51_TEST_REPORT.md` for the latest verified results.

## Next action
Owner: review the PR, run the release checklist smoke test on staging data, then merge manually.
