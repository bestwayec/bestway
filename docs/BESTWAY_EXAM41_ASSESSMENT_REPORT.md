# BESTWAY Exam System 4.1 assessment

## Configuration

See [Django environment example](../backend-django/.env.example) for placeholders. The dedicated Django assessment worker uses PostgreSQL for jobs and provider request reservations. It needs access to the same private recordings as the API and uses `ffprobe` to verify recordings. Local faster-whisper uses a prewarmed model cache and offline runtime.

| Setting | Default or use |
| --- | --- |
| `ASSESSMENT_EXTERNAL_AI_ALLOWED` | `false`. Enable only after organizational privacy and consent review. |
| `STT_PROVIDER`, `STT_MODEL` | `groq`, `whisper-large-v3-turbo`. `whisper-large-v3` is an explicitly selectable Groq model. |
| `GROQ_API_KEY`, `STT_GROQ_FREE_ACCOUNT_APPROVED` | Server-side secret and administrator attestation for an approved free account. |
| `STT_ALLOW_LOCAL_FALLBACK`, `STT_LOCAL_FALLBACK_MODEL` | `false`, `small.en`. The alternative primary `STT_PROVIDER=faster-whisper` uses `STT_MODEL=small.en`. |
| `ASSESSMENT_PROVIDER`, `OPENROUTER_EVAL_MODEL` | `openrouter`, `deepseek/deepseek-v4.1-flash-1017:free`. Availability is unverified. |
| `OPENROUTER_API_KEY`, `OPENROUTER_ALLOWED_PROVIDERS` | Server-side secret and approved provider slugs. An empty route list blocks dispatch. |
| `ASSESSMENT_DAILY_BUDGET` | At most 50 external requests per UTC day across both services by default. |
| `ASSESSMENT_WORKER_CONCURRENCY`, `ASSESSMENT_MAX_ATTEMPTS` | Two workers per process, configurable up to four. At most three attempts per job. |
| `ASSESSMENT_PROVIDER_TIMEOUT_MS`, `ASSESSMENT_STT_TIMEOUT_MS` | 90000 and 60000 respectively. |
| `ASSESSMENT_ALLOW_PAID_FALLBACK` | `false`. A configured model can be considered after a missing-model response. |
| `ASSESSMENT_FALLBACK_MODEL` | Approved paid candidates are `deepseek/deepseek-v4.1-flash` and `deepseek/deepseek-v4.1-flash-1017`. |
| `OPENROUTER_MAX_PROMPT_PRICE`, `OPENROUTER_MAX_COMPLETION_PRICE` | Explicit USD ceilings per million tokens for the configured paid route. |
| `ASSESSMENT_PAID_DAILY_REQUESTS`, `ASSESSMENT_PAID_DAILY_BUDGET_MICROUSD` | Both default to zero. The worker reserves a conservative upper estimate before dispatch. |
| `ASSESSMENT_ADJUDICATION_ENABLED` | `false`. The teacher-finalization requirement is enforced in code. |

OpenRouter sends a model ID and an explicit provider allowlist with zero-retention, data-collection denial, and price controls. Credentials remain server-side. These options still need verification against an actual routed provider before submitting student work. Groq account plan, quota, and retention require provider confirmation. Shared quota failures use `Retry-After`, a provider cooldown, and exponential backoff with jitter. Ambiguous paid outcomes stop automatic retry. Operational reservations are estimates and record consumption even when the outcome is uncertain.

## Evidence and grading

- Whisper receives English audio in validated multipart uploads. The server checks the saved file hash, decoded container, size, and duration. The frozen submission records the transcription language. The transcript includes model provenance and available segments. Confidence is null when the provider supplies no calibrated confidence.
- The advisory scorer receives frozen rubric and exam versions, task content, candidate text or transcript, and word count. The provider payload omits account records, private storage paths, and signed media links. Essay or audio contents can still contain personal information, which requires consent and institutional authorization before activation.
- JSON validation enforces rubric bounds, half-point increments, expected criteria, and source-matching evidence quotes. Provider feedback is rendered as plain text. Candidate data travels in a separate message and no tools are requested.
- IELTS Speaking pronunciation remains unavailable to a transcript-only model. The teacher reviews original audio. Multilevel uses the configured raw task maxima and existing score conversions.
- Writing Task 1 images remain available in teacher review. External visual assessment is disabled for the unverified route. The advisory output explicitly identifies missing visual evidence.
- Provider output stays in evaluation and transcript records. Automatic retry reuses records only within a matching job, evidence checksum, and configured provider and model. A changed model returns the attempt to review. Teacher review projects grades atomically using locks and revision checks. Drafts and transcript corrections are stored in the audit ledger. Late AI responses cannot project a score or overwrite an in-flight review. Technical failure leads to manual review. The existing unanswered-response rules remain separate from provider failure.

## Activation and calibration

The live catalogs and provider calls could not be verified from this environment. Keep external student processing disabled until retention, training policy, consent for minors, approved routing, model inputs, and actual prices are verified. Use synthetic fixtures for that verification. The local synthetic transport checks establish route and schema behavior. Teacher-scored calibration, actual score deviation, endpoint latency, and billed usage remain unmeasured.
