# BESTWAY 5.1 test report

Environment: cloud Linux container, local PostgreSQL 16 (Prisma 5.22 `migrate deploy` + Django `migrate`), local Redis, Python 3.13, Node 22. Hosted CI uses PostgreSQL 17 / Python 3.12 — check the PR's checks for exact-head results.

| Gate | Result | Status |
| --- | --- | --- |
| Django pytest (full) | 1731 passed, 4 skipped | VERIFIED |
| `verify_exam51_deadline_postgres.py` (new) | 35/35 (incl. 60 s objective grace vs 6 min Speaking grace) | VERIFIED (real PostgreSQL, controlled clock via DB deadlines) |
| `verify_exam51_reports_postgres.py` (new) | 48/48 (incl. PDF, progress, bot menu, classroom counts) | VERIFIED; Telegram = MOCKED TRANSPORT |
| `verify_grading_consistency_postgres.py` | 87/87 | VERIFIED |
| `verify_exam_window_postgres.py` | 23/23 | VERIFIED |
| `verify_notifications_teacher_postgres.py` | 88/88 | VERIFIED |
| `verify_teacher_workspace_postgres.py` | 61/61 | VERIFIED |
| `verify_telegram_engine_postgres.py` | 23/23 | VERIFIED |
| `verify_e2e_journeys_postgres.py` | 41/41 (needs `JWT_SECRET`; the earlier local failure was the missing secret) | VERIFIED |
| Vitest (full) | 1012 passed (148 files) | VERIFIED |
| `tsc --noEmit`, ESLint (changed files) | clean / 0 errors | VERIFIED |
| `next build` | success | VERIFIED |
| Worker entrypoint | `run_assessment_worker --once` closes an expired exam | VERIFIED locally |
| Browser: runner Listening layout (Chromium, dark, 1366×768 / 1280×720 / 1920×1080 / 390×844), Q10 jump below sticky stack and above footer, no horizontal overflow; Result Center render | screenshots in `docs/screenshots/bestway51/` | VERIFIED |
| Browser: full IELTS journey (assigned, fixed close): real Listening playback (`currentTime` advancing), compact typed answers, Reading split + drag resize (628/628 → 477/779), Writing real keystrokes (21 words, saved), microphone check, native MediaRecorder Speaking capture + upload (audio key stored), Finish → pending W/S result | `scripts/browser-acceptance-51/` | VERIFIED (fake microphone; emulated fullscreen acceptance) |
| Browser: teacher grades Writing 6.5 / Speaking 6.0 in the review UI with the AI worker disabled → backend Overall 5.0, "Reviewed by the teacher" | `grade2.js` | VERIFIED |
| Browser: automatic hand-in — two students closed the browser; `finalize_expired_attempts` handed them in (`reason=deadline`), Result Center shows "Auto", final stage, shared rank 2, five not-submitted rows, Telegram final leaderboard queued and matching the website | `teacher.js` | VERIFIED (Telegram = queued outbox rows) |
| Browser: Multilevel journey — structure 35 L / 35 R / 3 W / 8 S = 81 positions, server section deadlines, missing-answer review before moving on, Writing keystrokes, real playback (Plays 1/2, Play disabled while playing), Speaking task 1 native capture + upload | `ml.js`, `mlplay.js`, `mlspeak.js` | VERIFIED for one Speaking task; all eight recordings not re-run (covered by the existing Multilevel regression) |
| Theme proof | `html.dark` + computed body background `rgb(11, 15, 13)` (dark) / `rgb(250, 250, 249)` (light) logged per screenshot | VERIFIED |
| Viewports | 1366×768, 1280×720, 1920×1080, 390×844: no horizontal overflow; Q10 below sticky stack, above footer; phone audio panel static | VERIFIED |
| Live Telegram delivery | no authorized test bot / chat in this environment | NOT VERIFIED |
| Installed BW-Tauri desktop app | not available in this environment; only the shared web/API contracts were exercised | NOT VERIFIED |
| Live Telegram delivery | not run (no authorized test bot) | NOT VERIFIED |

Covered races: manual Finish vs two concurrent deadline workers; duplicate sweeps; late answer vs deadline; late advisory job (stale lease) vs teacher-final grade; repeated report sweeps; grade correction → one revision.

## UI comparison with `main` (same exam, same viewport)
The only runner change in 5.1 before this refinement was 27 lines in `mock-runner.tsx` (scroll offset, phone sticky).
The card-per-question Listening layout seen on the seeded `ielts-academic-mock-01` was the existing fallback for
completion questions **without** a gapped `contentHtml` document (present on `main` too); inline gapped documents were
never changed. The refinement replaces that fallback with compact inline rows and leaves gapped, choice, matching and map formats intact.

## Found and fixed during browser review
- Result Center showed "Awaiting teacher assessment" for students who never started.
- Report outputs showed the stored 3.5 placeholder instead of "below 4.0" for under-range Listening/Reading (scoring rule) — fixed in website, Telegram, Excel and PDF.
- Header stage badge wrapped under long titles; chart lines used near-identical greens; IELTS bands printed as `6` instead of `6.0`.
- Per-row "ONE WORD AND/OR A NUMBER" duplicated the group instruction.

## Known behaviour noticed (not changed)
- The Speaking microphone check re-opens after a page reload in IELTS Speaking (existing 5.0 behaviour).
- Locally, uploaded recording duration shows "unavailable" (no ffprobe in this container).

## CBT Exam Experience 2.0 (final cycle on this branch)

Same local stack (PostgreSQL 16, Prisma 5.22 `migrate deploy` + Django `migrate`, `seed_local_dev`, `seed_ielts_mock1_academic`,
`next build` + `next start`, Django `runserver`), headless Chromium with a **fake** microphone and emulated fullscreen.

| Gate | Result | Status |
| --- | --- | --- |
| Vitest (full) | 1036 passed (153 files) — was 1012 | VERIFIED |
| `tsc --noEmit` | clean | VERIFIED |
| ESLint (all files changed since `91d6a8b`) | 0 errors (warnings only, existing patterns) | VERIFIED |
| `next build` | success | VERIFIED |
| Django pytest (full) | 1733 passed, 4 skipped (was 1731 + 2 new readiness tests) | VERIFIED |
| New Django test `test_exam51_readiness.py` | 2/2 (timing fields; closed assignment still 409) | VERIFIED |
| Browser `cbt2.js` at 1366×768 light, 390×844 dark, 1280×720 dark, 1920×1080 light | every viewport: readiness rows measured (browser/connection/sign-in ok), **0 → 0 in-progress attempts while the readiness screen is open**, 1 after Start; save chip "Saved to server" → offline "Offline — kept on this device, not yet on the server" → "Saved to server" after reconnect; `O` opens the overview, filters All 40 / Unanswered 38 / Answered 2 / Flagged 0 / Not yet saved 0; review jump lands on Q5 below the 56 px header; Settings: dark (`html.dark`, body `rgb(11, 15, 13)`) + comfortable spacing applied without losing the typed answer, Restore defaults removes it; timer continues across reload (27:33 → 27:28); no horizontal overflow | VERIFIED |
| Speaking microphone-check reuse (`cbt2.js`) | first visit asks; new tab of the same browser does **not** ask; fresh browser profile asks again | VERIFIED (fake microphone; no physical device) |
| Deadline state (`deadline.js`, local DB deadline → +25 s) | "Time is up" chip, locked banner, fieldset disabled, "Answers locked" chip, then hand-in confirmed (`completed`) | VERIFIED |
| Uzbek browser pass | blocked locally: unprefixed Uzbek URLs 307 to themselves under `next start` on http://127.0.0.1 (next-intl routing; not changed in 5.1). Uzbek strings: `messages-parity.spec.ts` | NOT VERIFIED IN BROWSER |
| Live Telegram delivery / installed BW-Tauri | unchanged code paths; no test bot or desktop here | NOT VERIFIED |

Before/after: "before" screenshots of the same exam (`ielts-academic-mock-01`) are the 5.1 baseline in `docs/screenshots/bestway51-final/`;
"after" screenshots are in `docs/screenshots/bestway51-cbt-final/`.

Performance (confirmed, not measured): the runner re-rendered twice a second from two separate 1 s intervals (clock + server time);
they are now one tick. The submission review data is computed only while the dialog is open. No new dependencies.
