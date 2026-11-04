# Phase 2: exam integrity

Base: `4e12f262fdc75ea27ca283d2b59a468ddbc65d1b` (Phase 1); Phase 0
checkpoint `c6d19f9` is an ancestor. No database migration is introduced.

## Navigation and persistence contract

Full tests advance in the existing server-defined skill order. Answers may be
saved only in the active, unsubmitted section; the switch endpoint cannot move
to a different section. The transactional advance endpoint is the mechanism
for closing the current section and opening the next. Resumption uses the
persisted current skill. The existing server deadline checks apply to writes.
Partial practice continues to allow navigation within the skills and questions
in its frozen scope; a scope with no question IDs grants access to none.

Bulk saves keep their existing partial-acceptance contract: authorized question
IDs are saved and counted; out-of-scope IDs are ignored. A mixed full-test
batch containing a valid question from a closed or future section is rejected
in its entirety. The `saved` count is an integer, including zero, and single
answer saves retain their boolean result. Clients must compare the count with
what they sent. The attempt row lock serializes saves and section advances.

The runner waits for in-flight saves, saves the latest applicable responses in
batches, checks every acknowledgement, and only then submits or advances. Edits
remain in page memory on failure; retry is possible while the server accepts
writes. Timed automatic actions do not re-save already acknowledged answers
after the deadline but do require outstanding edits to be accepted. Server
expiry may prevent a late retry; preserving a draft across browser refresh is
not provided by this change. Reopening a closed section is deliberately no
longer accepted by full-test navigation. Empty, malformed historical practice
scopes no longer grant broad access.

## Verification and known limits

Focused Phase 2 backend and frontend tests exercise scope, active and closed
sections, deadlines, failed and partial acknowledgements, offline recovery,
duplicate clicks, racing saves, expired timers, and cleared responses. The
PostgreSQL partial-practice script covers mixed/duplicate submissions,
unauthorized attempts, a concurrent save/advance race and authoritative resume.

The full Django suite retains a pre-existing failure in
`test_assert_question_updates_section_without_lock`: it expects reading a
question to mutate the current full-test section, contrary to the enforced
section contract. Readiness integration retains the independent BW-15 fixture
mismatch (`MOCK_FULL_TEST_UNAVAILABLE`). Neither was altered in Phase 2.

Rollback: revert the Phase 2 commits together. Doing so restores the unsafe
out-of-scope, section-transition, and failed-save behavior, so any rollback
needs compensating controls. No schema rollback is required.

Verification on this branch: focused Phase 2 backend 11 passed; focused runner
20 passed; full Django 701 passed, 4 skipped, 1 pre-existing failure; full
frontend 390 passed; Django system check and migration dry-run passed;
PostgreSQL partial practice 74/74, grading consistency 65/65, AI rankings
35/35 passed; PostgreSQL readiness failed on the existing BW-15 mismatch.
TypeScript passed, ESLint reported 0 errors and 466 warnings. The frontend
production build was blocked by unavailable Google Fonts `Inter`.

Changed files: `apps/core/mock_attempts.py`, `apps/core/mock_practice.py`,
`tests/test_phase2_exam_integrity.py`, and
`scripts/verify_partial_practice_postgres.py` under `backend-django`;
`src/components/mock/mock-runner.tsx` and `mock-runner-autosave.spec.ts` under
`frontend`; and this report.
