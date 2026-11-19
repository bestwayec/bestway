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
