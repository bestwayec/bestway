# BESTWAY IELTS Academic — Full Mock Test 27: import, audio and publication runbook

Exam id/slug: `bestway-ielts-academic-full-mock-27` · type `ielts_academic` · profile `full_mock`.
Unofficial BESTWAY practice mock — never labelled as official IELTS.

## What is in the repository (and what is not)

| Part | Source | In git? |
|---|---|---|
| Writing Task 1 (Riverside Park maps 2005/2025, SVG + PNG) and Task 2 | original BESTWAY content (`apps/core/mock27/original_content.py`, `maps.py`, `assets/`) | yes |
| Speaking Parts 1–3 | original BESTWAY content | yes |
| Listening (4 parts, 40 questions) and Reading (3 passages, 40 questions) | owner-supplied PDFs; **watermarked third-party material, redistribution rights NOT verified** | **no** — extracted locally into a private directory |
| Listening audio | to be uploaded by the owner | no |

The repository is public. Supplied passages, questions and answer keys must never be committed
(`.gitignore` blocks `private_content/`, `private_mock27/`, `*.package.json`; the leak scan in the PR notes was clean).

## 1. Extract the owner's PDFs (private output)

```bash
cd backend-django
pip install pdfplumber            # dev-time only, not a runtime dependency
python manage.py extract_mock27_source \
  --listening /secure/IELTS_Listening_Full_Test_27.pdf \
  --reading   /secure/IELTS_Reading_Test.pdf \
  --out       /secure/private_mock27          # keep OUTSIDE the repository
```
The extractor fails loudly (never guesses) on any numbering/answer-key/option inconsistency and writes
`listening.package.json`, `reading.package.json` and `source_report.json` (SHA-256 of the sources).
Both packages are checked for: 40 questions numbered 1–40, 4 Listening parts / 3 Reading passages, a resolvable answer key for
every question, matching/option letters inside the option bank, and that every Reading completion answer occurs in its passage.

## 2. Import as a DRAFT (idempotent, transactional)

```bash
python manage.py import_mock27 --author <admin-or-super_admin-user-id> --source-dir /secure/private_mock27 [--dry-run]
```
Uses the existing validated importer (`commit_import`): one transaction for all four skills, replays do nothing, never
publishes, refuses a published/demo exam or one with attempts, changes no historical attempt. Run it where `STORAGE_DIR`
is the server's media root (the Writing map image is stored there). Content changes after import need a cloned exam
(existing revision policy).

## 3. Listening audio (owner)

Exam Builder → Listening: each part shows **MISSING / UPLOADED / VERIFIED**.
* Upload / replace (teacher who owns the exam, or admin): `.mp3` or `.m4a` only; checked for extension, MIME, magic bytes, a real
  decode, codec/container, 1–20 min. Replacement is atomic, resets verification, bumps the revision, deletes the old file after commit.
  API: `POST /v1/mock/groups/<groupId>/listening-audio` (multipart `audio`). The legacy Builder media endpoint is routed through the same validation for this exam.
* Verify (administrator only): play the recording, confirm every question number of the part is heard, attest full listen.
  `POST /v1/mock/groups/<groupId>/listening-audio/verify`. Verification is bound to the file checksum **and** the part's answer keys:
  replacing the file or editing a key drops the part back to UPLOADED.

## 4. Content rights (administrator)

`POST /v1/mock/exams/<examId>/content-rights` with `{status:"verified", attestation:true, evidence:"<≥20 chars permission reference>"}`
(also in the Builder). Withdrawing (`unverified`) unpublishes the exam at once.

## 5. Publication gates

`readiness()` for this exam additionally requires `content_rights` ∈ {verified, original} and `listening_audio_verified` (4/4 parts).
The publish route, the demo flag (catalogue exposure) and quick-content all enforce the gate; clones stay gated.
Existing mocks (no gate row) are unaffected. Publishing itself remains the normal Builder **Publish** action after every gate is green and
production deployment/CI/backup/rollback steps in `docs/` are followed. **Nothing in this change publishes the exam.**

Rollback of the code: revert the PR (migration `core.0018` only adds two tables). Rollback of the data: `delete_exam` as super admin (also purges gate rows).
