# Teacher Workspace 2.0

A simple teacher interface over the services BESTWAY already has. **No new database tables and no migration.**
Attendance stays in `Attendance` (Prisma), grammar tests in the ClassQuiz engine, lesson / vocabulary / exam homework in
`HomeworkAssignment` + `HomeworkSubmission`, notifications in the durable Telegram outbox.

## Screens

| Route | Who | What |
|---|---|---|
| `/dashboard` (teacher), `/teacher` | teacher (office: `/teacher`) | Four primary actions — **Davomat olish, Uy vazifasi berish, Guruhlarim, O'quvchilar natijalari** — and a small overview: today's scheduled groups, present today, active homework, work awaiting review, deadlines in the next 7 days. Everything else sits under *Boshqa bo'limlar*. |
| `/attendance` (teacher), `/teacher/attendance?group=` | teacher | One screen: group → day (the group schedule is shown) → Keldi / Kelmadi / Kechikdi → **Davomatni saqlash** → summary. Monthly grid: `/attendance?view=month` (the office keeps it as before). |
| `/teacher/assign?group=` | teacher | Three steps: group (with student count) → Grammar quiz (existing, or new from pasted questions + answer key) / Vocabulary set / published exam / lesson task → title + deadline (time limit, attempts, pass mark under *Qo'shimcha sozlamalar*). Live server preview, one **Guruhga biriktirish** button. |
| `/teacher/results?group=` · `?kind=&id=` | teacher | A group's homework with progress; one assignment: Assigned / Submitted / Pending (Not submitted after the deadline) / Average + student table, refreshed every 15 s; view attempt and mistakes, grade lesson tasks, CSV (quizzes), remind non-submitters. |
| `/groups/[id]` | staff | Tabs: Umumiy · O'quvchilar · Davomat · Vazifalar · Natijalar (existing sections reused). |
| `/homework` | student | *Mening vazifalarim*: both homework sources with real statuses (Boshlanmagan, Jarayonda, Topshirildi, Tekshiruvda, Baholandi, Muddati o'tgan) and stored scores. |
| `/homework/quiz/[id]` | student | Web runner for a teacher quiz: server timer, every answer saved at once, resume, idempotent finish, stored result. Vocabulary uses the existing assignment runner, exams the existing mock runner. |

Previous pages are kept: the detailed teacher dashboard at `/teacher/insights`, invite-code cohorts at `/teacher/cohorts`.

## API (all under `/v1/`)

| Endpoint | Notes |
|---|---|
| `GET teacher/workspace/overview` | own (non-archived) groups only |
| `GET/PUT teacher/workspace/groups/{id}/attendance` | GET: full roster + stored marks (`state: null` = unmarked) + `revision`. PUT `{date, records, revision}` → existing `attendance.bulk` under the group row lock; stale revision → **409 `ATTENDANCE_CHANGED`**; duplicate student, other group, future/invalid date → 400 |
| `GET teacher/workspace/groups/{id}/attendance/history` | saved days with counts |
| `GET teacher/workspace/groups/{id}/homework/options` | own quizzes, vocabulary sets, **published** student-accessible exams (`teacher_views.assignable_exams`), lessons |
| `POST teacher/workspace/groups/{id}/homework/preview` | validates, writes nothing, never returns keys |
| `GET/POST teacher/workspace/groups/{id}/homework` | POST creates once: a repeated or parallel click (same group, type, source, title, deadline within 10 min) returns the first assignment with `created: false` (200) |
| `GET teacher/workspace/homework/{kind}/{id}/results` | `kind` = quiz · vocabulary · exam · lesson |
| `POST teacher/workspace/homework/{kind}/{id}/remind` | outbox reminders, one per student per day; 409 after the deadline |
| `GET student/homework` | the student's own groups only |

The website quiz runner uses the existing ClassQuiz endpoints (`class-quiz-assignments/{id}/start`, `class-quiz-attempts/{id}`, `/answer`, `/finish`, `/result`).

## Rules that matter

* **Attendance is never pre-filled.** Opening the sheet writes nothing; *Hammasi keldi* is an explicit button; only changed marks are sent. A save based on an outdated sheet is refused (409) and the fresh sheet is shown with the teacher's edits kept for review.
* **Excused absence is not offered**: `AttendanceState` (Prisma) has only present/absent/late. Adding it needs a Prisma migration — an owner decision.
* **Scores are never computed in the workspace.** Quiz = ClassQuiz grader, vocabulary = snapshot scorer, exam = the attempt (`homework_scoring.sync_from_exam`), lesson = teacher grade. A lesson submission is *Tekshiruvda* (no score) until graded; a grade of 0 is *Baholandi 0%*.
* **Correct answers** are shown to the student only when the server allows (`keysVisible`: last attempt used or deadline passed).
* **Removed students keep their results**: shown as *guruhdan chiqqan*, not counted as assigned.
* **DRAFT exams (e.g. Mock 27) are never offered or accepted.**
* Attendance parent/student notices now run **after commit** (`transaction.on_commit`) — identical for existing callers, and a rolled-back save notifies nobody.

## Telegram

New homework and reminders are **queued** in `TelegramOutbox` (dedupe keys `homework_assigned:…`, `quiz_assigned:…`, `homework_reminder:…:{day}`), respecting opt-out and quiet hours, only for linked, active students of the group. The quiz notice now has a **website button** (`/homework/quiz/{id}`) next to the bot's Start button; website homework links to `/homework`. Nothing is sent until the owner starts the opt-in worker (`--profile telegram-outbox`). A website finish queues the same `result_ready` notice the bot uses — one result, two views.

Existing behaviour not changed here: parents linked via `ParentTelegramLink` still receive absence messages directly (pre-existing `notify_parents`), when a bot token is configured.

## Verification

* `backend-django/scripts/verify_teacher_workspace_postgres.py` — 61 checks on real PostgreSQL (1 teacher, 3 groups × 20 students, teacher B, outsider); in CI.
* `scripts/e2e-local/teacher-workspace.mjs` — real Chromium + Django + PostgreSQL, 45 checks incl. network drop + retry, reload/resume, double clicks, wrong roles, clipping at 360/768/1024 px. Screenshots: `docs/evidence/teacher-workspace-2/`.

### Run locally

```bash
python manage.py seed_local_dev && python manage.py seed_teacher_workspace_local   # *_local DB, loopback, DEBUG only
python manage.py runserver 127.0.0.1:8100
API_URL=http://127.0.0.1:8100/v1 npx next start -p 3300                             # after npm run build
BW_WEB=http://localhost:3300 node scripts/e2e-local/teacher-workspace.mjs
```

Accounts: teacher `+998900000003`, student `+998900101000` (B1 Kechki), password `LocalDev-2026!` — synthetic, local only, no Telegram links.

## Known gaps

* Excused absence (schema), per-lesson attendance (attendance is per group per day; the schedule is shown, not enforced).
* Adding students to a group still uses the existing Group page search (office/teacher rules unchanged).
* Website quiz runner covers ClassQuiz; long IELTS/Multilevel exams use the existing mock runner.
* Real-Telegram delivery and real-device testing are not part of the automated verification.
