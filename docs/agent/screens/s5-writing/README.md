# Writing editor: before / after

All screenshots use synthetic accounts and the synthetic IELTS exam built by `ielts-full.mjs`, on the local stack.

- **before**: main `c10c291`.
- **after**: `claude/writing-editor`.

The same three-paragraph answer (47 words) is typed in IELTS Writing Task 1, at 1366×768, 390×844 and 360×640, light and dark. Script: `scripts/e2e-local/writing-screens.mjs`.

| Item | Before | After |
|---|---|---|
| Words against the target | "47 words · Target: 150+ words", progress bar, words still needed | unchanged |
| Paragraphs | not shown | "3 paragraphs": text blocks separated by a line break, ignoring empty lines |
| Time | not shown | "0 min on this task · suggested 20 min"; turns amber past the suggestion |

## How the new figures work

- **Time on the task** is the student's own pace: it counts only while the task is on screen and the page is visible, and it survives a reload (sessionStorage). It is not the exam clock; the section countdown stays in the header.
- **Suggested time** is shown only for IELTS Task 1 and Task 2: the test's own advice of about 20 and 40 minutes. Other tasks get no invented advice.
