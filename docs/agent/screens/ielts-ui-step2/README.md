# IELTS exam window, catalogue and result: before / after

All screenshots use synthetic accounts and synthetic exams on the local stack.

- **before**: main `317868b`, the last main before the S1 UI work.
- **after**: main `f9d516a` plus `claude/ui-before-after`.

Sizes are 1366×768, 390×844 and 360×640, in light and dark themes.

## Scripts

Run from `scripts/e2e-local`:

- `ui-screens.mjs OUT` captures `catalogue-*` and `result-*`.
- `runner-layout.mjs --shots OUT --theme both` captures `runner-reading-*`, `runner-listening-*` and the phone `runner-palette-*` (after only).

`runner-layout.mjs` also measures the content share: the part of the viewport height that is not sticky chrome, so the passage, audio and questions. It exits 1 when the part tabs do not fit on one row.

## Content share

| Viewport | Section | Before | After |
|---|---|---|---|
| 1366×768 | Reading | 48% | 85% |
| 1366×768 | Listening | 13% | 85% |
| 390×844 | Reading | 45% | 81% |
| 390×844 | Listening | 1% | 82% |
| 360×640 | Reading | 19% | 75% |
| 360×640 | Listening | 19% | 76% |

Light and dark measure the same.

## Chrome height

The header is one row in every theme:

| Viewport | Before: top / bottom | After: top / bottom |
|---|---|---|
| 1366×768 (desktop) | 188 / 210 px | 56 / 57 px |
| Phones | 272–640 / 195 px | 56 / 99–107 px |

## Requirements (owner, step 2)

| Requirement | State after |
|---|---|
| Exam header on one row, ≤56 px on desktop | 56 px at every size |
| Part tabs on one row | At every size; checked by the script. On phones the count shows on the open part's tab only |
| Palette: thin panel on desktop | The open part's numbers sit in the 57 px bottom bar; "All questions" opens the full palette |
| Palette: bottom sheet on phones | `runner-palette-390x844-*`, `runner-palette-360x640-*` |
| ≥70% of 1366×768 for the questions and the text | 85% |
| Catalogue: compact track switch | Segmented IELTS / Multi-Level control (`catalogue-*`) |
| Catalogue: at most 2 badges per card | 1 status badge |
| Catalogue: a direct button per section | Each section chip starts that section. Since S4 it opens Exam rules / Practice |
| Result: table with All / Wrong / Unanswered filters, key on every question when review is allowed | `result-*` (#173, #181) |

No horizontal page overflow on the catalogue or the result page at any size. At 360 px the status filter chips scroll sideways inside their own row.
