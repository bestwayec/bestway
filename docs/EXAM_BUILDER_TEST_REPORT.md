# Exam Builder 2.0 — test report (2026-11-22)

Environment: Linux container, PostgreSQL 16, Python 3.13, Node 22, Chromium (Playwright 1.56),
Next.js production build. Code under test: `claude/blissful-planck-wa3s0n` merged with
NEXT 3.0 (`main` = `ec82893`). Synthetic local accounts and original synthetic content only;
no production system or data was touched.

## Baseline (before any change, `main` = `7e0e1f3`)

| Suite | Result |
|---|---|
| `python -m pytest` | 1606 passed, 4 skipped |
| `npx vitest run` | 137 files, 907 passed |

The 4 skips (identical throughout) need the legacy NestJS `dist`, which is not in the repository.

## Final (integrated branch)

| Suite | Command | Result |
|---|---|---|
| Backend | `cd backend-django && python -m pytest` | **1654 passed, 4 skipped** (pre-existing skips) |
| New backend tests | `pytest tests/test_exam_templates_and_export.py` | 24 passed, 36 subtests (all 18 templates import → export → re-import identical; permissions; rollback; merge; replacement; N+1 guard) |
| TypeScript | `npx tsc --noEmit` | 0 errors |
| ESLint | `npx eslint .` | 0 errors (warnings are pre-existing) |
| Frontend unit | `npx vitest run` | **140 files, 943 passed** |
| Production build | `npm run build` | succeeded |
| PostgreSQL scripts (CI list, CI env) | `python scripts/verify_*.py` | all pass: grading 79/79, E2E journeys 41/41, Mock 27 81/81, readiness 65/65, notifications 88/88, teacher workspace 61/61, result cards 47/47, class quiz 61/61, Telegram 23/33/65, AI rankings 35/35, points 48/48, exam window 23/23, item bank 10/10, listening schedule 10/10, finish load 11/11, release HTTP + workers; on a disposable `bestway_upgrade_local`: Next migration upgrade, group contract, classroom, vocabulary practice/homework, teacher submissions |
| Prisma manifest | `python -m common.schema_validation ../backend/prisma/migrations` | matches |

Environment-only notes: `check_legacy_schema --settings=config.settings.production` needs CI's
production variables (`PUBLIC_URL` …) and runs in hosted CI; six scripts refuse to run outside a
database named `*_local` by design and were run on `bestway_upgrade_local` as CI does.

## Real browser (Playwright, Chromium, Next production build + Django + PostgreSQL)

| Journey | Result |
|---|---|
| `scripts/e2e-local/exam-builder-2.mjs` (new) | **73/73**, twice in a row on the final build |
| `scripts/e2e-local/ielts-full.mjs` (existing: author → publish → student 4 skills → teacher criteria grading → bands → review) | **10/10** |
| `scripts/e2e-local/multilevel-full.mjs` (existing: blueprint → audio → publish → student → results) | **16/16** |

`exam-builder-2.mjs` covers: A templates load/check/import from the dialog (IELTS full mock,
Multilevel full mock, Listening part); B reopen, Export JSON download, re-validation, single-skill
export; C syntax error located at line/column, semantic error with readable path, nothing created;
D merge into the open draft, incompatible draft disabled with reason, existing ids/keys unchanged;
D2 explicit replacement of one skill; D3 a pre-selected draft that is still loading never falls
back to "create a new exam"; E student 403 on export/validate/commit and no keys in the student
payload; F publish a clean imported exam, unfinished template refused (`MOCK_NOT_READY`), student
start, autosave, reload restores the answer, submit, duplicate submit idempotent, score 2/3,
late save refused; G 1366×768 and 390×844: primary action on screen, no horizontal scroll, one
scroll region.

## Defects found by testing during integration

| Found by | Defect | Status |
|---|---|---|
| Postgres script `verify_mock27_postgres.py` | First passage-count rule failed an exam whose 3 passages share filler text | Fixed (legacy 3-group rule kept), regression test added |
| Browser run (flaky check D2) | Import from the editor could create a new exam before the pre-selected draft loaded | Fixed; deterministic check D3 |
| Screenshot review | Skill selector labels overlapped / truncated; preview table scrolled sideways on phones | Fixed |

## Not covered

Teacher review of an imported exam's Writing/Speaking (covered by the existing
`ielts-full.mjs` grading phase for builder-authored exams, not repeated for imported ones);
audio upload for imported Listening parts (same editor path as `multilevel-full.mjs`);
live AI providers (no keys in this environment; grading fail-closed states are covered by
`verify_grading_consistency_postgres.py`).
