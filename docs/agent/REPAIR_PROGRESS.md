# BestWay platform repair — progress

Program branch (both repos): `claude/affectionate-bell-uid86z` (the session may push only to this branch;
topic branches are not allowed, so PRs are split by commit range where needed).

## Verified SHAs (2026-11-11)

| Repo | Ref | SHA | How verified |
|---|---|---|---|
| bestwayec/bestway | main | 88d4758c743969773ff04b684e471a425d1545ef | `git ls-remote` |
| bestwayec/bestway | fix/writing-draft-recovery | 0383618bb66f01b0e7768678a0647862cb207da3 | `git ls-remote` (no PR) |
| bestwayec/bw-tauri | main | 900c5632dc7276fe90efafda1d4301d4e42cdcb1 | `git ls-remote` |
| bestwayec/bw-tauri | tag v1.0.12 | exists (not touched) | `git ls-remote --tags` |

Leads vs facts: web PRs #103–#108 and #112 are **merged** (nothing to salvage). CI run 42983067380 failure reproduced.

## Local stack (Linux container)

PostgreSQL 16 (CI uses 17.11), Redis 7, Python 3.13 venv (CI 3.12), Node 22 (CI 24), Prisma 5.22.0 `migrate deploy`
(binaries.prisma.sh reachable), `manage.py migrate`. Dummy secrets only (values from CI workflow).

## Phase checklist

| Phase | Status | Evidence / note |
|---|---|---|
| W0 inventory, SHAs, stack | DONE | this file |
| W1.1 CI MOCK_FULL_TEST_UNAVAILABLE | FIXED | Root cause: PR #111 (4cc2c72) deleted `partial = True` after inferring legacy practice skills in `mock_attempts.start`; practice exams fell through to `full_test`. Fixture was right. `verify_readiness_contract_postgres.py` failed before, passes after. pytest 860 pass / 4 skip; all CI PostgreSQL scripts, HTTP (67/67), worker, schema checks pass locally |
| W1.2 writing draft recovery | FIXED | 0383618 cherry-picked (no conflicts) + cross-tab and reload tests; vitest 77 files / 458 tests |
| W1.3 #103–#107, #112 | DONE | all merged into main, no unmerged work |
| W2 exam journey | TODO | open leads: Full Mock map 401, Finish 502 (not reproduced yet) |
| W3 Exam Builder | TODO | |
| W4 Vocabulary | TODO | |
| W5 Other functions | TODO | |
| W6 UI/UX | TODO | |
| W7 Perf/security | TODO | review findings from PR #111 below |
| W8 Final verification | TODO | |
| GATE | TODO | |
| D1–D3 desktop | TODO | not started (order rule) |

## Findings to review (from PR #111, external fork, merged 2026-11-10)

- `my_attempts`: no longer filters by the active exam track when `program` is omitted (own data only; behaviour change).
- `start`: duplicate in-progress attempts are now marked `completed` without submit/grading.
- Speaking upload minimum lowered 10 KB → 1 KB; any multipart field name accepted.
- `assessment_views.attempt`: GET now starts a background worker thread per request with pending jobs.
- New alias routes `attempts/*`, `save-answer`, PUT on answer.

## Desktop (bw-tauri) web contract — DO NOT BREAK

Base `https://api.bestwayec.uz/v1`; client strips `/api/v1`, `/api`, `/v1` prefixes.
Auth: `POST auth/login`, `GET auth/me`, `POST auth/refresh`, `POST auth/logout-refresh`, `POST auth/desktop/exchange`.
App: `GET desktop-version`, `POST exam-desktop/heartbeat`, `GET|PATCH exam-programs/mine`, `GET assessment/tracks`,
`GET assessment/overview`, `GET assessment/attempts/:id`, `GET mock/prediction/me`.
Mock: `GET mock/exams`, `POST mock/exams/:id/start`, `DELETE mock/exams/:id`, `GET exams/:id/cd-session/`,
`GET mock/attempts/mine`, `GET mock/attempts/:id`, `POST mock/attempts/:id/{answer,answers,submit,advance,flag-cheat}`,
`POST mock/attempts/:id/speaking/:qid`, `POST .../speaking/:qid/start`, `POST .../listening/:gid/{prepare,play}`,
`POST mock/attempts/:id/writing/:qid/ocr`, media `GET mock/groups/:id/audio`, `GET tests/questions/:id/audio`.
Legacy tests: `GET tests`, `POST tests/:id/start`, `DELETE tests/:id`, `POST tests/attempts/:id/{answer,submit,marks,flag-cheat}`,
`GET tests/attempts/:id`, `GET tests/attempts/mine`.
Live: `GET live-room/join`, `POST mock/live-rooms/join`, `POST mock/live-rooms`, `GET live-room/:pin/proctor-status`,
`POST live-room/:pin/action`, `POST live-room/telemetry`.

## Feature / role inventory (status: V verified, B broken, ? missing evidence)

| Area | Roles | Frontend | Backend | Status |
|---|---|---|---|---|
| Auth login/register/refresh/Google | all | (auth)/login, register | auth_views, auth_service | ? (tests exist) |
| Telegram login/OTP/link | all | login | telegram_views | ? |
| Desktop auth/update | student | (auth)/oauth/desktop | auth/desktop/*, desktop-version | ? |
| Dashboard / study plan | student | (app)/dashboard, exam-track | study_plan_views, statistics_views | ? |
| Legacy tests | all | (app)/tests/* | legacy_test_views | ? |
| Mock catalogue/start/runner/result | student | (app)/mock/* | mock_attempts, mock_scoring | B→FIXED practice start (P0) |
| Full mock / CD / live room | student, teacher | (fullscreen)/simulator, demo | cd_exam_views, live_exam_service | ? map 401 / finish 502 leads |
| Assessment / AI grading | student, teacher | mock result | assessment_views | V (grading consistency 76/76) |
| Exam Builder | teacher, admin | (app)/exam-builder/* | mock_authoring | ? |
| Mock imports | teacher, admin | exam-builder | mock_import_views | ? |
| Vocabulary / SRS | all | (app)/vocabulary/* | vocabulary_views | ? |
| Games / Bamboozle / runner | all | (app)/bamboozle | apps/bamboozle, runner_game_views | ? |
| Homework / cohorts | teacher, student | (app)/teacher | lms_views | ? |
| Lessons / videos | student | (app)/videos | video_views | ? |
| Groups / attendance | teacher, admin | (app)/groups, attendance | group_views, attendance_views | ? |
| Payments | admin | (app)/payments | payment_views | ? |
| Points / leaderboard | student, teacher | (app)/leaderboard | game_points_views | V (AI rankings 35/35) |
| Notifications | all | (app)/notifications | notification_views | ? |
| Placement | guest, student | marketing | placement-test/* | ? |
| Certificates | student | result modal | mock_certificate | ? |
| Blog/news/gallery | public, admin | (marketing)/news | article_views | ? |
| Parents | parent | (app)/children | parent_views | ? |
| Admin / teacher pages | admin, teacher | super-admin, staff, students, teacher | user_admin, lms_views | ? |

## Content blockers (kept visible)

- Reading Q7 and Q15: authoritative PDF required — unchanged.
- Six Record Mock WAV files (8 s) are unverified — never treat as authentic audio.

## PRs / CI

- (pending) draft PR from `claude/affectionate-bell-uid86z`.

## Open questions

- None yet for the owner beyond content blockers.

## NEXT STEP

Reproduce the Full Mock map 401 and Finish 502 on the local stack (W2.5).
