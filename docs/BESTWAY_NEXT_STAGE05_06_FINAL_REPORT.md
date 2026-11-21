# BESTWAY NEXT — Stage 05 completion and Stage 06 hardening: final report

Session 2026-11-21. Evidence for every claim is in
[`BESTWAY_NEXT_STAGE06_TEST_MATRIX.md`](BESTWAY_NEXT_STAGE06_TEST_MATRIX.md) and the desktop
[`docs/BESTWAY_NEXT_STAGE06_NATIVE_ACCEPTANCE.md`](https://github.com/bestwayec/bw-tauri/blob/feat/bestway-next-stage05-completion/docs/BESTWAY_NEXT_STAGE06_NATIVE_ACCEPTANCE.md).
Owner steps: [`BESTWAY_NEXT_OWNER_MERGE_CHECKLIST.md`](BESTWAY_NEXT_OWNER_MERGE_CHECKLIST.md).

## Repository delivery

| | bestway (web + Django) | bw-tauri (desktop + Android) |
| --- | --- | --- |
| Branch | `feat/bestway-next-stage05-completion` | `feat/bestway-next-stage05-completion` |
| PR | [#207](https://github.com/bestwayec/bestway/pull/207) | [#39](https://github.com/bestwayec/bw-tauri/pull/39) |
| Base of this session | `9d9ff0f` (verified remote head) | `146e1d0` (verified remote head) |
| Commits this session | `161b7fc`, `4e8584c`, `db2f25a`, `3e50f47`, `b7d0c33`, `150a317`, `29dda3f`, + docs commit | `8cf17a8`, `83fd6ac`, + docs commit |

## Phase A — recovered baseline and Gemini audit

### A2. Windows Rust CI failure (P0) — fixed

`session::tests::native_session_survives_new_credential_entry_and_load` failed with `NoEntry` on
`146e1d0` but passed on `cf645e4` with an identical `session.rs`: an intermittent failure, not a
deterministic product defect. Causes addressed:

1. **Test isolation (confirmed contributing):** tests that write the real OS credential store ran in
   parallel (keyring documents concurrent access as undefined), and fixture ids used wall-clock
   nanoseconds only. All credential-store tests now hold a crate-level test lock for the fixture's
   whole life (including cleanup), and fixture ids include a process-wide sequence.
2. **Production hardening:** the file fallback was deleted as soon as `set_password` returned `Ok`.
   A store that acknowledges a write but does not return it to a fresh handle would lose the rotated
   refresh token at next launch. The fallback is now removed only after a fresh-handle read-back
   matches; otherwise the session is written to the restricted file store.

The test was not disabled or skipped. Windows CI passed on `8cf17a8`
([run 44872565399](https://github.com/bestwayec/bw-tauri/actions/runs/44872565399)). One green run
of a previously intermittent test is supporting, not conclusive, evidence; later pushes re-run it.

### A3. Gemini additions — defects found and fixed

| Area | Defect | Fix |
| --- | --- | --- |
| Desktop assignments widget | `score_percent: null` rendered "Bajarildi (null%)"; empty list said "all completed"; tabs had no arrow-key navigation/tabpanel; vocabulary deep link survived an account switch | fixed + jsdom tests that click and key through the component (the previous "interactive" tests were static markup only) |
| Web transfer dialog | hardcoded Uzbek in a localized view; archived groups offered as targets; selection reset on every refetch; unlabeled select; mock-only backend tests | extracted `StudentTransferDialog` (uz/en, labelled, archived excluded, empty state, server refusal kept open) + jsdom tests; **real PostgreSQL** proof of cross-teacher 403 and single open enrollment |
| Web student dashboard | an enrolled student with no assignments was told "You are not in a group yet", offered an invite code and shown "All assignments are done" | widget now uses the authenticated profile's group |
| Web header | "Free level assessment" button opened registration | now opens the placement test |

## Stage 05

| Item | Status | Evidence / notes |
| --- | --- | --- |
| Public homepage | **Done** | tighter hero, exam-window frame, IELTS/Multilevel formats section, honest placement/demo-data notes, student vs. teacher section, accessible FAQ, closing CTA; 0 axe violations; screenshots `docs/screenshots/stage05/` |
| Design system | Partial | used existing semantic tokens only (`design-system.spec.ts` passes); no competing system added. Desktop primitives from Gemini kept. Full cross-app migration not done |
| Student workspace | Partial | enrollment-aware assignments fixed on web; single shared assignments fetch (8 → 7 requests); English deadline label no longer hardcoded Uzbek; desktop widget fixed. Remaining items (attendance, schedule, offline, resume) pre-existed from Stage 04 and were exercised only by the journeys listed |
| Teacher command center | Partial | dashboard request de-duplicated (12 → 11); existing KPI/queue/payment cards verified rendering against real data |
| Classroom management | Partial | transfer hardened and verified on PostgreSQL; other actions pre-existing and covered by `verify_classroom_postgres.py` |
| Vocabulary Studio | **Improved** | CSV/TSV/TXT import (web + desktop), duplicate detection matching the server rule, safer server parsing of hyphenated words, no silent local fallback on server refusal; cross-client web→desktop parity PASS on real Django |
| Exams & results UX | Not changed | secure engine untouched; exact-ID launch verified in code review |
| Localization | Partial | all new strings uz/en; desktop still uses bilingual "Uz / En" button labels in study views |
| Accessibility | Partial | axe on public pages 0 violations; keyboard tests for tabs/FAQ; no assistive-technology session |
| Performance | Measured | see below |

## Stage 06

| Area | Verdict | Evidence |
| --- | --- | --- |
| Backend tests + migrations | PASS | pytest 1485 passed; 15 PostgreSQL verification scripts; ledger + upgrade scripts |
| Security (authz, isolation, exports) | PASS for tested boundaries | student 403 on users / member-history / add-student / teacher vocabulary report; anonymous 401; cross-teacher transfer 403; logout purges account offline vocabulary (desktop) |
| Website build + E2E | PASS | tsc, lint (0 errors), 854 Vitest, prod build, Playwright journeys |
| Desktop software | PASS | tsc, 493 Vitest, 50 tool tests, Vite build, 33 Rust tests (Linux), strict clippy; Windows CI with NSIS install+launch |
| Windows native (physical, 4 GB) | UNVERIFIED | no hardware in this session |
| Linux packaged | Not re-run | prior evidence in `BESTWAY_NEXT_NATIVE_ACCEPTANCE.md` |
| Android emulator | CI only | `CI` workflow android job green on `8cf17a8` |
| Signed release | BLOCKED (by design) | requires owner-held signing keys |

## Actual performance measurements

- Desktop bundle (Vite prod): `main` 211.6 KB (66.1 KB gzip), `vendor-react` 190.0 KB (58.4 KB gzip),
  `vendor-three` 902.3 KB (240.7 KB gzip, lazy and skipped on ≤4 GB devices per Stage 03).
- Web API requests on a fresh dashboard tab (production build, local Django, 3 runs each): teacher
  11 (was 12), student 7 (was 8); classroom page 10.
- Memory/startup on a 4 GB Windows PC: not measured this session.

## Remaining work

| Pri | Repo / file | Action | Acceptance |
| --- | --- | --- | --- |
| P1 | bw-tauri / native | Physical Windows 10 4 GB run of the native checklist | all cases PASS with recorded working-set numbers |
| P1 | bw-tauri / Android | authenticated journey on device; signing certificate continuity | login, vocab offline/sync, exam recovery PASS; same signer as published app |
| P1 | bestway `frontend/package.json` | Next.js 16.4.6 upgrade | full CI + homepage/journey re-run green |
| P2 | bw-tauri `src/pages/Vocabulary.tsx` | single-language labels via the desktop i18n layer | no "Uz / En" pairs in student study view |
| P2 | bestway `frontend` | screen-reader pass of study view and exam window | issues logged and fixed |
| P3 | both | XLSX import (needs a reviewed parser dependency) | xlsx files import with the same validation |

## Final verdict

- STAGE 05 FEATURES: **PARTIAL**
- STAGE 06 SOFTWARE QA: **PASS** (software gates) / native items open
- SECURITY: **PARTIAL** (tested boundaries pass; no external pentest; Next.js advisory pending)
- NATIVE ACCEPTANCE: **PARTIAL** (CI install/launch only; physical devices UNVERIFIED)
- PR REVIEW: **READY** for owner code review once final-HEAD CI is green
- PRODUCTION RELEASE: **BLOCKED** (physical-device and signing gates)
