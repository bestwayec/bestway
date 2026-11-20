# BESTWAY NEXT execution ledger

Branch in both repositories is `feat/bestway-next-00-03`.

| Repository | Verified remote main and remote HEAD |
| --- | --- |
| bestwayec/bestway | e38bf8a5e60198d57547dc98b42efce2eabaafef |
| bestwayec/bw-tauri | 7f97f9ed1a480f27fd2b83d32a4defeb26b936b7 |

## Stage 00 — PASS

Inspected both checkouts and documented architecture, ownership, API contracts and permissions in the four companion audit documents. Stage 00 changed documentation in Bestway only in 4b7031d1202e7fbc9680247ab4c9931104ec7632. The Tauri baseline commit above is the audited companion revision.

Fresh baseline checks on the branch bases:

- Django PostgreSQL suite via `CORS_ALLOWED_ORIGINS=http://localhost:3000 python -m pytest -q`: 1,470 passed, four legacy checks skipped, 268 subtests passed.
- Next.js `npm test`: 837 passed.
- Tauri `npm test`: 450 passed.

Environment onboarding had separately validated production builds, native WebKit launch and the existing web smoke journey on these bases. The local database was initialized from checked-in SQL because the Prisma checksum host returned HTTP 403. Standard Prisma deployment and the ledger check are separate gates.

## Stage 01 — PARTIAL

Desktop companion commit `5e99992eeed9c9c685f530b31dd899803cb80661` replaces fabricated groups and analytics with authenticated Group requests and scoped query keys. Failed writes retain the name and schedule. Exports request server reports.

Bestway changes add the shared Group OpenAPI subset and generated DTOs, deny unknown Group roles and foreign teacher mutations, scope group results to the student or linked child, and use the required PostgreSQL enum type when enrolling a student without a profile.

Fresh checks include the real PostgreSQL Group contract across both route prefixes, 49 focused Django tests and 26 subtests, TypeScript in both clients, and Chromium against the actual Django group create API. The failed-network test used an intercepted request. Canonical role normalization across all domains and fully shared API contracts remain open.

## Stage 02 — PARTIAL

Stage 01 Bestway commits are `2431ebd04cc9acf9f871a3933ed8759d287a5b38` and `da8bde352a713d460c8ae4d215851765c54f10e4`. The second commit corrected an existing roster-test query regression.

Bestway adds the Django-owned nullable unique Cohort link. The bridge is created lazily when assigning homework. Linked classrooms derive membership, name and owner from the legacy Group and StudentProfile, with no mirror membership rows. Independent Cohorts and existing invitation workflows retain their data. Attendance requires existing enrollment and no longer changes membership. The web and desktop group screens both assign and list the same tasks.

Desktop companion commit `dc73fbac1a0b54bf6163fd0b0cbe93deb4c988c3` adds roster search and writes, name edits, date-based attendance and task creation. The real PostgreSQL `scripts/verify_classroom_postgres.py` journey passed through grading, removal and history retention. Chromium passed desktop creation, enrollment, attendance and task creation, then web reading and publishing and desktop rereading and removal. The browser exercises the desktop React frontend. It does not run the native window.

Schedule editing in desktop, archive, bulk assignment, one unified workspace navigation structure, and comprehensive student profile parity remain incomplete. Notes and excused attendance are not provided by the current attendance schema.

## Stage 03 — PARTIAL

Stage 02 Bestway commit is `df0180791f1acd235ac19afac2d3efdd0ff13988`. Stage 03 desktop companion is `467bb3772404698d6919c7ef438be86b7b9b8311`.

Classroom assignments can reference an existing vocabulary set. One persisted student session snapshots the issued words and directions and produces one server-graded HomeworkSubmission and VocabularyAttempt. Teacher reports and CSV exports use the current classroom scope. Standalone practice remains compatible with the older vocabulary workflow and does not create graded homework. Private catalog visibility and personal review bank ownership are enforced. Daily review uses signed, short-lived batches and atomic progress updates with a deterministic schedule.

On local PostgreSQL the integration script passed with a private 30-word set, mixed translation and spelling, duplicate-submit protection, teacher reports and CSV, schedule boundary checks and replay protection. The browser journey passed with a real website and Django backend, including 30-word Smart Paste and publish, classroom assignment, desktop frontend flashcards and 30/30 submission, identical teacher reports, daily review, reload, logout/login and concurrent review rejection.

Native Linux boot and WebKit rendering passed. The interactive vocabulary journey was exercised in Chromium against the desktop React app. Interactive native vocabulary, Windows/Android and low-memory checks remain unverified. Full studio editing and richer metadata, cross-device flashcard state and comprehensive analytics remain incomplete. See the final report for verification commands and backlog.

## Delivery evidence

- Bestway Stage 03 implementation `e08a5a1b85b5ce609c440b907c7dbd3f0fa3423b`. Tauri Stage 03 implementation `467bb3772404698d6919c7ef438be86b7b9b8311`.
- Both development branches pushed. GitHub draft pull request creation returned HTTP 403 for both repositories.
- Final suites recorded 1,470 Django tests passed, four legacy skips and 268 passing subtests, 837 web unit tests, 450 desktop unit tests, three mock-backed browser tests, 33 Rust tests and 16 existing web smoke checks. Production builds and Linux native boot passed.
- Remaining blocking environment issue is the Prisma checksum host and authoritative migration ledger. Interactive native acceptance, low-end Windows and Android are unverified. See BESTWAY_NEXT_00_03_FINAL_REPORT.md for exact commands, file inventory and ordered backlog.

## Completion pass — P0 integrity

Standalone practice issues authenticated, expiring question snapshots. Grading, progress, attempts, profile bootstrap and rewards commit together under a lock on the existing User row. An explicit session ID supports independent attempts and replay. Existing clients can omit the ID after fetching a legacy quiz. The legacy mode reuses the same quiz and result for its one-hour validity window. Existing attempts remain unchanged.

Verified the focused vocabulary suite (23 passed) and verify_vocabulary_practice_postgres.py against local PostgreSQL, including two simultaneous submissions to one session, ten independent concurrent sessions, missing profile, injected rollback, cross-account denial, input validation and legacy replay.

Prisma 5.22.0 expects engine revision 605197351a3c8bdd595af2d2a9bc3025bca48ea2 for debian-openssl-3.0.x. Both the CLI and a direct checksum request received HTTP 403 from the environment proxy, and inspection found no local compatible binary. No ledger was created from SQL or synthesized.

### Stage 01 continuation

Extended the generated contract to Group updates, roster writes, attendance and standalone practice. Both clients share the persisted role type. Other tabs clear cached website state when the browser's authentication changes. Desktop account or role changes clear cached queries and visible exam state before rendering the new session. Focused desktop login, session and navigation tests passed (29 tests), and the PostgreSQL Group and assigned vocabulary contracts passed. Stage 01 remains PARTIAL until cross-tab and cross-account behavior is fully exercised and the broader authorization review is complete.

### Stage 02 continuation

Implemented multi-slot scheduling, overlap validation, scoped exam selection, group search and archive filters, archive and restore, atomic bulk enrollment changes, and a paginated member-history lookup. The historical view preserves attendance and graded homework after removal, and includes exam scores and approved feedback only when their attempts fall inside a known enrollment interval. Older unknown start dates remain unknown. Legacy Prisma Group and Attendance schema were left intact. Both clients expose schedule, lifecycle, bulk and history tools.

PostgreSQL verification passed multiple same-day slots, overlap rejection, bulk rollback, enrollment, attendance, homework, archive/restore, and authorized history. Focused attendance, classroom and homework tests passed (42 tests, 16 subtests). Stage 02 remains PARTIAL until cross-client browser coverage and remaining attendance/profile details are resolved.

### Final continuation verification

- P0 standalone practice passed the PostgreSQL concurrency, replay, ownership, size, direction, missing-profile and rollback checks. Prisma compatibility remains blocked. The source manifest matched, and the database compatibility command reported the missing real migration ledger.
- Stage 01 remains PARTIAL. The shared DTO generation passed. Browser runs cleared previous authentication in another website tab and removed teacher data on the desktop teacher-to-student switch. The signed PostgreSQL Group test also verified expired and inactive sessions, role escalation denial, parent and student scope, and exports.
- Stage 02 remains PARTIAL. Desktop frontend and website Chromium journeys exercised schedule, enrollment, attendance, assignment, bulk removal, archive, retained history and restore against the same PostgreSQL data. The user-admin route now records the same enrollment changes and rejects assignment to an archived group. Earlier enrollment dates and extended attendance types remain open.
- Stage 03 remains PARTIAL. The real 30-word flow scored 30/30 after a teacher edited the issued collection. Both clients displayed the grade and downloaded Excel from the same report. Flashcard familiarity resumed after reconnect and appeared in another client session. Signed concurrent review applied once, and results survived transfer. Desktop authoring created, previewed, published and assigned a separate collection with a real deadline and pass score. Native audio, durable offline recovery and older unsigned review clients remain open.
- Linux WebKitGTK loaded both classroom and Studio after an authenticated teacher login in the native development build. The packaged test build reached the sign-in screen, and the isolated HTTPS request failed. Physical Windows, Android and audible native pronunciation remain open.
- Both repos retain `feat/bestway-next-00-03`. The pushed implementation heads were Bestway `121b06043559bcc0bf4c64a99d60ef8fbea9b900` and desktop `8697fd492506daa5aa4500fa2ba9ff35289386c4`. Both GitHub GraphQL and authenticated REST draft creation requests were blocked by the Envoy HTTP 403. See the completion report for verified delivery state, exact commands and manual Compare links.

[Completion report](BESTWAY_NEXT_COMPLETION_REPORT.md)

## Draft PR closure

- Verified both incoming PR refs and pushed the fixes to those same branches. GitHub's public Checks pages supplied job-level conclusions despite the API proxy returning 403.
- The hosted Django run passed clean Prisma deployment, the authoritative Prisma ledger check, Django migration verification and a separate populated upgrade. The local engine download remains blocked by the checksum proxy.
- Session-bound access tokens are rejected when their refresh family is revoked. PostgreSQL verified rotation, independent device families, scope and the pre-upgrade token transition. Chromium exercised session revocation on focus and a real website account switch across tabs.
- PostgreSQL verified approved feedback scoped to the actual enrollment period, teacher reassignment and eligible exam assignment. The report fixture checked 126 learners, stable pagination and streamed CSV/XLSX.
- New signed SRS batches detect changes to issued translations. In-flight signed batches from older builds retain their original lifetime and are still accepted once.
- Stage 01 feature status is PARTIAL, Stage 02 is PASS, and Stage 03 is PARTIAL. Device acceptance remains UNVERIFIED. See the current release evidence, outstanding cases and cross-repository checklist. [Release gates](BESTWAY_NEXT_RELEASE_GATES.md)

## Stage 04 — PARTIAL

The 2026-11-20 independent audit supersedes the previous Stage 04 completion claim and test totals. Earlier Stage 01–03 delivery entries above remain historical evidence. The audit verified the classroom and vocabulary regressions and repaired the teacher grading queue, scope after classroom transfer, offline sync receipts and exact assigned-exam validation. It separates proven application functionality from physical-device and production acceptance.

- **STAGE 04 FEATURES · PARTIAL**
- **SECURITY · PARTIAL**
- **NATIVE ACCEPTANCE · PARTIAL**
- **PRODUCTION READINESS · BLOCKED**

[Independent Stage 04 audit](BESTWAY_NEXT_SOL_STAGE04_AUDIT.md) · [Release gates](BESTWAY_NEXT_RELEASE_GATES.md)

### Final release blocker remediation

- The installed Debian bundle reproduced the splash when a released frontend included an invalid HTTP API origin. Desktop `0bf5276` rejects that configuration at build time and renders an actionable retry screen for module startup failures. The HTTPS package passed login, offline download, a pending edit across process restart with Secret Service restoration, and reconnect sync.
- Backend and website `0bb341d` placed handwritten originals behind attempt authorization and tied versioned Speaking and Writing reviews to each skill. PostgreSQL and Chromium verified real media, foreign-teacher denial, concurrent and repeated review, separate scores and approved feedback.
- Hosted checks installed and opened Windows NSIS and Android emulator builds. Physical Windows and Android and optimized Linux release-candidate acceptance remain UNVERIFIED. Shared Windows profiles do not provide encrypted offline vocabulary. Both PRs remain draft and production readiness remains BLOCKED.

[Remediation evidence](BESTWAY_NEXT_SOL_STAGE04_AUDIT.md#final-release-blocker-remediation) · [Current release gates](BESTWAY_NEXT_RELEASE_GATES.md) · [Owner device checklist](https://github.com/bestwayec/bw-tauri/blob/b0443fd1b98f9f7fee28e8c4b508fea07ed13034/docs/BESTWAY_NEXT_NATIVE_ACCEPTANCE.md)

## Stage 05 — PARTIAL

Resumed with backend `67accb6` and desktop `b0443fd`. The recovered Kotlin OAuth repair passed direct JVM tests and consumed a genuine Django desktop exchange response. Its commit is `ae725fa`. Stage 05 adds a shared visual baseline, workspace shortcuts, exact classroom selection, bounded lists and compact grading previews. Existing authorization, migrations and the secure exam runner remain subject to final branch checks. [Owner review report](BESTWAY_NEXT_STAGE05_FINAL_REPORT.md)
