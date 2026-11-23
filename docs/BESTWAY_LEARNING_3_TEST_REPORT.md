# BESTWAY Learning Experience 3.0 — test report

All runs are local (PostgreSQL 16, Django, Next production build, Chromium via Playwright) or
GitHub-hosted CI. Accounts and content are synthetic; no real student record was touched.

## Automated suites (branch, before PR C merge)

| Suite | Result |
|---|---|
| Django pytest (full) | 1682 passed, 4 skipped (legacy NestJS differential, dist absent) |
| Vitest (full) | 145 files, 976 passed |
| TypeScript `tsc --noEmit` | 0 errors |
| ESLint | 0 errors (warnings pre-existing) |
| CI PostgreSQL sequence on a fresh `bestway_upgrade_local` | 7/7: migration upgrade, group contract, classroom, vocabulary practice, vocabulary homework, teacher submissions, **learning 3 games (new, 14/14)** |

New tests in PR C: Bamboozle security/rules (5), Battle timing/validation (3 + 1 rewritten),
`BamboozleOnlineArena.spec.ts` (3), `verify_learning_3_games_postgres.py` (14 checks).

## Browser scenarios (Playwright, Chromium)

| Script | What it proves | Result |
|---|---|---|
| `exam-builder-completion.mjs` | undo/redo, question bank, lifecycle, keyless template (PR A) | 27/27 ×2 |
| `vocab-learning-3.mjs` | two sequential plays (pause 650–651 ms), speech fallback, cancellation, no answer-revealing audio, grounded type counts, listening quiz stored (PR B) | 23/23 ×2 |
| `games-learning-3.mjs` | Bamboozle 1v1 in two browsers: turn lock, server judging, same score on both screens, hidden answers, forged plays refused, 2x kept by server, same final result; teacher-fixed gap-fill homework end to end | 26/26 ×2 |
| `vocab-battle.mjs` | live battle host/players after the timing change | 20/20 |
| `teacher-workspace.mjs` | assign form and results after the new field | 45/45 |
| `learning-3-viewports.mjs` | 4 changed pages × 360/390/768/1024/1366/1920 × light/dark × uz/en: key element, no horizontal scroll, theme and locale applied, no page error | 96 combinations, 305/305 |

## Defects found by testing (all fixed before merge)

| Found by | Defect |
|---|---|
| browser (PR A) | `MockQuestion` bulk insert fails on the Prisma enum column |
| unit test (PR B) | cancelling during the pause never settled the old play |
| PG script (PR B) | homework start 500 for pinned pre-3.0 revisions |
| browser (PR B) | mode picker disabled every new type while loading |
| browser (PR C) | guest joined with a placeholder name before the profile loaded |
| browser (PR C) | the 1v1 room creator had no button |

## Performance

No performance improvement is claimed. Measured facts relevant to the new code: the online arena
polls one room document every 2 s while the tab is visible and stops when the game ends; the
pronunciation pause between plays measured 650–651 ms in Chromium.

## Not verified

- Real iOS/Android devices and real browser voices (headless Chromium has none; speech was
  replaced by a deterministic logger, the engine itself unchanged).
- Production deployment (not authorised; nothing was deployed).

Final `main` verification after the last merge is recorded in `BESTWAY_LEARNING_3_RELEASE_CHECKLIST.md`.
