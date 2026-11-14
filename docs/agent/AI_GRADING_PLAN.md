# AI grading — plan (decision document, no implementation)

Status: **proposal for the owner's decision** (Phase 4, P7, 2026-11-14). Nothing here is switched on by this document.

## 1. Purpose

AI produces a **draft score and draft feedback for the teacher** on Writing and Speaking. The student sees only a score the teacher has approved. AI never issues a band, a CEFR level or a certificate on its own.

| Who | Sees |
|---|---|
| Teacher | AI draft (criteria, evidence quotes, confidence), the original response/recording, one-click accept / edit / reject |
| Student | Nothing from AI until the teacher approves; then the approved score and the teacher's (edited) feedback |
| Certificates | Only teacher-final grades (owner decision B, #167) |

## 2. What already exists in the code (verified)

- Assessment jobs per attempt and skill (`AssessmentJob`, worker `run_assessment_worker`), provider calls with a fallback (`ASSESSMENT_PROVIDER=openrouter`, `ASSESSMENT_FALLBACK_PROVIDER=xkiro`), speech-to-text (`OPENROUTER_STT_MODEL`, local `faster-whisper` option).
- Safeguards already tested (CI script `verify_grading_consistency_postgres.py`, 76 checks): low-confidence AI stays a proposal; unmeasured STT confidence never auto-approves; silent/missing audio goes to review with no score; teacher override wins and is kept separate from the AI proposal; a late AI regrade never replaces a teacher grade; partial practice never queues external AI.
- Internal grading policy `BESTWAY_MULTILEVEL_PRACTICE_75_CAP55_V1` (35 + 15 × raw/max on the 75 scale for current Multilevel attempts).

So the plan is mostly **policy, evaluation and rollout**, not new plumbing.

## 3. Criteria mapping

| Exam | Skill | Criteria the model must score (each with a quote from the response as evidence) | Scale |
|---|---|---|---|
| IELTS | Writing Task 1 / 2 | Task Achievement (T1) / Task Response (T2), Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy | 0–9 in 0.5; task = mean, half-band rounding; Writing band = (T1 + 2 × T2) / 3 |
| IELTS | Speaking | Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation | 0–9; Pronunciation only from audio evidence (never from a transcript alone) |
| Multilevel | Writing 1.1 / 1.2 / 2 | Agency task raw marks (5 / 5 / 6), descriptors from the agency writing specification | raw marks; standard score via the blueprint conversion |
| Multilevel | Speaking 1.1, 1.2, 2, 3 | Agency rating scale per part (raw 5 / 5 / 5 / 6) | raw marks per part (mean within a part) |

Descriptors are taken only from the official public documents already listed as sources in `exam_blueprint.py`; no invented descriptor text.

## 4. Provider options and cost per attempt

Cost = Σ (input tokens × input price + output tokens × output price) + speech-to-text minutes × STT price. Prices must be read from each provider's pricing page **on the day of the decision**; this document does not state prices from memory.

Approximate volume per full attempt (estimate, to be measured in the pilot):

| Part | Input | Output |
|---|---|---|
| IELTS Writing (2 tasks, ~420 words + prompts + rubric) | ~4–6 k tokens | ~1.5–2 k tokens |
| IELTS Speaking (~11–14 min audio → transcript ~1.8 k words) | ~5–7 k tokens + STT minutes | ~1.5 k tokens |
| Multilevel Writing (3 tasks) | ~5–7 k tokens | ~2 k tokens |
| Multilevel Speaking (8 answers, ~10 min) | ~5–6 k tokens + STT minutes | ~1.5 k tokens |
| Second opinion / adjudication (only on disagreement) | ×1 of the above for that skill | |

Options to compare in the pilot (same prompts, same samples): the currently configured OpenRouter model; one stronger general model; local STT (`faster-whisper`, no audio leaves the server) vs. hosted STT. Free-tier models (`…:free`) are not suitable for production grading: no availability guarantee and unclear data terms.

## 5. Privacy of student recordings and texts

- **Consent**: written consent from the student — and from a parent/guardian for students under 18 — before any response leaves BestWay's servers; a per-group switch so a centre can run without external AI.
- **Minimisation**: send only the response, the prompt and the rubric; never names, phone numbers, group names or IDs (use a random per-job reference).
- **Audio**: prefer local STT so audio never leaves the server; if hosted STT is used, the provider must not train on or retain the audio (contractual "zero data retention" option), and the region must be acceptable to the owner.
- **Retention**: provider requests/responses kept only as long as needed for review and audit (proposal: 90 days for raw provider payloads; approved scores and feedback stay with the attempt).
- **Access**: AI drafts visible only to staff who can already grade the attempt (existing `assert_view` rules).

## 6. Accuracy evaluation (before any pilot result reaches a student)

1. Collect **teacher-graded samples** already in the system (with consent): target ≥ 100 Writing tasks and ≥ 60 Speaking sets per exam family, spread over levels.
2. Blind-run the AI on them; compare with the teacher score.
3. Measures: exact agreement and agreement within ±0.5 band (IELTS) / ±1 raw mark (Multilevel), mean absolute error, bias by level (does AI over-score weak or under-score strong responses?), and teacher-vs-teacher agreement on a double-marked subset as the ceiling.
4. Go/no-go thresholds proposed for the owner: within ±0.5 band ≥ 80 % (IELTS), within ±1 raw mark ≥ 80 % (Multilevel), no level bias > 0.5 band, every score with a valid evidence quote.

## 7. Failure modes and handling

| Failure | Handling (most already implemented) |
|---|---|
| Provider down / timeout | Retry with backoff, then fallback provider, then "needs teacher review" — never a made-up score |
| Silent, short or missing audio | Review with no score (tested) |
| Low or unmeasured confidence | Stays a proposal; teacher must grade (tested) |
| Off-topic / memorised / pasted text | Flag for the teacher; no automatic penalty |
| Prompt injection inside a student essay | Response is passed as data in a fixed field; output must match a strict JSON schema; anything else is rejected |
| Model update changes scores | Model + prompt version stored per job; re-run the accuracy set before switching |
| Cost spike | Per-day job cap and per-attempt token cap; jobs above cap wait for a teacher |

## 8. Rollout

1. Feature flag off by default (per centre / per group).
2. Pilot: one group per exam family, 4 weeks, teachers grade as today and see the AI draft side by side; students see only teacher scores.
3. Review the accuracy report (section 6) and the measured cost per attempt with the owner.
4. Decide: keep as teacher assistant only / extend to more groups / stop.

## 9. Owner decisions needed

1. Approve the purpose (teacher draft only, student sees approved scores only).
2. Consent wording and whether minors may use AI grading at all.
3. Local STT only, or hosted STT allowed (with which provider terms).
4. Pilot group(s) and the go/no-go thresholds in section 6.
5. Monthly budget cap.
