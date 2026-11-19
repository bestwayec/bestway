# BESTWAY NEXT stages 00–03 final report

## A. Repository state

Both repositories use the pushed branch feat/bestway-next-00-03. Their clean starting checkouts were switched to fresh branches after verifying remote HEAD and main. GitHub GraphQL returned HTTP 403 for both draft pull request attempts.

| Repository | Verified main | Implementation HEAD |
| --- | --- | --- |
| bestwayec/bestway | e38bf8a5e60198d57547dc98b42efce2eabaafef | e08a5a1b85b5ce609c440b907c7dbd3f0fa3423b |
| bestwayec/bw-tauri | 7f97f9ed1a480f27fd2b83d32a4defeb26b936b7 | 467bb3772404698d6919c7ef438be86b7b9b8311 |

The Bestway implementation HEAD precedes the final documentation commit containing this report. Final working tree status and remote tips are checked after committing this file.

- Bestway repository and pushed branch. [Repository](https://github.com/bestwayec/bestway) · [Compare](https://github.com/bestwayec/bestway/compare/main...feat/bestway-next-00-03)
- Tauri repository and pushed branch. [Repository](https://github.com/bestwayec/bw-tauri) · [Compare](https://github.com/bestwayec/bw-tauri/compare/main...feat/bestway-next-00-03)

### Commit history

- Bestway 4b7031d1202e7fbc9680247ab4c9931104ec7632 docs(next): audit stage 00 architecture and baseline
- Bestway 2431ebd04cc9acf9f871a3933ed8759d287a5b38 feat(next): align stage 01 group contracts and permissions
- Bestway da8bde352a713d460c8ae4d215851765c54f10e4 fix(next): retain roster query compatibility with scoped reads
- Bestway df0180791f1acd235ac19afac2d3efdd0ff13988 feat(next): link classroom rosters to existing homework
- Bestway e08a5a1b85b5ce609c440b907c7dbd3f0fa3423b feat(next): grade vocabulary homework and schedule daily review
- Tauri 5e99992eeed9c9c685f530b31dd899803cb80661 fix(next): require server confirmation for desktop groups
- Tauri dc73fbac1a0b54bf6163fd0b0cbe93deb4c988c3 feat(next): add desktop classroom roster, attendance, and assignments
- Tauri 467bb3772404698d6919c7ef438be86b7b9b8311 feat(next): add assigned vocabulary practice and review to desktop

### Changed files

Bestway

~~~text
backend-django/apps/core/attendance.py
backend-django/apps/core/classrooms.py
backend-django/apps/core/groups.py
backend-django/apps/core/migrations/0011_classroom_cohort.py
backend-django/apps/core/migrations/0012_vocabulary_homework_and_review.py
backend-django/apps/core/models.py
backend-django/apps/core/teacher_views.py
backend-django/apps/core/urls.py
backend-django/apps/core/vocabulary_homework.py
backend-django/apps/core/vocabulary_review.py
backend-django/apps/core/vocabulary_service.py
backend-django/apps/core/vocabulary_views.py
backend-django/scripts/verify_classroom_postgres.py
backend-django/scripts/verify_group_contract_postgres.py
backend-django/scripts/verify_vocabulary_homework_postgres.py
backend-django/tests/test_vocabulary_engine.py
docs/BESTWAY_NEXT_00_03_LEDGER.md
docs/BESTWAY_NEXT_API_CONTRACT_AUDIT.md
docs/BESTWAY_NEXT_ARCHITECTURE.md
docs/BESTWAY_NEXT_DOMAIN_MAP.md
docs/BESTWAY_NEXT_PERMISSION_MATRIX.md
docs/contracts/groups.v1.openapi.json
frontend/messages/en.json
frontend/messages/uz.json
frontend/src/app/[locale]/(app)/vocabulary/assignment/[id]/page.tsx
frontend/src/app/[locale]/(app)/vocabulary/srs/page.tsx
frontend/src/components/dashboard/StudentAssignmentsWidget.tsx
frontend/src/components/groups/classroom-assignments.tsx
frontend/src/components/groups/group-detail-view.tsx
frontend/src/components/teacher/group-ai-ranking.tsx
frontend/src/components/vocabulary/VocabularyAssignment.tsx
frontend/src/components/vocabulary/VocabularyQuizRunner.tsx
frontend/src/lib/group-contract.generated.ts
frontend/src/lib/types.ts
scripts/generate-group-contract.mjs
docs/BESTWAY_NEXT_00_03_FINAL_REPORT.md
~~~

Tauri

~~~text
scripts/verify-classroom-ui.mjs
scripts/verify-group-ui.mjs
scripts/verify-vocabulary-ui.mjs
src/App.tsx
src/components/Sidebar.tsx
src/lib/group-contract.generated.ts
src/pages/ClassroomWorkspace.tsx
src/pages/GroupsResults.tsx
src/pages/Vocabulary.tsx
~~~

## B. Stage completion

| Stage | Status | Planned work and delivery | Evidence | Open gate and next action |
| --- | --- | --- | --- | --- |
| 00 | PASS | Audited both repositories and documented architecture, schema ownership, role boundaries and the Group/Cohort bridge design. | Fresh baseline checks on both verified main revisions. | Preserve ownership boundaries in later migrations. |
| 01 | PARTIAL | Published a versioned Group OpenAPI subset and generated both clients. Desktop shows write failures, retains form values and uses server IDs and exports. Group reads scope progress by owner, student or linked child. First enrollment now writes the PostgreSQL enum type. | Signed JWT Group integration and Chromium create through real Django. The network outage was simulated. | Broader canonical role and DTO coverage, profile/export review and full cache isolation validation. |
| 02 | PARTIAL | Added a unique Group-to-Cohort link. Group enrollment drives linked homework, and existing Cohorts retain their data. Added matching assignment tools, desktop roster editing and date-based attendance. Attendance no longer changes enrollment. | Real PostgreSQL classroom journey and cross-client HTTP browser test. | Complete schedule, teacher assignment, archive, bulk actions and unified profile history. |
| 03 | PARTIAL | Linked vocabulary to existing homework, graded issued mixed and spelling sessions, added scoped teacher reports and CSV, and scheduled daily review. Reused the web builder and added student desktop practice. | Real 30-word PostgreSQL and Chromium journeys through teacher publish, desktop scoring, reports, review, reload and reauthentication. Linux native boot passed. | Complete editing and rich metadata, desktop authoring, synchronized flashcard state, richer reporting and native interaction checks. |

## C. Feature checklist

| Feature | Verified work | Remaining |
| --- | --- | --- |
| Authentication | Existing password sessions on website and desktop frontend. Native auth and refresh tests passed. | Complete canonical role and native OAuth journey coverage. |
| Permissions | Scoped Group mutations, roster rows, exports, vocabulary visibility and teacher reports. | Broader teacher profile, cache and export audit. |
| Shared API | Generated Group, classroom and vocabulary DTOs with both mounted API prefixes. | Full OpenAPI coverage and pagination consistency. |
| Groups | List, create, rename, search, add and remove. Desktop reports use returned results. | Schedule editing parity, teacher administration and archive. |
| Cohorts | Independent invitation and homework semantics preserved. | Review any migration of old groups separately using verified mappings. |
| Classroom integration | Group identifies schedule, roster and attendance. Linked Cohort supplies homework. | Bulk actions and unified workspace navigation. |
| Student profiles | Scoped roster results and existing profile routes retained. | A single teacher view of attendance, coursework, feedback and study history. |
| Attendance | Present, absent, late, saved date and duplicate-save protection. | Notes and excused state are absent from the current schema. |
| Vocabulary CRUD | Existing single/bulk creation, preview and publish. Group and private collection visibility enforced. Assigned sets have deletion protection. | Update workflow, richer word metadata and desktop authoring. |
| Vocabulary assignments | Group, deadline, score threshold and persisted HomeworkSubmission. | Additional cohort-wide workflow and progress views. |
| Flashcards | Reveal and keyboard-focusable navigation. Desktop known-state is local to the open study view. | Shuffle, resume and cross-device state distinct from grades. |
| Spelling | Issued prompt, typed answer and server grading. | Full native interaction verification. |
| Quizzes | Both translation directions and mixed mode. One result per assigned student and assignment. | Hardening and migration of older standalone scoring and rewards. |
| Audio | Existing website speech synthesis and desktop pronounce/mute/replay where available. | Native voice and audio availability verification. |
| Spaced repetition | Signed batches, version checks, locked writes, due dates, intervals, lapses and review counts. | Rollout compatibility for older clients and long-term reporting. |
| Progress | Results persist through reload and sign-out/sign-in. Review dates persist in PostgreSQL. | Unified learner progress and historical review display. |
| Teacher reports | Completion, overdue count, individual scores, missed words and scoped CSV. | Historical reports for removed students and longitudinal analytics. |
| Website parity | Publish, assign, report and assigned practice reuse existing components. | Full studio and profile parity. |
| Desktop parity | Classroom, attendance, assignments, reports, student quiz and review use the live backend. | Existing Bestway exam smoke | scripts/e2e-local, `BW_WEB=http://localhost:3007 BW_CHROMIUM=/usr/bin/chromium BW_PYTHON=/workspace/scratch/bestway-venv/bin/python node smoke.mjs` | All 16 steps passed. Browser diagnostics included a pre-auth /auth/me HTTP 401 and a hydration warning. |
| Native interactive, Windows and Android checks, and desktop authoring. |

## D. Verification

Used a disposable localhost PostgreSQL database. Django migrations 0011 and 0012 applied successfully. The Prisma source manifest passed. The Prisma checksum host returned HTTP 403 and the SQL-initialized local database lacks a Prisma migration ledger. Normal Prisma deployment and the legacy ledger check remain blocked.

| Type | Command in the stated directory | Result |
| --- | --- | --- |
| Django suite | backend-django, `CORS_ALLOWED_ORIGINS=http://localhost:3000 /workspace/scratch/bestway-venv/bin/python -m pytest -q` | 1,470 passed, 4 legacy NestJS checks skipped, 268 subtests passed. |
| Schema checks | backend-django, `python manage.py check`, `python manage.py makemigrations --check --dry-run`, `python -m common.schema_validation ../backend/prisma/migrations` | Passed. Local `python manage.py migrate --noinput` applied both managed migrations. |
| PostgreSQL contracts | backend-django, `python scripts/verify_group_contract_postgres.py`, `python scripts/verify_classroom_postgres.py`, `python scripts/verify_vocabulary_homework_postgres.py` | Passed with real JWTs, routes and database transactions. Fixtures rolled back. |
| Shared types | Bestway root, `node scripts/generate-group-contract.mjs ../bw-tauri/src/lib/group-contract.generated.ts --check` | Both generated files matched. |
| Web checks | frontend, `npm exec --no -- tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` | TypeScript and build passed. 837 tests passed. ESLint reported 419 warnings and zero errors. |
| Tauri checks | Tauri root, `npm run lint`, `npm test`, `npm run build` | TypeScript and Vite build passed. 450 tests passed. |
| Mock browser tests | Tauri root, `CI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` | Three passed against the repository mock server. |
| Real browser tests | Tauri root, `node scripts/verify-group-ui.mjs`, `node scripts/verify-classroom-ui.mjs`, `node scripts/verify-vocabulary-ui.mjs` | Passed against actual Django and PostgreSQL. Group transport failure was simulated. Two concurrent review submissions produced HTTP 200 and 409. |
| Rust and native boot | src-tauri, `cargo check --locked -j 2`, `cargo clippy --locked -j 2 --message-format short`, `cargo test --locked --lib -j 2`, `cargo build --locked --bin bestway-app -j 2`, then the cloud WebKit smoke command | Check, Clippy, 33 tests and debug link passed. The rootless container mapped the Bestway window with a live WebKit renderer. The container used file fallback for Secret Service. |
| Interactive native, low-end Windows and Android | Procedure below | UNVERIFIED. |
| Production | No production tests or migrations | Outside this mission. |

For the real browser scripts, run the disposable Django API on 127.0.0.1:3104 and allow the web and Vite loopback origins in CORS. Run Next.js on localhost port 3007 with API_URL pointing to that API and Vite on localhost port 1423 with the same VITE_API_URL. Use the synthetic accounts from seed_local_dev and the variables named in each script. Group-only defaults are API port 3103 and Vite port 1422. These scripts write disposable fixtures.

### Resolved verification failures

The first Group integration found the legacy ExamProgram array cast error. The first full authorization suite found a change to the roster query shape that broke an existing fixture. Both fixes passed the same contract and suite. The first desktop vocabulary navigation placement changed the exam-track action index. The original navigation test passed after preserving the existing order. The first CSV request used DRF's reserved format parameter and returned 404. The scoped export passed with download=csv. The browser re-login script now accepts the application's sign-out confirmation and waits for the sign-in screen.

### Native interactive procedure still to verify

1. Start local Django and Next.js, seed synthetic roles, and publish and assign a 30-word set to the synthetic student's classroom.
2. On a graphical workstation with the platform dependencies installed, set VITE_API_URL and VITE_WEB_URL to the local services and run `npm run tauri dev`. For Windows use WebView2 and the Rust/MSVC toolchain.
3. Sign in as the student. Open Vocabulary, reveal a flashcard and complete mixed practice with both translation directions and spelling.
4. Compare the persisted score in website and native teacher reports. Run a due review and check its next timestamp. Sign out and back in to confirm the result remains.
5. Record audio availability, input latency and failures on low-memory Windows and Android. Stop before deploying.

GitHub API access returned HTTP 403, so no CI run URL or result was verified. [Bestway Actions](https://github.com/bestwayec/bestway/actions) · [Tauri Actions](https://github.com/bestwayec/bw-tauri/actions)

## E. Ordered backlog

| Priority | Repository and module | Required fix | Acceptance criterion | Dependency |
| --- | --- | --- | --- | --- |
| P0 | Bestway vocabulary_service.py legacy standalone path | Bind rewarded practice to issued directions and atomic per-user/set reward accounting. | Simultaneous valid submissions cannot exceed the reward limit. | Shared contract and upgrade plan. |
| P0 | Bestway check_legacy_schema and Prisma CI | Run normal Prisma deployment in a clean disposable DB and validate the ledger. | Verified checksums, Prisma deploy and schema consistency pass. | Egress to the Prisma binary host. |
| P0 | Both auth, cache and review consumers | Validate role scope, account switching and signed-review compatibility across supported clients. | No account cache leak and supported versions recover from review version conflicts. | Real API and compatible client versions. |
| P1 | Bestway groups.py, web group detail and desktop ClassroomWorkspace.tsx | Finish multi-slot schedules, assignment, archive, bulk actions and student history. | Equivalent teacher workflow on both clients with history retained. | Group authorization and identifiers. |
| P1 | Both vocabulary studios and Bestway vocabulary_views.py | Add editing, rich metadata, desktop authoring and synchronized flashcard state. | Collections can be edited without losing results, and flashcards resume without changing official grades. | Shared metadata and revision rules. |
| P1 | Both reports and profile modules | Add historical enrollment reporting, learning progress and scoring feedback. | Authorized users can recover results after transfers and export equivalent scoped data. | Membership history and profile authorization. |
| P1 | Tauri native and mobile | Execute the full interactive native flow on Linux, Windows and Android. | Reproducible runs against a real backend. | Graphical runners and platform toolchains. |
| P2 | Both classroom and vocabulary screens | Improve keyboard coverage, layout and low-memory performance. | Keyboard and responsive checks pass with representative timing measurements. | Completed core workflows. |
| P3 | Both vocabulary asset flows | Support licensed audio or reviewed enrichment. | Optional enrichment has documented provenance and can be skipped. | Licensing and publishing rules. |

## F. Roadmap

Stage 04 can use the Group identifier, Django-owned homework link and shared contract subset once the remaining scope and workspace flows are reviewed. Stage 05 should address measured desktop latency, accessibility and audio availability. Stage 06 requires the Prisma ledger, cross-platform interactive QA, rollout verification and deployment approval. Stage 04 was not started.

## G. Verdict

Stage 00 passed. Stages 01–03 are partial. The teacher-to-student vocabulary workflow passed in Chromium against real Django and PostgreSQL, with the same score on the website and desktop frontend. Native boot and renderer checks passed. Full native parity, complete scope and production readiness remain unverified. Grandec was untouched.
