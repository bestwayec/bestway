# Phase 1 — AI and speech evidence integrity

Base: Phase 0 commit `c6d19f92d2fa74bd61092d1ff291e5bf8df63bf0`.

## Changes

- BW-04: provider JSON now goes directly through the strict result validator;
  missing scores, confidence and evidence are not synthesized. Providers must
  return the complete supported schema. Malformed responses fail evaluation.
- BW-05: Gemini network/provider errors remain errors and preserve their
  transient/uncertain flags. They no longer return the heuristic as Gemini
  success. Existing provider fallback and worker retry/review rules apply.
- BW-06: before STT or reuse of cached transcripts, the worker checks the
  expected SHA-256 against the stored audio. Missing hash, missing audio,
  mismatch, failed transcription and empty transcript cannot produce a fake
  transcript or reach the grader. Existing `fail_job` retry/review states apply.
- BW-07: explicit `STT_PROVIDER=faster-whisper` runs local STT first even if an
  OpenRouter key exists. A local provider failure propagates unless
  `STT_ALLOW_REMOTE_FALLBACK=true` (or `1`/`yes`) is explicitly configured.
  Explicit Deepgram configuration no longer silently routes to OpenRouter when
  its key/model is missing. Unset provider may still select OpenRouter if its
  key is present, matching the existing default discovery behavior.

No schema change is required. Existing historic scores/transcripts have not been
revalidated or modified; review any earlier heuristic/fabricated evaluations
and missing-hash jobs before relying on them. This phase does not change BW-17:
projection of otherwise valid low-confidence results requires separate work.
Do not infer that enabling local STT automatically downloads its model; normal
local inference remains offline and requires a prewarmed model. Explicit remote
fallback transfers audio to an external service and requires operator approval
and appropriate data handling before activation.

## Verification

- Focused assessment suite: 84 passed and 41 subtests passed. Synthetic tests
  cover invalid/valid provider responses, failures, local routing and explicit
  fallback, audio hash/missing file/STT failures, retry states and no grading
  after failed evidence. Existing PostgreSQL grading checks exercise teacher
  authorization through their pre-failure portion.
- Django `check` and `makemigrations --check --dry-run`: PASS.
- Full pytest: 688 passed, 4 skipped, 1 failed. The failure is the unchanged
  BW-09 `test_assert_question_updates_section_without_lock` baseline.
- PostgreSQL AI ranking: 35/35 PASS. Readiness and partial-practice remain FAIL
  for pre-existing BW-15 and BW-08 respectively.
- PostgreSQL grading consistency: FAIL at its existing silent-speech assertion.
  The fixture expects `SUCCEEDED`, final score 0 and answers marked graded;
  the new outcome is `NEEDS_REVIEW`, `STT_EMPTY_TRANSCRIPT`, no final score.
  This is the deliberate fail-closed behavior, but the integration contract and
  fixture need explicit product review and a subsequent approved update. The
  script's preceding checks, including teacher authorization, passed. The test
  was not modified to hide the changed behavior.

## Rollback

No migration is involved. Roll back source on the phase branch if necessary;
reverting these changes restores acceptance of fabricated grading results,
fictional transcripts and remote STT routing despite local configuration.
Prefer a forward fix. Preserve assessment job/evaluation history and do not
relabel previously generated results without an audited review.
