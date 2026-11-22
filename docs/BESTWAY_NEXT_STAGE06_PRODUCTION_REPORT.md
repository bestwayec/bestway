# BESTWAY NEXT — Stage 06 production report

Session 2026-11-21. Desktop release detail: bw-tauri
`docs/BESTWAY_NEXT_STAGE06_RELEASE_VERIFICATION.md`. Feature status:
`BESTWAY_NEXT_STAGE05_FINAL_COMPLETION.md`.

## Final status

| | Status |
| --- | --- |
| STAGE 05 | **PARTIAL** |
| STAGE 06 (software QA) | **PASS** for every automated and local real-backend gate run; native/physical gates open |
| SECURITY | **PARTIAL** — P0 token storage fixed and verified; live authorization probe all denied; no external pentest; Next.js advisory pending |
| NATIVE ACCEPTANCE | **PARTIAL** — hosted Windows install/launch and Android emulator only; physical devices UNVERIFIED |
| MERGE | **BLOCKED** — release precheck gates 8–11 (signing credentials, Android signer continuity, updater signature of a new build, notarized/Authenticode artifacts) cannot pass |
| PRODUCTION DEPLOYMENT | **BLOCKED** — deploy runs from `main` after merge |
| RELEASE | **BLOCKED** — not tagged, not published |

The owner authorized merge and release only after all mandatory gates pass. They do not, so no merge,
deployment, tag or release was performed. Both PRs remain open, green and ready for review.

## Security findings and fixes (this round)

| Finding | Severity | Fix / status |
| --- | --- | --- |
| Desktop wrote access + refresh tokens to plaintext `session.json` when the OS credential store failed | P0 | Fixed in bw-tauri `c3ec47b`: OS store only, read-back verified, memory-only otherwise, legacy file migrated and deleted; Windows native test green |
| Published v1.0.12 `latest.json` lists only `darwin-x86_64` | P1 (release) | Root cause already fixed in the current workflow (single manifest writer, all platforms required); 1.0.12 Windows/Linux/arm64 users need a manual upgrade |
| macOS releases ad-hoc signed, not notarized; Windows NSIS not Authenticode-signed | P1 (release) | Owner must provide credentials and wire signing; blocks a complete stable release |
| Browser-only desktop fallback derives its AES key from a stored device id | P3 (dev/browser mode only) | Documented; not used by the Tauri app |
| Next.js GHSA-h694-7cp9-m8p3 (nested `'use cache'`) | P1 (not exploitable here) | Not used by the app; framework bump left to owner |

Live cross-account probe on a disposable seeded database
(`backend-django/scripts/verify_cross_account_local.py`):

```
B reads A attempt 403 · B claims/releases A session 404 · B reveals A answer 404 · B writes A annotations 404
B streams A speaking audio 403 · B writing page of A 403 · B speaking upload to A 404 · B certificate of A 403
B teacher-grade A 403 · B reads user A 403 · unlinked parent reads user A 403
A force-submit own 403 · A extends own time 403 · A reads own attempt 200 · reuse revoked refresh 401
```

## Test evidence

| Suite | Result |
| --- | --- |
| Django `pytest` (disposable PostgreSQL, CI env) | 1486 passed, 4 skipped (legacy NestJS dist absent), re-run at the end of this session |
| PostgreSQL verification scripts (15) incl. legacy upgrade, Prisma ledger | PASS |
| Website `tsc`, ESLint, Vitest, production build | PASS — 130 files / 858 tests, 0 lint errors |
| Website responsive sweep | 77 combinations, 0 overflow |
| Website accessibility (axe-core wcag2a/aa/21aa, public pages) | 0 violations |
| Desktop `tsc`, Vitest, Vite build | PASS — 65 files / 498 tests |
| Rust `cargo test --lib` / strict Clippy | 40 passed / clean (Linux); Windows native via CI |
| Cross-client vocabulary acceptance (real Django) | PASS — exactly-once sync, same 100% score on web and desktop paths |
| Hosted CI | all completed runs on both PR heads green (see PR checks) |

## Performance (measured)

- Teacher dashboard first load: 11 API requests (was 12), no duplicate endpoint (3/3 runs).
- Student dashboard first load: 7 API requests (was 8), no duplicate endpoint (3/3 runs).
- Desktop bundle (gzip): main ≈ 66 KB, React ≈ 58 KB, three.js ≈ 241 KB (lazy, skipped on ≤ 4 GB).
- Memory and cold start on a 4 GB Windows PC: not measured (no hardware).

## Deployment and rollback (for when gates pass)

1. Back up production PostgreSQL and media.
2. Merge bestwayec/bestway#207 → run `deploy-django.yml` / `deploy.yml` as today. No migration is
   introduced, the API contract is unchanged, so installed 1.0.12 desktop apps keep working.
3. Smoke (non-destructive): homepage, login, student dashboard, teacher 403 on a foreign group, vocabulary
   list, mock exam list, protected audio without auth → 401.
4. Merge bestwayec/bw-tauri#39 and follow the desktop runbook (version `1.0.13`, `versionCode 10130`).
5. Rollback: redeploy the previous image/tag; stop promoting the desktop release. No data to reverse.
