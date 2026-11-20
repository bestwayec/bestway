# BESTWAY NEXT Stage 04 independent audit

2026-11-20 · Draft PRs · `feat/bestway-next-00-03`

| Gate | Status |
|---|---|
| STAGE 04 FEATURES | PARTIAL |
| SECURITY | PARTIAL |
| NATIVE ACCEPTANCE | PARTIAL |
| PRODUCTION READINESS | BLOCKED |

| Repository | Verified incoming PR head | Audited implementation commit |
|---|---|---|
| Backend and website [PR #206](https://github.com/bestwayec/bestway/pull/206) | `15e783fc40363d72c5987e30d9573be26c29fc67` | `b564742b2fe3723fea96f71a5331dc800f817457` |
| Desktop [PR #38](https://github.com/bestwayec/bw-tauri/pull/38) | `4b5c5a811ba77c033ab68acc780a19655e5ec1b8` | `39d1bc72ecad1545991d30bd48ac6c1e954b6a19` |

The backend PR also contains `06b74455e2a9d4a15ef3c148f07cc16a931def0d` for grading, offline sync and assignment validation. The PR commit and Checks pages identify the current reporting commit and the workflow results. Previous handoff references to `191b73f`, `e119b68`, runs `446649…`, and “100% complete” describe earlier evidence or unsupported claims. [Backend checks](https://github.com/bestwayec/bestway/pull/206/checks) · [Desktop checks](https://github.com/bestwayec/bw-tauri/pull/38/checks)

## Findings and repairs

| Prior claim or dependency | Baseline finding | Independent result |
|---|---|---|
| Real Writing and Speaking queue | **INCORRECT · P0**. The view used fields outside the question model and synthesized Writing entries. The desktop summed a limited page. | The server selects actual answers in their exam section, returns stable attempt/skill IDs, paginates the scoped skills, and supplies an independent total. Blank and unrelated rows produce no queue entry. |
| Skill grading and privacy | **INCORRECT · P0**. The new endpoint passed a skill item into the whole-attempt override, exposed storage keys and preliminary feedback, and lacked replay control. | The queue requires the exact question ID and writes its grade through the canonical grader under the attempt lock. A repeated grade gets 409. Protected answers route to the website review process. Student contact and raw media keys are omitted. |
| Staff access after transfer | **INCORRECT · P0**. Current-group authorization on older review, audio, override and monitoring paths could include work predating a recorded transfer. | Those paths reject pre-enrollment work when the transfer date is known. The new queue requires a current dated enrollment or an explicit class-owned assignment for undated legacy membership. Former classroom history retains its existing scoped read path. |
| Offline persistence and acknowledgements | **INCORRECT · P0**. Memory writes reported success, queue and progress were written separately, missing acknowledgements were inferred, and PostgreSQL accepted mutation IDs without receipts. | A single committed local record updates progress and pending edits. The server persists operation IDs and payload fingerprints in Django migration 0017. Replays preserve later writes, malformed batches roll back, and a reused ID with different content returns 409. |
| Download, reconnect and isolation | **PARTIAL · P1**. Snapshot lookup took a row lock outside a transaction. Cold startup lacked a downloaded-assignment list and cached data survived explicit sign-out. | The snapshot endpoint now has an atomic boundary. Durable downloads can be reopened when API access is unavailable. Network requests bind to the active account. Explicit logout clears the account’s offline vocabulary and warns that unsynced items will be discarded. Chromium verified restart, reconnect and receipt replay against PostgreSQL. |
| Assignments | **PARTIAL · P1**. Desktop catalog filtering could silently send a student to the general Exams screen. Website load errors rendered as an empty list. | Website and desktop resolve the exact assignment through an authenticated endpoint. Desktop rechecks before start. PostgreSQL coverage includes same-title exams of both types, unpublished exams, expired assignments, foreign students, and teacher denial. Website links saved result attempts by ID. |
| Unified student profile | **PARTIAL · P1**. The overlay lacked focus containment and could display previously cached history on reopen. | Native HTML dialog containment and focus restoration replace the overlay listener. The modal waits for fresh authorization and drops cached results on dismissal. |
| Classroom and vocabulary domain | **VERIFIED** for the tested scope. | PostgreSQL tests cover enrollment windows, transfer, archiving, teacher assignment, attendance, approved feedback, vocabulary snapshots, grading, export denial, and reporting over 126 synthetic learners. The website and desktop browser displayed the same real 30/30 result. |
| Native Speaking UX and whole-device sign-off | **INCORRECT / UNVERIFIED**. The original desktop waveform and playback controls were decorative. Physical acceptance was missing. | The misleading controls were removed. Protected review requires the established website flow. Linux runtime checks and hosted platform checks have separate rows below. |
| Localization and low-resource operation | **PARTIAL / UNVERIFIED**. | The website has English and Uzbek message catalogs. Several desktop screens still mix languages. Russian coverage, contrast across all widgets, and a physical 4 GB Windows run remain open. |

## Evidence

- Django `pytest -q -rs` passed 1,476 tests and 268 subtests. Four differential tests skipped because the local checkout lacked a compiled legacy NestJS distribution.
- The PostgreSQL grading regression exercised signed teacher, student, parent and admin identities, pagination, the protected-evidence boundary and two concurrent submissions. Exactly one request succeeded and one returned 409. An unrelated Speaking answer remained pending. The former student's new teacher received 403 on the legacy overview and override routes.
- The PostgreSQL classroom and vocabulary regressions verified restricted exports, scoped feedback, assignment eligibility for IELTS and Multilevel, signed SRS, a 126-learner report and replay after a second device changed the same word. Those tests use synthetic data and the Stage 01–03 ownership rules.
- Website TypeScript, ESLint, Vitest and a production build were exercised. Vitest passed 837 tests across 126 files and Next built 88 pages. An intermediate TypeScript failure from a button variant was corrected. The live browser teacher flow created a group, enrolled a student, published 30 words, assigned them and inspected the learner’s score. The browser SRS fixture did not establish that a newly added word was selected by that particular quiz.
- Desktop TypeScript and Vite build passed. Vitest passed 475 tests across 59 files. Rust check, 33 Rust tests and strict Clippy passed. The Chromium suite exercised secure exam recovery for Writing and Speaking and recovered vocabulary changes after closing the Chromium process.
- A separate real-backend browser test downloaded a vocabulary assignment through the UI, blocked API access, persisted an edit, closed and relaunched Chromium, checked another account’s namespace, and synchronized the original operation. A replay left the server revision unchanged.
- Local Prisma 5.22.0 could not download the official Debian OpenSSL 3 checksum. The request to `binaries.prisma.sh` returned HTTP 403. The hosted Django run for `06b7445` succeeded on Prisma deploy, Django migration, and the staged legacy upgrade with migration ledgers and row preservation. Use the same named steps on the final PR run. [Hosted migration evidence](https://github.com/bestwayec/bestway/actions/runs/44668409855/job/136063258237)

## Offline contract and privacy

IndexedDB transactions serialize concurrent writes and commit the progress and pending queue together. LocalStorage can save the same state as one value. Cross-window serialization in the fallback depends on Web Locks. Memory-only storage supports neither a download nor an offline-mutation success message. An older queue loads on first use, and a malformed queue raises an error. Server revisions prevent an older response from replacing newer confirmed state. Two distinct edits use server commit order. Every replay requires a matching receipt, and synchronized flashcard state cannot alter official grades.

A downloaded collection lives in ordinary WebView storage and in the operating-system profile. Another signed-in app account cannot open it through the normal app. Someone with access to the same OS profile can inspect local storage. If policy requires data-at-rest protection on a shared OS profile, use a per-user encryption key protected by Windows Credential Manager, Linux Secret Service, or the Android Keystore. Validate key availability, rotation, revocation and upgrade before introducing encryption. While disconnected, a client cannot learn that server access was revoked. An online denial removes an opened cached snapshot and preserves unacknowledged operations for diagnosis.

## Native matrix

| Platform | Result | Evidence and remaining verification |
|---|---|---|
| Linux Tauri and WebKitGTK | PARTIAL | A current bundled executable reached its native window and spawned the actual WebKit network and renderer processes in a confined Debian runtime. The bundled startup capture remained at the splash. Complete packaged sign-in, keyring restart and offline vocabulary in a supported Linux user session before accepting the package. |
| Windows hosted x64 | PARTIAL | Use the exact final Windows job for installer, launch and packaging evidence. Physical Windows 10/11, Credential Manager, update UI, audio, keyboard and 4 GB operation are UNVERIFIED. |
| Android hosted emulator | PARTIAL | Use the exact final Android job for APK and offline emulator behavior. Physical Android, hardware audio, secure storage and offline restart are UNVERIFIED. |
| Chromium | VERIFIED for recorded tests | The full browser suite and live PostgreSQL journeys cover the recorded behavior. |

## Remaining gates

1. **P0 · Migration and native launch.** Require the final backend Django run to pass the genuine Prisma deploy, Django migration and seeded upgrade steps. Reproduce the bundled Linux splash in a supported user session with WebKit diagnostics and finish login and recovery before accepting native delivery. Keep both PRs in draft while these release gates are open.
2. **P1 · Native acceptance.** On a Windows PC with about 4 GB RAM and a physical Android device, install the candidate, sign in, relaunch, switch accounts, inspect secure storage, open a classroom, author/assign vocabulary with a teacher account, download and study with the network disabled, restart and sync, test pronunciation and mute, resume an exam, test keyboard focus and the upgrade prompt. Record model, OS, application SHA and results per step.
3. **P1 · Grading and assignment workflows.** Run protected Speaking and handwritten Writing review end to end and check that authorized audio, official scoring and approved feedback remain tied to the correct student and question. Complete IELTS and Multilevel assigned launch, resume and exact result navigation in native clients. Decide whether the existing website whole-attempt override should be retired after its callers migrate to task review.
4. **P1 · Account and privacy coverage.** Run cross-tab and cross-device logout, expiry and revocation with the final client builds. Decide on shared-profile encryption and confirm revocation handling across restart. Record native offline download and mutation recovery from a real device.
5. **P2 · Accessibility and resource measurement.** Complete keyboard and screen reader coverage at 1366×768 and 1024×768, complete Uzbek/English and supported Russian strings, and bound resource use for CSV/XLSX and receipt growth on production-sized data.
6. **P3 · Documentation and replication.** Record the exact workflow run links and keep the native checklist tied to the tested build.

The PRs remain drafts. Stage 04 retains completed classroom, vocabulary and assessment functionality, with the above release gates open.
