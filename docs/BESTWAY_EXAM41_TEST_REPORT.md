# BESTWAY Exam System 4.1 verification

Tests ran on synthetic local data using PostgreSQL 17.11, Redis 8.2.10, Django with Gunicorn, and Chromium. The production frontend build used the lockfile's Next.js 16.4.6. The browser stack used the locally installed Next.js 16.3.6.

## Browser and database evidence

| Journey | Result |
| --- | --- |
| IELTS Writing regression | Five checks. Stale skill link, paragraph and cursor edits, Chromium IME, offline recovery and task switching, then exact matching against the saved submission snapshot. |
| Timed Writing | Six checks including real keys, word count, permitted internal cut and paste, outside-paste blocking, and the anomaly log. |
| IELTS full | 10 of 10. Listening 9, Reading 9, Writing 6.5, Speaking 7, overall 8. Speaking used three recordings and one teacher-led live part. |
| Multilevel full | 16 of 16. Eight native recordings with measured durations from 30 to 120 seconds and a recovered network interruption. Teacher grades produced 68.5 of 75, C1. |
| Teacher Workspace | 45 of 45. Assignment workflow, attendance, results and access separation, and checks at three viewport widths. |

PostgreSQL confirmed two saved essays and three audio references for IELTS attempt `363d9fed-0bbe-4408-afc9-cfa230641f57`. Multilevel attempt `0eeef012-3f92-423a-b352-d6cf5a78d8ab` has three essays, eight audio references and a persisted 68.5 C1 result. Practice attempt `255afbe8-7e28-468b-89ae-863bb1c4cd22` held both typed essays while awaiting teacher review during the keyboard check. Browser captures and logs were kept in local synthetic test outputs.

## Regression suites and limits

- Django system and migration checks run against the local stack. PostgreSQL pytest covers app contracts, provider failure cases, group reporting, visibility, and score conversions.
- The dedicated worker harness uses actual management-command subprocesses, PostgreSQL, and loopback HTTP. It checks advisory persistence, 429 with `Retry-After`, restart recovery, retained teacher grades during late delivery, and simultaneous review conflicts.
- The optional historical compiled NestJS comparison has 76 mismatches against both initial `main` and the candidate with the available old reference binary. The standard suite skips the four compiled-reference-dependent cases when that binary is absent.
- The checked-in Prisma migration SQL was applied to the clean local database. The normal Prisma CLI migration check could not download the checksum from `binaries.prisma.sh` through the cloud proxy. Prisma CLI and migration ledger verification remain open.
- Groq and OpenRouter transport tests use loopback fixtures. Real catalog, endpoint, image, privacy, cost, and calibration verification remain open.
