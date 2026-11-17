# Redesign stage 2 — exam window

Timed attempts (`BW_MODE=timed`) on the synthetic IELTS exam, 1366×768 and 390×844, light and dark.

- **before**: main `64d58a7` (stage 1 merged).
- **after**: this branch.

```bash
BW_MODE=timed BW_WEB=http://localhost:3300 node scripts/e2e-local/redesign-screens.mjs OUT listening reading writing speaking
```

| | Before | After |
|---|---|---|
| Exam area at 1366×768 | max 1280 px wide, 44 px side margins | full window (max 1680 px), 20 px gutters; ~84% of the height |
| Reading passage | card inside a card | plain column, 17 px / 1.75 |
| Flag | 11 px "Flag" text above the card | beside the question number, `aria-pressed`, 44 px on phones |
| Palette | 32–36 px cells, ⚑ 9 px glyph | answered fill / unanswered outline / flagged warning outline + corner, 44 px in the phone sheet |
| Timer | 10:00 and 5:00 flash with pulse (Reading/Writing only) | warning colour under 5:00, danger under 1:00, calm notice at 5:00 and 1:00 in every section |
| Writing | bright green "Type" toggle, 288 px editor | neutral segmented toggle, editor fills the screen height |
| Listening | part title hidden under the sticky player | title above the player |
| Copy | "Previous", "Next", "Shared situation", "Map", "Response timing" in English | en + uz keys |

E2E on this branch: `exam-a11y.mjs` 12/12 (axe: no serious/critical), `exam-workspace.mjs` 20/20,
`shortcuts-screens.mjs` (N/P/F, ?, typing) all sizes.
