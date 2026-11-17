# Keyboard shortcuts, Today's plan, Uzbek part tabs: before / after

All screenshots use synthetic accounts and the synthetic IELTS exam built by `ielts-full.mjs`, on the local stack.

- **before**: main `31f26f9`.
- **after**: `claude/shortcuts-help`.

Sizes are 1366×768, 390×844 and 360×640, light and dark. Script: `scripts/e2e-local/shortcuts-screens.mjs`. It drives the keys in a real browser and prints what happened:

| Check | Before | After |
|---|---|---|
| N, N then P (from question 1) | nothing (1 → 1 → 1) | 1 → 3, then 2 |
| F | nothing | the open question is flagged |
| ? | nothing | the shortcuts list (`shortcuts-*`) |
| N / P / F typed in the Writing answer | (no shortcuts) | letters typed, the question does not change |
| Dashboard card title | "Today" | "Today's plan" (`today-*`) |
| Part tabs on `/uz` | "Passage 1, Passage 2, Passage 3" (English) | "1-matn, 2-matn, 3-matn" (`uz-tabs-*`) |

## Shortcuts

| Key | Action |
|---|---|
| N | next question |
| P | previous question |
| F | flag or unflag the question |
| H | highlight the selected text |
| ? | open the shortcuts list (also under Info → "Keyboard shortcuts") |
| Esc | close, as before |

- Single keys only. None of them fire with Ctrl, Cmd or Alt held, so browser and exam-lock keys are left alone.
- None of them fire while the student types in an answer.

## Today's plan

The card already listed only real items: an unfinished exam, teacher homework, words to review (unmastered words in the mistakes bank; the SRS model has no due dates), and the latest result. Only the title changed.
