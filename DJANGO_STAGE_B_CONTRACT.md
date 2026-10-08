# Stage B lifecycle contract inventory — incomplete gate

Reference: the active built `MockController` and `TestsController`, their source services/DTOs, and actual calls in `frontend/src/hooks/use-mock.ts`, `frontend/src/components/mock/mock-runner.tsx`, and `../bw-tauri/src/lib/{mocks,tests,cheat}.ts`.

Run `node backend-django/scripts/stage_b_inventory.cjs` for exact methods, paths, role metadata, public/optional authentication and success statuses. This is not an inventory of all backend routes: authoring mutations and assessment/grading implementation are outside Stage B. Direct lifecycle access, management and result-support contracts are included, even when unimplemented. The user explicitly included legacy `/tests`.

Active scoped contracts: **43** (28 mock, 15 legacy). Registered in Django: **17** (13 new lifecycle routes, four existing catalogue/media routes). Missing: **26**. Registration is not proof of full compatibility.

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
| POST `/mock/attempts/:attemptId/submit` | S | `{skills?:MockSkill[]}`; grading/submission result + enqueue | Missing |
| POST `/mock/exams/:id/purchase` | S | No DTO; `{status,amount}` | Missing |
| GET `/mock/attempts` | T | ListAttemptsQueryDto; summaries/meta scoped by student | Missing |
| POST `/mock/attempts/:attemptId/force-submit` | T | No DTO; submission result, audit, enqueue | Missing |
| POST `/mock/attempts/:attemptId/extend` | T | `{minutes:integer 1..180}`; saved/deadlines/serverTime | Missing |
| POST `/mock/attempts/:attemptId/reopen` | T | No DTO; `{saved:true,status:in_progress}` | Missing |
| DELETE `/mock/attempts/:attemptId` | D | No DTO; `{deleted:true}`, cascading response cleanup | Missing |
| GET `/mock/purchases` | D | page/limit/status; purchase summaries/meta | Missing |
| POST `/mock/exams/:id/confirm-purchase` | D | `{userId}`; purchased result, notification/audit | Missing |
| POST `/mock/exams/:id/reject-purchase` | D | `{userId}`; rejection, notification/audit | Missing |
| GET `/mock/attempts/:attemptId/certificate` | A | Authorized result PDF | Missing result-support contract |

## Persisted mock semantics

Start requires StudentProfile, publication/demo visibility, enrolled exam program and purchase access. `MOCK_PURCHASE_PENDING` and `MOCK_PAYMENT_REQUIRED` are 402. No reference attempt limit was found: completed attempts do not prohibit a new Start. An existing in-progress attempt is resumed before new-definition readiness. The resumed attempt's stored specification and speaking profile override the current definition's versions.

The Start response is `{attemptId,resumed,mode,startedAt,deadlineAt,serverTime,durationMinutes,flowMode,currentSkill,sectionDeadlines,overallDeadlineAt,exam,annotations,savedAnswers}`. Audio answers resume as `[audio]`. The database stores null flowMode for single-skill; JSON reports `single_skill`. There is no answer revision or stale-save rejection contract: last processed response wins, empty text clears, duplicate question items are processed in order. Text saving updates only response/updatedAt, retaining audio and grading columns.

Definition starts lock MockExam and check contentVersion; mutations lock MockAttempt. No production schema changes. The reference does not persist a complete definition snapshot on an attempt; history safety relies on authoring locks and stored spec/profile versions. Do not invent a snapshot column.

IELTS single-skill timed deadlines run in parallel; the last skill in fixed L/R/W/S order supplies the overall deadline, not a max operation. Listening is authored audio seconds +120 (fallback 1800+120); Reading/Writing use section minutes or 60. IELTS Speaking is untimed. Full-test deadlines chain all L/R/W defaults, and IELTS with Speaking has no overall deadline. Multilevel current section durations are 45/60/60/11 minutes. Resume never resets a clock. Save rejects strictly after the deadline; the completeness gate treats exact deadline as expired.

Supported Multilevel mutations recheck MULTILEVEL enrollment. Versioned bulk rejects the entire mixed-section/foreign-question request; legacy bulk filters invalid/out-of-section items and errors only if nothing remains. Full-test writes require currentSkill. Advance is one-way. Versioned advance allows expired clocks, recalculates future deadlines, and caps at the original overall deadline.

MediaPhase is `{startedAt,prepEndsAt,expiresAt,plays,serverTime,playLimit:2}`. Listening preview is 20 seconds. Timed phases persist and enforce part order; practice recreates phases. Speaking profile upload acknowledgements gate the next response. Timed Speaking upload requires a started phase, prep completion, and a five-minute recovery window; a previously acknowledged take is immutable. Versioned uploads recognize audio container headers, not STT. Practice replacement preserves safe referenced-file cleanup.

Known errors: `MOCK_EXAM_NOT_FOUND`/`MOCK_ATTEMPT_NOT_FOUND` 404; `NOT_A_STUDENT`/`PROGRAM_NOT_ENROLLED`/`SECTION_LOCKED`/`PART_LOCKED`/`PREVIEW_ACTIVE`/`AUDIO_REPLAY_BLOCKED` 403; `MOCK_CONTENT_CONFLICT`/`PREVIOUS_UPLOAD_PENDING` 409; validation/empty/not-ready/unsupported/finished/time-up/section-time-up/flow-complete/recording-not-started/upload-window-expired/invalid-audio 400. Exact invalid-DTO first-error ordering and UTF-16 length parity are not fully verified.

Submission remains unimplemented. Reference Multilevel incomplete manual submission returns `MOCK_ATTEMPT_INCOMPLETE` with counts only; expired overall/section clocks excuse missing work. Full-test completeness requires only the current section. Versioned repeat submit returns the saved result; legacy repeat submit errors. `MockGradingService.submit` synchronously scores objective sections, updates status/scores and notifies, then the controller calls `AssessmentService.enqueue`. Porting a bare status change would not preserve this contract. Snapshot/job enqueue is a required compatibility handoff, not authorization to run providers. No separate mock timeout endpoint or background mock timeout job was found: the clients use advance/submit on clock expiration.

## Approved compatibility/security decisions

1. Preserve exact NestJS annotations behavior: owner may update annotations after submission. This does not permit changing completed answers.
2. Enforce attempt-bound student Listening/audio access, rather than copying the reference IELTS omitted-attempt replay bypass. The reference already rejects omission for an active timed Multilevel exam; the original broad vulnerability description was corrected after running the local fixture. Requests without attemptId are bound server-side to the student's active attempt for the same exam. No active attempt means denial. Explicit IDs cannot name foreign/completed attempts. Staff authoring and anonymous demo contracts remain unchanged. This is an intentional observable security difference; the differential report retains the mismatch.
3. Structural Start readiness remains distinct from fuller Review/Publish readiness, exactly as approved in Stage A.

## Legacy `/tests` — active, not orphaned; all missing

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
| GET `/tests/questions/:questionId/audio` | P | Range; service enforces demo/audio access |
| GET `/tests/attempts` | T | Scoped queue/meta |
| GET `/tests/attempts/:attemptId/certificate` | A | Authorized PDF |

Legacy uses Test/TestAttempt/Question/Answer/AntiCheatEvent, not Mock* tables. Start selects shuffled pools by sectionQuestionCounts and persists questionOrder. Answer/marks validate membership in that order, ownership, in-progress state and startedAt + Test.durationMinutes. Resume keeps selection and savedMarks. Marks trim/filter highlights (length>=2), cap50, truncate300, and do not change answer text. Submit computes objective scores and makes nonblank Writing/Speaking responses pending grading. Legacy duplicate Start and submit concurrency are not safely serialized in the reference and must be verified/reported, not assumed safe.

No orphaned desktop student lifecycle route was established in the inspected references. Assessment feedback calls are active but provider assessment implementation remains later-stage work. Exact legacy payload/error/DB differential inventory and result-support decisions are still outstanding; this document does not claim Step 1's full gate is complete.
