# Bestway Exam System 4.0 · Phase 2 report

## Base and scope

Phase 2 is on `feat/bestway-exam4-builder-reading-listening` and is stacked on the verified Phase 1 commit `b0849f552d146991dfd8ae0b09cc56573ca799b0`. The fetched `main` predates that commit. The draft PR base is `fix/bestway-exam4-reliability`. GitHub returned HTTP 403 for the PR lookup, draft creation, and Actions runs lookup. [Create the stacked draft PR manually](https://github.com/bestwayec/bestway/compare/fix/bestway-exam4-reliability...feat/bestway-exam4-builder-reading-listening?expand=1)

## Findings and implementation

- The candidate stepper treated each persisted group as a passage or part. The runner also suppressed source text when a group contained a rich task document. The shared frontend adapter now uses the Reading `stimulusRef` or IELTS Listening `partNumber`. Legacy consecutive Reading groups with repeated normalized text stay together. A source-less legacy group stays separate until a teacher associates it.
- Reading shows source text and image once beside the task groups. Gaps use original stored numbers and question IDs. Static task documents appear with the questions. A repeated gap token produces one input and an inert blank. Questions without matching tokens keep their normal controls. Matching tasks with identical ordered option lists show one bank and per-question dropdowns.
- IELTS Listening uses one recording and one server schedule per numbered part. Practice includes the task groups that inherit a sibling's audio. Whole-section recordings use the supplied markers matched to the numbered part. Independent recordings start at their beginning and the API omits inferred markers. Multilevel retains its existing per-group playback policy.
- The palette uses candidate-facing positions, and the browser session remembers the active question by ID. Source and audio grouping leave the existing Phase 1 answer writer, revision receipts, and attempt gates in place. An IELTS multi-response card can span several positions. Full-section scoring checks the objective maximum, while stored question IDs and gap numbers remain the persistence keys.
- The builder can create a group in an existing passage or numbered IELTS part and move a task group without its own source or audio via `parentGroupId`. Use `copyFromGroupId` on draft group creation and `groupPlacement` with a sibling ID and direction when reordering. Copies receive new question IDs and remapped gaps. Moves and reorder operations preserve IDs and stored answer mappings. Listening question reordering uses the editor's existing undo history.
- Builder context, review and publication use inherited source status. A passage or recording can have its own source group, and populated task groups count as ready when they reference that source.
- Candidate-shaped responses carry the association metadata. JSON import and export preserve explicit associations and source-only groups with populated siblings. Publish validation checks for one unambiguous Reading source and one Listening recording per unit. The existing Prisma-owned columns cover the associations. Historical content keeps its stored IDs and version.

## Reproduction and verification

Run the backend suite against disposable PostgreSQL. Focused coverage lives in `tests/test_exam4_content_units.py`, `tests/test_exam_templates_and_export.py`, and `tests/test_question_numbering.py`. Run `npm test`, `npm run lint`, `npm run build`, and then `tsc --noEmit` from the frontend. The build generates route types, so run it sequentially with the standalone TypeScript check.

- PostgreSQL-backed pytest passed 1,695 tests and 325 subtests. Four comparisons were skipped because the legacy NestJS build artifact was unavailable. Django system checks and migration checks passed, and the Prisma manifest matched checked-in migrations.
- Vitest passed 986 tests across 146 files. TypeScript and the Next.js production build passed. ESLint reported zero errors and 415 warnings, compared with 426 warnings in Phase 1.

For Chromium, seed the usual local accounts and run `manage.py shell < ../scripts/e2e-local/seed-exam4-phase2.py` from `backend-django` with a loopback `*_local` database. Run `node exam4-builder-reading-listening.mjs` from `scripts/e2e-local` with `BW_WEB` pointing at local Next.js. Set `BW_PHASE2_SCREENSHOTS` to collect the screenshots. Use the same `localhost` hostname when starting Next and running the browser scripts.

The synthetic browser fixture verified three Reading passages and four Listening parts, each with 40 positions. Chromium verified Table and Summary inputs, TFNG and Multiple Choice responses, the shared matching bank, server receipts, active question restoration, the deadline across reload, and the shared Listening schedule. Mobile keyboard navigation opened the correct question. The Reading view had no page-level horizontal overflow at 360, 390, 768, 1024, 1366, and 1920 pixels. A PostgreSQL query found the four Reading answers at their original question IDs with a raw result of 4/40, and the Listening continuation at its original question ID with 1/40.

The builder journey created and reordered linked groups, duplicated a task, added a whole-section audio file with explicit markers, reopened the draft, and rendered shared sources in both preview and the published exam. The builder UI published the draft. The student received one existing server schedule across audio-owner and sibling requests and after reload. PostgreSQL recorded the continuation answer and a partial Listening raw score of 1/2. Screenshots for the six Reading widths, Listening at 1920, and the builder at 1366 are under `/workspace/scratch/bestway-phase2-screens`.

The Phase 1 browser smoke passed for IELTS and Multilevel, including offline recovery, access refresh, lost hand-in responses, and speaking playback. The browser session suite passed 22 assertions across tabs and separate contexts, including Uzbek.

The full IELTS browser journey passed all 10 steps on the production build. It covered publication, 40 confirmed answers in each objective section, Writing, three Speaking uploads, manual grading, and evidence review. The partial-practice suite passed all five checks, including preserved paper numbering, raw-only scoring, and Listening controls permitted by the mode.

The full Multilevel production-build journey verified publication, the two-play limit across reload, 35 Listening and 35 Reading confirmations, offline Writing recovery, all eight timed Speaking uploads, a single hand-in, teacher grading, and cross-user access restrictions. PostgreSQL confirmed the completed attempt had 81 distinct answers, eight recordings, and the result used the Multilevel scale. The synthetic result was 68.5/75 (C1).

The recorder starts automatic transitions without waiting for fullscreen or optional audio meter activation. An earlier run stalled before the seventh response. A later run entered the eighth window and returned `SPEAKING_AUDIO_DURATION_INVALID`. The clean production-build run accepted all eight recordings under the existing duration rules, including one retried after a network drop. The 390-pixel check caught the compact save status overlapping the header. The header fix passed the focused mobile rerun with reload and persisted answer.

The normal Prisma deploy command was attempted on a fresh disposable database. The checksum URL at `binaries.prisma.sh` returned HTTP 403. Django and browser tests used the existing local PostgreSQL database prepared from the checked-in Prisma SQL, followed by Django migrations.

## Remaining verification

JSON packages transport shared media references. Verified whole-section offsets remain exam configuration and need to be reapplied when importing into another draft. The browser checks use Chromium. Mobile Safari recording and playback, the normal Prisma engine download, and the target GitHub CI run require the release environment.

## Phase 3 handoff

Use the section-scoped Reading references, IELTS part numbers, and original question IDs for the result-review model. Use recorded evidence offsets and audio timestamps only when the source provides them. Continuation-specific evidence authoring, full review parity, and richer playback analytics need separate validation. Phase 4 owns CI migration verification, the coordinated web/backend release, and integration.
