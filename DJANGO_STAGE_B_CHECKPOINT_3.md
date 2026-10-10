# Checkpoint 3 implementation matrix

Reference: active MockController, MockAccessService, MockGradingService and MockCertificateService. All paths start `/v1`. POST success is 201, GET/DELETE success 200 (PDF binary). T=teacher/admin/super_admin; D=admin/super_admin; A=authenticated owner/linked parent/assigned teacher/admin scope. No Stage C grading endpoint is in this matrix.

| Method | Path | Request | Response data | Role | Database side effect | Test status |
|---|---|---|---|---|---|---|
| POST | `/mock/exams/:id/purchase` | No DTO | `{status,amount}` | student | Upsert MockPurchase, refresh non-purchased amount/status; audit | API/DB pass |
| GET | `/mock/purchases` | page,limit,status | Purchase summaries + top-level pagination meta | D | None | API/DB pass |
| POST | `/mock/exams/:id/confirm-purchase` | `{userId:nonempty string}` | `{confirmed:true}` | D | Upsert purchased/confirmedById; audit/notification | API/DB pass |
| POST | `/mock/exams/:id/reject-purchase` | `{userId:nonempty string}` | `{rejected:true}` | D | Delete pending purchase only; audit/notification | API/DB pass |
| GET | `/mock/attempts` | page,limit,status,studentId,examId,program | Persisted score/clock summaries + pagination meta | T | None; teacher group filter | API/DB pass |
| POST | `/mock/attempts/:attemptId/force-submit` | No DTO | Existing deterministic submission result | T | Score/finalize, audit, notifications, immutable assessment handoff | API/DB/PG pass |
| POST | `/mock/attempts/:attemptId/extend` | `{minutes:integer 1..180}`; Number coercion | `{saved:true,deadlineAt,overallDeadlineAt,sectionDeadlines,serverTime}` | T | Shift all stored deadlines, audit | API/DB/PG pass |
| POST | `/mock/attempts/:attemptId/reopen` | No DTO | `{saved:true,status:in_progress}` | T | grading only: status/submittedAt reset, audit; retain scores/jobs/clock | API/DB/PG pass |
| DELETE | `/mock/attempts/:attemptId` | No DTO | `{deleted:true}` | D | Delete answers/cheat events/attempt, DB cascades assessment ledger, audit | API/DB pass |
| GET | `/mock/attempts/:attemptId/certificate` | No DTO | Authorized completed result PDF; filename mock-:id.pdf | A | None; persisted raw/band/standard scores | API/PDF/security pass |

Reference quirks retained: purchase request uses accessFor but does not itself assert enrollment; confirmation may directly create a purchased entitlement without a pending request and does not require StudentProfile. Start still enforces enrollment. Reopen never allows completed attempts and does not erase historical assessment snapshots. Delete is administrative history deletion, not permission to rewrite finalized scores. No provider/worker execution is authorized.

## Verified gate — 2026-10-08

STAGE_B_CHECKPOINT_3_COMPLETE. 43/43 scoped Stage B routes registered, zero missing. Checkpoint 3 adds 153 recorded groups, all pass (151 API/DB groups plus PostgreSQL concurrency/rollback and audit comparison groups). Combined: 705 groups, 702 pass, three approved media differences, zero unapproved failures. Strict differential still exits 1 to retain those differences.

PostgreSQL support safety: 18 checks for force-submit duplicates, manual/force-submit races, accumulating extensions, unique purchase requests, notification-failure rollback, snapshot retention and stable persisted reference results. Audit group compares actual records for all seven new mutation actions. Django uses the shared TestAttempt lock and transactions, preserving the previous stronger atomic notification/snapshot policy; Nest's out-of-transaction audit/notification behavior is not claimed as identical failure/concurrency timing. Equivalent final persisted results and normal HTTP outcomes match.

Exact errors exercised: UNAUTHORIZED401, FORBIDDEN403, MOCK_EXAM_NOT_FOUND404, MOCK_ATTEMPT_NOT_FOUND404, MOCK_PURCHASE_NOT_PENDING404, MOCK_ALREADY_ACCESSIBLE400, MOCK_PAYMENT_REQUIRED402, MOCK_PURCHASE_PENDING402, PROGRAM_NOT_ENROLLED403, MOCK_ATTEMPT_FINISHED400, MOCK_CANNOT_REOPEN400, MOCK_ATTEMPT_NOT_COMPLETED400, FOREIGN_KEY_VIOLATION400 and DTO VALIDATION_ERROR400. Number coercion, null/fraction/min/max and invalid query first-error messages match the real reference.

Completed owner/linked parent/assigned teacher/admin certificates read persisted rawScores/sectionBands/standardScores/overallBand/overallScore/cefrLevel, never run grading. Pending/in-progress certificates are denied. Force-submit bypasses student completeness checks as the reference staff route requires; unassessed manual sections remain grading and immutable assessment handoff is persisted. No providers execute. Completed attempts cannot be reopened or extended, and student answer writes remain denied. Only admin/super_admin may invoke the explicit deletion contract; existing PostgreSQL cascades clear the ledger. Uploaded files are not proactively removed because the reference deletion route does not remove them.

PDF HTTP metadata, complete extracted text and page bounds match IELTS and Multilevel fixtures. ReportLab and PDFKit have different binary serialization/metadata; PDF bytes are not claimed identical. The PDF skill required rendering/visual inspection; both IELTS and long-name Multilevel layouts were inspected and scratch files removed. No PDF artifact is delivered separately from the API.

Fixture clocks are explicitly coordinated before support list tests because prior cloned inputs shared startedAt and SQL has no reference tie-breaker. Returned arrays are not sorted/normalized by the harness. Relative deadline shifts are checked against exact stored PostgreSQL values, not merely timestamp normalization. Existing baseline random-ID/timestamp normalization is retained; score values, statuses, errors, hashes, result text and ownership denials are not normalized away.

Regression: Django check clean; 127 pytest +11 subtests; original 578 scoring comparisons; Stage A268 API/DB and163 PostgreSQL; legacy158 groups and16 PG checks retained; Nest421 tests/31 files, TypeScript/build/Prisma validation pass. All disposable schemas/storage cleaned. Frontend/Tauri/NestJS source untouched; no production, migrations, merge or deployment. Stop before Stage C.
