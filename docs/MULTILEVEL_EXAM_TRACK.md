# Multilevel exam track implementation — 2026-10-04

## Baseline and architecture

The feature branch is `feat/multilevel-exam-track`, based on main at `7ec8a0b5bfaf4471174a09d2df49c9d0ddc60c7f`. The desktop companion branch starts at `eb3a7a2d6342a14b1c201f04124901186ab20e49`. Both were fresh clones with clean working trees; remotes were fetched before editing.

The backend uses NestJS 10.4.22, Prisma 5.22.0/PostgreSQL, TypeScript 5.9.3 and Vitest 5.0.0. The web uses Next.js 16.3.4, React 19.2.4, TypeScript 5.9.3 and Vitest 3.2.7. Desktop uses React 19.2.8, Vite 8.2.2, TypeScript 5.6.3, Vitest 5.0.3 and Tauri JS 2.11.1; its locked Rust Tauri crate is 2.11.5, edition 2021, minimum Rust 1.77.2. Host Node is 24.11.1/npm 10.9.0. Migration verification used PostgreSQL 17.11.

Baseline: backend 89 tests and build passed; web 52 tests and lint passed with 17 warnings; desktop 57 tests and build passed with bundle warnings. The baseline web build compiled, but its final outcome was interrupted/unverified. Initial web/desktop `npm ci` failed because upstream lockfiles omitted optional native/WASM dependency entries. Only missing entries were added, preserving existing package versions and metadata. Clean installs and dry runs now pass. Earlier baseline checks used compatible newer Next/Vite versions; final builds use the original locked versions above.

Existing architecture includes global JWT/role guards, teacher group scoping, legacy Tests and a richer shared MockExam/Section/Group/Question/Attempt/Answer engine. Mock authoring supports practice/full_mock, publication readiness, imports, disk media, server deadlines, manual grading, audit and notifications. Web and desktop adapt shared objective renderers. The existing AI JSON importer authors content; there is no AI assessment provider, STT pipeline or grading queue to reuse.

## Implemented behavior

- Accounts persist available IELTS/Multilevel programs and a selected default. Existing students default to IELTS. Staff enrollment changes are scoped and audited; selecting a track requires current enrollment. Demo/free/purchased exams do not bypass enrollment.
- Web profile/dashboard and desktop profile/dashboard/catalog expose track selection. Multilevel dashboards expose four skills and separate history. Staff can filter grading submissions by program and assign/remove access from student detail.
- Central version `UZBMB_MULTILEVEL_EN_2026_V1` defines Listening 45 minutes/6 parts/35 questions, Reading 60 minutes/5 parts/35 questions, Writing 60 minutes/three tasks, and Speaking four parts/eight responses. Speaking uses an 11-minute section cap including transition allowance and server-issued preparation/response phases.
- Listening issues a 20-second preview and permits two server-granted plays. Range/media fetches do not consume additional plays or advance the exam. Timed parts must run in order. Practice uses the existing flexible player.
- Reading reuses MCQ, matching/headings, one-word completion and TFNG renderers with validated mixed-part ordering.
- Writing uses informal email around 50 words, formal email 120–150 and publication 180–200, with raw maxima 5/5/6. The two emails must share a source stimulus. Word targets remain guidance; teacher assessment supplies the raw scores.
- Speaking provides microphone preflight/meter, timed preparation, automatic recording stop, upload acknowledgement/retry, and durable IndexedDB takes. Recorded progress changes only after successful upload. The first acknowledged timed take is immutable; its recovery upload window is bounded to five minutes after the response deadline.
- Autosave preserves dirty data until acknowledgement, serializes requests, and waits for outstanding saves before manual finalization/section advance. Server transactions recheck ownership, enrollment, status, question membership and current section. Final submission claims status once; duplicate submissions return the stored state. Early transitions cannot donate unused time to the next section.
- Authoring uses the existing builder with versioned per-part types/limits. Publication/start validates the blueprint and media duration. Attempted Multilevel content must be cloned before editing. Clone retains profile/version. Imports remain draft-first and require media duration editing/readiness before publication.
- Results/history/certificates show estimated /75 scores, version/method and unofficial status. Writing/Speaking await real teacher grading rather than synthetic AI scores. Feedback and overrides reuse the existing audit path.

## Database and compatibility

Migration: `20261003000000_multilevel_exam_track`.

`ExamProgram` enum adds IELTS/MULTILEVEL. `StudentProfile` adds `availablePrograms` and nullable `activeProgram`; a check requires the selected track to be enrolled. `MockExam` adds `specificationVersion`. `MockAttempt` adds `specificationVersion`, `scoreMethod`, `scoreVersion`, `standardScores`, `overallScore` and `mediaState`.

Changes are additive. Existing Multilevel exam definitions are stamped for readiness validation; historical attempt versions/scores remain untouched. Existing Multilevel content must satisfy the new blueprint before a new versioned attempt can start. IELTS timing/band tables and historical results remain on their existing paths. No production migration, deployment, push or OAuth change was performed.

## Scoring

Writing sums three raw task scores out of 16 and applies all 33 supplied half-point conversion entries. Speaking averages half-point prompt ratings within each holistic part, rounds that part to a half-point, sums four parts out of 21 and applies all 43 supplied entries. A teacher should apply a consistent holistic rating to recordings in the same part.

Listening/Reading use a deterministic interpolated practice estimate with approximate /35 raw anchors, not a Rasch model. Every new result declares `scoreMethod: ESTIMATED`, the versioned estimate method and `isOfficial: false`. No item parameters or calibrated status are invented. Overall retains the arithmetic mean of all four available section standard scores without premature rounding. Thresholds are 38/B1, 51/B2, 65/C1; below 38 is BELOW_B1. Missing teacher scores leave overall pending.

## Verification

| Project/command | Result |
|---|---|
| backend `npm ci` | PASS |
| backend `npm test` | PASS: 124 tests, 14 files |
| backend `npm run build` | PASS |
| backend `npx prisma validate` | PASS |
| backend `npx prisma generate` | PASS |
| web `npm ci --no-audit --no-fund` | PASS |
| web `npm test` | PASS: 54 tests, 12 files |
| web `npm run lint` | PASS: 0 errors, 17 baseline warnings |
| web `npm run build` | PASS: production compilation, TypeScript and 60 static pages |
| desktop `npm ci --no-audit --no-fund` | PASS |
| desktop `npm test` | PASS: 71 tests, 6 files |
| desktop `npm run build` | PASS: TypeScript/Vite; baseline bundle warning |
| web/desktop `npm ci --dry-run --ignore-scripts --no-audit --no-fund` | PASS with minimal lock repairs |
| isolated PostgreSQL baseline SQL migrations | PASS: all 16 preceding migrations |
| isolated `npx prisma migrate deploy` | PASS: all 17 migrations on a fresh second database |
| isolated `npx prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code` | PASS: no difference detected |
| `psql ... -f scripts/verify-multilevel-migration.sql` | PASS: existing results/points, defaults, backfill and constraint |
| `DATABASE_URL=... node scripts/verify-multilevel-http.cjs` | PASS: 35 authenticated HTTP assertions |

The HTTP script refuses databases other than loopback `multilevel_verification`. It creates original development-only content and synthetic WAV/two-picture PNG assets outside the repository. It boots the actual Nest AppModule and checks authentication, student/staff role boundaries, teacher scope, invalid enrollment DTOs, publication, direct start denial, persisted selection, section timing, answer isolation, revoked access, sanitized keys/transcripts, preview timing, audio range streaming, two-play enforcement, immutable attempted content, idempotent submit and program history, scoped manual grading/score validation and an actual IELTS start/answer/submit (band 9) regression. It simulates elapsed media phases through fixture DB updates rather than waiting a complete exam.

New unit tests cover every conversion entry/invalid raw score, exact threshold boundaries, objective anchors, complete blueprint fixture, pending manual grades, /16 and /21 aggregation, ownership/revocation/concurrent finalization, expired writes and media fetch isolation. Existing IELTS and desktop contract tests still pass. This is not a hardware microphone/kiosk test.

## Remaining validation and dependencies

Cargo is unavailable, so native Tauri packaging/updater validation was not run. Real browser/WebView microphone permission, device interruption, IndexedDB quota failures and full-duration audio playback still require an interactive device test. The backend enforces task/upload windows and upload-size limits; it does not decode recordings to independently validate codec integrity or audio duration.

Automatic AI/STT assessment and calibrated Rasch scoring remain unavailable because the repository has neither assessment infrastructure/credentials nor calibrated item parameters. Manual review is functional. The existing supervised `/exam-sessions` desktop contract still has no corresponding backend and is outside this shared `/mock` integration.

Before rollout, review existing Multilevel content against the new blueprint, provision real media, and run the migration through the normal deployment workflow in staging. Production was not contacted or changed. Local commits and exact changed-file manifests are recorded in the parent workspace implementation report.

## Independent hardening verification — 2026-10-04

The follow-up audit preserves the original implementation commit. Fixes restore first-render full-test resume, preserve unversioned historical attempts/results, retain completed recordings when local storage fails, guard microphone finalization/upload races, retry expired Multilevel transitions, reject empty/obviously spoofed audio and clean rejected uploads, and restore the IELTS authoring part-number limit. The desktop also waits for answer acknowledgement on manual Multilevel submission and filters stale section queues.

Fresh final results: backend 129 tests/15 files, web 60 tests/14 files, desktop 78 tests/8 files; all three TypeScript checks and JavaScript production builds passed. Web lint has 0 errors/17 existing warnings. The expanded authenticated HTTP fixture passed 121 checks, including the four-skill IELTS flow with overall band 8.5 and all Multilevel manual grades. A separate comparison against the original supplied tables passed all 76 conversion entries. Prisma validation/generation, 17-migration fresh deployment, migration preservation and zero-drift checks passed. IndexedDB tests use a contract fixture, not a physical WebView.

Verdict: **BLOCKED_FOR_PR**. `cargo fmt --check`, `cargo check`, `cargo test` could not run because Cargo/Rust are absent. `npm run tauri -- build --no-bundle` failed at Cargo metadata; `tauri info` also reports missing MSVC/SDK components. **NATIVE_MICROPHONE_UNVERIFIED**: permission, device interruption, recording/playback/upload and reopen require a built native application and physical device. Nothing was pushed or deployed.

AI grading/STT are not implemented: there is no assessment adapter, job queue, transcription service or provider environment contract. Submitted audio is retained for teacher review, with no synthetic score. Audio validation recognizes container headers and does not prove codec integrity/duration. Part 1.2 preparation defaults of 15/5/5 seconds and the 11-minute Speaking cap preserve the requested practice specification; official Speaking Part 1.2 describes no preparation, so this configuration must not be presented as an exact official exam simulation. The complete command results and remaining manual validation are recorded in the parent workspace `FINAL_HARDENING_REPORT.md`.
