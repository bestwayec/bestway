# Speaking and writing integrity follow-up

The assessment overview now reports only non-empty, successful transcripts tied
by question and audio hash to the current assessment job. Text cached in answer
fields or media state is not a verified transcript. Legacy speech diagnostics
lack reliable acoustic provenance and are withheld, including for old records.
The overview no longer invents confidence, rubric scores, teacher confirmation
or an overall score from an individual skill. Pending, failed and review states
come from the newest job per skill; a teacher review must be recorded or use a
teacher score source. The overview's status can therefore now be `needs_review`
or `failed`, and its confidence and overall score can be null.

The OpenRouter and direct Gemini transcription paths return no fabricated
confidence, word timestamps, duration, or pronunciation diagnostics when the
provider does not measure them. Evidence-policy speaking jobs without matching
transcript confidence at or above the configured threshold require review,
even if their AI evaluation succeeds. Existing clients must handle empty
segments and null confidence; legacy phonetic diagnostics are intentionally not
shown. No acoustic pronunciation evaluator is asserted by this change.

The separate instant checker previously assigned bands and CEFR levels from
word counts and stock feedback while presenting them as an AI assessment. It is
now explicitly unavailable (HTTP 503); the dashboard explains this and disables
the action. Restoring it requires an evidence-backed assessment implementation,
not re-enabling the heuristic scores.

The manual teacher-grade endpoint rejects unassigned teachers, in-progress
attempts, non-finite scores and scores outside the exam scale. This does not
establish complete safety for that older endpoint: its bulk update is not yet
serialized with worker and answer updates, and it can treat a holistic score as
individual results. It needs a transactional redesign and separate concurrent
integration coverage before a release may rely on it.

No schema or data migration is required. Roll back by reverting this change on a
new branch and redeploying the prior application image after assessing the risk
of restoring fabricated evidence. Do not alter recorded historical data to
simulate rollback. Existing BW-13, BW-14, BW-16 and BW-17 release blockers and
unverified real provider/microphone behavior remain; see the phase reports.
