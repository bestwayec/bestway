# Redesign stage 4 — student dashboard and catalogue

1366×768, 390×844 and 360×640, light and dark. **before**: main `6a16b9c` (stage 3). **after**: this branch.

Note on the data: the attempts API returns the latest 20 attempts, and the screenshot runs create single-section
practice attempts, so the synthetic student's full IELTS result (8.0) is outside that window. The dashboard
therefore honestly shows "No full result yet" — it never fills the tile with a practice score.

| | Before | After |
|---|---|---|
| Order | recommended test → Today's plan → stats | **Today's plan** (continue, homework, words, latest result) → stats → recommended test |
| Continue | a separate big card | the first row of Today's plan, highlighted, with "Continue" |
| Stats | estimated level · completed tests · **day streak** (invented: up to 7 from the number of attempts, kept in localStorage) | latest full result (links to it) · estimated level · completed tests |
| Exam type | raw `ielts_academic` | "IELTS Academic" (catalogue copy) |
| Track switch | green active segment + a sentence | neutral segmented control on one row with the status filter; sentence only when the track is staff-assigned |
| Status filter | scrolled sideways, "Finished" cut off on phones | wraps; active chip in high contrast |
| Card | 36 px section chips, "Start" | "Or one section" — 2×2 grid of 44 px buttons (practice or exam per section); **Start full exam**; **View last result** when the exam was done |
