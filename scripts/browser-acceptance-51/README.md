# BESTWAY 5.1 browser acceptance (local, synthetic data only)

Playwright scripts used for the 5.1 release acceptance. They drive the real app (Next.js `next start` + Django `runserver`)
against a disposable `*_local` PostgreSQL database seeded with `seed_local_dev` and `seed_ielts_mock1_academic`
(synthetic accounts, password from `seed_local_dev`). Never point them at production.

Chromium runs with a fake microphone (`--use-fake-device-for-media-stream`) so the native MediaRecorder path is exercised;
`lib.js` emulates an accepted fullscreen request because headless Chromium cannot enter real fullscreen.
Screenshots go to `docs/screenshots/bestway51-final/`.

| Script | What it proves |
| --- | --- |
| `ielts.js <theme> <phone>` | Compact Listening rows, once-only audio, typed answers, Q10 visible below sticky panel / above footer |
| `journey.js <theme> <phone>` (`ASSIGNMENT=` optional) | Full IELTS: real audio playback, Reading split + drag resize, Writing keyboard input + word count |
| `speak.js <theme> <phone> <attemptId>` | Microphone check, native MediaRecorder capture, upload receipt |
| `finish.js <theme> <phone> <attemptId>` | Finish confirmation; student result shows pending Writing/Speaking |
| `assign.js` (`GROUP_ID=`), `student-start.js` | Teacher fixed-close assignment; students who start and leave (auto hand-in) |
| `teacher.js <theme> <tag> [w h]` | Result Center / live monitor, verified theme (html class + computed background) |
| `grade2.js <theme> <attemptId>` | Teacher finalizes Writing and Speaking in the review UI with AI disabled |
| `ml.js`, `mlspeak.js`, `mlplay.js` | Multilevel: structure 35/35/3/8, section flow, Speaking capture, playback limit |

## CBT Exam Experience 2.0 (`docs/screenshots/bestway51-cbt-final/`)

| Script | What it proves |
| --- | --- |
| `cbt2.js <theme> <w> <h> <tag>` | Readiness screen (rows measured, **no attempt exists until Start**), Start creates exactly one attempt, save chip online → offline ("kept on this device") → reconnected ("Saved to server"), `O` opens the overview, Unanswered filter, submission review lists unanswered numbers and jumps to Q5 below the sticky header, Settings 2.0 (dark + comfortable spacing applied in place, typed answer kept, Restore defaults), timer kept across reload, Speaking mic check: asked once, **not** asked again in a new tab of the same browser, asked again in a fresh browser profile |
| `deadline.js <theme>` | Synthetic attempt with its server deadline moved to +25 s in the `*_local` DB: "Time is up" chip, locked banner, answer fieldset disabled, "Answers locked" save chip, then confirmed hand-in |
| `cbt2-uz.js <theme>` | Uzbek pass — blocked locally: unprefixed Uzbek URLs return a 307 to themselves under `next start` on http://127.0.0.1 (next-intl routing, unrelated to 5.1); Uzbek strings are covered by `messages-parity.spec.ts` |

Run: `OUT=/home/user/bestway/docs/screenshots/bestway51-cbt-final node cbt2.js light 1366 768 1366` (also `dark 390 844 390`, `dark 1280 720 1280`, `light 1920 1080 1920`).
