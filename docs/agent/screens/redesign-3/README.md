# Redesign stage 3 — result and analysis

Student result of the synthetic IELTS attempt (`ielts-full.mjs`: L 9 · R 9 · W 6.5 · S 7 → 8.0, teacher
graded) and the same page as the teacher (`grading-*`). 1366×768 and 390×844, light and dark;
`result-more-*` is the page scrolled one screen down.

- **before**: main `825c296` (stage 2).
- **after**: this branch.

| | Before | After |
|---|---|---|
| Overall band | twice (infographic "Overall Band: 8.0" + card "OVERALL BAND 8.0"), plus a third "IELTS BAND" box | once, 48 px display number |
| CEFR | badge + English-only descriptor | "CEFR C1" badge + descriptor in en/uz |
| Skills | four unrelated hues, "Band 9.0" printed twice per card | one bar chart in one hue (band of 9 / standard score of 75), pending and below-range written out |
| Writing / Speaking | "Accuracy 72%" derived from the band | criteria marks (TA/TR, CC, LR, GRA · FC, LR, GRA, P) from the assessment |
| Estimated | badge only in the header | marked on the bar (*) with a note, and a box under the band |
| Buttons | "Certificate (PDF) (PDF)", gradient/scale hover | "Certificate (PDF)" primary, feedback outline, print ghost |
| Analysis | accuracy by type | + Next steps (weakest and strongest question types, ≥ 4 marked answers) and band over time (≥ 2 full results), from real data only |
