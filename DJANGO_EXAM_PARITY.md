# Stage A exam compatibility gate — 2026-10-08

Verdict: **STAGE_A_BLOCKED**. Stage B is not started.

## Counts and meaning

- NestJS active Stage A endpoints: **33** (27 catalogue/authoring/paste/media + 6 JSON-package import).
- Django registered matching method/path pairs: **24**.
- Missing method/path pairs: **9**.
- Endpoints exercised by exact NestJS/Django API differential fixtures: **1**, parse-questions; **27/27** fixtures match.
- Full-contract-compatible endpoint count: **not established**. The 24 registered routes must not be reported as 24 compatible routes. The single differential endpoint also excludes JWT authentication.

Inventory comes from the currently built active MockController and MockExamImportController metadata, compared against Django URL registrations. Reproduce from backend-django with `python scripts/verify_stage_a_inventory.py`. Purchases, attempts, grading and student execution are excluded from Stage A. Both import controllers are active, not dead reference code.

## Exact route inventory

All paths below have prefix `/v1/mock`. Parameter names are shown as in NestJS; Django captures the equivalent IDs using snake-case names. S = teacher/admin/super_admin; A = admin/super_admin; X = super_admin; O = optional authentication with service-level access checks. "Registered" means routing only, not JSON/error parity certification.

| Method | Path after prefix | Reference roles | Reference success status | Django |
|---|---|---|---|---|
| PUT | /groups/:groupId/content | S | 200 | Registered |
| GET | /exams | O | 200 | Registered |
| POST | /exams | S | 201 | Registered |
| POST | /parse-questions | S | 201 | 27 exact differential fixtures |
| GET | /groups/:groupId/audio | O | 200/206 | Missing |
| GET | /groups/:groupId/image | O | 200/206 | Missing |
| POST | /groups/:groupId/media | S | 201 | Missing |
| POST | /groups/:groupId/questions/import | S | 201 | Registered; PostgreSQL paste coverage |
| POST | /groups/:groupId/questions | S | 201 | Registered |
| PATCH | /groups/:groupId | S | 200 | Registered |
| DELETE | /groups/:groupId | S | 200 | Registered |
| POST | /sections/:sectionId/groups | S | 201 | Registered |
| PATCH | /sections/:sectionId | S | 200 | Registered |
| DELETE | /sections/:sectionId | S | 200 | Registered |
| PATCH | /questions/:questionId | S | 200 | Registered |
| DELETE | /questions/:questionId | S | 200 | Registered |
| GET | /exams/:id | O | 200 | Registered |
| PATCH | /exams/:id | S | 200 | Registered |
| DELETE | /exams/:id | X | 200 | Registered |
| POST | /exams/:id/clone | S | 201 | Registered |
| GET | /exams/:id/readiness | S | 200 | Registered; checklist gaps |
| GET | /exams/:id/multilevel-repair-inspection | A | 200 | Registered |
| POST | /exams/:id/apply-multilevel-safe-repair | A | 201 | Registered |
| POST | /exams/:id/clone-corrected-multilevel | A | 201 | Registered |
| POST | /exams/:id/repair-multilevel | S | 201 | Registered |
| GET | /exams/:id/preview | S | 200 | Registered; serialization gaps |
| POST | /exams/:id/sections | S | 201 | Registered |
| POST | /exam-imports/validate | S | 200 | Missing |
| POST | /exam-imports/media | S | 201 | Missing |
| POST | /exam-imports | S | 201 new / 200 replay | Missing |
| GET | /exam-imports/by-package/:packageId/revisions/:revision | S | 200 | Missing |
| GET | /exam-imports/by-exam/:examId | S | 200 | Missing |
| POST | /exam-imports/issues/:issueId/resolve | S | 200 | Missing |

## Closed gaps in this gate pass

Paste parsing and paste import are now registered. Parsing preserves numbering syntax, instruction preamble, continuation lines, option detection, TFNG/YNNG hints, completion detection, and omission of an undefined options property. Decision and choice answer expansion retain reference order and raw variants.

Parse HTTP comparison includes actual reference controller/service, DTO ValidationPipe, RolesGuard, exception filter and response interceptor, versus the Django DRF endpoint. Reference is a local loopback Nest application with injected fixture identities, not the production AppModule; unused services are not exercised. JWT/cookie authentication, rate limits and the other 32 routes are not covered. JSON object member order is irrelevant; values, missing/null fields, statuses, codes and messages are compared without semantic normalization.

Exact parse success JSON: `{success:true,data:{instructions,questions,count}}`, status 201. Anonymous: 401 UNAUTHORIZED; student/parent: 403 FORBIDDEN. Invalid text and unknown properties: 400 VALIDATION_ERROR with reference messages (including property name). Unicode length follows the installed validator's character/presentation-sequence counting.

Paste import: status 201, `{success:true,data:{added,questions}}`; questions contains all current group rows, not only newly inserted rows. Local PostgreSQL covers preamble retention, answer-key expansion, supplied objective points, one version increment, missing answers, out-of-range numbers, duplicate paste/existing numbers, student denial, foreign teacher denial and rollback. Errors checked: NO_QUESTIONS_PARSED/400, MISSING_ANSWERS/400, VALIDATION_ERROR/400, MOCK_NOT_OWNER/403 and FORBIDDEN/403. Complete Nest-versus-Django persisted import responses and all import DTO edge cases are not yet certified.

Points resolution now matches reference: IELTS manual tasks require exactly nine; other skills use supplied points or one. Existing route wiring/preview/repair work was preserved rather than rebuilt.

## Remaining compatibility items — implementation required

1. **All six JSON-package import endpoints.** Port exact payload validation and raw duplicate-key detection, canonical checksum, schema/question-type validation, issue limits/order, media bindings/ownership/expiry, transactional commit/append, replay/conflict semantics, numbering/part collision checks, source maps, issue resolution and provenance. Preserve new 201 versus replay 200. Cover reference 422 import-invalid/binding/stale-validation errors, 409 conflict/collisions and 410 expired media; verify exact code/message names against the service before implementation. No placeholder success routes were added.
2. **All three group media endpoints.** Multipart audio/image fields and limits, MIME/extension validation, storage keys, absolute PUBLIC_URL URLs, authenticated/paid access, draft visibility, timed Multilevel audio replay authorization, range headers/statuses, safe replacement/deletion and shared-clone references. Reference errors include NO_FILE/400, INVALID_FILE_KEY/400, FILE_NOT_FOUND/404, UNAUTHORIZED/401, MOCK_PURCHASE_PENDING/402, MOCK_PAYMENT_REQUIRED/402 and AUDIO_REPLAY_BLOCKED/403. Range rejection is 416. Import staging is a separate missing endpoint above. No file access/cleanup parity is claimed.
3. **Readiness/publish.** Current Multilevel branch only evaluates structural readiness. Reference additionally checks objective answer keys/prompt/gap mapping, media existence, placeholders and open import issues; IELTS has full-paper counts, material/audio and writing-task requirements. Exact checklist keys/detail strings and publish outcomes need differential tests. The current PG runner deliberately uses fixture media keys without physical media files, so its green publish result is not proof of Nest media readiness parity.
4. **Definition and mutation JSON parity.** Django media URLs are relative; reference uses PUBLIC_URL. Specification/task guidance/speaking-profile and canonical decision options need comparison. Add-questions currently returns new rows rather than the reference's full group list. Save-group-content array/null semantics and manual-group reconciliation differ. Nested DTO validation and all mutation error messages/statuses require comparison. Student-shaped matching options helpers also need review; existing structural tests do not establish wire parity.
5. **HTML/gap security.** Port reference rich-HTML sanitization, duplicate gap rejection and gap/question one-to-one validation. Do not call the security gate complete merely because preview removes answer-key fields.
6. **Full differential suite.** Equivalent disposable fixtures through both APIs for mutations/versioning, history locks, readiness/publish, clone/repair, paste and package import, media, ownership and preview sanitization. No normalization of semantic differences. Verify concurrent/late-failure rollback for each affected write operation.

## Verified security subset

Local PG proves student import/preview denial, foreign teacher mutation/import denial, super-admin-only exam deletion, Multilevel preview answer-key/transcript removal, attempted-exam repair refusal and historical source preservation on corrected clone. A fault injected after question inserts but before version bump proves paste rows/version roll back with no success audit. Snapshots include full exam/group/question rows.

Not certified: all role/ownership combinations on all routes; media authorization/storage; package imports; HTML sanitization; IELTS Listening transcript fixtures; concurrent transactions; the complete answer-key leak surface. These are remaining Stage A work, not external-environment blockers.

## Verification

| Check | Result |
|---|---|
| Django manage.py check with local DATABASE_URL | No issues |
| Django pytest | 55 passed, plus 5 subtests |
| Local Nest/Django parse API differential | 27/27 exact matches |
| Disposable real PostgreSQL authoring/repair/paste runner | 139/139; zero exam leftovers |
| NestJS npm test | 31 files, 421 tests passed |
| NestJS npx tsc --noEmit | Exit 0 |
| NestJS npm run build | Exit 0 |
| NestJS npx prisma validate | Schema valid, exit 0 |

The initial npm test attempt hit sandbox child-process EPERM; the approved rerun passed. The initial default Django check lacked DATABASE_URL; the explicit local-only rerun passed. Neither is a remaining environment blocker.

Frontend, Tauri and NestJS source are unchanged. No production access, deploy, reset, stash or discard occurred.
