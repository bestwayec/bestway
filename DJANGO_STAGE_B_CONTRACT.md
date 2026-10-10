# Stage B lifecycle contract inventory — Checkpoint 3 complete

Reference: the active built `MockController` and `TestsController`, their source services/DTOs, and actual calls in `frontend/src/hooks/use-mock.ts`, `frontend/src/components/mock/mock-runner.tsx`, and `../bw-tauri/src/lib/{mocks,tests,cheat}.ts`.

Run `node backend-django/scripts/stage_b_inventory.cjs` for exact methods, paths, role metadata, public/optional authentication and success statuses. This is not an inventory of all backend routes: authoring mutations and assessment/grading implementation are outside Stage B. Direct lifecycle access, management and result-support contracts are included, even when unimplemented. The user explicitly included legacy `/tests`.

Active scoped contracts: **43** (28 mock, 15 legacy). Registered in Django: **43**. Missing: **0**. Checkpoint3 verifies the remaining ten access/staff/result-support contracts; exact implementation matrix and results are in `DJANGO_STAGE_B_CHECKPOINT_3.md`. Approved media restrictions remain explicit differences. Provider grading/teacher review remain Stage C, not covered by this inventory.

JSON responses use `{success:true,data:...}`; paginated routes add top-level `meta:{page,limit,total}`. Errors use `{success:false,error:{code,message}}`. POST success defaults to 201; GET/PUT success defaults to 200. Binary streams also support 206 and 416. Below `S` means JWT student; `A` means authenticated with student/linked-parent/assigned-teacher/admin scope; `T` means teacher/admin/super_admin; `D` means admin/super_admin; `O` means optional JWT; `P` means public. All paths start with `/v1`.

## Mock routes

| Method/path | Auth | Payload/query; data result | Django |
|---|---|---|---|
| GET `/mock/exams` | O | `type,program,practiceLevel`; catalogue array | Existing |
| GET `/mock/exams/:id` | O | Student-safe definition/access/price/readiness | Existing |
| POST `/mock/exams/:id/start` | S | `{mode?:practice\|timed,flow?:string}`; Start object | New |
| GET `/mock/attempts/mine` | S | `page,limit,status,examId,studentId,program`; summaries/meta | New |
| GET `/mock/attempts/:attemptId` | A | Summary, serverTime, annotations, sections/responses | New |
| POST `/mock/attempts/:attemptId/answer` | S | `{questionId,response:string<=10000}`; `{saved:true}` | New |
| POST `/mock/attempts/:attemptId/answers` | S | `{answers:[{questionId,response}]}` (1–200); `{saved:number}` | New |
| POST `/mock/attempts/:attemptId/listening/:groupId/prepare` | S | No DTO; MediaPhase | New |
| POST `/mock/attempts/:attemptId/listening/:groupId/play` | S | No DTO; MediaPhase | New |
| POST `/mock/attempts/:attemptId/speaking/:questionId/start` | S | No DTO; MediaPhase | New |
| POST `/mock/attempts/:attemptId/speaking/:questionId` | S | Multipart `audio`, 25 MiB; `{saved:true,audioUrl}` | New |
| GET `/mock/attempts/:attemptId/answers/:questionId/audio` | A | Range; protected recorded audio | New |
| PUT `/mock/attempts/:attemptId/annotations` | S | `{annotations?:unknown[]}`; `{saved:true}` | New |
| POST `/mock/attempts/:attemptId/flag-cheat` | S | `{event:nonempty string<=50}`; `{saved:true}` | New, throttle parity pending |
| POST `/mock/attempts/:attemptId/advance` | S | No DTO; saved/currentSkill/submittedSections/serverTime/deadlines | New |
| GET `/mock/groups/:groupId/audio` | O | `attemptId?`, Range; stream | Existing; approved security change |
| GET `/mock/groups/:groupId/image` | O | Range; image stream | Existing |
| POST `/mock/attempts/:attemptId/submit` | S | `{skills?:MockSkill[]}`; synchronous scores/submission result + immutable enqueue | Checkpoint 1 |
| POST `/mock/exams/:id/purchase` | S | No DTO; `{status,amount}` | Checkpoint3 |
| GET `/mock/attempts` | T | ListAttemptsQueryDto; summaries/meta scoped by student | Checkpoint3 |
| POST `/mock/attempts/:attemptId/force-submit` | T | No DTO; submission result, audit, enqueue | Checkpoint3 |
| POST `/mock/attempts/:attemptId/extend` | T | `{minutes:integer 1..180}`; saved/deadlines/serverTime | Checkpoint3 |
| POST `/mock/attempts/:attemptId/reopen` | T | No DTO; `{saved:true,status:in_progress}` | Checkpoint3 |
| DELETE `/mock/attempts/:attemptId` | D | No DTO; `{deleted:true}`, cascading response cleanup | Checkpoint3 |
| GET `/mock/purchases` | D | page/limit/status; purchase summaries/meta | Checkpoint3 |
| POST `/mock/exams/:id/confirm-purchase` | D | `{userId}`; `{confirmed:true}`, notification/audit | Checkpoint3 |
| POST `/mock/exams/:id/reject-purchase` | D | `{userId}`; `{rejected:true}`, notification/audit | Checkpoint3 |
| GET `/mock/attempts/:attemptId/certificate` | A | Authorized completed result PDF | Checkpoint3 |

## Persisted mock semantics

Start requires StudentProfile, publication/demo visibility, enrolled exam program and purchase access. `MOCK_PURCHASE_PENDING` and `MOCK_PAYMENT_REQUIRED` are 402. No reference attempt limit was found: completed attempts do not prohibit a new Start. An existing in-progress attempt is resumed before new-definition readiness. The resumed attempt's stored specification and speaking profile override the current definition's versions.

The Start response is `{attemptId,resumed,mode,startedAt,deadlineAt,serverTime,durationMinutes,flowMode,currentSkill,sectionDeadlines,overallDeadlineAt,exam,annotations,savedAnswers}`. Audio answers resume as `[audio]`. The database stores null flowMode for single-skill; JSON reports `single_skill`. There is no answer revision or stale-save rejection contract: last processed response wins, empty text clears, duplicate question items are processed in order. Text saving updates only response/updatedAt, retaining audio and grading columns.

Definition starts lock MockExam and check contentVersion; mutations lock MockAttempt. No production schema changes. The reference does not persist a complete definition snapshot on an attempt; history safety relies on authoring locks and stored spec/profile versions. Do not invent a snapshot column.

IELTS single-skill timed deadlines run in parallel; the last skill in fixed L/R/W/S order supplies the overall deadline, not a max operation. Listening is authored audio seconds +120 (fallback 1800+120); Reading/Writing use section minutes or 60. IELTS Speaking is untimed. Full-test deadlines chain all L/R/W defaults, and IELTS with Speaking has no overall deadline. Multilevel current section durations are 45/60/60/11 minutes. Resume never resets a clock. Save rejects strictly after the deadline; the completeness gate treats exact deadline as expired.

Supported Multilevel mutations recheck MULTILEVEL enrollment. Versioned bulk rejects the entire mixed-section/foreign-question request; legacy bulk filters invalid/out-of-section items and errors only if nothing remains. Full-test writes require currentSkill. Advance is one-way. Versioned advance allows expired clocks, recalculates future deadlines, and caps at the original overall deadline.

MediaPhase is `{startedAt,prepEndsAt,expiresAt,plays,serverTime,playLimit:2}`. Listening preview is 20 seconds. Timed phases persist and enforce part order; practice recreates phases. Speaking profile upload acknowledgements gate the next response. Timed Speaking upload requires a started phase, prep completion, and a five-minute recovery window; a previously acknowledged take is immutable. Versioned uploads recognize audio container headers, not STT. Practice replacement preserves safe referenced-file cleanup.

Known errors: `MOCK_EXAM_NOT_FOUND`/`MOCK_ATTEMPT_NOT_FOUND` 404; `NOT_A_STUDENT`/`PROGRAM_NOT_ENROLLED`/`SECTION_LOCKED`/`PART_LOCKED`/`PREVIEW_ACTIVE`/`AUDIO_REPLAY_BLOCKED` 403; `MOCK_CONTENT_CONFLICT`/`PREVIOUS_UPLOAD_PENDING` 409; validation/empty/not-ready/unsupported/finished/time-up/section-time-up/flow-complete/recording-not-started/upload-window-expired/invalid-audio 400. Exact invalid-DTO first-error ordering and UTF-16 length parity are not fully verified.

Checkpoint 1 implements submission. Multilevel incomplete manual submission returns `MOCK_ATTEMPT_INCOMPLETE` with counts only; expired overall/section clocks excuse missing work. Full-test completeness requires only the current section. Versioned repeat submit returns the saved result; legacy repeat submit errors. Django ports synchronous deterministic scoring into `mock_scoring.py`, preserving result JSON, IELTS tables/rounding, Multilevel conversions and manual pending states. It writes scores, snapshots and in-app notifications under the attempt lock. Snapshot/job enqueue is a required compatibility handoff, not authorization to run providers. No separate mock timeout endpoint or background mock timeout job was found: the clients use advance/submit on clock expiration.

Transaction safety: Django rolls back score projections, finalization, snapshots and in-app notifications together if any handoff fails. Nest's public controller performs snapshot enqueue after the grading transaction and notifications. This stronger atomic boundary follows the requested rollback requirement; success JSON and persisted results match. A concurrent Nest loser can observe the intermediate `grading` claim; the harness retains its raw response rather than normalizing it away. Django's loser waits for the finalized transaction and returns the saved stable result. Existing manual scores are reused without introducing teacher-review functionality.

## Approved compatibility/security decisions

1. Preserve exact NestJS annotations behavior: owner may update annotations after submission. This does not permit changing completed answers.
2. Enforce attempt-bound student Listening/audio access, rather than copying the reference IELTS omitted-attempt replay bypass. The reference already rejects omission for an active timed Multilevel exam; the original broad vulnerability description was corrected after running the local fixture. Requests without attemptId are bound server-side to the student's active attempt for the same exam. No active attempt means denial. Explicit IDs cannot name foreign/completed attempts. Staff authoring and anonymous demo contracts remain unchanged. This is an intentional observable security difference; the differential report retains the mismatch.
3. Structural Start readiness remains distinct from fuller Review/Publish readiness, exactly as approved in Stage A.

## Legacy `/tests` — all 15 active scoped lifecycle routes implemented

| Method/path | Auth | Contract |
|---|---|---|
| GET `/tests` | O | QueryTestsDto; active/program-filtered paginated catalogue |
| GET `/tests/demo/list` | P | Active demos/meta |
| GET `/tests/demo/:id` | P | Sanitized demo questions |
| POST `/tests/demo/:id/submit` | P | DemoSubmitDto; stateless demo scoring |
| GET `/tests/:id` | A | Definition, staff/student sanitization |
| POST `/tests/:id/start` | S | No DTO; random skill pools, persisted questionOrder; resume original selection |
| GET `/tests/attempts/mine` | S | QueryAttemptsDto; active-program history/meta |
| GET `/tests/attempts/:attemptId` | A | Selected question review/answers/marks |
| POST `/tests/attempts/:attemptId/answer` | S | `{questionId,answer:string}`; `{saved:true}` |
| POST `/tests/attempts/:attemptId/marks` | S | `{questionId,highlights?:string[],note?:string<=2000}`; saved |
| POST `/tests/attempts/:attemptId/flag-cheat` | S | event string<=50; saved, cap50 and throttle30/min |
| POST `/tests/attempts/:attemptId/submit` | S | No DTO; `{status,autoScore}`, score/notifications |
| GET `/tests/questions/:questionId/audio` | P/S/T | Demo public; private student access bound to a live own selected attempt; staff authorized. Optional `attemptId`, Range. Approved security change from Nest's public access. |
| GET `/tests/attempts` | T | Scoped queue/meta |
| GET `/tests/attempts/:attemptId/certificate` | A | Authorized PDF |

Legacy uses the existing unmanaged Prisma-owned `Test`, `Question`, `TestAttempt`, `Answer`, `AntiCheatEvent`, `Notification`, `StudentProfile`, `Group` and `ParentStudent` tables, not Mock* tables. There is no separate section/session/submission/result table or tenant column in this lifecycle. No schema migration, invented snapshot column, bulk-answer, autosave, timeout or grading endpoint was added. Autosave repeats the existing single-answer POST. Timeout uses the same submit POST; no background timeout worker is ported.

### Requests, responses and database effects

Catalogue/demo-list queries are `page` (default 1), `limit` (default 20, maximum 100), `type:ielts|multilevel`, `program:IELTS|MULTILEVEL`; attempt-list queries additionally accept `status:in_progress|grading|completed`, `studentId`, `testId`, not `type`. Unknown query/body fields are rejected where the reference DTO applies. Start/submit have no DTO. All POST successes are 201 and all GET successes 200, except audio 206/416. JSON envelopes are defined above.

- Catalogue rows: `id,type,title,level,isDemo,isActive,durationMinutes,questionCount,sections`, with top-level pagination meta. Guests/parents see active demos; staff see all tests; students see active tests in their active enrolled program. Requested stale program gives 409 `PROGRAM_CHANGED`.
- Definition: metadata plus `sectionQuestionCounts`; ordinary authenticated users get no questions. Staff receive full questions including keys/storage keys/createdAt. Public demo detail requires active demo and adds sanitized questions and sections. Discovery/detail/demo-submit are read-only.
- Sanitized question: `id,section,type,prompt,options,maxScore,passageText,instructions,audioUrl,hasAudio`; audioUrl is `/v1/tests/questions/:id/audio` or null. No correctAnswer is returned by Start or demo detail.
- New Start: `attemptId,resumed:false,durationMinutes,startedAt,questions`. It creates one TestAttempt with persisted `questionOrder`, original `startedAt`, `in_progress`, zero cheat count and null score/finalization fields. Fisher–Yates randomizes each L/R/W/S pool before configured selection. Resume: same fields with `resumed:true,savedAnswers,savedMarks`; stored order and clock are retained, deleted questions filtered, no attempt reset. Enrollment is checked before resume.
- Answer: strict `{questionId,answer:string}`, no invented answer-size limit; `{saved:true}`. Upsert changes answer/updatedAt only. Marks: `{questionId,highlights?:string[],note?:string<=2000}`; `{saved:true}`. Highlights trim/filter length>=2, cap50, truncate300 using JS UTF-16 slicing. Marks preserve answer/scoring columns; omitted note is retained; marks-only insert has empty answer. Owner, in-progress state, strict `now > startedAt + durationMinutes` expiry and stored selection are checked. Completed/grading attempts cannot change answers or marks. Nullable duration has no deadline.
- Cheat: `{event:nonempty string<=50}`; `{saved:true}`. In-progress attempts insert at most 50 AntiCheatEvent rows and atomically increment antiCheatCount. Finalized attempts are a no-op. The real reference route's 30/minute per-IP/handler throttle includes invalid DTO hits and returns 429 `TOO_MANY_REQUESTS`.
- Submit: `{status,autoScore}`. Only persisted Answer rows are graded. Listening/Reading award maxScore for exact normalized key alternative, otherwise zero; every objective row is marked graded. Normalization is lower-case, ECMAScript trim and whitespace collapse, then `|` alternatives. There is no punctuation/article/NFKC expansion or IELTS/Multilevel band conversion in legacy scoring. Nonblank Writing/Speaking leaves status `grading`, manualScore/totalScore null; otherwise `completed`, manualScore zero and totalScore=autoScore. finishedAt is set in both states. No fabricated manual scores, AI jobs or AssessmentJob snapshot records exist in this reference lifecycle. Completion notifies student/linked parents; pending manual work notifies the assigned teacher. Sequential repeat submit is 400, not the versioned mock idempotent-success contract.
- Own history/staff queue: `id,studentId,testId,testTitle,testType,status,autoScore,manualScore,totalScore,antiCheatCount,startedAt,finishedAt`; staff queue adds studentName. Students are active-program scoped; teachers are assigned-group scoped; admins/super_admins are not teacher-filtered.
- Detail adds studentName and selected ordered questions: sanitized fields with `questionId,order,answer,score,isGraded,comment` instead of id. Only staff or completed owner receive objective correctAnswer/isCorrect. Owner/staff receive highlights/note; parents receive neither keys nor personal marks. Staff receive `cheatEvents:[{event,date}]`. Linked-parent/assigned-teacher/owner/admin scope follows the existing AccessService contract.
- Demo submit accepts optional answers object; values use reference JS String coercion. It scores all demo questions, not a shuffled selection, returning `testId,autoScore,totalScore,totalMax,autoMax,correctCount,autoCount,perQuestion,bySection`. Manual items are ungraded with zero demo contribution. It creates no attempts, answers, notifications or grading work.
- Certificate authorizes the same result scope, requires completed, and aggregates selected section score/max and persisted totalScore. Returns application/pdf, A4, `attachment; filename="certificate-:attemptId.pdf"`. Full extracted text/page bounds and HTTP metadata match local equivalent fixtures; PDF generator bytes/metadata differ (ReportLab vs PDFKit), not compared as identical bytes. Certificate JSON error content-type also matches Nest. PDF skill render/inspection verified clean layout; no external PDF service.
- Audio resolves existing validated storage keys, never absolute/client-selected file paths; no database mutation or file deletion. Demo audio stays public; private student audio requires enrollment, selected question and a non-expired in-progress own attempt. Omitted attemptId resolves that own attempt server-side. Staff access remains authorized. Range bytes/status/header semantics, including the reference's permissive suffix/malformed handling, are preserved.

### Error/status inventory and transaction safety

401 `UNAUTHORIZED` for protected anonymous routes; 403 `FORBIDDEN` for role/scope denial; 403 `NOT_A_STUDENT` without profile and `PROGRAM_NOT_ENROLLED` without test-program enrollment; 409 `PROGRAM_CHANGED`; 404 `TEST_NOT_FOUND`, `ATTEMPT_NOT_FOUND`, `QUESTION_NOT_FOUND`, `FILE_NOT_FOUND`; 400 `TEST_EMPTY`, `QUESTION_NOT_IN_ATTEMPT`, `TEST_TIME_UP`, `ATTEMPT_NOT_COMPLETED`, `VALIDATION_ERROR`; 400 `ATTEMPT_FINISHED` with the reference's distinct save vs submit messages; 429 `TOO_MANY_REQUESTS`. Valid/invalid DTO, roles, ownership, enrollment, completed mutation and expiry fixtures compare exact JSON/status/database state, without translating semantic errors.

Django locks Test for fresh starts and TestAttempt for saves/marks/cheat/submit under transaction.atomic. Separate-connection PostgreSQL tests verify one durable start, one duplicate-save row, one successful concurrent submit and one ATTEMPT_FINISHED, timeout-vs-submit, save-vs-submit, no double scoring/notifications and rollback after injected notification failure. Reference sequential JSON and final persisted state match. Nest lacks these start/submit locks and sends notifications outside its scoring transaction: Django intentionally strengthens serialization/atomicity as required by Checkpoint 2 Step 5. This is not a claim of identical concurrent Nest responses. Legacy scoring remains separate from `mock_scoring.py`; only proven-identical ECMAScript whitespace helpers are reused.

No orphaned desktop student lifecycle route was established. Legacy authoring/admin grading routes are active but explicitly outside the scoped student lifecycle; no claim that all backend `/tests` functionality has migrated. Provider/teacher assessment remains deferred. Checkpoint2: 15/15 registered, 158 recorded groups (157 API/DB plus one PG group containing 16 checks), 156 pass, two explicitly approved private-media denials, zero unapproved differences. Checkpoint3 adds all ten formerly missing mock contracts: 153/153 recorded groups pass. No scoped routes remain missing. The broader historical mock verification limitations are not claims of provider/assessment coverage; the scoped Checkpoint3 gate verifies current routes without starting Stage C.
