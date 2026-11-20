# BESTWAY NEXT Stage 05 test matrix

## Local and hosted evidence

| Area | Reproduction | Evidence |
|---|---|---|
| Protected assessment | Run `python scripts/verify_teacher_submissions_postgres.py` and `python scripts/verify_grading_consistency_postgres.py` in a disposable migrated PostgreSQL environment | Role and ownership scope, guarded media, separate scores, proposal privacy, rollback, concurrent review conflict, approved feedback and compact queue totals |
| Migrations | Use the backend PR Django job. Inspect the pinned Prisma deployment, Django migrations, authoritative ledger and populated legacy upgrade steps | Use the exact backend commit on the Checks page |
| Website | `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` in `frontend` | 837 Vitest tests across 126 files on the workspace implementation. The hosted job repeats full regression |
| Desktop | `npm run build`, `npm test` and the CI Rust and Windows jobs | 476 Vitest tests across 59 files. Hosted jobs exercise Rust, Chromium exam recovery, and NSIS build and launch |
| Android OAuth | `gradle -p android :app:testReleaseUnitTest :app:assembleRelease` and the Android job | Kotlin tests cover the envelope and cookie flags. The parser also consumed a genuine signed PKCE exchange response from disposable Django/PostgreSQL. The local backend rejected an off-origin redirect and a repeated code. Hosted emulator exercises installation and offline launch |
| Linux package | Follow the desktop checklist against a disposable HTTPS Django API | Installed Debian package completed sign-in, offline download, a saved operation across process death, Secret Service restoration, and a server-confirmed sync |
| Browser classroom and learning | In a disposable website and desktop session, search the group list, open the classroom and its roster, open assigned vocabulary, and check flashcards | Use 1024×768, 1366×768, 1440×900 and 1920×1080. Include 390 px mobile on website. Keep screenshots synthetic |
| Dashboard request count | Use a teacher with 35 groups and count distinct `/api/backend/` paths during Chromium dashboard navigation and the viewport checks | 57 before grouped attendance and 23 after. The attendance integration checks foreign roles and archived classes |
| Physical devices and Windows memory | Follow the owner checklist for Windows 10/11 near 4 GB and a supported Android device | UNVERIFIED for authenticated flows, sustained memory, device audio, Android session storage behavior, and signed Windows updates |

[Backend checks](https://github.com/bestwayec/bestway/pull/206/checks) · [Desktop checks](https://github.com/bestwayec/bw-tauri/pull/38/checks) · [Owner acceptance](https://github.com/bestwayec/bw-tauri/blob/feat/bestway-next-00-03/docs/BESTWAY_NEXT_NATIVE_ACCEPTANCE.md)
