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

- Focused assessment suite: 86 passed and 41 subtests passed. Synthetic tests
  cover invalid/valid provider responses, failures, local routing and explicit
  fallback, audio hash/missing file/STT failures, retry states and no grading
  after failed evidence. Existing PostgreSQL grading checks exercise teacher
  authorization through their pre-failure portion.
- Django `check` and `makemigrations --check --dry-run`: PASS.
- Full pytest: 690 passed, 4 skipped, 1 failed. The failure is the unchanged
  BW-09 `test_assert_question_updates_section_without_lock` baseline.
- PostgreSQL AI ranking: 35/35 PASS. Readiness and partial-practice remain FAIL
  for pre-existing BW-15 and BW-08 respectively.
- The grading consistency fixture originally asserted `SUCCEEDED`, zero final
  score and graded-zero answers after a mocked empty STT output. That fixture
  did not verify silence and contradicted its own “human review” description.
  It now separately exercises actual decoded silent PCM (`STT_NO_SPEECH`), an
  empty STT result (`STT_EMPTY_TRANSCRIPT`), unavailable microphone audio
  (`STT_AUDIO_UNAVAILABLE`) and retryable STT timeout. Silence, empty output and
  missing audio stay `NEEDS_REVIEW` with no final score; timeout stays `RETRY`.
  The valid transcription case still checks the successful grading path.
  Verified acoustic silence means no speech was captured, not that the candidate
  intentionally submitted a blank answer: microphone failure may sound silent.
  There is no verified intent/blank-submission signal in this contract, so human
  review is required before applying any blank-answer scoring policy.
- PostgreSQL grading consistency now passes 65/65 checks with no fabricated
  successful transcript or graded answer in the failure scenarios.
- PostgreSQL authoring verification fails its independent assertion that draft
  deletion is super-admin-only: an admin received HTTP 200 and the synthetic
  draft was deleted. The route passes a super-admin proxy actor for an exam
  with no history. This code also exists at Phase 0 base `c6d19f9`; it was not
  changed in this phase and requires a separate authorization fix or an explicit
  product contract decision before release.


## Rollback

No migration is involved. Roll back source on the phase branch if necessary;
reverting these changes restores acceptance of fabricated grading results,
fictional transcripts and remote STT routing despite local configuration.
Prefer a forward fix. Preserve assessment job/evaluation history and do not
relabel previously generated results without an audited review.
