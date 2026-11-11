# Next-level UX audit (U1)

Method: 19 core pages × 4 sizes (1440×900, 768×1024, 390×844, 360×640) × light/dark captured with
`scripts/e2e-local/responsive-audit.mjs` on a local stack with synthetic accounts (student, teacher, admin,
anonymous), plus `smoke.mjs` (16 steps), `full-journey.mjs` (13 steps) and a runner i18n check in both locales.
Screenshots stay out of the repo (owner rule). Ranked by impact on real workflows.

Status: FIXED (PR), OPEN (planned phase), NOTE (needs owner decision or content).

| # | Friction point | Where | Impact | Status |
|---|---|---|---|---|
| 1 | Light theme rendered dark panels, white-on-white text and transparent "cards" (raw palette classes; ~190 undefined colour names produced no CSS) | all core screens | every light-mode user | FIXED #124–#126 |
| 2 | Dark was the default theme; owner direction is light | app shell | first impression | FIXED U2 (`claude/u2-foundation`) |
| 3 | English users saw Uzbek mid-exam (flag button, Passage/Questions tabs, Type/OCR switch, section transition dialog) | exam runner | exam comprehension | FIXED U2 |
| 4 | Transition dialog showed fixed durations not taken from the exam | runner | misleading timing | FIXED U2 (removed) |
| 5 | Runner header: save state, answered count and position were three loose grey lines | runner | anxiety, missed saves | FIXED #125 |
| 6 | Essay box used a monospace font on phones | writing | readability | FIXED #125 |
| 7 | Finish wrapped onto its own row at 360px | runner header | hidden primary action | FIXED #125 |
| 8 | Hard-coded Uzbek elsewhere: builder import modals, live PIN panel, groups/teacher tables, vocabulary pages, mic-check, launcher ("daqiqa") — ~200 strings in ~60 files | builder, teacher, vocabulary | English UI inconsistent | OPEN U8 (guard test lists migrated files) |
| 9 | Mic-check dialog reopens on every Speaking tab visit | speaking | friction, repeated permission prompts | OPEN U4 |
| 10 | "Writing / Speaking practice" notice also shown on Listening/Reading tabs | partial practice runner | confusing | OPEN U4 |
| 11 | Question palette sheet covers half of a 360×640 screen | runner (phone) | hides the question | OPEN U4 |
| 12 | Tiny practice sets show IELTS bands ("Band 9.0" for 1/1) | result | inflated meaning | NOTE (owner decision) |
| 13 | Empty "Multilevel score breakdown" heading on objective-only results | result | looks broken | FIXED #124 |
| 14 | Student dashboard lacks a "today" view (due homework, words due, resume exam in one place) | dashboard | next action unclear | OPEN U4 |
| 15 | Catalogue cards: no explicit in-progress/completed/unavailable state, level filter only | exam list | discovery | OPEN U4 |
| 16 | Bottom nav labels truncate ("Dashbo…") at 390px | mobile shell | navigation clarity | OPEN U3 |
| 17 | Login method tabs wrap to two lines at 390px | login | polish | OPEN U7 |
| 18 | Google button looked disabled in light mode | login | trust | FIXED #126 |
| 19 | Teacher buttons mix emoji, Uzbek and duplicated "+" ("+ + Yangi guruh yaratish", "📊 Excel") | groups, teacher dashboard | professionalism | OPEN U6 |
| 20 | Vocabulary hub copy over-claims ("3D", "60 FPS") | vocabulary | honesty rule | OPEN U5 |
| 21 | Small touch targets: vocabulary chips/icons (9 under 32px on phone) | vocabulary | tap accuracy | OPEN U5 |
| 22 | Exam Builder: no persistent autosave indicator or unsaved-changes guard; validation not grouped with jump-to-field | builder | lost work risk | OPEN U6 |
| 23 | Missing i18n key in uz (`assessment.feedbackFields.bamboozle`); no key-parity test | i18n | silent fallbacks | FIXED U2 (+ parity test) |
| 24 | Vocabulary mode page lacks the set title | vocabulary | orientation | OPEN U5 |
| 25 | `/media` is public | media | privacy policy | NOTE (owner kept policy, P2) |

Local-environment notes (not product bugs): binding `next dev`/`next start` to `-H 127.0.0.1` makes the
default-locale rewrite cross-origin, so Uzbek pages loop with 307; bound normally, `/` and `/login` return 200.
Use `http://localhost:3300` with the dev server (Next blocks dev resources for other origins).
