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
