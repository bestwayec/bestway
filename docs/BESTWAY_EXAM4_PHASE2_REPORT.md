# Bestway Exam System 4.0 · Phase 2 report

## Base and scope

Phase 2 is stacked on the verified Phase 1 commit `b0849f552d146991dfd8ae0b09cc56573ca799b0`. The fetched `main` did not contain that commit. The draft PR base is `fix/bestway-exam4-reliability`. GitHub GraphQL returned Forbidden for the PR lookup.

## Findings and implementation

- The candidate stepper treated each persisted group as a passage or part. The runner also suppressed source text when a group contained a rich task document. The shared frontend adapter now uses the Reading `stimulusRef` or IELTS Listening `partNumber`. Legacy consecutive Reading groups with repeated normalized text stay together. A source-less legacy group stays separate until a teacher associates it.
- Reading shows source text and image once beside the task groups. Gaps use original stored numbers and question IDs. Static task documents appear with the questions. A repeated gap token produces one input and an inert blank. Questions without matching tokens keep their normal controls. Matching tasks with identical ordered option lists show one bank and per-question dropdowns.
- IELTS Listening uses one audio owner per numbered part. Practice scope retains the affected task groups even when the audio is on a sibling. The runner uses the existing authorized audio endpoint and stored IELTS playback schedule. Exam and practice continue to use their existing controls. Multilevel retains its existing per-group playback policy.
- The palette uses candidate-facing positions, and the browser session remembers the active question by ID. Source and audio grouping leave the existing Phase 1 answer writer, revision receipts, and attempt gates in place. An IELTS multi-response card can span several positions. Full-section scoring checks the objective maximum, while stored question IDs and gap numbers remain the persistence keys.
- The builder can create a group in an existing passage or numbered IELTS part and move a task group without its own source or audio. The operation uses `parentGroupId` on the existing draft group endpoints and the exam's existing write lock. Editors link to the source group when a task inherits passage text or audio.
- Candidate-shaped responses carry the association metadata. JSON import and export preserve explicit associations. Publish validation checks for one unambiguous Reading source and one Listening audio owner per unit. Drafts can retain unresolved associations. The existing Prisma-owned columns cover this contract without a new migration or a rewrite of historical content.

## Reproduction and verification

Run the backend suite against disposable PostgreSQL. Focused coverage lives in `tests/test_exam4_content_units.py`, `tests/test_exam_templates_and_export.py`, and `tests/test_question_numbering.py`. Run `npm test`, `npm run lint`, `npm run build`, and then `tsc --noEmit` from the frontend. The build generates route types, so run it sequentially with the standalone TypeScript check.

For Chromium, seed the usual local accounts and run `manage.py shell < ../scripts/e2e-local/seed-exam4-phase2.py` from `backend-django` with a loopback `*_local` database. Run `node exam4-builder-reading-listening.mjs` from `scripts/e2e-local` with `BW_WEB` pointing at local Next.js. Set `BW_PHASE2_SCREENSHOTS` to collect the screenshots. Use the same `localhost` hostname when starting Next and running the browser scripts.

The synthetic browser fixture verified three Reading passages and four Listening parts, each with 40 positions. Chromium verified Table and Summary inputs, the shared matching bank, a saved answer receipt, active question restore, unchanged deadline on reload, stored scores, shared Listening audio and an idempotent server schedule. The teacher journey verified linked draft groups and candidate-safe preview metadata. Screenshots were captured for Reading at 360, 390, 768, 1024, 1366 and 1920 pixels, Listening at 1920 and the builder at 1366. Captures are local under `/workspace/scratch/bestway-phase2-screens`.

The Phase 1 browser smoke passed for IELTS and Multilevel, including offline recovery, access refresh, lost hand-in responses, and speaking playback. The browser session suite passed 22 assertions across tabs and separate contexts, including Uzbek.

The normal Prisma deploy command was attempted on a fresh disposable database. The checksum URL at `binaries.prisma.sh` returned HTTP 403. Django and browser tests used the existing local PostgreSQL database prepared from the checked-in Prisma SQL, followed by Django migrations.

## Phase 3 handoff

Use the section-scoped Reading references, IELTS part numbers, and original question IDs for the result-review model. Use recorded evidence offsets and audio timestamps only when the source provides them. Continuation-specific evidence authoring, full review parity, and richer playback analytics need separate validation. Phase 4 owns CI migration verification, the coordinated web/backend release, and integration.
