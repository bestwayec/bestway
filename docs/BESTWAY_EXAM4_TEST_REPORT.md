# BESTWAY Exam System 4.0 · Phase 4 tests

## PostgreSQL and browser checks

PostgreSQL 17.11 and Redis 8.2.10 ran with disposable data. Prisma’s checksum hostname returned HTTP 403. The application database was prepared by executing checked-in SQL followed by Django migrations. This exercises the PostgreSQL schema and application only. The hosted gate uses pinned Prisma 5.22.0, validates the schema, repeats deployment and checks the ledger. A local additive SQL exercise preserved an existing completed IELTS attempt, question and answer. The disposable schema check verified 39 unmanaged mappings, and the checked-in Prisma manifest matched.

| Coverage | Evidence |
| --- | --- |
| IELTS full mock | 10/10 in Chromium on the production Next.js 16.4.6 build. Overall band 8.0 and three native recordings. Part 3 was evaluated live by the synthetic teacher. |
| Multilevel native | 16/16 on the Next.js 16.4.6 production build. Native Chromium MediaRecorder took all eight recordings from a controlled live Web Audio source in one session. The first take survived a transport outage. The teacher browser played the eight recordings before grading. PostgreSQL stored 81 distinct answers, eight native recordings and the completed 68.5/75 C1 result. Independent decoding matched each receipt. Durations were 30.000, 29.940, 29.940, 44.940, 30.000, 30.000, 119.760 and 120.000 seconds. |
| Reading and Listening | Three Reading passages and exactly 40 positions, with exclusive counts 4 correct, 1 incorrect and 35 unanswered. Four Listening parts, shared recordings, progress preserved across reload and authorized playback. |
| Builder and imports | Preview, publication, linked group move and duplication confirmed in Chromium. Mock 27 80/80, readiness 65/65, item bank 10/10, Builder completion 15/15 and scoped practice 76/76 in PostgreSQL scripts. The package tests cover template and metadata round-trips and invalid import rollback. |
| Profile and reporting | Profile target persisted on reload, released review reopened after archive, playback worked, and exports downloaded. PostgreSQL verified assigned 3, started 2, submitted 2, graded 1, pending 1, completion 67%. |
| Reliability | Browser offline edits, reconnect, lost submit response and authenticated byte-range playback passed. Tab and device takeover 22/22. Exam window 23/23 and finish load 11/11. Client tests preserved pending edits after 401, 403, 408, 409, 429, 500, 502 and 503. |
| Teacher and classroom | Teacher Workspace 45/45 in Chromium and 61/61 in PostgreSQL. Classroom lifecycle, protected submissions, vocabulary practice and homework, Learning 3 games, quiz, Telegram fixture and notification contracts passed. |
| Accessibility | Chromium axe and keyboard suite 12/12 in English light and Uzbek dark at 1440 and 390 px. Reviewed captured result screens. Physical Android, iOS Safari and installed desktop testing are outstanding. |

## Cross-process Redis

The primary Gunicorn server had two workers on loopback port 8110. A separate Gunicorn server on 8111 had one worker with the same PostgreSQL database and Redis. Next.js used the primary API in the browser takeover suite. A separate test server on 8112 used an unavailable loopback Redis address.

An authenticated HTTP fixture ran the following checks across the processes.

1. Two servers agreed on lease ownership.
2. Two simultaneous edits produced two distinct answer rows.
3. Takeover on the second server changed the first server’s lease decision.
4. An unavailable Redis produced a retryable 503 and left the PostgreSQL answer unchanged.
5. Replacement Gunicorn workers recovered the lease.
6. The lease became claimable after its Redis TTL expired.
7. Two simultaneous submit requests converged on one completed attempt.

The local harness and logs are under `/workspace/scratch/bestway-exam4-redis.*`. The finish load script separately confirmed 60 grading jobs across 30 attempts with no duplicate jobs.

## Performance

On the synthetic classroom fixture, overview and selected-exam reports used eight queries each. Five runs yielded medians of 16.8 ms for five attempts and 15.9 ms for four attempts. Filtered PDF and XLSX exports were approximately 45 KB and 11 KB, with single-run generation of 36.4 ms and 31.2 ms. Adding 5,050 synthetic attempts caused the broader range to request narrower filters. A corrected date and exam filter returned 1,000 attempts in six queries and 307.1 ms. These are local measurements.

## Reference checks

The normal test suite skips four differential cases when NestJS output is absent. Transpiling the last NestJS source at `f749fc1131389f33c697c43c12cc875ccbdfae60` made the pure checks runnable. Main and the integration candidate produced the same results, 76 failed, 17 passed and 172 subtests passed across the two files. The normal NestJS build still requires the denied Prisma engine download. Installed-client parity remains unverified.

## Full suites and dependencies

- Django PostgreSQL suite with the updated Python pins. 1,704 passed, 325 subtests passed and four NestJS-reference checks skipped in the default run. Release HTTP passed 67/67 and worker integration passed 5/5 with an isolated provider fixture.
- Frontend on Next.js 16.4.6. All 999 tests in 146 files passed at `3d250c2ebd3b56903f7e75e60e35ee9957dc0c9d`. The production build and TypeScript checks passed. ESLint reported zero errors and 406 existing warnings. The browser release-metadata timeout and retry fixture kept the official fallback link.
- The production npm audit reported zero known advisories. The follow-up Python environment audit reported no known vulnerabilities after targeted updates. The npm audit including development dependencies found two critical, one high and eight moderate advisories. The critical Vitest-related fixes require a major tooling upgrade.
- The production build bound to `localhost` served the default Uzbek routes and explicit English routes. The explicit `127.0.0.1` bind caused self-redirects on the unprefixed routes in this cloud setup.
- A completed IELTS review rendered without page overflow at 360, 390, 768, 1024, 1366, 1440 and 1920 px. One authenticated detail response measured 54,843 bytes in 40 ms. Each of two IELTS browser attempts wrote 86 distinct answer rows and three recording files.

## Acceptance ledger

| Criterion | Status |
| --- | --- |
| Phase 1–3 requirements reviewed | Reviewed with gaps below |
| Functional audit | Partial. Remaining format and real-device matrix |
| Integration audit | Partial. Installed desktop and hosted integration pending |
| Defensive security audit | Partial. Local checks completed and hosted checks pending |
| Reliability and performance audit | Partial. Full HTTP matrix and physical devices pending |
| Critical fixes | Implemented and checked locally. Hosted CI and physical devices remain gates |
| Eight uninterrupted native recordings | Verified in Chromium with controlled synthetic input |
| Shared Redis across processes | Verified |
| IELTS full browser journey | Verified |
| Multilevel full browser journey | Verified 16/16 |
| Exam Builder | Verified representative authoring and publication |
| Reading and Listening review | Verified |
| History and resume | Verified |
| Classroom analytics | Verified |
| Ranking and exports | Verified for shared report paths. Specialized export filter parity pending |
| Vocabulary and classroom regressions | Verified representative local suites |
| PostgreSQL tests | Passed with four separately documented reference skips |
| Frontend tests | 999/999 passed |
| Production build | Passed on Next.js 16.4.6 |
| Normal Prisma pipeline | Blocked by HTTP 403 |
| Required hosted CI | Blocked by HTTP 403 |
| Eligible sequential merges | Pending release gates |
| Final merged main SHA | Pending merges |
| Final main CI | Pending merges |
| Production release checklist | Prepared |
| Production deployment | None initiated during this task |


## Repeat the native browser check

Prepare the disposable seeded PostgreSQL and Redis stack and run the production frontend bound to `localhost`. From `scripts/e2e-local` use the locked Playwright dependency and Chromium.

```bash
npm ci
BW_WEB=http://localhost:3314 BW_CHROMIUM=/usr/bin/chromium \
  BW_SYNTHETIC_AUDIO_CONTEXT=1 BW_CAPTURE_SPEAKING=1 \
  node multilevel-full.mjs
```

The controlled source feeds native Chromium MediaRecorder throughout the journey. The test checks eight distinct server receipts and verifies authorized playback. Complete the manual device checklist for physical microphone and browser behavior.
