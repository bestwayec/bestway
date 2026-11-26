# BESTWAY Exam System 4.1 verification

Tests ran on synthetic local data using PostgreSQL 17.11, Redis 8.2.10, Django with Gunicorn, and Chromium. The production frontend build used the lockfile's Next.js 16.4.6. The browser stack used the locally installed Next.js 16.3.6.

## Browser and database evidence

| Journey | Result |
| --- | --- |
| IELTS Writing regression | Five checks. Stale skill link, paragraph and cursor edits, Chromium IME, offline recovery and task switching, then exact matching against the saved submission snapshot. |
| Timed Writing | Six checks including real keys, word count, permitted internal cut and paste, outside-paste blocking, and the anomaly log. |
| IELTS full | 10 of 10. Listening 9, Reading 9, Writing 6.5, Speaking 7, overall 8. Speaking used three recordings and one teacher-led live part. |
| Multilevel full | 16 of 16. Eight native recordings with measured durations from 30 to 120 seconds and a recovered network interruption. Teacher grades produced the platform's internal result of 68.5 of 75, C1. |
| Teacher Workspace | 45 of 45. Assignment workflow, attendance, results and access separation, and checks at three viewport widths. |
| Teacher review with provider credentials absent | Three checks. Both original essays remain available, the teacher draft survives a reload, and the teacher releases the score and comment. Student projections omit the draft and advisory score. |
| Exam System 4.0 reliability | Four checks covering offline recovery, competing browser tabs, lost submit responses, and server-verified Speaking upload receipts. |
| Exam System 4.0 review and analytics | Five checks covering archived result access, historical evidence, assignment launch, ranking, and filtered PDF and Excel downloads. |
| Assigned full IELTS examination | The teacher created a classroom, enrolled a synthetic learner, and assigned a published examination. All eight student and grading checks passed. The assignment's gradebook contained one completed learner, 100% completion, and IELTS average, median and best of 8. Duplicate assignment requests and replayed starts reused existing records. An unenrolled learner received HTTP 404. Both filtered exports opened. |

PostgreSQL confirmed two saved essays and three audio references for IELTS attempt `363d9fed-0bbe-4408-afc9-cfa230641f57`. Multilevel attempt `0eeef012-3f92-423a-b352-d6cf5a78d8ab` has three essays, eight audio references and a persisted 68.5 C1 result. Practice attempt `255afbe8-7e28-468b-89ae-863bb1c4cd22` held both typed essays while awaiting teacher review during the keyboard check. Assigned attempt `3a897f6e-0f02-46e7-88af-26be5563720c` produced IELTS band 8. Browser captures and logs were kept in local synthetic test outputs.

## Regression suites and limits

- Django system checks passed and no migrations were pending or required. PostgreSQL pytest passed 1,718 tests and 327 subtests, with four compiled-reference-dependent cases skipped.
- Nine worker harness checks use actual management-command subprocesses, PostgreSQL, and loopback HTTP. They cover advisory persistence, 429 with `Retry-After`, restart recovery, matching model provenance, budget exhaustion, manual finalization while the provider is active, and simultaneous review conflicts.
- The PostgreSQL grading harness passed 87 checks, including exact rubric release, private transcript corrections, permission denials, and rollback after failed grading.
- Seven shared Redis checks cover cross-process ownership, concurrent saves and submissions, restart and expiry recovery, and retryable failure without answer mutation.
- The frontend passed 999 Vitest cases, TypeScript and the Next.js production build. ESLint reported zero errors and 406 warnings.
- The optional historical compiled NestJS comparison has 76 mismatches against both initial `main` and the candidate with the available old reference binary. The standard suite skips the four compiled-reference-dependent cases when that binary is absent.
- The checked-in Prisma migration SQL was applied to the clean local database. The normal Prisma CLI migration check could not download the checksum from `binaries.prisma.sh` through the cloud proxy. Prisma CLI and migration ledger verification remain open.
- Groq and OpenRouter transport tests use loopback fixtures. Real catalog, endpoint, image, privacy, cost, and calibration verification remain open.
