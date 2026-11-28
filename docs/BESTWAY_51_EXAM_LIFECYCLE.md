# BESTWAY 5.1 exam lifecycle

## Timing policies (per exam assignment)
| Policy | Meaning | Server behaviour |
| --- | --- | --- |
| `individual` (default; all pre-5.1 assignments) | Each student gets the exam's full duration after starting. | The assignment deadline only refuses *new starts* (`ASSIGNMENT_EXPIRED`). |
| `fixed_close` (supervised classroom exam) | Everyone must finish by the common closing time. | On start every attempt timer (overall + sections) is capped at the deadline; legacy Speaking steps also keep the cap. |

`opens_at` (optional) refuses starts before the opening time (`ASSIGNMENT_NOT_OPEN`). Times are stored in UTC; the teacher UI enters and shows Asia/Tashkent (UTC+05:00). Teacher extensions (`mock_support.extend`) still move one attempt's own timer.

## Automatic hand-in (`apps/core/mock_deadline.py`)
* Runs inside the **assessment worker** (`python manage.py run_assessment_worker`, every `EXAM_AUTO_SUBMIT_INTERVAL`=15 s). Disable only with `EXAM_AUTO_SUBMIT_ENABLED=false`.
* Eligible: `in_progress` + `timed` attempts whose own deadline has passed by more than their grace:
  * attempts with Speaking in scope: `EXAM_AUTO_SUBMIT_GRACE_SECONDS` (default 360 s), which covers the Speaking upload recovery window (phase end + 5 min);
  * objective/Writing-only attempts: `EXAM_AUTO_SUBMIT_OBJECTIVE_GRACE_SECONDS` (default 60 s), enough for a client Finish racing the deadline.
  Answers are rejected after the deadline (`MOCK_TIME_UP`) during either grace.
* Attempts with no own timer that belong to an assignment close 3 h after the assignment deadline (`reason=assignment_closed`).
* Hand-in uses the existing `mock_submissions.submit` (same lock, scoring, `SubmissionHandoff` → assessment jobs, teacher notification, homework sync). Only server-confirmed answers are scored; nothing unsent is claimed.
* `SELECT … FOR UPDATE SKIP LOCKED` + status re-check: two workers, duplicate sweeps, restarts and a simultaneous manual Finish give one result. No lower time bound → catch-up after downtime. Manual catch-up: `python manage.py finalize_expired_attempts`.
* Audit: `media_state.__auto_submitted {at, deadline, reason}`, `AuditLog mock.attempt.auto_submit`, API `submissionKind: manual|auto`.

## Statuses (no new DB states)
Participation: `not_started` → `in_progress` → `submitted | auto_submitted`, or `not_submitted` after closing. Grading: `none`, `awaiting_assessment` (AI job running), `awaiting_teacher_review`, `partially_graded`, `finalized`. A never-started student has no attempt and no score; an unanswered objective question is 0; a pending Writing/Speaking grade is a status, never 0.

## Grading authority (unchanged 4.1 rule, verified)
Listening/Reading are scored by the server at hand-in. Writing/Speaking: AI output only lands in `NEEDS_REVIEW` (`assessment.finish`); only a teacher action sets `final_score_source='TEACHER'`. A late AI job under a stale lease cannot change a teacher-final grade. Manual grading needs no AI.

## Reports (`exam_report.py`, `exam_report_delivery.py`)
* One dataset per assignment feeds the Result Center API, Excel and the Telegram leaderboard.
* Stage: `open` → `preliminary` (closed, or everyone handed in, while any result is pending) → `final` (every handed-in result teacher-final). Overall is shown only when final.
* Ranking: finalized only, descending, shared competition ranks (1, 2, 2, 4); name order inside a tie; speed never breaks ties.
* Growth: previous finalized attempt of the same exam type and flow; IELTS, Multilevel and raw scales are never mixed.
* Delivery: `ExamReportState` stores the revision queued per stage. Preliminary once; final once per content revision (a correction → "revision N"). Sweep looks back 30 days and skips assignments whose final is queued; the grade-finalization hook re-checks immediately.
* Teacher: private paged leaderboard (every eligible student exactly once). Classroom chat: the existing aggregate report with small-group suppression, no names.
