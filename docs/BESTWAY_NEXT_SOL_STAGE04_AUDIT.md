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
| Desktop [PR #38](https://github.com/bestwayec/bw-tauri/pull/38) | `4b5c5a811ba77c033ab68acc780a19655e5ec1b8` | `d6dceea1e7ba8483ab4c304237d31222dfc0c74e` |

The backend PR also contains `06b74455e2a9d4a15ef3c148f07cc16a931def0d` for grading, offline sync and assignment validation. The desktop repairs are in `39d1bc72ecad1545991d30bd48ac6c1e954b6a19`, `8b319dfc17d551c6fd08f8938b35792e2d1eac3d`, `f0fdf1eb075359b71c67605b3ba0ff6a305d56ea`, `70db27fc1fa78bcf936d6b7767dd59ff832c9753` and the final desktop commit above. The PR commit and Checks pages identify the current reporting commit and the workflow results. Previous handoff references to `191b73f`, `e119b68`, runs `446649…`, and “100% complete” describe earlier evidence or unsupported claims. [Backend checks](https://github.com/bestwayec/bestway/pull/206/checks) · [Desktop checks](https://github.com/bestwayec/bw-tauri/pull/38/checks)

## Findings and repairs

| Prior claim or dependency | Baseline finding | Independent result |
|---|---|---|
| Real Writing and Speaking queue | **INCORRECT · P0**. The view used fields outside the question model and synthesized Writing entries. The desktop summed a limited page. | The server selects actual answers in their exam section, returns stable attempt/skill IDs, paginates the scoped skills, and supplies an independent total. Blank and unrelated rows produce no queue entry. |
| Skill grading and privacy | **INCORRECT · P0**. The new endpoint passed a skill item into the whole-attempt override, exposed storage keys and preliminary feedback, and lacked replay control. | The queue requires the exact question ID and writes its grade through the canonical grader under the attempt lock. A repeated grade gets 409. Protected answers route to the website review process. Student contact and raw media keys are omitted. |
| Staff access after transfer | **INCORRECT · P0**. Current-group authorization on older review, audio, override and monitoring paths could include work predating a recorded transfer. | Those paths reject pre-enrollment work when the transfer date is known. The new queue requires a current dated enrollment or an explicit class-owned assignment for undated legacy membership. Former classroom history retains its existing scoped read path. |
| Offline persistence and acknowledgements | **INCORRECT · P0**. Memory writes reported success, queue and progress were written separately, missing acknowledgements were inferred, and PostgreSQL accepted mutation IDs without receipts. | A single committed local record updates progress and pending edits. The server persists operation IDs and payload fingerprints in Django migration 0017. Replays preserve later writes, malformed batches roll back, and a reused ID with different content returns 409. |
| Download, reconnect and isolation | **PARTIAL · P1**. Snapshot lookup took a row lock outside a transaction. Cold startup lacked a downloaded-assignment list and cached data survived explicit sign-out. | The snapshot endpoint now has an atomic boundary. Durable downloads can be reopened when API access is unavailable. Network requests bind to the active account. Explicit logout clears the account’s offline vocabulary and warns that unsynced items will be discarded. Chromium verified restart, reconnect and receipt replay against PostgreSQL. |
| Assignments | **PARTIAL · P1**. Desktop catalog filtering could silently send a student to the general Exams screen. Website load errors rendered as an empty list. | Website and desktop resolve the exact assignment through an authenticated endpoint. Desktop rechecks before start. PostgreSQL coverage includes same-title exams of both types, unpublished exams, expired assignments, foreign students, and teacher denial. Website links saved result attempts by ID. Live IELTS and Multilevel fixtures opened the assigned exams in both browser clients. The desktop reads the exact exam instead of querying the active-track catalog. |
| Student dashboard | **INCORRECT · P1**. The displayed “learning streak” came from attempt count plus two days. The classroom widget used fields absent from the stored session, so a real enrolled learner appeared unassigned. Attendance cache keys lacked an account ID. | Exam metrics use loaded data and display unavailable states on failure. The classroom widget reads the authorized student roster endpoint with retry. Attendance caches are keyed by account. |
| Browser account change | **PARTIAL · P1**. A browser tab could keep the previous signed-in view after logout in another tab. | A credential-free storage event invalidates the other tab’s session and clears its authenticated view. The backend regression separately proves refresh-family revocation and independent sessions on separate devices. |
| Unified student profile | **PARTIAL · P1**. The overlay lacked focus containment and could display previously cached history on reopen. | Native HTML dialog containment and focus restoration replace the overlay listener. The modal waits for fresh authorization and drops cached results on dismissal. Real Chromium interaction confirmed focus containment and restoration at 1366×768 and 1024×768. |
| Classroom and vocabulary domain | **VERIFIED** for the tested scope. | PostgreSQL tests cover enrollment windows, transfer, archiving, teacher assignment, attendance, approved feedback, vocabulary snapshots, grading, export denial, and reporting over 126 synthetic learners. The website and desktop browser displayed the same real 30/30 result. |
| Native Speaking UX and whole-device sign-off | **INCORRECT / UNVERIFIED**. The original desktop waveform and playback controls were decorative. Physical acceptance was missing. | The misleading controls were removed. Protected review requires the established website flow. Linux runtime checks and hosted platform checks have separate rows below. |
| Localization and low-resource operation | **PARTIAL / UNVERIFIED**. | The website has English and Uzbek message catalogs. Several desktop screens still mix languages. Russian coverage, contrast across all widgets, and a physical 4 GB Windows run remain open. |

## Evidence

- Django `pytest -q -rs` passed 1,476 tests and 268 subtests. Four differential tests skipped because the local checkout lacked a compiled legacy NestJS distribution.
- The PostgreSQL grading regression exercised signed teacher, student, parent and admin identities, pagination, the protected-evidence boundary and two concurrent submissions. Exactly one request succeeded and one returned 409. An unrelated Speaking answer remained pending. The former student's new teacher received 403 on the legacy overview and override routes.
- The PostgreSQL classroom and vocabulary regressions verified restricted exports, scoped feedback, assignment eligibility for IELTS and Multilevel, signed SRS, a 126-learner report and replay after a second device changed the same word. Those tests use synthetic data and the Stage 01–03 ownership rules.
- Website TypeScript, ESLint, Vitest and a production build were exercised. Vitest passed 837 tests across 126 files and Next built 88 pages. An intermediate TypeScript failure from a button variant was corrected. The live browser teacher flow created a group, enrolled a student, published 30 words, assigned them and inspected the learner’s score. The browser SRS fixture did not establish that a newly added word was selected by that particular quiz.
- Desktop TypeScript and Vite build passed. Vitest passed 476 tests across 59 files. Rust check, 33 Rust tests and strict Clippy passed. Seven Chromium tests passed, covering Writing and Speaking recovery, a real Chromium process restart, cross-tab logout, classroom data and an assignment outside the active catalog track. An earlier browser run disconnected before the lazy dashboard bundle loaded. The regression now waits for the dashboard before disconnecting.
- A separate real-backend browser test downloaded a vocabulary assignment through the UI, blocked API access, persisted an edit, closed and relaunched Chromium, checked another account’s namespace, and synchronized the original operation. A replay left the server revision unchanged.
- Local Prisma 5.22.0 could not download the official Debian OpenSSL 3 checksum. The request to `binaries.prisma.sh` returned HTTP 403. The hosted Django run for `06b7445` succeeded on Prisma deploy, Django migration, and the staged legacy upgrade with migration ledgers and row preservation. A subsequent hosted run on `25f109b` passed the same three named steps. Use the final PR check for the reporting commit. [Subsequent migration evidence](https://github.com/bestwayec/bestway/actions/runs/44669399043/job/136066470658) [Hosted migration evidence](https://github.com/bestwayec/bestway/actions/runs/44668409855/job/136063258237)

## Offline contract and privacy

IndexedDB transactions serialize concurrent writes and commit the progress and pending queue together. LocalStorage can save the same state as one value. Cross-window serialization in the fallback depends on Web Locks. Memory-only storage supports neither a download nor an offline-mutation success message. An older queue loads on first use, and a malformed queue raises an error. Server revisions prevent an older response from replacing newer confirmed state. Two distinct edits use server commit order. Every replay requires a matching receipt, and synchronized flashcard state cannot alter official grades.

A downloaded collection lives in ordinary WebView storage and in the operating-system profile. Another signed-in app account cannot open it through the normal app. Someone with access to the same OS profile can inspect local storage. If policy requires data-at-rest protection on a shared OS profile, use a per-user encryption key protected by Windows Credential Manager, Linux Secret Service, or the Android Keystore. Validate key availability, rotation, revocation and upgrade before introducing encryption. While disconnected, a client cannot learn that server access was revoked. An online denial removes an opened cached snapshot and preserves unacknowledged operations for diagnosis.

## Native matrix

| Platform | Result | Evidence and remaining verification |
|---|---|---|
| Linux Tauri and WebKitGTK | PARTIAL | Actual Tauri/WebKitGTK development-mode sign-in reached the student dashboard and opened assigned flashcards against Django/PostgreSQL. The app downloaded the snapshot and sent a real flashcard mutation that the server acknowledged. The bundled executable spawned its native WebKit processes and remained at the splash in the same container. Complete packaged sign-in, keyring restart and offline vocabulary before accepting the package. |
| Windows hosted x64 | PARTIAL | The Windows workflow installs and launches the candidate installer on a hosted runner. Physical Windows 10/11, Credential Manager, update UI, audio, keyboard and 4 GB operation are UNVERIFIED. |
| Android hosted emulator | PARTIAL | The Android workflow installs and launches the candidate APK offline on an emulator. Physical Android, hardware audio, secure storage and offline restart are UNVERIFIED. |
| Chromium | VERIFIED for recorded tests | The full browser suite and live PostgreSQL journeys cover the recorded behavior. |

## Remaining gates

1. **P0 · Migration and native launch.** Require the final backend Django run to pass the genuine Prisma deploy, Django migration and seeded upgrade steps. Reproduce the bundled Linux splash in a supported user session with WebKit diagnostics and finish login and recovery before accepting native delivery. Keep both PRs in draft while release gates are open.
2. **P1 · Native acceptance.** On a Windows PC with about 4 GB RAM and a physical Android device, install the candidate, sign in, relaunch, switch accounts, inspect secure storage, open a classroom, author/assign vocabulary with a teacher account, download and study with the network disabled, restart and sync, test pronunciation and mute, resume an exam, test keyboard focus and the upgrade prompt. Record model, OS, application SHA and results per step.
3. **P1 · Grading and assignment workflows.** Run protected Speaking and handwritten Writing review end to end and check that authorized audio, official scoring and approved feedback remain tied to the correct student and question. Extend the verified browser opening of both exam types to native start, resume and exact result navigation. Decide whether the existing website whole-attempt override should be retired after its callers migrate to task review.
4. **P1 · Account and privacy coverage.** Extend the verified browser cross-tab logout and PostgreSQL expiry, revocation and independent-device tests to physical clients and account switching. Decide on shared-profile encryption and confirm revocation handling across restart. Record native offline download and mutation recovery from a real device.
5. **P2 · Accessibility and resource measurement.** Extend the verified profile focus behavior at 1366×768 and 1024×768 to all widgets and screen readers, complete Uzbek/English and supported Russian strings, and bound resource use for CSV/XLSX and receipt growth on production-sized data.
6. **P3 · Documentation and replication.** Record the exact workflow run links and keep the native checklist tied to the tested build.

The PRs remain drafts. Stage 04 retains completed classroom, vocabulary and assessment functionality, with the above release gates open.

## Final release blocker remediation

The existing branches entered remediation at backend `3565af26b158039b387e618f065f722aebdf50f4` and desktop `d6dceea1e7ba8483ab4c304237d31222dfc0c74e`. The fixes are backend `0bb341de7809cfad17ec7c8cfefd6451c3429680` and desktop `0bf52760dd76504bfc73d0c511ca5fd7683bc6fc`. This section supersedes the earlier open items for protected grading and the packaged Linux splash. [Backend PR checks](https://github.com/bestwayec/bestway/pull/206/checks) · [Desktop PR checks](https://github.com/bestwayec/bw-tauri/pull/38/checks)

### Installed Linux

An installed baseline Debian bundle configured with `http://localhost:3104/v1` reproduced the splash hang. Production API-origin validation threw while JavaScript modules loaded, before React could mount. The packager now validates the same configuration before bundling. An early startup handler also renders a reload screen if the frontend fails to initialize. The invalid bundle configuration was rejected after the fix.

An installed 1.0.12 Debian bundle with production Vite assets and a debug Rust build ran in an isolated WebKitGTK desktop session. The disposable Django and PostgreSQL fixture used a trusted test CA and HTTPS on port 443. Student login, assigned vocabulary download, an edit with backend access cut, process termination, Secret Service session restoration, reopening the download with one pending edit, and manual retry after reconnection all passed. Django returned HTTP 200 for the sync and the UI cleared the pending edit. The restarted app had no session fallback file. Optimized signed build acceptance, native audible pronunciation, updater, and the complete native exam journey remain UNVERIFIED.

### Protected assessments

Handwriting originals, including legacy page keys, now require authenticated attempt, question and page authorization. New uploads also verify that the student owns the open Writing attempt and that the question belongs to its Writing section. Speaking playback resolves the recording attached to the exact review job and supports browser HTTP ranges. Private responses disable shared caching. The legacy whole-attempt grading path cannot bypass unfinished skill review jobs. Canonical review records retain the original media links and publish approved feedback.

The Django PostgreSQL fixture submitted a handwritten page and a playable WAV and checked owner and foreign access, legacy media denial, exact question and attempt scope, and versioned review. Two concurrent reviews produced one successful write and one conflict. Replays conflicted. Speaking scored 6 while Writing remained pending. The authorized Writing review scored 7 and finalized the result with approved feedback. Chromium decoded the protected image, advanced audio playback using HTTP 206, submitted both teacher review forms, and checked the student result. An external OCR provider was simulated with an empty result to exercise the manual review path.

Django passed 1,476 tests and 268 subtests, with four legacy NestJS differential checks skipped because the compiled distribution was unavailable. Website TypeScript and lint passed, and Vitest passed 837 tests across 126 files. Desktop Vitest passed 476 tests. See the PR checks for hosted builds and migration evidence.

### Native device and data-at-rest sign-off

| Platform | Verified | Unverified |
|---|---|---|
| Linux WebKitGTK | Installed Debian package, HTTPS login, Secret Service restore, download, offline edit, restart, reconnect and server acknowledgement. | Optimized signed release distribution, audible pronunciation, native exam recovery and updater. |
| Windows x64 | Hosted NSIS build and checksum, clean install, launch, WebView2 child process and startup working-set measurement. | Physical Windows 10/11 session restore, offline vocabulary, audio and mute, exam recovery, signed updater, and sustained memory measurements on a 4 GB device. |
| Android | Hosted build and offline emulator installation and launch. | Signed-in device workflows, Android secure storage, offline progress across process death, audio, exam recovery and physical hardware. |

Offline vocabulary, progress and pending edits are ordinary WebView IndexedDB records with a LocalStorage fallback, scoped to the Bestway account. The application applies no encryption to either store. Sign-out purges the account’s data through the application. That deletion does not guarantee forensic erasure. Separate Windows users receive OS profile isolation. People sharing one Windows account can access the same WebView profile, and the OS credential store for authentication is separate from the vocabulary cache. The session component can fall back to a profile-local JSON file when its platform store fails. Hosted Windows and Android launch evidence does not establish secure storage for a real interactive account.

Use separate Windows profiles for shared PCs. If the owner requires data-at-rest isolation among people sharing a profile, hold offline deployment on those profiles until an implementation meets that requirement. A design would use a randomly generated key per Bestway account, authenticated encryption for snapshots and queues, OS-protected key wrapping on Windows, and an independent per-person unlock or an OS account boundary. Credential Manager or DPAPI under a common Windows user alone does not establish the per-person boundary. Verify unlock after a disconnected restart, denial from another Bestway account and ordinary processes on the same profile, logout and revocation behavior, rotation, and recovery of unsynced data before enabling it. No such vault is implemented. [Native acceptance checklist](https://github.com/bestwayec/bw-tauri/blob/b0443fd1b98f9f7fee28e8c4b508fea07ed13034/docs/BESTWAY_NEXT_NATIVE_ACCEPTANCE.md) · [Hosted Windows installation](https://github.com/bestwayec/bw-tauri/actions/runs/44673585076/job/136080019555) · [Hosted Android installation](https://github.com/bestwayec/bw-tauri/actions/runs/44673584883/job/136080019778)

Stage 04 remains PARTIAL and production readiness remains BLOCKED pending the physical and release-candidate checks and the shared-profile policy. [Current release gates](BESTWAY_NEXT_RELEASE_GATES.md)
