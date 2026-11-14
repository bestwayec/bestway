# BestWay platform repair — progress

Program branch: `claude/affectionate-bell-uid86z` (PR #113). Exam program: docs/agent/EXAM_PROGRAM.md. Since the owner asked for separate PRs, new work
is on topic branches `claude/<topic>`, each starting from #113's head e328f58. This file is kept current on
`claude/repair-progress` (#113 + this file only). Owner rules: no force-push (plain pushes only), commits and PR
text authored by rozievkomiljon with no Claude attribution, reports in Uzbek.

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
| W5 Other functions | DONE (2 BLOCKED on owner) | Crawl of 24 app routes × 4 roles in Chromium: before, 16 hydration errors (dashboards) + /teacher open to students/parents (403 API) → after, 0 API errors ≥400, 0 page errors (PR #117). Attendance per-day summary (PR #113). API sweep: notifications broadcast (group, 2 notified, Telegram off), read by non-owner 404; placement questions anon 200; payments scoped (student own, teacher own groups); attempt/assessment/certificate of another student 403; parent unlinked 403; student /users 403. BLOCKED: homework submit takes a client-reported score (empty POST = 100% passed), and no UI calls it → owner must define the score source. OPEN: teacher /users lists all students with phones (needed by the group enrolment picker) |
| W5 runner points (owner decision) | FIXED | PR #114: server session, server-side replay of choices, retry idempotent, 300/day cap, staff no points. Live: too fast → 400, retry → no new ledger row, ledger [150,150] then 0 |
| W5 vocabulary visibility (owner decision) | FIXED | PR #115: student sees own group teacher's sets, sets of own group, own sets; others 404 for detail/quiz/submit; admin all. Live verified |
| W5 Finish 502 diagnosis | PARTIAL | PR #116: proxy logs `backend_proxy_error` + header `x-bw-proxy-error` (timeout/network/refresh_unavailable/retry_failed). Needs production logs (owner) |
| W6 UI/UX | PARTIAL | PR #118: responsive audit (15 pages × 4 sizes, docs/design/w6 before/after + report.json). Fixed: exam runner/result overshoot on phones, staff bottom nav hiding "More", exam-track cards at 360, 2 unlabeled search inputs. Exam smoke re-run 16/16. NOT DONE: design-system consolidation (needs its own plan); small touch targets on vocabulary chips/icons |
| W7 Perf/security | DONE (BW-16 server side open) | PR #119: /mock/exams 118→33 (student) / 141→44 (staff) queries, byte-identical output, regression test. Client retries 409 REFRESH_IN_PROGRESS. Security scripts on disposable bestway_security_w7: phase0 17 PASS, phase3 auth 22 PASS, refresh contention PASS, refresh race FAIL BW-16 (server-side, mitigated in client). Login: 31st bad attempt/min → 429 |
| W8 Final verification | DONE (local) | Local integration of #113 + #114–#119 (unpushed, no conflicts): pytest 889 pass/4 skip; all CI PostgreSQL scripts pass (authoring 171/171, HTTP 67/67, workers); schema/manifest/deploy checks pass; lint 0 errors, vitest 81 files/466, tsc, next build pass; browser smoke 16/16; crawl 4 roles × 24 routes clean |
| Owner decision: homework score | FIXED | PR #120: exam-linked → server-side from the student's own attempt (sum raw score / sum raw max); otherwise awaiting teacher review; teacher grade endpoint + 'Baholang' UI; client score ignored; migration core.0008. Live + browser verified |
| Owner decision: teacher /users | FIXED | PR #121: outside own groups phone '+998 ** *** 12 34' and email masked; teacher search by name/ID only; admins unchanged; browser enrolment verified (390×844) |
| BW-16 server side | CLOSED (owner decision 2026-11-12) | No server-side grace window for now; keep the client retry of 409 REFRESH_IN_PROGRESS from #119. Previous analysis: | No server fix without weakening reuse detection: a grace window must keep the new raw tokens in Redis and lets a stolen old token get valid tokens for its duration. Client recovery is in #119. Owner: grace window yes/no |
| W8b full browser E2E | DONE | PR #122: scripts/e2e-local/full-journey.mjs 13/13 twice (Builder → publish → student all 4 sections → reload → finish → honest pending → teacher view; vocabulary list → quiz 3/3 server-scored). Found and fixed: catalogue cache hid new exams 60 s; launcher offered Full Mock on practice exams (HTTP 400); quiz double load re-scored answers; unnamed add-word button |
| W6b unified design system | TODO | not started (context budget); next session |
| GATE | NOT CLOSED | waiting for W6b (CI green on all 10 PR heads #113–#122) |
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

## PRs / CI (state 2026-11-13 evening, main 7603d7f)

#113–#137 MERGED (#123 included; verified 2026-11-13 via the PR list: only dependabot PRs open before this session).
OPEN, exam program phase 1 (docs/agent/EXAM_PROGRAM.md), merge order: #138 blueprint → #139 scoring module → #140 prediction #129 → #141 vocab battle winners → #142 targeted practice (contains #141's commit) → #143 demo test keys → docs PR (EXAM_PROGRAM.md + this file). Merging all six onto main locally is conflict-free; on that integration: pytest 1061 pass / 4 skip, all CI PostgreSQL scripts (incl. new verify_points_integrity_postgres 48/48), vitest 604, tsc, lint 0 errors, next build, smoke 17/17, full-journey 13/13, vocab-battle 20/20, drill 24/24, demo 15/15.
OPEN, exam program phase 2 (CD IELTS exam window), stacked with plain merges, merge order: #145 answer queue + last-write-wins + Finish 502 → #146 workspace (highlights/notes/flags on the server) → #147 timer, Settings, Help, Hide, Listening 2-minute check → #148 Writing word count + clipboard → #149 exam mode log → phase 2 docs PR (stacked on #144). Independent of phase 1. All 12 branches merge onto main without conflicts; on that integration: pytest 1070 pass / 4 skip, all CI PostgreSQL scripts (points 48/48, exam window 14/14), vitest 669, tsc. Top of the phase 2 stack alone: pytest 915 / 4 skip, vitest 654, lint 0 errors (446 warnings, main 453), next build, smoke 16/16, full-journey 13/13, exam-window 12/12, exam-workspace 20/20, exam-tools 28/28, exam-writing 6/6, exam-mode 8/8.

NOT YET OPENED (owner rule: do not mix phases), exam program phase 3, pushed branches stacked with plain merges on `claude/exam3-base` (main + all phase 1 and phase 2 branches): `claude/exam3-levels` → `-single-session` → `-listening` → `-a11y` → `-reading-split` → `-live-i18n` → `-item-bank` → `-multilevel` → `claude/exam3-docs` (on #150). PRs are opened in that order once #138–#150 are merged. Top of the phase 3 stack: pytest 1167 / 4 skip, CI PostgreSQL scripts incl. exam window 23/23, listening schedule 10/10, item bank 10/10; vitest 722; tsc; lint 0 errors (446 warnings, same as the base); next build; E2E on a production build 190/190 (smoke 17, full-journey 13, exam-window 12, exam-workspace 20, exam-tools 30, exam-writing 6, exam-mode 8, exam-session 20, exam-listening 16, exam-a11y 12, exam-reading-split 20, teacher-live 16).

## Open questions (owner)

- Decided: BW-16 closed, no server grace window (client retry from #119 stays). Short/partial practice: no band/CEFR, raw "N/M correct · %" (#129).
- Decided 2026-11-13 and implemented: prediction follows #129 (#140); drill one award per drill + daily cap 300 (#142); battle winners in the state + idempotent /finish + no podium for 0 score (#141).
- Decided 2026-11-13 and implemented (phase 3, levels): Multilevel levels follow the agency criteria B1 38–50, B2 51–64, C1 65–75, from one blueprint table. Stored levels of older attempts are not recomputed; `manage.py report_multilevel_levels` lists differences (read-only). Recomputing = data change, needs the owner's approval.
- OPEN: site brand green #16a34a with white text is 3.3:1 (fails WCAG AA); fixed inside the exam window only (EXAM_PROGRAM finding 8).
- Implemented as the owner asked in phase 2: exam-mode exits are recorded, never punished (the old 3-strike auto-submit is removed, #149).
- Finish 502: production logs needed. Record Mock: authentic audio needed. Reading Q7/Q15: official PDF needed. Desktop: Android keystore secret needed.
- P2 noted, not changed: /media public policy.

## NEXT LEVEL PROGRAM (owner brief 2026-11-11: premium UI/UX, website first, then desktop)

| Phase | Status | Evidence / PR |
|---|---|---|
| U0 post-merge health | DONE | PR states verified. Main CI green at 5d0b82b. Backend 900 pass / 4 skip (CI-like env), makemigrations --check clean, single leaf core.0008. Env-only test issues fixed in #127. smoke.mjs 16/16, full-journey.mjs 13/13 on main + #125/#126. A/B/W8b merged (#120/#121/#122); C BW-16 client recovery merged (#119), server grace window = owner decision; W6b 3/3 = #126. Record Mock hidden on production until authentic audio (expected) |
| U1 audit + design direction | PARTIAL | docs/design/NEXT_LEVEL_AUDIT.md (top 25, ranked, status) in #128, based on 19 pages × 4 sizes × 2 themes + E2E runs. Not done: every route per role (parent, admin sub-pages); DESIGN_SYSTEM v2 sections for elevation/motion/data-viz palette |
| U2 foundation v2 | PARTIAL | #128: light default (pre-paint script, no flash, verified), Inter Latin-Ext + Cyrillic faces, runner + transition i18n, i18n parity + hard-coded-text guard tests. Not done: component library additions (DataTable, Sheet, StatCard, Stepper...), dev UI gallery |
| Owner decision: band in short practice | DONE (#129) | No IELTS band / CEFR level for short or partial sets; raw "5/6 correct · 83%". Band only for full sections (IELTS 40 / Multilevel 35 objective questions; IELTS Writing both tasks) or a full mock; tables unchanged. Tests both ways; result view hides bands stored by older attempts. CI PostgreSQL scripts pass with CI env |
| U3 shell | PARTIAL (#130) | Bottom-nav short labels. Not done: PageHeader pattern audit, route skeletons, 403/404 pages |
| U4 student | PARTIAL (#130, #133, #134, #135) | #130: Today card, mic check once per attempt, compact phone palette. #133: catalogue chips/filter from GET mock/attempts/mine (finished = submittedAt). #134: optional device check. #135: Results page progress card — finished/being-checked counts; full-mock chart on the official scale per family (IELTS 0–9, Multilevel 0–75, dots + line only between real points, no fitted trend); practice bar chart of raw N/M · % (Listening+Reading, never a band, #129); empty state without placeholder points; tooltips + table view; --chart-series token (validator); recent results table translated; prediction card + drill on tokens, drill shows server pointsAwarded. Not done: browser view of the full-mock chart with real data (no completed full mock locally; covered by jsdom test) |
| U5 vocabulary | DONE frontend (#136, #137); backend items for owner | #136: Live Vocab Battle host/player translated + tokens; podium shows game scores only (battle state has no pointsAwarded; /finish is never called and would double-award); in-game score called pts/ochko; no example PIN; countdown from server timeLimit; question line from the word; answer tiles fixed dark category hues ≥4.5:1 + shapes. #137: VocabularyBuilder translated (labels tied to inputs), mode page shows set title/level/size from GET vocabulary/sets/:id |
| U6 teacher/admin/builder | TODO | audit #19, #22 |
| U7 public/auth/onboarding | TODO | audit #17 |
| U8 motion/i18n/a11y | IN PROGRESS (#128, #130–#134) | Translated + guarded: runner, transition dialog, student dashboard, Today card, exam launcher, mic check, live PIN card, result view, vocabulary quiz, vocabulary catalogue, mode page, SRS page, Finish dialog, Resume dialog (#132), exam catalogue (#133), device check (#134). Guard regex extended with vocabulary/exam words; it found the quiz runner's Uzbek SRS title. Fixed in #132: Resume dialog used next/navigation (English users sent to the Uzbek URL); catalogue promised "+5 points" before any test; failed set list shown as "no sets"; SRS empty state claimed "all mastered". Next: Live Vocab Battle host/player (Uzbek + raw colours; podium "+10/+7/+5 awarded" text not tied to the server's pointsAwarded), VocabularyBuilder, CDLayout, teacher/builder screens |
| U9 performance | TODO | |
| U10 verification | TODO | all-roles crawl, axe, compressed visual baseline |
| D1–D3 desktop | TODO | not started (order rule) |

Local notes: dev stack = postgres + redis + `runserver 127.0.0.1:8100` + `next dev -p 3300` WITHOUT `-H 127.0.0.1` (with it the default-locale rewrite becomes cross-origin and Uzbek pages loop with 307 — local artifact, not production) and open it as http://localhost:3300 (Next blocks dev resources for other origins; set BW_WEB=http://localhost:3300 for the e2e scripts); `. /root/local.env` sets CORS_ALLOWED_ORIGINS, so run `unset CORS_ALLOWED_ORIGINS` before the full pytest. CI PostgreSQL scripts need CI's env: `/root/ci-like.env` (DB education_center, ALLOWED_HOSTS=testserver,localhost,127.0.0.1, CORS http://localhost:3000, no DJANGO_SETTINGS_MODULE) — with local.env they fail with 403/400 on unchanged main too. Screenshots are kept out of the repo (owner rule); only a compressed baseline (<= 3 MB) in U10.

## Session 2026-11-13, third part (exam program phase 3)

VERIFIED (local stack, synthetic accounts, production build): Multilevel levels 37/38, 50/51, 64/65 on the backend and the web (parity test with the blueprint); second tab and second device get "open somewhere else", "continue here" moves the exam, the old place keeps what it typed and sends it on continuing (exam-session 20/20); IELTS Listening reading time, resume after a reload at the server clock, highlight on question text (exam-listening 16/16); keyboard navigator and axe 0 critical/serious on Reading/Listening/Writing (exam-a11y 12/12); Reading divider drag/keyboard/remembered, independent scroll, phone tabs (exam-reading-split 20/20); teacher live room and group monitoring in en/uz without the other language (teacher-live 16/16); item bank on the real schema (10/10).
UNVERIFIED: the official IELTS reading-time length (not published; 30 s is BestWay's); rounding of a mean like 37.8 for the Multilevel level (not in the criteria); real microphones and Safari/iOS autoplay after a reload (headless Chromium resumed by itself; the "Continue listening" button is covered by jsdom tests); Builder templates, IELTS Speaking modes and the full Builder → student → teacher → result journey (not built in this phase).
Found: an IELTS Listening reload before pressing Play locked the audio (the page's preload had already counted the one play); live room table invented 40 questions / "reading" / "B2"; group export made a CEFR level from Writing + Speaking; dev server CSS can go stale after `git stash` (use a production build for E2E).

## Session 2026-11-13, second part (exam program phase 2)

VERIFIED (local stack, synthetic accounts, production `next build` + `next start`): offline answer queue survives reload and is sent in order; newer edit wins on the server; 502 on Finish → "answers saved, hand-in not confirmed" → retry hands in, one attempt; double Finish → one request; highlight + note + flag → reload / cleared device cache → restored from the server; timer warnings, Settings (text size, colours, volume), Help per section, Hide keeps the clock running; Listening part 1 ends without the check, last part starts 02:00 (synthetic 2 s recording); Writing word count, outside paste refused and logged, own text movable; four window exits recorded, exam not stopped, admin sees the exam log. en/uz, light/dark, 390×844/1440×900, student and admin.
UNVERIFIED: real tab switches in headless Chromium (simulated with window blur, same handler); real speakers and Safari/iOS full screen; the official software's exact word-count algorithm, colour options, text-size steps and copy/paste rules (not published); GitHub CI on the updated heads at the time of writing (see the session report).
Found: on the dashboard, Next prefetches /en/... pages after login; their responses set NEXT_LOCALE back to en, so E2E scripts must set the Uzbek cookie after the dashboard settles (fixed in the phase 2 scripts).

## Session 2026-11-13 (exam program phase 1)

VERIFIED (local stack, synthetic accounts; details in EXAM_PROGRAM.md and the PR texts #138–#143): official format checked on ielts.org and the agency's documents; blueprint conformity of all 5 seeded exams (0 differences); scoring boundary tests incl. all 33 rows of the 2025 Multilevel Writing table; points integrity on the real schema (48 checks); browser runs of battle podium, drill and public demo in en/uz, light/dark, 390×844/1440×900, student and staff; key-leak sweep of student exam endpoints.
UNVERIFIED: GitHub CI on #138–#143 at the time of writing (see the session report); Multilevel Speaking total length and 21→75 table (no official source found); IELTS 2-minute Listening review on computer (not on the ielts.org pages checked).

## Session 2026-11-12, second session (VERIFIED / UNVERIFIED)

VERIFIED (local stack, synthetic accounts): per PR (#135, #136, #137) vitest (589 tests on #137), tsc, lint 0 errors, next build, key parity; smoke.mjs (#127 version, labels adapted) 16/16 and full-journey.mjs 13/13 on each head (smoke once failed step 07 on a cold dev compile, then 16/16 twice); browser light + dark, 390×844 + 1440×900, en + uz: Results page (IELTS: all grading → empty state; Multilevel: 3 real Reading practice bars 13/35 · 37%, tooltip, "12 Noy" dates), teacher /profile without the card; two full Live Vocab Battles (teacher desktop + student phone, themes swapped); builder + Smart Paste; mode page set title.
UNVERIFIED: full-mock chart with real completed full mocks (none locally; jsdom test only); real speakers/microphones and Safari/iOS (owner tests by hand).
Found: Chromium prints "M11 12" for short Uzbek month names via Intl — use the monthsShort/months messages (done on the Results page).

## Session 2026-11-12, first session (VERIFIED / UNVERIFIED)

VERIFIED (local stack, synthetic accounts): frontend vitest 92 files / 564 tests, tsc, lint 0 errors, next build on #134 head (also on #132, #133 heads); smoke.mjs 16/16 (#127 version, labels adapted) and full-journey.mjs 13/13 on #133 and #134; browser light + dark at 390×844 and 1440×900 for vocabulary catalogue/mode/SRS (en + uz), Finish and Resume dialogs, exam catalogue (student + teacher), device check (Chromium synthetic mic); Resume opens /en/mock/attempt/...?skill=reading; GitHub CI green on #123, #125–#132.
UNVERIFIED: real speakers/microphones (only Chromium's synthetic devices); Safari/iOS audio gesture rules for the test tone; production data.
Local note: the branch's own smoke.mjs (without #127) fails steps 06–10 after a full-journey run because full-journey switches the student to the IELTS track — data dependency, fixed by #127. Use `NEXT_LOCALE=uz` cookie to view Uzbek pages after visiting /en.

## PHASE 4 (owner brief 2026-11-14: land open PRs → Multilevel completion → plan)

Owner authorization (2026-11-14): the agent may merge this program's PRs in bestwayec/bestway when CI on the exact head SHA is green, there are no conflicts and no unresolved review threads; normal merge method, no admin override. Still forbidden: deploy, production access, tags/releases, force-push, closing PRs unmerged. bw-tauri PRs are not merged by the agent.
Deploy safety gate (checked 2026-11-14): `deploy.yml` and `deploy-django.yml` run only on `workflow_dispatch` with the typed confirmation and the protected `production` environment; `ci.yml` never deploys. Merging to main does not deploy.
Owner decisions recorded: (1) brand green #15803d approved (light theme, #160); (2) old Multilevel attempts are NOT recalculated — stored levels stay, `report_multilevel_levels` stays list-only; (3) docs PR for `claude/exam3-docs` opened and merged (#159); (4) BW-16: no server grace window (client retry stays); short practice shows raw score only, no band/level.

| Step | Status | Evidence |
|---|---|---|
| P0 restore state | DONE | 21 open program PRs (#138–#158), all base main, CI green; deploy gate passed; baseline main 7603d7f pytest 906 passed / 4 skipped |
| P1 land PRs | DONE except #160 (CI running at the time of writing) | Merge SHAs below. Each branch was updated by plain merges (main + earlier PR heads), CI green on the exact head, code-quality bot threads fixed at the source (#138, #145, #152) |
| P2 Multilevel full E2E | TODO | e2e script to be committed as scripts/e2e-local/multilevel-full.mjs |
| P3 Multilevel Speaking + per-part grading | TODO | |
| P4 Builder templates + pre-publish panel | TODO | |
| P5 IELTS E2E + Speaking modes | TODO | |
| P6 Desktop (bw-tauri) D1–D3 | TODO | leads: v1.0.12, run 42982782068, PR #30 |
| P7 AI grading plan (docs only) | TODO | docs/agent/AI_GRADING_PLAN.md |

Merge SHAs on main (2026-11-14): #138 c01fb9c · #139 1d20b3d · #140 73bae22 · #141 ce2cfe2 · #142 98a161f · #143 bc5ce68 · #144 6e91f96 · #145 a8d7a2f · #146 4564f8a · #147 e7f1519 · #148 993acf2 · #149 24d9086 · #150 a13d2a2 · #151 c2fbcd6 · #152 30353e7 · #153 ce59b08 · #154 42d3724 · #155 6643b46 · #156 90854e3 · #157 fe6298a · #158 5ac6c57 · #159 9fea88a.

Post-stage checks on fresh main (local, CI-like env, PostgreSQL 16; smoke/full-journey on the local stack with synthetic accounts):

| After | main | pytest | PG scripts (readiness / partial / grading / rankings) | vitest | lint / tsc / build | smoke | full-journey |
|---|---|---|---|---|---|---|---|
| Stage 1 | 6e91f96 | 1061 passed, 4 skipped | 65/65 · 75/75 · 76/76 · 35/35 | 604 | 0 errors / ok / ok | 16/16 | 13/13 |
| Stage 2 | a13d2a2 | 1070 passed, 4 skipped | 65/65 · 75/75 · 76/76 · 35/35 | 669 | 0 errors / ok / ok | 16/16 | 13/13 |
| Stage 3 | 5ac6c57 | 1167 passed, 4 skipped | 65/65 · 75/75 · 76/76 · 35/35 | 722 | 0 errors / ok / ok | 16/16 | 13/13 |

`makemigrations --check` clean; single Django leaf `core.0009_vocab_battle_winners` at every stage.

Migrations for the owner's deploy (in this order; both additive, the normal deploy script applies them):
1. Prisma `20261113000000_question_item_metadata` (#157): `MockQuestion.cefrLevel TEXT NULL`, `MockQuestion.skillTags JSONB NULL`. Rollback: old code ignores the columns; to remove, `ALTER TABLE "MockQuestion" DROP COLUMN "cefrLevel", DROP COLUMN "skillTags"` and delete the row from `_prisma_migrations` (only if no tags were entered).
2. Django `core.0009_vocab_battle_winners` (#141): nullable JSON `winners` on the vocab battle session. Rollback: `manage.py migrate core 0008`.

Notes:
- Main CI: pushes that arrive while a main run is queued replace the queued run (GitHub keeps one pending run per concurrency group), so intermediate merge commits show "cancelled". Deploy only a commit whose main CI run is green (the workflow enforces it).
- `backend-django/apps/core/views.py` had `\r\r\n` line endings on main; #138 normalised them (large diff, no logic change).
- Local container notes: e2e needs `BW_CHROMIUM=/opt/pw-browsers/chromium`, `BW_WEB=http://localhost:3300`; Next (Turbopack) rejects a symlinked `node_modules` in a git worktree — use a real copy (`cp -al`). smoke step 07 can time out once on a cold dev compile.

## NEXT STEP

The exam program (docs/agent/EXAM_PROGRAM.md) is the active track; phase 3 is closed (main part), its NEXT STEP is phase 4: first the phase 3 leftovers (Builder templates + publish conformity UI, full Builder → student → teacher → result E2E for Multilevel and IELTS, Multilevel Speaking flow and teacher per-part grading, IELTS Speaking modes), then AI assessment.
1. PHASE 4 (see the section above): phases 1–3 are merged (#138–#159). Next: merge #160 (brand green) when CI is green → P2 Multilevel full E2E → P3 → P4 → P5 → P6 desktop → P7 AI grading plan.
2. Website program items still open: U6 teacher/admin/builder (audit #19, #22) → U7 → U9 → U10 → WEBSITE GATE → desktop (D1–D3). Remaining i18n: CDLayout, drill modal, teacher/builder screens.
Checks per PR: as in EXAM_PROGRAM.md (UMUMIY QOIDALAR). Local E2E (production build: `next build` + `next start -p 3300`): smoke.mjs (before full-journey), full-journey.mjs, vocab-battle.mjs, drill.mjs, demo.mjs, exam-window.mjs, exam-workspace.mjs, exam-tools.mjs (BW_AUDIO = short WAV; sets the seeded Listening parts to 3 s and restores them), exam-writing.mjs, exam-mode.mjs, exam-session.mjs, exam-listening.mjs (BW_LONG_AUDIO = 60 s WAV), exam-a11y.mjs (axe-core from frontend/node_modules), exam-reading-split.mjs, teacher-live.mjs (BW_WEB=http://localhost:3300, BW_PYTHON, BW_CHROMIUM). Restart the local Django server after switching branches.
