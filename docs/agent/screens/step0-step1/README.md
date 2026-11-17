# STEP 0 / STEP 1 leftovers: before / after

All screenshots use synthetic accounts and exams on the local stack.

- **before**: main `0992f3f`.
- **after**: `claude/step0-step1-leftovers`.

Sizes are 1366×768, 390×844 and 360×640, light and dark. The Android download card is captured with Playwright's "Pixel 7" profile (412×915).

## Scripts

- `scripts/e2e-local/site-screens.mjs OUT` captures `landing-*`, `download-*` (top and bottom of each page) and `clear-dialog-*`. It also reports any Uzbek line on an English page.
- `download-android-*` is a one-off capture with the "Pixel 7" profile.

## What the check found

| Item | Before | After |
|---|---|---|
| Uzbek on `/en` (landing, download) | 12 of 12 page/size combinations: footer "Barcha huquqlar himoyalangan.", "0 so'm", "Barcha Platformalar Uchun O'rnatgichlar", "Sizda"; on Android the whole APK card | none |
| Old release label | Hard-coded v1.0.10 fallback (version, file names, sizes) shown until GitHub answered (seen as "v1.0.10" in 2 of 12 runs) | Only what GitHub reports as the latest release; retry and GitHub links otherwise |
| Android APK | "BestWay APK Yuklab Olish (5.1 MB)" for a file the latest release does not have | "The latest release has no Android APK yet" with a link to the releases |
| Header menu | Teachers and News linked to sections that are hidden when empty | Only sections that exist (here: Courses · Benefits · Contact) |
| Menu pills, light theme | Dark grey text on near-black (#242718) | Theme tokens, about 7:1 |
| "29+ video lessons" | Number not backed by data | "Gamified video lessons" |
| Plurals | "1 words", "1 students", "1 minutes left", and similar | ICU plurals in all 24 English count messages |
| Clear answers | Whole section only | "Only Passage 1 (2 answers)" or "The whole Reading (2 answers)" |

## Already in place (earlier PRs, re-checked)

- No "Official", "95% accuracy" or "Unbiased" claims on the landing page (#170).
- No empty Teachers block (#170).
- The dashboard "1 days" is a plural (ICU).
- The IELTS window shows the server clock (#171).
- Numbers 1–40 in every section (#171).
- Visible Highlight / Notes / Word lookup / Focus buttons (#172).
