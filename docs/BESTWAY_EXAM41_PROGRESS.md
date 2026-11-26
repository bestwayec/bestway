# BESTWAY Exam System 4.1

The implementation branch is `feat/bestway-exam41`, based on verified `main` commit `67b92f5419e0bf9e95f2a16852019aef3c72659e` after PR #226. Tests use synthetic local data.

| Phase | Delivered | Release status |
| --- | --- | --- |
| 1. Writing and exam reliability | The active server section controls the full-test editor and navigation. Chromium exercises real keys, draft recovery, and persisted essays. | Local verification complete. |
| 2. Advisory assessment | Groq Whisper STT, free-first OpenRouter routing, JSON and evidence validation, request reservations, and bounded retries. | Live provider access, pricing, privacy routes, and calibration remain unverified. |
| 3. Teacher grading | Teacher-owned final grades, partial drafts, audit history, transcript corrections, and a classroom grading queue. | Local browser and PostgreSQL coverage. |
| 4. Delivery | Full local QA and independent PostgreSQL worker verification. | Hosted PR and CI require access to GitHub API. Production remains outside this release task. |

## Writing defect

A full test still on Listening could render the Writing editor when `?skill=writing` was present. The controlled textarea used a save guard that accepted only questions in the active server section. Every attempted edit was discarded. Chromium reproduced the empty textarea before the fix.

The runner now selects the server section for an active full test. Other section tabs are disabled until the server advances. Scoped practice retains its task selection. The server keeps its existing write authorization. Normal keyboard input, timed clipboard rules, recovery, and completion run through the existing editor and answer endpoints.

## Teacher workflow

The group dashboard uses real enrollment and assignment records. It shows participation counts and a grading queue with Writing and Speaking stages, teacher review links, and available provider failure details. Its group, assignment, exam, track, skill, student search, and review stage filters share the existing analytics surface. Classroom averages and rankings exclude provisional subjective grades. Previously released attempts retain their stored scores and remain readable.

The teacher reviews the original essay or audio and may save a partial rubric and comment. A teacher can confirm an eligible AI suggestion or finalize the rubric manually. The assessment history records the actor, reason, version, and submitted rubric or accepted evaluation. A teacher correction of a transcript is recorded separately from the original. Students see released teacher feedback and scores under existing access rules.

See [assessment](BESTWAY_EXAM41_ASSESSMENT_REPORT.md), [verification](BESTWAY_EXAM41_TEST_REPORT.md), and [release](BESTWAY_EXAM41_RELEASE_CHECKLIST.md).
