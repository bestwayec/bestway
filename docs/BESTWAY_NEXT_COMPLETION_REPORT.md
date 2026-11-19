# BESTWAY NEXT stages 01–03 completion report

## PR closure and current status

The two existing PRs are open as drafts. The closure phase added immediate revocation for session-bound access tokens, desktop revalidation on focus, scoped approved feedback, and streamed vocabulary exports. It also verified the populated schema upgrade through the hosted CI job. The local Prisma checksum proxy still returns HTTP 403. The native release checks and the remaining offline decisions are tracked independently from functional outcomes.

[Bestway PR #206](https://github.com/bestwayec/bestway/pull/206) · [Desktop PR #38](https://github.com/bestwayec/bw-tauri/pull/38) · [Current release gates](BESTWAY_NEXT_RELEASE_GATES.md)

The remainder of this report records the implementation pass before the draft PRs existed.

## Repository state

The existing feature branches were fetched and verified before changes. The implementation and delivery evidence below is for the continuation from the previous feature tips.

| Repository | Verified main baseline | Previous feature HEAD | Final implementation HEAD |
| --- | --- | --- | --- |
| bestwayec/bestway | `e38bf8a5e60198d57547dc98b42efce2eabaafef` | `b1760eb2065887fe3ea4263b7596406e870db7b4` | `121b06043559bcc0bf4c64a99d60ef8fbea9b900` |
| bestwayec/bw-tauri | `7f97f9ed1a480f27fd2b83d32a4defeb26b936b7` | `467bb3772404698d6919c7ef438be86b7b9b8311` | `8697fd492506daa5aa4500fa2ba9ff35289386c4` |

Both repositories use `feat/bestway-next-00-03`. The Bestway tip also includes the commit containing this report. Use `git ls-remote origin refs/heads/feat/bestway-next-00-03` to verify the tip, and `git status --short` to check the local tree.

Both branches were pushed and verified with `git ls-remote`. Local trees were clean at delivery. The draft PRs are blocked. GraphQL and authenticated REST requests both failed with HTTP 403 for both repositories. An unauthenticated request to `api.github.com/user` received an Envoy CONNECT 403 before any GitHub response. The authenticated identity check failed at the same endpoint, so token identity and PR permissions remain unverified.

- Backend and website draft. [Compare & Pull Request](https://github.com/bestwayec/bestway/compare/main...feat/bestway-next-00-03?expand=1)
- Desktop draft. [Compare & Pull Request](https://github.com/bestwayec/bw-tauri/compare/main...feat/bestway-next-00-03?expand=1)

~~~sh
gh api -i user
gh pr create --repo bestwayec/bestway --base main --head feat/bestway-next-00-03 --draft --title "BESTWAY NEXT stages 01–03 backend and website" --body-file /workspace/scratch/next-bestway-pr.md
gh pr create --repo bestwayec/bw-tauri --base main --head feat/bestway-next-00-03 --draft --title "BESTWAY NEXT stages 01–03 desktop" --body-file /workspace/scratch/next-tauri-pr.md
gh api --method POST repos/bestwayec/bestway/pulls --input /workspace/scratch/next-bestway-pr.json
gh api --method POST repos/bestwayec/bw-tauri/pulls --input /workspace/scratch/next-tauri-pr.json
~~~

Each body references the companion Compare page. Both REST payloads used `draft: true`.

## Stage status

| Stage | Status | Implementation and remaining gates |
| --- | --- | --- |
| 00 | PASS | Existing architecture, domain and permission baselines were preserved. |
| 01 | PARTIAL | Clients share generated Group, classroom and vocabulary DTOs and the persisted role type. Live account switching and scoped PostgreSQL checks passed. Clean Prisma deployment is blocked. Desktop parent support, complete endpoint contract coverage and revoked-session device verification remain open. |
| 02 | PARTIAL | Both clients use the same multi-slot scheduling, group lifecycle, classroom assignments and scoped history. PostgreSQL verified preservation across removal and archiving. The admin student create and transfer routes now record enrollment too. Historical dates before enrollment tracking and note or excused attendance types remain open. |
| 03 | PARTIAL | Versioned editing preserves assignment snapshots and results. Desktop authoring, synchronized flashcards, signed review, paginated reports and scoped CSV and XLSX are implemented. Offline pending durability, older unsigned SRS and native pronunciation remain open. |

## Feature acceptance

| Feature | Evidence | Status |
| --- | --- | --- |
| Authentication and role scopes | Signed JWT tests exercised expired/inactive accounts, self-promotion denial, cross-teacher access, student scope and linked-parent reads. Unit suites cover login, refresh and logout. | PARTIAL across supported client roles and native session scenarios |
| Cache isolation | Real HTTP account switch cleared the teacher group in another website tab. Desktop logout and student login cleared teacher data and navigation in Chromium. | PASS for verified journeys |
| API contracts | Django and both generated clients agree on the revised contract. Signed requests exercised both URL prefixes, role boundaries and validation. | PARTIAL for legacy API coverage and pagination consistency |
| Prisma migration integrity | Prisma 5.22.0 expected the schema engine at revision `605197351a3c8bdd595af2d2a9bc3025bca48ea2` for `debian-openssl-3.0.x`. CLI and direct checksum requests returned HTTP 403. Local SQL-seeded PostgreSQL had no `_prisma_migrations` ledger. | BLOCKED |
| Group schedules and teacher assignment | Multiple weekly and same-day slots, overlap rejection, teacher reassignment denied, admins scoped by role. | PASS for local API |
| Archive, restore and bulk | Django-owned archive and enrollment records, atomic bulk rollback, scoped archived history. | PASS for local API |
| Student history and attendance | Group-scoped attendance and homework remain readable after removal. Exam scores and approved feedback use known enrollment dates. | PARTIAL for historical enrollment intervals before tracking, standalone progress and extended attendance states |
| Vocabulary editing | Optimistic revision check, validated metadata, private scoping, archived words, stable issued assignment snapshots and recorded grades. | PASS for local API and cross-client edit during issuance |
| Desktop authoring | Real API for owned collections, paste and preview, publish, deadline and passing score, completion and difficult words. | PASS for the verified Chromium authoring and edit journeys |
| Issued quiz scoring and atomic rewards | Real PostgreSQL exercised replay, two simultaneous submissions and ten parallel sessions; validated word IDs and direction, ownership, limits, missing profile and rollback. | PASS for supported standalone paths |
| Flashcard synchronization | Server stores position, shuffled order, last studied time and self-assessment independently of grades. Browser and JWT tests verified two devices. Pending changes in an open study view sync after reconnect. | PARTIAL for durable pending writes offline |
| Spaced repetition | Signed batches, version conflicts, persisted reviews, reload and login recovery. | PARTIAL for older clients that omit a signed review ID |
| Pronunciation and keyboard | Recorded audio can replay, mute and fall back to browser speech. Both clients show a message when playback fails. Browser checks exercised keyboard mute and unmute. | PARTIAL pending audible native playback and a complete native keyboard review |
| Teacher analytics | Completion and overdue counts, missed words, paginated student results, historical attempts and scoped per-assignment CSV and XLSX. | PARTIAL for complete older history and large classroom load checks |
| Web and desktop parity | Shared Django data, matching classroom workflows and the same 30/30 result on both teacher clients. | PARTIAL across physical native platforms and unverified cases |

## Local verification

Commands below ran from the listed repository paths with local settings and disposable PostgreSQL. The live browser runs used Next.js at `http://localhost:3007`, Vite at `http://localhost:1423`, Django at `http://127.0.0.1:3104/v1` and `/usr/bin/chromium`. Supply synthetic credentials to the driver scripts.

| Area | Exact command | Outcome |
| --- | --- | --- |
| Django full suite | `cd backend-django && CORS_ALLOWED_ORIGINS=http://localhost:3000 python -m pytest -q -rs` | 1,470 passed, 268 subtests passed, 4 skipped because the legacy NestJS dist was unavailable. |
| Django migrations and static schema | `cd backend-django && python manage.py makemigrations --check --dry-run && python -m common.schema_validation ../backend/prisma/migrations` | No pending Django model changes. Static SQL ownership and the source migration manifest passed. |
| Prisma and compatibility | `cd backend && npm exec --no -- prisma -v` and `curl -fsSI --max-time 10 https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/schema-engine.gz.sha256` | Both returned HTTP 403. No compatible pinned engine was available in local caches. |
| Prisma migration ledger | `cd backend-django && python manage.py check_legacy_schema` | Failed with “Prisma migration ledger is missing; do not baseline automatically”. Clean `prisma migrate deploy` and authoritative legacy upgrade preservation could not be verified. |
| PostgreSQL standalone scoring | `cd backend-django && python scripts/verify_vocabulary_practice_postgres.py` | Passed ownership, answer validation, missing profile, injected rollback, parallel sessions and older-client retry. |
| PostgreSQL classroom | `cd backend-django && python scripts/verify_group_contract_postgres.py && python scripts/verify_classroom_postgres.py` | Passed contract and permissions, overlap and bulk rollback, attendance, homework and retained history after archive. |
| PostgreSQL homework and SRS | `cd backend-django && python scripts/verify_vocabulary_homework_postgres.py` | Passed 30 words, private access, edits during issuance, flashcard sync, scoped CSV and XLSX, review concurrency and retained history after transfer. |
| Shared code generation | `node scripts/generate-group-contract.mjs ../bw-tauri/src/lib/group-contract.generated.ts --check` | Both generated files matched. |
| Next.js | `cd frontend && npm exec --no -- tsc --noEmit && npm run lint && npm test && npm run build` | TypeScript passed. ESLint returned zero errors and 416 warnings. Vitest passed 837 tests. Production build passed. A proxy failure and empty exam fixture warning appeared in expected regression cases. |
| Website browser regression | `cd scripts/e2e-local && BW_WEB=http://localhost:3007 BW_CHROMIUM=/usr/bin/chromium BW_PYTHON=/workspace/scratch/bestway-venv/bin/python node smoke.mjs` | 16 passed. The unauthenticated landing check returned 401 as expected. It also reported 19 application console errors, five Google console errors and 18 failed non-Google network requests. The assertions passed. |
| Tauri web frontend | `npm run lint && npm test && npm run build` | TypeScript lint passed. 450 Vitest tests passed. Production TypeScript and Vite build passed with a chunk-size advisory. |
| Tauri mock browser tests | `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` | Three passed with mocked exam and updater endpoints. An expected updater test warning reported missing installer URL. |
| Real classroom browser | `node scripts/verify-group-ui.mjs && node scripts/verify-classroom-ui.mjs` | Passed Django-backed group creation, enrollment, attendance, shared assignments, bulk removal, archive, retained history and web restore. The failure-path test aborted a create request in Chromium and verified the form remained populated. |
| Real account isolation | `node scripts/verify-account-switch-ui.mjs` | Passed website cross-tab and desktop teacher-to-student switch. |
| Real vocabulary browser | `node scripts/verify-vocabulary-ui.mjs` | Passed a 30-word set, keyboard mute and unmute, paused flashcard sync and reconnect, editing after quiz issuance, exact 30/30 grading, matching reports, XLSX downloads, reauthentication and replay protection, retained grades after transfer, and desktop create, publish and assign. |
| Linux Rust and WebKit | `cd src-tauri && cargo check --locked -j 2 && cargo clippy --locked --all-targets -j 2 -- -D warnings && cargo test --locked --lib -j 2 && cargo build --locked --bin bestway-app -j 2` | Cargo check and build passed. Strict Clippy passed after removing a redundant borrow in a Rust test. All 33 Rust tests passed. Linux container boot confirmed a visible window and live WebKit renderer. DBus, accessibility bus, tray deprecation and secure-storage fallback warnings were recorded. |
| Linux native interactive check | `cd src-tauri && TAURI_CONFIG='{"build":{"devUrl":"http://localhost:1423"}}' VITE_API_URL=http://localhost:3104/v1 cargo build --no-default-features --locked --bin bestway-app -j 2` | Ran under Xvfb and WebKitGTK. Synthetic teacher sign-in reached Django with HTTP 200. Classroom and Studio navigation made authenticated requests to the Group list and owned collections, both with HTTP 200. Linux Secret Service was absent, so the test used the existing file fallback. The packaged HTTPS build reached sign-in, then reported a connection error to the disposable TLS endpoint. |
| Windows and Android | Physical-device checks | Login, device secure storage, deep links, exam recovery, update installation, audible pronunciation and low-resource behavior remain unverified on physical Windows and Android devices. |
| GitHub-hosted CI | `gh api repos/bestwayec/bestway/actions/runs` and corresponding desktop endpoint | Both branch-filtered workflow status requests were blocked by the GitHub proxy. Hosted CI status is unverified. |

The Linux startup smoke used the local runtime image and mounted demo binary.

~~~sh
docker run --rm \
  --mount type=bind,src=/workspace/bw-tauri/src-tauri/target/debug/bestway-app,dst=/opt/bestway-app,readonly \
  --mount type=bind,src=/workspace/scratch/bestway-native/smoke-runtime.sh,dst=/opt/smoke-runtime.sh,readonly \
  bestway-cloud-tauri-runtime sh /opt/smoke-runtime.sh
~~~

## Remaining backlog

| Priority | Repository and module | Required work and acceptance | Dependency |
| --- | --- | --- | --- |
| P0 | Bestway Prisma and Django schema | Deploy the pinned Prisma migrations to a clean disposable PostgreSQL database, then apply Django migrations. Verify real migration ledger and row preservation on a synthetic legacy upgrade. | Approved pinned Prisma engine and checksum access |
| P1 | Both auth and contract modules | Validate every supported role and relevant API envelope, including full logout, revocation and expired state across devices. Confirm the supported parent experience and scope. | Desktop parent UI and native device coverage |
| P1 | Bestway classroom enrollment history | Backfill older enrollment periods only where source records substantiate the dates. Verify that each period reveals only the associated exam results and approved feedback. | Historical source data |
| P1 | Both classroom attendance and history | Verify teacher assignment, exam assignment, scoped downloads and unified historical exam/feedback views end to end. Add excused and notes when approved schema supports them. | Approved schema evolution for added attendance data |
| P1 | Both review and flashcard modules | Verify supported signed protocol versions and implement durable pending study mutations and conflict handling if offline support is required. Confirm reload and cross-device behavior after disconnect. | Legacy client compatibility decision and offline implementation |
| P1 | Both vocabulary reports | Verify historical analytics and export memory use with large classroom cohorts. | Dataset volume fixtures |
| P1 | Tauri vocabulary and native exam | Extend Linux interaction coverage and verify Windows and Android login and secure storage, exam/update recovery, pronunciation replay and mute, keyboard focus and low-resource performance. | Interactive Linux session and supported Windows/Android devices |
| P2 | Both clients | Complete localization and accessibility review for new teacher and study controls. Confirm behavior in English and Uzbek. | Keyboard and language acceptance coverage |

## Stage 04 readiness

The shared API, server-owned classroom history and immutable vocabulary assignment snapshots are available for planning the Unified Teacher/Student Workspaces. Keep Stage 04 implementation gated on authoritative migration verification and the remaining authorization, history and native acceptance work.

## Continuation inventory

### Bestway backend and website commits

~~~text
fba141da8752c033a46a201e524a1f13345f8df4 fix(vocabulary): issue and grade standalone practice atomically
11affcfbf89dd20ff4d50e530e46262c299998f8 feat(next): share roster, attendance and practice boundaries
cc29928470898eb8178e1a4e613d267d103f9264 feat(classroom): support schedule, archive and scoped history
779d2ab1ce342d45f9a8f3345e5926ab26a2f768 Complete revisioned vocabulary studio and synchronized learning history
6b0e209f5a8fce9083deac0f8086a920122f55d8 Verify classroom account boundaries against PostgreSQL
e62c715b4f5317490865c72914cb71f3383cd6dc Track classroom enrollment through admin changes
ec02ea6182b63ddec21e03f7eff2e40bbea9a4fa Export scoped vocabulary workbooks and handle audio fallback
121b06043559bcc0bf4c64a99d60ef8fbea9b900 Show paused study sync and render separate export links
~~~

### Bestway desktop commits

~~~text
634a7f16c613e148f6a7f2935d66c4fe4e39c183 fix(session): reset desktop state on identity changes
c855a087301b07808358cc2b440861561b84240f feat(classroom): edit schedules and manage classroom lifecycle on desktop
7df9be609f711c31b4b1422dcce20757a6b42489 Complete desktop vocabulary authoring and synchronized learner history
6b987f78d6917dbd52092dc67796807b0f12b54f Keep one desktop classroom workspace active per group
f72fe5b2942251b2192e197bd4ae802b2d5d4b92 Normalize the local group verification API URL
0f67bb9ecec143599d7c67ef816b58b4a8c4fc6b Add vocabulary workbook exports and pronunciation controls
8697fd492506daa5aa4500fa2ba9ff35289386c4 Surface offline flashcard sync and verify reconnection
~~~

### Bestway backend and website files

~~~text
backend-django/apps/core/attendance.py
backend-django/apps/core/classroom_roster.py
backend-django/apps/core/classrooms.py
backend-django/apps/core/group_views.py
backend-django/apps/core/groups.py
backend-django/apps/core/migrations/0013_vocabulary_practice_session.py
backend-django/apps/core/migrations/0014_classroom_archive_and_history.py
backend-django/apps/core/migrations/0015_vocabulary_revisions_and_flashcards.py
backend-django/apps/core/migrations/0016_vocabulary_review_timeline.py
backend-django/apps/core/models.py
backend-django/apps/core/teacher_views.py
backend-django/apps/core/urls.py
backend-django/apps/core/user_admin.py
backend-django/apps/core/vocabulary_collections.py
backend-django/apps/core/vocabulary_homework.py
backend-django/apps/core/vocabulary_review.py
backend-django/apps/core/vocabulary_service.py
backend-django/apps/core/vocabulary_views.py
backend-django/scripts/verify_classroom_postgres.py
backend-django/scripts/verify_group_contract_postgres.py
backend-django/scripts/verify_vocabulary_homework_postgres.py
backend-django/scripts/verify_vocabulary_practice_postgres.py
backend-django/tests/test_vocab_battle_and_lookup.py
backend-django/tests/test_vocabulary_engine.py
docs/BESTWAY_NEXT_00_03_LEDGER.md
docs/contracts/groups.v1.openapi.json
frontend/messages/en.json
frontend/messages/uz.json
frontend/src/app/[locale]/(app)/vocabulary/srs/page.tsx
frontend/src/components/groups/classroom-assignments.tsx
frontend/src/components/groups/classroom-management.tsx
frontend/src/components/groups/group-detail-view.tsx
frontend/src/components/groups/group-form-dialog.tsx
frontend/src/components/groups/groups-view.tsx
frontend/src/components/providers.tsx
frontend/src/components/teacher/VocabularyBuilder.tsx
frontend/src/components/vocabulary/VocabularyAssignment.tsx
frontend/src/components/vocabulary/VocabularyCatalogView.tsx
frontend/src/components/vocabulary/VocabularyHistory.tsx
frontend/src/components/vocabulary/VocabularyQuizRunner.tsx
frontend/src/hooks/use-groups.ts
frontend/src/lib/api-client.ts
frontend/src/lib/auth-context.ts
frontend/src/lib/group-contract.generated.ts
frontend/src/lib/types.ts
scripts/generate-group-contract.mjs
docs/BESTWAY_NEXT_00_03_FINAL_REPORT.md
docs/BESTWAY_NEXT_COMPLETION_REPORT.md
~~~

### Bestway desktop files

~~~text
scripts/verify-account-switch-ui.mjs
scripts/verify-classroom-ui.mjs
scripts/verify-group-ui.mjs
scripts/verify-vocabulary-ui.mjs
src-tauri/src/session.rs
src/App.tsx
src/components/ClassroomSchedule.tsx
src/components/Sidebar.tsx
src/lib/auth.ts
src/lib/group-contract.generated.ts
src/pages/ClassroomHistory.tsx
src/pages/ClassroomWorkspace.tsx
src/pages/GroupsResults.tsx
src/pages/Login.tsx
src/pages/Vocabulary.tsx
src/pages/VocabularyStudio.tsx
~~~
