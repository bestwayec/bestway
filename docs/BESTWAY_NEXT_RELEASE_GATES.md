# BESTWAY NEXT release gates for Stages 01–03

This record covers the existing draft PRs on `feat/bestway-next-00-03`. The backend and website entered closure at `8d80732705f83c4c5347b7c5d1d2f6ba702521b6` and the desktop at `8697fd492506daa5aa4500fa2ba9ff35289386c4`. Closure implementation commits are `b264d57` and `f0eb740` on Bestway and `a80df09` on desktop. The closing commit adds signed-review revision checking and documentation. The Checks pages show results for the selected commit. [Bestway PR #206](https://github.com/bestwayec/bestway/pull/206) · [Desktop PR #38](https://github.com/bestwayec/bw-tauri/pull/38)

## Decision

Feature status reflects the implementation and tested behavior. Release status reflects whether the release gate has run successfully in the required environment.

| Scope | Feature status | Release status | Evidence or remaining condition |
| --- | --- | --- | --- |
| Prisma and Django migration integrity | PASS | VERIFIED | Hosted CI ran the pinned Prisma engine on a clean database and on a separate populated upgrade fixture. Both database ledgers were checked and fixture rows survived. |
| Stage 01 shared API and authorization | PARTIAL | UNVERIFIED | Shared contract, signed session-family revocation and scoped roles passed. Packaged-session restoration and OS secure storage are still open. Access tokens issued before the upgrade retain their original lifetime. |
| Stage 02 classroom lifecycle and history | PASS | UNVERIFIED | Multi-slot scheduling, transfers, archive and restore, teacher assignment, published exam assignment, and historical scores and approved feedback passed. Native device coverage remains open. Legacy undated membership stays undated, and detailed absence reasons remain outside the existing attendance schema. |
| Stage 03 Vocabulary Studio | PARTIAL | UNVERIFIED | Collection revisions, issued questions, persisted grades, offline-in-view synchronization, signed review, pagination and scoped exports passed. Native audio, physical-device accessibility, and the durable offline design remain open. |
| Physical release acceptance | PARTIAL | UNVERIFIED | Linux development navigation and hosted packaging have evidence. Repeat the device checklist against the same commit and release configuration before release. [Native checklist](https://github.com/bestwayec/bw-tauri/blob/feat/bestway-next-00-03/docs/BESTWAY_NEXT_NATIVE_ACCEPTANCE.md) |

Keep both PRs in draft while release-critical native and compatibility evidence remains incomplete. Stage 04 planning can use the validated classroom and vocabulary API. Stage 04 implementation should wait for native sign-off and a decision about durable offline recovery.

## Hosted CI

The GitHub REST and GraphQL endpoints returned HTTP 403 from this environment. The PR Checks pages and individual job pages provided run IDs, conclusions, and specific step outcomes. Neither the Windows installer job nor the Android build job exercised a physical device.

| Gate | Evidence |
| --- | --- |
| Bestway starting head | Code Quality and CI passed. [Code Quality](https://github.com/bestwayec/bestway/actions/runs/44538152257) · [CI](https://github.com/bestwayec/bestway/actions/runs/44538158716) |
| Bestway session and migration implementation | Clean Prisma deploy, Django migrate, production ledger check and populated upgrade gate succeeded. [Django job](https://github.com/bestwayec/bestway/actions/runs/44539355657/job/135613207813) |
| Bestway classroom and reporting implementation | Code Quality and CI passed. [Code Quality](https://github.com/bestwayec/bestway/actions/runs/44540177322) · [CI](https://github.com/bestwayec/bestway/actions/runs/44540188719) |
| Desktop starting head | CI, Windows installer validation and Chromium exam recovery passed. [CI](https://github.com/bestwayec/bw-tauri/actions/runs/44538165459) · [Windows](https://github.com/bestwayec/bw-tauri/actions/runs/44538165461) · [Browser](https://github.com/bestwayec/bw-tauri/actions/runs/44538165845) |
| Desktop revalidation and accessibility implementation | [CI](https://github.com/bestwayec/bw-tauri/actions/runs/44540188612) · [Windows](https://github.com/bestwayec/bw-tauri/actions/runs/44540188636) · [Browser](https://github.com/bestwayec/bw-tauri/actions/runs/44540188648) |
| Current PR tips | [Bestway checks](https://github.com/bestwayec/bestway/pull/206/checks) · [Desktop checks](https://github.com/bestwayec/bw-tauri/pull/38/checks) |
| Workflows without PR evidence | Physical Windows and Android interaction, emulator interaction and low-resource device validation have no executed PR job. Production deployment and release workflows were outside the acceptance run. |

## Verification results

- **Database.** Local Prisma 5.22.0 download attempts received HTTP 403 from `binaries.prisma.sh` for pinned engine revision `605197351a3c8bdd595af2d2a9bc3025bca48ea2` and target `debian-openssl-3.0.x`. The hosted workflow genuinely deploys the engine and does not bypass its checksums. The populated upgrade first applies the checked-in Prisma baseline, writes synthetic users, a classroom, roster points and attendance, and deploys the remaining Prisma migrations. It then applies Django through 0012, writes a grade, an issued quiz and an SRS review row, upgrades to the latest Django migration, and asserts their preservation. The production schema compatibility command checks the authoritative Prisma ledger.
- **Authorization and compatibility.** PostgreSQL verified teacher, student, admin and linked parent scope, foreign-classroom denial, scoped downloads, expired and deactivated sessions, refresh rotation and revocation of old and rotated access tokens. A separate device family remained active. The desktop retries an expired access token once during profile revalidation, clears its workspace after a definitive revocation on focus, and leaves active exams to the existing exam-recovery flow. Chromium exercised shared-cookie website tabs and separate desktop sessions. Pre-upgrade access tokens without a session claim retain expiry behavior. Existing clients refresh into the family-bound token automatically. Signed SRS tests verified cross-account denial, stale batch rejection, conflict when issued translations change, signed in-flight compatibility, and a single persisted review update. An unsigned older SRS client remains outside the supported write contract.
- **Classroom and history.** PostgreSQL verified admin teacher reassignment, foreign-teacher rejection, free published exam assignment, paid or unpublished exam rejection, enrollment and attendance history, archive and restore, and the approved feedback and score for an attempt inside a known enrollment interval. An older attempt outside the interval was excluded. Approved assessment text is now visible on both clients. Historical dates without source evidence stay unknown.
- **Vocabulary and resource use.** The report processed 126 persisted learners over three pages, with unique stable ordering, name filtering, and scoped CSV/XLSX. JSON results are read in chunks. CSV rows stream, and XLSX uses a write-only workbook and a spool that spills above 512 KiB. This validates the export path and pagination. The report still scans the class to calculate aggregates, and production-scale performance remains unmeasured. Browser coverage exercises issuance, edit, exact scoring, cross-device study state, paused sync and reconnection, signed SRS and both report downloads.
- **Offline decision.** A study change may wait while its current view stays open. A durable queue across logout or process death needs an account-bound idempotency key, revision policy for changed assignments, conflict resolution across devices, and user-visible handling of permanently rejected writes. This closure retains the existing in-view contract until those requirements are defined.

## Native matrix

| Platform | Verified | Unverified |
| --- | --- | --- |
| Linux WebKitGTK | Development-window login, classroom navigation and Vocabulary Studio against disposable Django. File fallback operated in the container. | Packaged HTTPS login, system keyring, process-restart restoration, audible pronunciation, native exam resume, updates and low-resource performance. |
| Windows x64 | Hosted compiler, tests and checksum of the generated NSIS installer. | Manual installation, Windows secure storage, runtime workflows, audio, native exam resume, updates and hardware testing. |
| Android | Hosted unit and build job. | Emulator and physical installation, deep links, secure storage, touch, pronunciation, recovery and performance. The cloud instance lacked a configured Android emulator and hardware acceleration. |
| Chromium | Website and desktop frontend login and account switching, classroom journey, native-client frontend quiz focus, language controls, offline-in-view reconnect, exam recovery and simulated update checks. | Platform-native behaviors in the rows above. |

## Local commands

~~~sh
cd backend-django
CORS_ALLOWED_ORIGINS=http://localhost:3000 python -m pytest -q -rs
python scripts/verify_group_contract_postgres.py
python scripts/verify_classroom_postgres.py
python scripts/verify_vocabulary_practice_postgres.py
python scripts/verify_vocabulary_homework_postgres.py

# Run in the website or desktop directory as applicable.
npm run lint
npm test
npm run build

# Run from the desktop repository with local fixture URLs and accounts.
node scripts/verify-account-switch-ui.mjs
node scripts/verify-classroom-ui.mjs
node scripts/verify-vocabulary-ui.mjs

# The Next upgrade fixture requires a fresh local database named bestway_upgrade_local.
python scripts/verify_next_migration_upgrade.py
~~~

Django passed 1,470 tests and 268 subtests. Four NestJS differential checks were skipped because the legacy build was absent. The website passed 837 unit tests with zero lint errors and 416 warnings. The desktop passed 451 unit tests. The cross-repository contract generator matched both clients. Local schema deployment remains blocked by checksum access. The hosted migration gate provides the authoritative evidence.
