# BESTWAY Exam System 4.0 · Phase 4 audit

The integration branch starts at Phase 3 `e43f15389a6b0d824bf6e2b28d362014369b8537`. The audit uses synthetic data and loopback services. Production approval remains gated on the test and merge reports.

## Audit coverage

| Pass | Evidence | Remaining |
| --- | --- | --- |
| Functional | IELTS full mock and scoring, Reading and Listening practice, Builder creation and publication, package round-trips, review and profile target persistence, participation and reporting | Full supported-format UI matrix and device coverage |
| Integration | Real Django, PostgreSQL, Redis and Next.js, classroom and vocabulary contracts, older answer API contract, deployment trigger review | Hosted Prisma and CI, installed desktop client |
| Defensive security | Scoped staff and learner access, embargoed fields, timed writes, safe CSV/XLSX text, private playback, rights and Listening gates, dependency review | Development dependency advisories and hosted checks |
| Reliability and performance | Offline responses, lost submit acknowledgement, duplicate submissions, Redis outage and expiry, synthetic analytics load, native audio and server-side duration verification | Physical device coverage and complete HTTP failure matrix |

## Finding register

| ID | Severity | Reproduction and root cause | Change and verification |
| --- | --- | --- | --- |
| EX4-401 | P1 | Native Speaking timed from the call to start, and late JS stop callbacks could discard a finalized take. A 120-second standalone Chromium capture started producing data 50–63 ms after the start call. Separate full-flow failures contained 28.20 or 28.32 seconds of decoded samples in roughly 30 seconds on the media timeline. The earlier 117.96-second take remains historical evidence. | Wait for MediaRecorder readiness, bound startup allowance to three seconds and the original exam deadline, and let the server validate finalized bytes. Return honest timed retry guidance. Delayed start, delayed stop, rejection, and repeat grant tests passed. Both reproduced sample-loss failures remain valid rejections. The final journey verified all eight native recordings, their decoded durations and browser playback. |
| EX4-402 | P1 | Mock 27’s three legacy Reading groups have distinct passage numbers and identical source text. Phase 2 merged them into one passage and prevented an otherwise valid exam from publishing. | Use a numbered heading as a boundary for legacy groups while honoring explicit stimulus references. The normal Mock 27 PostgreSQL checks passed 80/80 after the fix. |
| EX4-403 | P1 | Session validation and annotations or OCR persistence could occur in separate transactions. A takeover between them could leave a stale write. A Redis connection failure surfaced as a generic error. | Hold the lease check and annotation write under the same lock and recheck after OCR before saving. Unavailable Redis returns 503 and the same retry guidance as a database outage. Local HTTP checks confirmed saved data survived cache unavailability. |
| EX4-404 | P1 | The exam-specific XLSX inferred spreadsheet formulas for imported text. Its PDF also cut off learners after row 20. | Write text as literal cells and paginate. Regression checks read the exported workbook and locate learner 21 on the second PDF page. |
| EX4-405 | P2 | The desktop release UI kept loading while its metadata request stalled. | Abort after eight seconds, cancel obsolete requests, retain the official release link, and retry with a fresh request. The public latest page resolved to v1.0.12 and the listed Windows installer returned HTTP 206. |
| EX4-406 | P2 | A clean local classroom seed provided profile membership without dated enrollment, so Phase 3 participation verification undercounted learners. | Seed enrollment through the normal roster service. The browser participation and historical-result flow passed using two dated synthetic enrollments. |
| EX4-407 | P1 | Runtime package audit reported Next.js and Python dependency advisories on existing pins. | Update targeted packages within their existing major versions. Frontend production audit reported zero advisories with Next.js 16.4.6. See the test report for remaining development and Python findings. |
| EX4-408 | P2 | The title and evidence of historical phases were compatible with the dashboards, but the specialized dual-layer report selects its current roster and latest exam attempt. | Generic dashboard, PDF, XLSX and CSV share filters. Exact filter and scoring-policy parity for the separate dual-layer report remains open. |

## Pre-existing observations

The last NestJS source could be transpiled for pure reference checks. The same differential case failures occurred on main and Phase 4. The old reference therefore does not establish native desktop compatibility. An existing LMS profile fallback also uses an ORM array cast incompatible with Prisma’s enum-array column when it must create a missing profile. Exam and classroom fixtures now work against both database schemas. The LMS fallback was outside the changed exam flows.

The cloud proxy denied GitHub REST and the signed Prisma engine download. The local HTTP and SQL checks used no production services.
