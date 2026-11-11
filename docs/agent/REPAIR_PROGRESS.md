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
| W1.2 writing draft recovery | FIXED | 0383618 cherry-picked (no conflicts) + cross-tab and reload tests |
| W1.3 #103–#107, #112 | DONE | all merged into main, no unmerged work |
| W2 exam journey | PARTIAL | Browser smoke (scripts/e2e-local/smoke.mjs, real Chromium, local stack) 16/16 PASS: login, catalogue, practice start, 3 answers persist across reload, section nav, submit 201, result, logout, RBAC 403, Record Mock Listening 6 parts + answer persists |
| W2.5 Full Mock Finish 502 | NOT REPRODUCED | API full_test flow on Record Mock: start 201, 4 sections via advance, submit 201 in 0.11 s, repeat submit idempotent (same status), 1 Writing job only, honest `grading` state. Prod 502 cause UNVERIFIED (needs prod logs) |
| W2 map 401 | FIXED/VERIFIED | Real runner map via proxy: owner 200, anonymous 401. Simulator (CDLayout) used raw /media path (404 on web origin) + hard-coded Record Mock map for every Part 4 → now proxy GroupImage, no invented map |
| W2.6 content/media | FIXED | 6 Record Mock WAVs measured 8.0 s each. Importer (run by deploy-release.sh) copied and published them. Now never copied, exam unpublished with BLOCKED list until real recordings are in MEDIA_ROOT; `--allow-placeholder-audio` only for *_local loopback DB |
| W3 Exam Builder | PARTIAL | Browser (teacher, 1440px): create Multilevel practice → passage title/instructions/text → question with custom text + 3 custom options + answer key; keyboard text selection inside option works; Save Draft → reload → all values persisted. Backend author→publish→student→grade: verify_mock_authoring_postgres 171/171. FIXED: outline label 'No exams here yet' on empty passages; hard-coded Uzbek quick-import labels in English UI. Not done: publishing a tiny real exam end-to-end in the browser (Multilevel blueprint needs full part counts) |
| W4 Vocabulary | PARTIAL | FIXED (P0 points integrity): quiz submit counted repeated/foreign answers and re-awarded points on every resubmit; staff got student profiles. Live: exploit 1/5=20% 0 pts; 3 perfect submits → PointsLog [5] only. FIXED: any teacher could delete any set / read any set's results+Excel (now author, group teacher or admin). FIXED: set report always 500 (unimported function). Not done: browser UX pass on vocabulary pages |
| W5 Other functions | PARTIAL | Attendance: frontend called /attendance/group-summary/<id> (404) → dialog defaulted everyone to present and could overwrite absences; route added, live-verified |
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
- Media policy (P2, unchanged): everything under /media except private/ and speaking_submissions/ is public; exam media keys are random UUIDs; Record Mock is a public demo.
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

## Local stack recipe

`/root/local.env`-style dummy env (DB `education_center_local`, `config.settings.local`), `prisma migrate deploy`, `manage.py migrate`,
`seed_local_dev`, `seed_cbt_multilevel_exam`, `import_cd_record_mock_1 --allow-placeholder-audio` (local only),
Django `runserver 127.0.0.1:8100`, `frontend/.env.local` API_URL=http://127.0.0.1:8100/v1, `next dev -p 3300`,
smoke: `BW_PYTHON=... BW_CHROMIUM=... node scripts/e2e-local/smoke.mjs`.

## Content blockers (kept visible)

- Reading Q7 and Q15: authoritative PDF required — unchanged.
- Six Record Mock WAV files (8 s) are unverified — never treat as authentic audio.

## PRs / CI

- https://github.com/bestwayec/bestway/pull/113 (draft). CI run 43017256251 on 6b38720: success.

## Open questions

- Runner game (`games/runner`): score, distance and correct answers are client-reported; up to 150 points per game, no daily cap and no idempotency key (a retried POST is credited twice). Needs a product decision on a daily cap; the idempotency key needs a frontend change.
- Vocabulary set list (`GET vocabulary/sets`) shows every group's sets to every user; confirm whether sets should be limited to the student's own group.

## NEXT STEP

Continue W5 (other functions: homework, notifications, placement, payments with mocks) then W6 screenshots at 4 sizes.
