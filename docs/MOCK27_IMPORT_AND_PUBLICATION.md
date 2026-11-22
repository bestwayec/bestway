# BESTWAY IELTS Academic — Full Mock Test 27: import, audio and publication runbook

Exam id/slug: `bestway-ielts-academic-full-mock-27` · type `ielts_academic` · profile `full_mock`.
Unofficial BESTWAY practice mock — never labelled as official IELTS.

**State of this change: the exam is imported as a DRAFT only. Nothing here publishes it. It is not available to students
and must not be described as available until the production catalogue has been checked after an explicit publish.**

## 1. What is in the repository (and what is not)

| Part | Source | In git? |
|---|---|---|
| Writing Task 1 (Riverside Park maps 2005/2025, SVG + PNG) and Task 2 | original BESTWAY (`apps/core/mock27/original_content.py`, `maps.py`, `assets/`) | yes |
| Speaking Parts 1–3 | original BESTWAY | yes |
| Listening (4 parts / 40 q) and Reading (3 passages / 40 q) — **supplied** | owner PDFs, third-party watermark, **redistribution rights NOT verified** | **no** (extracted into a private directory) |
| Listening and Reading — **original replacement** | `original_listening.py`, `original_reading.py` (spoken scripts included) | yes |
| Listening audio | owner records/uploads | no |

The repository is public: supplied passages, questions and answer keys must never be committed
(`.gitignore` blocks `private_content/`, `private_mock27/`, `*.package.json`).

## 2. Decision: which Listening/Reading goes to students?

* **Path A — supplied material.** Allowed only after an administrator records *documentary* permission
  (licence/contract/e-mail reference) in the Builder. Until then `content_rights = unverified` and the exam cannot be published.
  Nobody (including an AI assistant) may attest permission without that document.
* **Path B — fully original replacement** (use if no permission can be shown): `import_mock27 --content original`.
  Rights are `original`; only the audio gate remains. Limitations: the scripts are *compact* (≈2–3 minutes of speech per part,
  a real part is ≈7) and the Reading texts are shorter than a real test (≈550–680 words each). Extend them before relying on it for timing.
  The spoken scripts are staff-only (Builder › Listening part › audio script); they are never sent to students.

Both paths import into the same exam id; choose one per exam (content changes need a clone — existing revision policy).
To switch, a super administrator deletes the *unpublished, attempt-free* draft in the Builder, or import Path B under another id
(`--exam-id <id> --id-suffix -b`).

## 3. Production import procedure (Path A) — read-only checks first, no destructive step

Prerequisites: an administrator account id; the two supplied PDFs (expected SHA-256:
Listening `4b493135c65d9c289770f4e6654fcddae40b668752d5bbddc6092a8af04039e2`,
Reading `a9f5543f65ed885ab296a6743c163ec4a6a8205a11224c5062d00d2ed038633d`).

1. **Extract on a trusted machine** (not inside any git checkout; output stays private, mode 700):
   ```bash
   python -m venv .venv && . .venv/bin/activate
   pip install -r backend-django/requirements/prod.txt pdfplumber
   cd backend-django
   python manage.py extract_mock27_source --listening /secure/Listening.pdf --reading /secure/Reading.pdf --out /secure/private_mock27
   ```
   (needs `DATABASE_URL`/`DJANGO_SECRET_KEY` env like any manage.py call; it touches no database). Extraction is deterministic:
   running it twice yields byte-identical packages. It fails loudly on any numbering/key/option inconsistency.
2. **Copy** `/secure/private_mock27` to the server **outside the repository checkout** (e.g. `/srv/bestway-private/mock27`, `chmod -R go-rwx`).
3. **Back up the database** with the normal release backup (`scripts/deploy-release.sh` already verifies a custom-format dump; take a manual one
   before importing: `pg_dump --format=custom`). Migrations are never rolled back; the import only adds rows for one new draft exam.
4. **Migration state.** The main release (`deploy.yml` → `scripts/deploy-release.sh`) runs Prisma migrations *and* `manage.py migrate`
   before swapping containers, so `core.0018` (two additive tables) is applied. The alternate `deploy-django.yml` path does **not** run Django
   migrate: if that path is used, run `python manage.py migrate core` first. If the tables are absent the gate code stays inactive and
   ordinary exams keep working, but the import refuses to run.
5. **Preflight (read-only)** inside a one-off container with the production `STORAGE_DIR` volume (`/app/storage`, volume `education_backend_storage`):
   ```bash
   docker compose -f docker-compose.yml run --rm --no-deps -v /srv/bestway-private/mock27:/private:ro backend \
     python manage.py check_mock27 --stage preflight --author <ADMIN_USER_ID> --source-dir /private
   ```
   It verifies: PostgreSQL, `core.0018` applied, Prisma ledger present and complete, required tables, `STORAGE_DIR` existing and writable,
   PyAV installed, the author is an admin, the exam (if it exists) is an unpublished non-demo draft with **no attempts**, the source dir is
   outside a git work tree, and Listening/Reading are 40/40 with valid keys.
6. **Dry run, then import (transactional, idempotent, never publishes):**
   ```bash
   docker compose -f docker-compose.yml run --rm --no-deps -v /srv/bestway-private/mock27:/private:ro backend \
     python manage.py import_mock27 --author <ADMIN_USER_ID> --source-dir /private --dry-run
   docker compose -f docker-compose.yml run --rm --no-deps -v /srv/bestway-private/mock27:/private:ro backend \
     python manage.py import_mock27 --author <ADMIN_USER_ID> --source-dir /private
   ```
   `STORAGE_DIR` matters: the Writing map image is stored in the server's media root. Re-running replays all four packages and changes nothing.
   It refuses a published/demo exam or one with attempts; it never touches existing students, attempts or results.
7. **Post-check (read-only):** `python manage.py check_mock27 --stage post` → draft, counts L40 R40 W2 S3, gate row present, audio parts MISSING.

Never run the PostgreSQL verification scripts, `seed_*` commands or any test against production: they create and delete fixture rows
(they refuse non-loopback databases).

## 4. The owner uploads the four Listening recordings (Builder UI)

Requirements per file: **one file per part**, `.mp3` or `.m4a`, 1–20 minutes (4–12 usual; others upload with a warning), ≤ 200 MB.

1. Sign in as an **administrator** (teachers can upload to their own exams but cannot verify).
2. Sidebar → **Exams → Exam Builder** → open **BESTWAY IELTS Academic — Full Mock Test 27** (badge *Draft*).
3. In the outline choose **Listening** (on a phone use the section selector). The panel **Listening audio status** appears at the top.
4. **Part 1 (Q1–10):** press **Upload audio**, choose the Part 1 file. Expect the message *Recording uploaded*; the badge turns **UPLOADED**
   and shows format, duration, size and revision. Repeat for **Part 2 (Q11–20)**, **Part 3 (Q21–30)**, **Part 4 (Q31–40)**. Check that each row is
   labelled with its question range.
5. A wrong or rejected file: the part stays as it was and a clear message is shown (renamed non-audio, truncated, wrong format, too short/long).
   To fix a wrong recording use **Replace audio** — the old file is removed only after the new one is stored, and verification is reset (revision +1).
6. **Play** each recording with the built-in player and compare it with the questions.
7. **Verify** each part (administrator): press **Verify**, play the whole recording, tick **I listened to the whole recording**, tick every question
   whose answer you heard (**Tick all after checking** helps once you have checked), then **Confirm verification**. The badge turns **VERIFIED**.
   Verification is bound to that exact file and those exact answer keys: replacing the file or editing a key later sends the part back to UPLOADED.
8. The header must read **4/4 verified**. The list *Blocking publication* then shows only the content-rights item (if rights are still unverified).
9. **Content rights:** only if you hold written permission, press **Record verified rights**, enter the permission reference (≥ 20 characters) and confirm.
   Without it the supplied material cannot be published (Path B avoids this).
10. Only when *Review* shows no blocker, press the Builder **Publish** button, then **check the production catalogue** and open the exam URL as a student account
    before announcing anything.

## 5. Publication gates (technical)

`readiness()` for this exam additionally requires `content_rights ∈ {verified, original}` and `listening_audio_verified` (4/4).
Publish, the demo flag (catalogue exposure) and quick-content all enforce the gate (quick-content requires *full* readiness for a gated exam);
clones stay gated; withdrawing rights unpublishes at once. Exams without a gate row are unaffected.

## 6. Known gaps (deliberate, reported)

* **Listening keys are checked against the supplied key page and for internal consistency only**; they can be checked against sound only after
  the recordings exist (that is what administrator verification attests). The 40 Reading keys were verified against the passages by reading.
* **IELTS Speaking Part 2 preparation time** (blueprint: 60 s preparation, 120 s response) is *declared* (`exam_blueprint.py`) and stated in the task
  instructions, but only the Multilevel engine enforces server-side preparation/response windows; the IELTS runner records freely. Adding a server phase for
  IELTS would change recording flow for every IELTS mock, so it was not done here (pinned by a test so a future change is deliberate).
* Mock 27 student attempts on the *real* exam cannot be run while it is a draft without audio. The same content was exercised end-to-end on a throwaway exam
  (see PROGRESS.md block 41).

## 7. Rollback

Code: revert the PR (migration `core.0018` only adds two tables). Data: a super administrator deletes the draft in the Builder (also purges its gate rows);
the import never modifies other exams. No migration is reversed.
