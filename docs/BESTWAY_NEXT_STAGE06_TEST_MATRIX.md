# BESTWAY NEXT — Stage 06 test matrix (website + Django)

Branch `feat/bestway-next-stage05-completion`, [PR #207](https://github.com/bestwayec/bestway/pull/207).
Session date 2026-11-21. "PASS" means the command was run in this session and its output was read.
"CI" means the hosted GitHub Actions run on the listed commit. Nothing below was inferred.

## Environment used locally

- Disposable PostgreSQL 16 (apt), Redis 7, Python 3.13, Node 22. Databases: `education_center`,
  `bestway_upgrade_local`, `bestway_e2e_local` — all created for this session and never connected
  to production.
- Migration order exactly as CI: `prisma@5.22.0 migrate deploy` (authoritative ledger) →
  `python manage.py migrate` (Django-owned `core` app only).
- Synthetic accounts from `manage.py seed_local_dev` (refuses to run unless DEBUG and a loopback
  `*_local` database).

## Backend and database

| Gate | Command | Result |
| --- | --- | --- |
| Clean migration deploy | `prisma migrate deploy` + `manage.py migrate` on an empty DB | PASS |
| Prisma ledger / unmanaged models | `manage.py check_legacy_schema --settings=config.settings.production` | PASS — "39 unmanaged models; Prisma ledger verified" |
| Migration manifest | `python -m common.schema_validation ../backend/prisma/migrations` | PASS |
| Legacy synthetic upgrade + row preservation | `scripts/verify_next_migration_upgrade.py` | PASS — classroom, attendance, grade, issued questions and SRS history preserved |
| Django regressions | `CORS_ALLOWED_ORIGINS=http://localhost:3000 python -m pytest` | PASS — 1485 passed, 4 skipped (legacy NestJS `dist` absent), +1 parser test this session |
| Readiness / item bank / partial practice / exam window / finish load / listening schedule / grading consistency / AI rankings / points integrity | the nine `scripts/verify_*_postgres.py` CI scripts | PASS (all exit 0) |
| Group contract, scoped roles, exports, token family rotation | `verify_group_contract_postgres.py` | PASS |
| Classroom lifecycle incl. **new** cross-teacher transfer denial and single open enrollment | `verify_classroom_postgres.py` (extended this session) | PASS |
| Vocabulary practice concurrency (2 simultaneous replays, 10 parallel sessions) | `verify_vocabulary_practice_postgres.py` | PASS |
| Vocabulary homework: revision-safe edits, flashcard sync, scoring, retention after transfer, export pagination | `verify_vocabulary_homework_postgres.py` | PASS |
| Teacher submissions: grading evidence, enrollment scope, embargoed fields, concurrent replay | `verify_teacher_submissions_postgres.py` | PASS |
| Hyphenated headwords in parse-text | `tests/test_vocabulary_engine.py::test_hyphenated_headwords_are_not_split` | PASS (new) |
| Spreadsheet formula injection in exports | code review of `export_results` (`safe_spreadsheet_text`) | Verified by inspection; covered by existing export tests |

Not run locally: `verify_release_http.py`, `verify_release_workers.py`, the docker-compose deploy
smoke and `manage.py check --deploy` — these run in hosted CI (see PR checks).

## Website (Next.js 16.3.6)

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | PASS |
| ESLint | `npm run lint` | PASS — 0 errors (414 pre-existing warnings) |
| Vitest | `npm test` | PASS — 130 files, 854 tests (baseline 127 / 840) |
| Production build | `npm run build` | PASS (several rebuilds; last after every change) |
| Homepage links/CTAs (Playwright, prod build + local Django) | scratch script | PASS — all header/main links resolve; unauthenticated `/mock` → `/login?next=…`; primary CTA scrolls to the placement test; FAQ opens with Enter; `/` (uz) 200 |
| Responsive overflow | Playwright at 1440 / 820 / 390 px, uz + en | PASS — no horizontal overflow, no page errors |
| Accessibility automation | axe-core 4 (wcag2a, wcag2aa, wcag21aa) | PASS — 0 violations on `/en` light+dark, `/` and `/en/demo` |
| Authenticated teacher journey | login → dashboard → classroom → vocabulary | PASS — 200s; dashboard 11 API requests, no duplicates (was 12) |
| Authenticated student journey | login → dashboard → vocabulary | PASS — 200s, 8 API requests |
| Authorization denials | student `GET /users`, `GET /groups/:id/member-history`, `POST /groups/:id/students`; anonymous `/groups` | PASS — 403, 403, 403, 401; anonymous dashboard → login |
| Cross-client parity | web teacher creates + assigns a 3-word set; desktop student (browser build, real Django) sees it and the deep link opens that set | PASS — create 201, assign 201, student report access 403, teacher report 200 |
| Production dependency audit | `npm audit --omit=dev` | sharp/zod/source-map-js/sanitize-html fixed; Next.js GHSA-h694-7cp9-m8p3 remains (affects nested `'use cache'`, not used) |

Mock-only vs. real: the Vitest/jsdom suites mock the API client. The journeys above used the real
Django API and PostgreSQL with synthetic accounts.

## Known gaps (not executed this session)

- Real-device assistive technology (screen reader) testing — UNVERIFIED.
- `gis is not defined` page error on login: from the external Google sign-in script whose host is
  blocked in this sandbox; reproduce on a networked machine before release.
- Next.js 16.4.x upgrade — owner decision.
