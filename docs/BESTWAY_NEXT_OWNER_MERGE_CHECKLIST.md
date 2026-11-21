# BESTWAY NEXT — owner merge checklist (PR #207 + bw-tauri PR #39)

Both PRs are companion changes. Neither should be merged or deployed by an agent; the product owner
approves each step.

## Before merging

- [ ] Hosted CI is green on the exact final HEAD of [bestway#207](https://github.com/bestwayec/bestway/pull/207) and [bw-tauri#39](https://github.com/bestwayec/bw-tauri/pull/39) (`CI`, `Windows installer validation`, `Browser exam recovery validation`).
- [ ] Review the homepage screenshots in `docs/screenshots/stage05/` (desktop en, tablet en, mobile uz) and the copy in `frontend/messages/{uz,en}.json` → `marketing.*`. Confirm the course descriptions (targets such as "Band 6.5+", "1400+") are acceptable marketing claims.
- [ ] Confirm no migration is introduced. This round adds **no** Prisma or Django migration (verify: `git diff origin/main -- backend/prisma backend-django/apps/*/migrations` is empty).
- [ ] Decide on the Next.js 16.4.x upgrade for GHSA-h694-7cp9-m8p3 (not exploitable here; no `'use cache'`).
- [ ] Spot-check on a networked machine: Google sign-in button on `/login` (the sandbox blocked its script).

## Deployment order

1. Back up the production database (existing runbook: `scripts/deploy-release.sh`, `scripts/check-production-approval.sh`).
2. Deploy backend + website from `main` after merging #207. The only server behaviour change is the vocabulary `parse-text` separator rule (hyphenated words); the API contract is unchanged, so older desktop clients keep working.
3. Merge #39. Build desktop releases through the existing signed release workflow only. Do not publish unsigned artifacts as official downloads.
4. Desktop clients from before #39 remain compatible with the new backend (no endpoint or payload change).

## Rollback

- Website/backend: redeploy the previous image/tag; no data migration to reverse. Vocabulary sets
  saved while the new parser was live are ordinary rows and remain valid.
- Desktop: the updater only offers signed releases; to roll back, stop promoting the new version on
  the release channel. Session storage stays compatible (the keyring change only adds a read-back
  check; a file fallback written by the new build is read by the previous build's loader).

## Not ready for production release until

- Physical Windows 10 / ~4 GB RAM acceptance (install, login, offline vocabulary, exam recovery, audio, signed update) — see bw-tauri `docs/BESTWAY_NEXT_STAGE06_NATIVE_ACCEPTANCE.md`.
- Android authenticated journey on an approved backend and a physical device; official signing certificate continuity check.
- Real screen-reader pass on the student study view and the exam window.
