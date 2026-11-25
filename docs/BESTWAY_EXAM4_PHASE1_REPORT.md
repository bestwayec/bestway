# Bestway Exam System 4.0 · Phase 1 report

## Findings and changes

| Finding | Change |
| --- | --- |
| The runner accepted a batch count as proof of persistence. A delayed response could clear a newer local edit or apply an older conflict result to the editor. | PostgreSQL checks the base revision while holding the attempt lock. The API returns a receipt for each question and edit. The runner removes only the matching edit, advances the base revision of an edit typed in flight, and asks the student explicitly how to resolve conflicts. |
| Finish and advance resent clean answers with new timestamps. A stale snapshot could overwrite a response already stored elsewhere. | Both actions drain only pending edits. Hand-in during a failed save stays open, and a lost hand-in response is reconciled against the server status. The submission transaction includes any inline answers accepted by older clients. |
| The queue stored each attempt in one shared browser value and swallowed write failures. Clearing that value on hand-in could erase unsent edits. | Per-writer, per-question storage isolates edits. Existing queue records remain readable. The UI reports quota and storage failures, and the attempt owner can review and remove unconfirmed local edits after completion. The queue contains response text and revision metadata. |
| A repeated advance could advance the next section. Browser-driven timeouts could attempt an early transition. | Advance carries the expected section and retries return the current cursor. Timeout actions require the server deadline to have passed. Expired text edits stay local, and scoring uses the answers the server accepted before expiry. |
| A transport success could be treated as a recording receipt. Playback metadata was deferred and suffix ranges were read from the wrong byte offset. | Both recorders wait for a saved response before releasing the take. New recordings are validated and measured before receipt. The player loads metadata, reports playback failures, and uses the authenticated range endpoint. |

The reported production symptoms do not identify one failure. This investigation used local synthetic accounts. The production health request returned HTTP 403, so the deployed commit and the specific recording behind the 0:00 display could not be verified.

## Test environment

PostgreSQL 17, Python 3.12, Node 24, Next.js 16, and local Chromium. GitHub CI and manual deployment workflows were reviewed. The Prisma engine host was blocked in the cloud environment, so the loopback browser test database was created by replaying the 23 checked-in Prisma SQL files in order and then applying Django migrations. Prisma CLI and its migration ledger require verification through the normal CI setup.

## Reproduction

Run the Django suite on disposable PostgreSQL with `python -m pytest`. The focused suite is `tests/test_exam4_reliability_postgres.py`. It checks the database rows and the submission handoff after concurrent saves, section advances, expiry, duplicate hand-in, and audio range requests.

From `frontend`, run `npm run lint`, `npm test`, and `npm run build`. From `scripts/e2e-local`, run `npm ci` and `node exam4-reliability.mjs` against a loopback Django and Next.js stack seeded with `seed_local_dev` and `seed_ielts_mock1_academic`. Set `BW_WEB` for a nondefault port and `BW_CHROMIUM` to use a system Chromium.

## Verification results

- The Django suite passed 1,686 tests on PostgreSQL. Four legacy NestJS comparison tests were skipped because their build artifact was unavailable.
- All 981 frontend tests passed. The Next.js production build passed. Lint finished with zero errors and 426 warnings.
- Chromium verified offline editing, a deterministic HTTP 503, local recovery after reload, expired access cookie refresh, and a matching server receipt for IELTS and Multilevel. Both browser runs intercepted the submit response after Django committed and then recovered the result from the server. A direct PostgreSQL check confirmed the IELTS answer, graded state, and one submission handoff after restart.
- The IELTS browser run uploaded a synthetic recording and fetched it over the authorized range endpoint. Chromium reported a positive duration. The PostgreSQL regression additionally verifies that a rejected corrupt upload preserves the previous take.
- The session browser check passed 22 assertions across same-browser tabs and separate browser contexts. It verified the Uzbek takeover prompt, refused writes from the previous session, and confirmed the chosen response after resolving a conflict.

Run the same browser check with `BW_EXAM4_EXAM=MOCK-RECORD-01` for Multilevel Reading. Use the synthetic fixtures when running either path.
For `exam-session.mjs`, start Next with `--hostname localhost` and use the same hostname in `BW_WEB`. This keeps the default-locale rewrite on the local server.

## Deployment validation

The web and backend should be released together so the web runner receives per-answer acknowledgments. The older API contract still accepts unversioned clients. Exercise the shared Redis lease with more than one backend process and verify representative mobile audio formats and the deployed build ID during final integration.
