# BestWay — redesign direction (2026-11)

Status: stage 0 of the redesign programme. Baseline screenshots (main `3b46c08`, local stack,
synthetic accounts and the synthetic IELTS exam from `scripts/e2e-local/ielts-full.mjs`):
`docs/agent/screens/redesign-0/before/` — 1366×768 and 390×844, light and dark.
Script: `scripts/e2e-local/redesign-screens.mjs OUT_DIR [page ...]`.

This file says **what** we change and **why**; `DESIGN_SYSTEM.md` stays the rulebook for tokens and
primitives and is updated as stage 1 lands.

---

## 1. Audit — the three biggest UX problems per screen

### Landing (`/`)
1. The hero is a slogan ("DO YOUR BEST / FORGET THE REST !") in all caps with a green glow; it says
   nothing about what the product is. The real value (computer-delivered IELTS / CEFR mocks, teacher
   grading, band history) is in 14 px grey under it.
2. No picture of the product. A student cannot see the exam window or a result before signing up —
   the two things that make BestWay credible.
3. The page is long and repetitive (benefits → ecosystem showcase → courses → "Why" → contact → a giant
   "BEST WAY" wordmark). Two header CTAs use a neon lime fill that is off-brand and has a coloured shadow;
   "Courses / Benefits / Contact" look like pills, not navigation.

### Login (`/login`)
1. The method switch ("Phone & Password" / "Telegram Code (OTP)") wraps to two lines on phones and looks
   like two primary buttons; the selected state is a solid green block that competes with "Sign in".
2. The card has a heavy coloured shadow and floats with a large empty band above it on phones — the form
   starts at ~150 px instead of near the top.
3. Errors are only toasts; field-level messages, `aria-invalid` and the caps-lock hint are missing
   (checked in stage 6).

### Student dashboard (`/dashboard`)
1. "Recommended test" is first and "Today's plan" second; the plan (continue, homework, words to
   review, latest result) should lead.
2. The exam type is shown as a raw enum (`ielts_academic • 138 min`).
3. The three stat tiles are equal and large; the most important number (latest band / estimated level)
   has no trend and no link to the result. On phones every tile takes a full row, pushing the useful
   content below the fold.

### Catalogue (`/mock`)
1. The track switch (IELTS / Multi-Level) plus a sentence plus four status chips take three rows before
   the first exam; on phones the chips scroll horizontally and "Finished" is cut off.
2. Cards show four section chips that are not links and one "Start" button; the student cannot go
   straight to a section, and practice vs. timed exam is only chosen inside a modal.
3. A finished exam shows "Completed" and still "Start" — no "View result", no last band.

### Exam window — common (Listening, Reading, Writing, Speaking)
1. The work area is inset: a 56 px header, then a bordered card with 44 px margins and its own title row
   ("Passage 1" / "Task 1"), then a 56 px footer. At 1366×768 the question/passage area is ~74% of the
   height but only ~93% of the width; the inner title row duplicates the part tab.
2. Six icon-only tools sit in the header with equal weight (status, info, highlight, notes, dictionary,
   focus); the answered counter and the timer are not visually separated from them. In practice mode
   there is no timer at all, so the header gives no sense of pace.
3. Flag is a tiny 12 px "Flag" text above each card, far from the question number; the palette uses
   the same chip for answered / unanswered / flagged with only a thin outline difference.

### Exam window — Listening
1. The native `<audio>` element (grey pill) in practice mode clashes with the page; the part timestamps
   are small chips.
2. The part instruction ("Synthetic listening part 1.") is muted grey and easy to miss.
3. In dark mode the part title is clipped under the sticky player ("Part 1" overlaps).

### Exam window — Reading
1. The passage panel is a card inside a card; with a short passage there is a huge empty column.
2. The resize handle is a 16 px dot grid that is easy to miss; no keyboard hint.
3. On phones the Passage/Questions toggle is good, but the passage card is boxed twice and the bottom bar
   has two rows (part tabs + navigator), leaving ~560 px for content.

### Exam window — Writing
1. The task prompt is a single grey line with a "1" chip; Task 1's image/prompt should sit beside the
   answer at desktop width (split view), as in the real CBT.
2. The word/paragraph/time guide is a separate box under the editor; the editor height is fixed and
   does not use the remaining screen.
3. "Type / Upload paper photo (OCR)" segmented control looks like the primary action of the screen.

### Exam window — Speaking
1. The microphone check dialog covers a blurred, unreadable page; there is no sense of "where am I"
   (part, question count) behind it.
2. After the check, parts are a list of cards with small "record" buttons rather than a single focused
   prompt.
3. Ring timer and level bars (added in S5) are good; they need the same calm header as other sections.

### Result (`/mock/attempt/:id`)
1. The overall band appears **twice** (hero "Overall Band: 8.0" and a second "OVERALL BAND 8.0" card),
   and each skill card repeats "Band 9.0" twice ("Band 9.0" badge + "Score Band 9.0").
2. Skill bars use four unrelated hues (green/blue/purple/orange) while the second grid uses brand green;
   "Accuracy" for Writing/Speaking is a derived percentage, not a real accuracy.
3. Button label bug: "Certificate (PDF) (PDF)". No band trend, criteria are further down without a
   clear "provisional" marker at the top, no "next step".

### Teacher dashboard (`/dashboard`, teacher)
1. Quick actions duplicate the "New PIN exam" button (twice on one screen) and one action has an emoji
   and Uzbek text on the English site ("📲 Ota-onalarga Digest").
2. "Grading queue" — the teacher's most frequent job — is the last card in the right column, below
   payments.
3. Cards use a soft coloured shadow and raised look that is inconsistent with flat cards elsewhere.

### Teacher workspace (`/teacher`)
1. Entire page is hard-coded Uzbek on `/en` ("O'qituvchi Kabineti", "Yangi Guruh Ochish", …).
2. "Teacher Workspace v1.0" badge and a gradient hero card are decoration, not information.
3. Empty state when the teacher has a group in "Groups" but none here — two group concepts confuse.

### Grading (attempt page as teacher)
1. The exam log is first; the work to grade (Writing/Speaking criteria) is far below.
2. No keyboard flow (next item, accept AI suggestion, set criterion score).
3. Same duplicated result hero as the student page.

### Admin dashboard
1. KPI tiles are fine, but "Exam analytics" draws an empty 400 px chart with the message "No activity
   in this period" on top — empty charts should collapse to an empty state.
2. Sidebar has 14 items with no grouping (people, money, content, exams).
3. Icon tiles in KPI cards use four different hue backgrounds.

---

## 2. Direction

**Academic, trustworthy, calm, premium.** The product is an exam room and a teacher's desk, not a game.
It should feel like a well-set printed exam paper on a quiet desk:

- **Quiet surfaces.** Flat cards with 1 px borders; elevation only for things that float (menus,
  dialogs, sticky bars). No coloured or glowing shadows, no gradients behind text, no neon lime.
- **One accent.** Brand green (`--brand`) marks the single primary action, the current item and
  progress. Everything else is neutral. Status colours (success/warning/danger/info) only carry status.
- **Type does the hierarchy.** A real scale with a display size for bands and titles, tabular numbers
  for scores and timers, sentence case (no ALL CAPS headlines).
- **Content first.** In the exam window the passage and the questions own the screen; chrome is thin,
  grouped and secondary.
- **Honest.** No "official", no invented percentages, testimonials or student counts. Estimated values
  are labelled "estimated"/"provisional".
- **Avoid the template look:** no centred hero-plus-three-cards formula repeated down the page, no
  icon-in-a-coloured-square on every card, no emoji in UI copy.

---

## 3. Foundations (tokens)

Implemented in `frontend/src/app/globals.css` (stage 1). All values are CSS variables with a Tailwind
theme alias; components never use raw hex or arbitrary pixel values for these roles.

### 3.1 Typography — Inter Variable, tabular numerals for numbers

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `display` | 48 / 52 (36 / 40 on phones) | 700, -0.02em | band score, landing headline |
| `title` (`text-2xl`) | 28 / 34 | 700, -0.01em | page title |
| `subtitle` (`text-lg`) | 20 / 28 | 600 | card / section title |
| `body` (`text-base`) | 16 / 24 | 400 | default text, exam text (exam passages 17 / 28) |
| `caption` (`text-sm`) | 14 / 20 | 400–500 | meta, labels, table cells |
| `overline` | 12 / 16, +0.06em, uppercase | 600 | rare: tiny section labels inside dense panels only |

Rule kept from S19: no reading text below 14 px. `overline` is for labels only, never sentences.

### 3.2 Colour

Brand green stays (owner-approved `#15803d` light / `#22c55e` dark). Neutrals move from a cold slate
to a slightly warmer, "paper" neutral in light mode; dark mode becomes deeper and less blue so long
reading is calmer.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `bg` | `#fafaf9` | `#0b0f0d` | page |
| `bg-subtle` | `#f4f4f2` | `#111613` | recessed areas, exam canvas |
| `surface` | `#ffffff` | `#141a17` | cards, inputs |
| `surface-hover` | `#f1f1ee` | `#1b221e` | hover / selected rows |
| `fg` | `#18181b` | `#f4f4f2` | 17:1 / 16:1 |
| `fg-muted` | `#52525b` | `#a8aea9` | ≥ 7:1 / ≥ 7:1 |
| `fg-subtle` | `#63636b` | `#8b928d` | ≥ 4.5:1 on bg and surface |
| `border` | `#e7e5e4` | `#232b26` | dividers, cards |
| `border-strong` | `#d6d3d1` | `#34403a` | inputs, emphasis |
| `brand` | `#15803d` | `#22c55e` | unchanged |
| `focus-ring` | `brand` at 2 px + 2 px offset | same | visible on every control |

Status colours unchanged (already AA). Each pair is checked by the token contrast test
(`src/design-system.spec.ts`), target ≥ 4.5:1 for text.

### 3.3 Spacing — 4 px base

`1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48, 16=64`. Page gutter 16 px (phone) / 24 px
(tablet) / 32 px (desktop). Card padding 16 / 20 / 24. Vertical rhythm between sections 24–32 px.

### 3.4 Radius

`--radius-sm: 6px` (chips, badges, palette cells), `--radius-control: 10px` (buttons, inputs),
`--radius-card: 14px` (cards, panels), `--radius-dialog: 18px` (dialogs, sheets), `full` for pills.

### 3.5 Elevation

| Token | Use | Value (light) |
|---|---|---|
| `--shadow-0` | flat cards | none (1 px border) |
| `--shadow-1` | sticky bars, hovered card | `0 1px 2px rgb(24 24 27 / .06)` |
| `--shadow-2` | menus, popovers, toasts | `0 4px 12px rgb(24 24 27 / .08), 0 1px 3px rgb(24 24 27 / .06)` |
| `--shadow-3` | dialogs, bottom sheets | `0 16px 40px rgb(24 24 27 / .14), 0 2px 6px rgb(24 24 27 / .08)` |

Dark mode uses black shadows at higher opacity plus a 1 px border; never coloured shadows.

### 3.6 Motion

`--ease-out: cubic-bezier(.2,.8,.2,1)`, `--ease-in: cubic-bezier(.4,0,1,1)`;
`--dur-fast: 120ms` (hover, press), `--dur-base: 180ms` (popover, tab), `--dur-slow: 260ms` (sheet,
dialog). Only opacity and transform animate. `prefers-reduced-motion` turns animations off. No
looping animation in the exam window except the recording indicator.

---

## 4. Screen priorities

1. **Exam window** (Listening, Reading, Writing, Speaking) — the product's core; trust is won or lost here.
2. **Result and analysis** — the reason students come back.
3. **Student dashboard and catalogue** — daily entry points.
4. **Teacher grading, group analytics, exam builder** — staff productivity.
5. **Landing and auth** — first impression; must show the real product honestly.
6. Everything else inherits the tokens and primitives.

## 5. Guard rails (all stages)

- Exam rules do not change: audio plays once in exam mode, time comes from the server, autosave, the
  finish flow and section locking stay as they are.
- No new runtime libraries; Recharts (already present) for charts.
- All copy in `messages/en.json` and `messages/uz.json`.
- axe: 0 serious / critical; keyboard reachable; focus visible; 44 px touch targets on phones.
- Nothing breaks at 360 px.
