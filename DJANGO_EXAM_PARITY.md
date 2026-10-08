# Stage A Django exam parity — 2026-10-08

Verdict: **STAGE_A_COMPLETE**. Stage B has not been started.

## Contract totals

| Area | Result |
|---|---:|
| Active NestJS Stage A contracts | 33 |
| Django method/path pairs registered | 33/33 |
| Django contracts exercised through both APIs | 33/33 |
| JSON-package import contracts | 6/6 |
| Group media contracts | 3/3 |
| Full API/database differential comparisons | 268/268 |
| Pure import-validation/HTML comparisons | 61/61 |

The live inventory is derived from built NestJS controller metadata, not a hand-maintained route list. Run `python scripts/verify_stage_a_inventory.py` from `backend-django` with the local database configuration to check registration.

## Exact active route inventory

All paths below have the `/v1/mock` prefix. S = teacher/admin/super_admin; A = admin/super_admin; X = super_admin; O = optional authentication with service-level access controls.

| Method | Path | Roles | Success | Django |
|---|---|---|---:|---|
| PUT | /groups/:groupId/content | S | 200 | Compatible |
| GET | /exams | O | 200 | Compatible |
| POST | /exams | S | 201 | Compatible |
| POST | /parse-questions | S | 201 | Compatible |
| GET | /groups/:groupId/audio | O | 200/206 | Compatible |
| GET | /groups/:groupId/image | O | 200/206 | Compatible |
| POST | /groups/:groupId/media | S | 201 | Compatible |
| POST | /groups/:groupId/questions/import | S | 201 | Compatible |
| POST | /groups/:groupId/questions | S | 201 | Compatible |
| PATCH | /groups/:groupId | S | 200 | Compatible |
| DELETE | /groups/:groupId | S | 200 | Compatible |
| POST | /sections/:sectionId/groups | S | 201 | Compatible |
| PATCH | /sections/:sectionId | S | 200 | Compatible |
| DELETE | /sections/:sectionId | S | 200 | Compatible |
| PATCH | /questions/:questionId | S | 200 | Compatible |
| DELETE | /questions/:questionId | S | 200 | Compatible |
| GET | /exams/:id | O | 200 | Compatible |
| PATCH | /exams/:id | S | 200 | Compatible |
| DELETE | /exams/:id | X | 200 | Compatible |
| POST | /exams/:id/clone | S | 201 | Compatible |
| GET | /exams/:id/readiness | S | 200 | Compatible |
| GET | /exams/:id/multilevel-repair-inspection | A | 200 | Compatible |
| POST | /exams/:id/apply-multilevel-safe-repair | A | 201 | Compatible |
| POST | /exams/:id/clone-corrected-multilevel | A | 201 | Compatible |
| POST | /exams/:id/repair-multilevel | S | 201 | Compatible |
| GET | /exams/:id/preview | S | 200 | Compatible |
| POST | /exams/:id/sections | S | 201 | Compatible |
| POST | /exam-imports/validate | S | 200 | Compatible |
| POST | /exam-imports/media | S | 201 | Compatible |
| POST | /exam-imports | S | 201/200 replay | Compatible |
| GET | /exam-imports/by-package/:packageId/revisions/:revision | S | 200 | Compatible |
| GET | /exam-imports/by-exam/:examId | S | 200 | Compatible |
| POST | /exam-imports/issues/:issueId/resolve | S | 200 | Compatible |

## Compatibility decisions

- Package import preserves schema 1.0 structure, raw duplicate-key detection, canonical checksum, media bindings, validation reports, replay/conflict behavior, transactions, provenance/source maps and review-issue resolution.
- Media preserves multipart contracts, MIME/extension validation, storage-key containment, range streaming, optional GET authentication, ownership/access checks and safe unreferenced-file cleanup. Default Django storage now resolves the existing local reference storage root, so valid existing keys remain reachable.
- Rich authored HTML is allow-listed and canonicalized with one-to-one gap/question enforcement. Preview hides answer keys and Multilevel Listening transcripts.
- The user-approved readiness behavior preserves the actual NestJS distinction: catalogue/detail use structural Start readiness (IELTS is always ready there), while Review and publish use the stricter key/media/import-issue checklist.
- Existing attempted exams remain immutable; legacy zero-history exams repair in place, while history-bearing exams require a corrected clone.

## Differential method

`scripts/verify_stage_a_differential.py` creates two disposable, localhost-only PostgreSQL schemas, creates equivalent real users and HS256 JWTs, then exercises local Django and an isolated NestJS reference server. It compares response status/body and persisted relevant rows after every call. Only UUIDs and ISO timestamps are normalized. Storage keys are made equivalent in the harness so checksums are compared rather than normalized.

It covers success mutations, version conflicts, imports/replay, media, publish/readiness, preview, repair/clone and every route's anonymous/student/teacher/admin/super-admin gate. Its machine-readable result is [STAGE_A_PARITY_REPORT.json](backend-django/STAGE_A_PARITY_REPORT.json).

## Security and transaction evidence

- Students cannot author; teachers cannot edit another teacher's exam; admin and super-admin boundaries are checked on every active route.
- Preview contains no answer keys or Listening transcript content.
- Mass-assignment fields are rejected.
- Invalid/stale import and authoring writes leave no partial persisted definitions.
- Media rejects traversal, MIME/extension spoofing and unauthorized access.
- Attempt history blocks repair and leaves the source unchanged; corrected clones do not copy attempts.

No frontend, Tauri or NestJS source was changed. No production system was accessed, deployed to, reset, stashed or discarded.
