# Redesign stage 6 — landing and sign-in

1366×768, 390×844 and 360×640, light and dark. **before**: main `f28228e`. **after**: this branch.

| | Before | After |
|---|---|---|
| Hero | all-caps slogan "DO YOUR BEST / FORGET THE REST !" with a green glow; no picture of the product | a sentence that says what BestWay is, two actions, three honest facts, and a **real screenshot of the exam window** (seeded IELTS Academic mock, light and dark) |
| Below the hero | three icon cards, then an "ecosystem" block with "Vision OCR" / "Smart Analytics" chips | "What you get": exam window, result, teachers in the loop — each with a link — and a **sample result** labelled "demo data (not a real student)" |
| Claims | an unused `STATS` constant (500+ students, 7+ teachers, 17+ years) | removed; no counters, testimonials or "official" anywhere |
| Header | neon-lime "Courses" pill (JellyNav) and shiny lime buttons (SpecularButton), rainbow underline | plain links with the current section underlined, `ghost` Sign in and `primary` Free level assessment; translated aria labels |
| Sign-in | method switch wraps to two lines on phones and looks like two primary buttons; floating card with a heavy shadow and glowing blobs; `text-slate-100` on the page | neutral segmented switch ("Password" / "Telegram code") on one line, `aria-pressed`; card starts near the top on phones; design-system buttons; Telegram link text in the theme colour (was 2.1:1) |

Product images: `frontend/public/product/*.webp` (exam 1366×768 ≈ 100 KB, result ≈ 7 KB), served through
`next/image` (AVIF/WebP, `sizes`), so phones download a ~640 px rendition.
