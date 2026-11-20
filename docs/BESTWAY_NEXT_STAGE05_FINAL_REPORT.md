# BESTWAY NEXT Stage 05 owner review

Both pull requests use `feat/bestway-next-00-03`. Work resumed at backend `67accb6e295ca9a9c9b8c267fb01dbfa11c1b480` and desktop `b0443fd1b98f9f7fee28e8c4b508fea07ed13034`. The pre-existing edits in the separate Bestway checkout were preserved. The PR commit and Checks pages record the delivery revisions and conclusions. [Backend PR #206](https://github.com/bestwayec/bestway/pull/206) · [Desktop PR #38](https://github.com/bestwayec/bw-tauri/pull/38)

## Stage 04

Protected Speaking and Writing were exercised in Django/PostgreSQL and Chromium. Authorized review rendered the handwriting and played the recording. A foreign teacher received 403, one concurrent write succeeded and one conflicted, and approved scores and feedback remained skill-specific. Empty OCR output left the original available for manual review. The packaged Linux candidate passed HTTPS and offline recovery. The Android repair handles the real Django exchange envelope and sets the website’s Secure, HttpOnly, SameSite=Lax cookies. The emulator smoke exercises offline launch. Authenticated Android device behavior remains UNVERIFIED.

Offline vocabulary uses account-scoped IndexedDB, with LocalStorage as a fallback. Logout purges the application’s records. Use separate OS profiles where several people use the same Windows PC. The application does not encrypt that cache within the WebView profile. Official grades remain server-authoritative.

## Stage 05

| Area | Feature status | Implemented and remaining work |
|---|---|---|
| Design system | PARTIAL | Refined shared website header, semantic control sizing and focus, and desktop surface and control primitives. Remaining legacy components need migration. |
| Student dashboard | PARTIAL | Present current classroom, assigned work and study actions earlier. Provide a resume shortcut, and keep failed website score and catalog queries distinct from an empty result. |
| Teacher dashboard | PARTIAL | Search classrooms, show compact server-counted queue previews, and open the selected desktop classroom directly. Website mounts group cards progressively. Unified assignment and attendance scheduling still needs owner acceptance. |
| Classroom management | PARTIAL | Search enrolled students and render bounded rosters on both clients. Direct section links reduce navigation. Website analytics load on demand. Existing assignment, attendance, membership and history endpoints are retained. |
| Vocabulary | PARTIAL | The website filter fits narrower viewports. Desktop flashcard controls expose pending and selected states, and Studio has collection search. Full authoring and history redesign is open. |
| Exam and results | PARTIAL | Add clear study and resume shortcuts and pressed track states. Existing secure timers, authorization and recovery remain in place. Broader exam analytics presentation is open. |
| Responsiveness and accessibility | PARTIAL | Focus styling, target sizes, text wrapping and reduced motion in touched screens. Full assistive technology and mobile-device testing is open. |
| Localization | PARTIAL | New website workspace strings are in English and Uzbek. Desktop additions use existing preference or bilingual labels. Older English and Uzbek fragments remain. |
| Performance | PARTIAL | Compact five-row previews, bounded roster rendering, on-demand analytics and fewer decorative route animations. The website teacher fixture with 35 groups went from 57 to 23 distinct browser API paths during dashboard navigation and viewport checks. One scoped attendance aggregate replaces per-classroom requests. This is a request-count comparison in Chromium development mode. Validate production cold startup, vocabulary latency and sustained memory on a representative 4 GB Windows PC. |
| Visual consistency | PARTIAL | Common semantic color, heading, control, and status choices established. Older desktop and website screens remain on legacy patterns. |

## Owner checklist

1. Check the confirmed revisions and required hosted jobs on both PRs. Inspect the Django migration step outcomes and the staged synthetic row-preservation test.
2. Use the same disposable accounts for the website and desktop. Verify the dashboard and exact classroom navigation, membership, attendance, published assignment, issued vocabulary, protected review and reports.
3. Run the owner native checklist and confirm whether offline study may ship on shared OS profiles. Require the protected session behavior on a staged Android build and the signed updater on Windows.
4. After approval, deploy the backend and website before desktop and Android. The compact queue query is additive and leaves the existing full response available. The clients tolerate an older backend's full queue response. The Android client uses the website’s current session cookie contract.
5. Roll back the client first if there is an incompatibility. Preserve stored attempts, media, pending operations, and migration ledgers. Keep the protected media access fix in any backend rollback and repeat the PostgreSQL suite before approving an alternate revision.

## Remaining work and gates

| Priority | Repository and module | Required acceptance |
|---|---|---|
| P0 release | Both repositories, hosted CI | Require the exact backend migration ledger and both final check sets to pass. |
| P1 | Desktop, Linux Tauri installer and Windows NSIS updater | Verify the signed candidates, device audio, interrupted exam and Windows update outside an exam using the owner test environment. |
| P1 | Desktop Android wrapper, `MainActivity.kt` | Provide approved staging website and API origins. Perform login, refresh, restart, logout, account change, audio and recovery on supported physical Android. Record actual WebView data-at-rest behavior. |
| P1 | Desktop WebView offline store | Choose separate Windows profiles or validate an independent per-user key strategy before enabling offline data for people sharing one OS account. |
| P2 | Both workspace clients | Complete outstanding accessibility, localization and screenshot coverage. Measure 4 GB memory and the complete dashboard and vocabulary request paths on supported hardware. |
| P3 | Both workspace clients | Complete remaining visual migration after product owner review. |

Stage 04 features are PARTIAL with the physical acceptance items open. Stage 05 features are PARTIAL. Security and native acceptance are PARTIAL. The PRs remain draft while the remaining review scenarios are open. Production release is BLOCKED.

[Design system](BESTWAY_NEXT_STAGE05_DESIGN_SYSTEM.md) · [Test matrix](BESTWAY_NEXT_STAGE05_TEST_MATRIX.md) · [Release gates](BESTWAY_NEXT_RELEASE_GATES.md)
