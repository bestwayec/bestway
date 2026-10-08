# Stage B Checkpoint 4 — local client integration

Date: 2026-10-08. Verdict: **STAGE_B_INTEGRATION_BLOCKED**.

Stage A and the 43/43 Stage B API implementation remain intact. This gate is
separate from API parity; native desktop tests and complete browser lifecycle
coverage have not passed. No Stage C implementation, merge or deployment.

## Runtime and latency evidence

Django runs on `127.0.0.1:8001`, using localhost PostgreSQL and a generated
schema. Next.js uses its actual server-side `API_URL` variable set to
`http://127.0.0.1:8001/v1`; browsers use the existing `/api/backend` proxy.
No client source or environment files are changed. The browser aborts all
non-loopback requests. Tokens/passwords and cookie values are not recorded.

The earlier Next login request took 28.2 seconds: its server log attributed
22.7 seconds to Next.js processing and 5.5 seconds to application code.
This is evidence of substantial cold-route overhead, not a measured
28-second Django authentication operation. Instrumented reproduction measured:

| Measurement | Duration / result |
|---|---|
| Direct Django login | 1,228 ms / 200 |
| Cold Next login, invalid disposable credentials | 3,653 ms / 401 |
| Warm same Next login route | 411 ms / 401 |
| Browser valid login | about 1,347 ms / 200 |
| First post-login catalogue render, server log | 30.9 seconds / 200 |

The original 30-second listener was already registered before clicking.
Cold compilation consumed most of that budget. After prewarming with invalid
credentials, valid browser login succeeded; a separate test synchronization
failure then attempted to read `body` during full-document navigation.
The runner now waits for committed DOM and actual catalogue content, records
request timings/failures, and captures screenshots before browser teardown.
No timeout-only change is presented as a product fix. Cookie processing is
included in the Next route application time, not separately instrumented;
there is no evidence it caused the large cold-route delay.

The default `/login` URL also returned a 307 redirect to itself in local
testing. Existing `/en/login` rendered successfully. This remains a frontend
locale-routing issue to reproduce/fix with explicit client-source approval,
not evidence of a Django JSON or authentication defect.

## Real browser evidence

The initial completed instrumented run verified rendered student, teacher
and admin logins; student catalogue/exam detail; staff catalogue and admin
setup page. Matching Next proxy and Django request/status evidence is in
`backend-django/STAGE_B_CLIENT_REPORT.json`. All three `bw_*` cookies were
HTTP-only, SameSite=Lax and correctly non-Secure on local HTTP; values omitted.
Screenshots are `backend-django/STAGE_B_CLIENT_*.png`.

The expanded runner exercises timed IELTS Reading start, real answer input,
autosave, reload, preserved database start/deadline, submission/completed state
and staff starter creation. Its latest machine report is authoritative for
which assertions finished; it is not a claim of complete four-skill coverage.

Latest run **FAILED at autosave**. Actual Start returned 201, attempt fetch
returned 200, and the rendered timed Reading screen showed `1 / 1 answered`
after entering the fixture answer. **No POST `/answers` occurred in the
90-second observation window**, so reload/submission were not reached. This
failure is not a slow response from a save endpoint: no save request was sent.

Source diagnosis: `frontend/src/components/mock/mock-runner.tsx:140` depends on
the whole `bulk` mutation object for `flush`; the autosave effect at line143
depends on `flush` and resets a 1,500ms timeout. The clock at line221 rerenders
every 1,000ms. Installed `@tanstack/react-query/src/useMutation.ts` returns a new
`{ ...result, mutate, mutateAsync }` wrapper each render. Thus timed rerenders
can perpetually reset the save debounce (and the versioned recovery interval).
The smallest proposed product fix is to depend on stable `mutate`/`mutateAsync`
callbacks, not the whole mutation wrapper, then verify timed autosave and
recovery with browser tests. **Frontend change requires user approval; not made.**

There were also transient 502s for `/api/backend/exam-programs/mine`,
`/api/backend/mock/exams?program=IELTS` and
`/api/backend/mock/attempts/mine?program=IELTS`; retries returned200.
The existing Next proxy's eight-second upstream timeout is visible in the
8.0–9.2-second server logs. These remain performance/recovery findings, not
demonstrated contract mismatches or authorization bypasses. No production
requests were observed. Console findings were WebGL ReadPixels GPU warnings;
no application page errors were recorded in this run.

Still required: both complete IELTS and Multilevel student flows, Listening,
Writing/Speaking pending-result flows, dashboard traversal, logout/refresh,
ownership denial through UI, editor save/Review/preview/publish, clone/repair,
duplicate/incomplete submission and network recovery. No invented AI results.

## Media and native desktop

The three approved attempt-bound restrictions remain visible in differential
results: expired IELTS mock audio, anonymous private legacy audio, and private
legacy audio after finalization. They are not normalized away or weakened.
Real-browser/desktop audio replay and practice coverage remain incomplete.

Source inspection: web `mock-runner.tsx` sends `attemptId` for strict/timed
audio; practice omits it. Tauri `src/lib/mocks.ts` follows the same contract;
`src/lib/tests.ts` resolves legacy audio paths without an attempt parameter.
Django binds omitted student audio IDs to a live own attempt and applies
ownership, timing and playback gates. Static inspection/API parity do not
prove actual native playback.

The desktop checkout exists at `C:\Users\user\Desktop\bwww\bw-tauri`.
Local build overrides use real `BESTWAY_API_URL` and `VITE_WEB_URL` variables.
Native E2E: **UNVERIFIED**. Both UI-control runtimes failed initialization:
`failed to write kernel assets: Системе не удается найти указанный путь. (os error 3)`.
No native network or restart evidence was fabricated.

## Regression and resource limits

| Check | Current evidence |
|---|---|
| Django system check | PASS |
| Django pytest | 127 passed + 11 subtests |
| Combined Stage A/B differential | 705 groups: 702 pass, 3 approved differences, 0 unapproved failures |
| Stage A differential within combined run | 268 pass |
| Stage A PostgreSQL authoring checks | 163/163 pass; zero fixture leftovers |
| Stage B PostgreSQL safety | Included in rerun combined differential; no unapproved failures |
| Nest reference tests | 421 tests / 31 files pass |
| Nest typecheck/build/Prisma validation | PASS |
| Next.js unit tests | 158 / 28 files pass |
| Next.js typecheck | PASS with `--incremental false` after initial ENOSPC |
| Next.js lint | PASS: 0 errors, 31 existing warnings |
| Next.js production build | UNVERIFIED under disk headroom constraint |
| Tauri client unit tests | 140 / 15 files pass |
| Tauri TypeScript/Vite bundle | PASS; large-chunk warning |
| Native Rust offline test/build | FAIL: `rustc-LLVM ERROR: IO failure on output stream: no space on device` |

Native compilation exhausted C: (about 50 MB observed just before failure).
The compiler exited before the targeted stop request; failed compiler temporary
output was released, leaving roughly 575 MB. Existing build caches/user files
were not deleted. No further large build is safe without more disk space.
PostgreSQL UI cleanup initially also failed with `DiskFull`; the two leftover
schemas were individually inspected, contained only disposable UI users,
and were subsequently removed. Public/local user data was untouched.

## Exact blockers / handoff

1. Native UI-control runtime unavailable; native lifecycle/media evidence absent.
2. Insufficient disk headroom for native build and complete client build gates.
3. **Timed browser autosave never sends a request**; requires approval for the
   minimal frontend callback-dependency correction described above.
4. Complete IELTS/Multilevel student/staff/recovery/media browser matrix remains
   unverified; the machine report records only executed flows.
5. Default-locale local login redirect loop requires client diagnosis/approval
   if a product-source correction is necessary.

Only test infrastructure/evidence/docs are eligible for commit. Unrelated
`tmp/` and `tmpprobe_login2.py` changes are preserved and excluded. No frontend,
Tauri or NestJS product source changes. No production access.

Runner prerequisites: `backend-django/requirements/client-verification.txt`
(Playwright1.58.0 plus existing development dependencies), installed Chromium,
`pg_dump`, Node and local PostgreSQL. Supply DATABASE_URL only in the process
environment; never commit its value. The runner owns and removes its generated
schema/storage/services; reports exclude token/password/cookie values.
