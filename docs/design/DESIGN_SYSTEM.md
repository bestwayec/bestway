# BestWay design system

One source of truth for colour, type, shape and the shared UI primitives of the website
(`frontend/`). It formalises what `frontend/src/app/globals.css` and `frontend/src/components/ui`
already defined, and states the rules screens must follow.

## 1. Colour: semantic tokens only

The app has a light and a dark theme; **light is the default** and a dark choice is remembered in
`localStorage("theme")`. `lib/theme-init.ts` applies the stored theme in `<head>` before the first paint (no
flash); `components/theme-provider.tsx` only touches `<html>` after reading the stored value. Only the semantic tokens below follow the theme. Raw Tailwind
palette classes (`bg-slate-900`, `text-emerald-400`, `bg-white`, …) are fixed colours and render
wrongly in one of the two themes (white cards in dark mode, white text on white in light mode).

| Role | Tokens (Tailwind class stem) | Use |
|---|---|---|
| Page | `bg`, `bg-subtle` | page background, recessed areas |
| Surface | `surface`, `surface-hover` | cards, panels, inputs; hover / selected rows |
| Text | `fg`, `fg-muted`, `fg-subtle` | primary text, secondary text, hints and placeholders |
| Lines | `border`, `border-strong` | dividers and card borders; input borders, emphasis |
| Brand (green) | `brand`, `brand-hover`, `brand-fg`, `brand-subtle`, `brand-subtle-fg` | the one primary action per screen, current item, progress |
| Success | `success`, `success-bg`, `success-border` | correct, saved, passed |
| Danger | `danger`, `danger-bg`, `danger-border` | errors, destructive actions, time almost up |
| Warning | `warning`, `warning-bg`, `warning-border` | flagged questions, needs attention |
| Info | `info`, `info-bg`, `info-border` | neutral notices |
| Orange | `orange`, `orange-fg`, `orange-subtle` | secondary highlight (streaks, rewards) |
| Chart | `chart-series` | the mark of a single-series chart (bars, dots, line); `#16a34a` in both themes because the dark `brand` (`#22c55e`) fails the chart lightness band on the dark surface (dataviz validator) |

Use them with any colour utility: `bg-surface`, `text-fg-muted`, `border-danger-border`,
`ring-brand/40`, `from-brand`.

**Allowed exceptions** (keep raw colours, and say why in the component):

- `bg-black/<opacity>` for modal and media overlays (black in both themes).
- `text-white` on a saturated colour fill (e.g. a red badge); on brand green use `text-brand-fg`.
- Colours that carry meaning as categories: per-skill colours, annotation highlighter colours,
  question-type chips, game answer colours. They must stay distinct, so they keep their hues; their
  neutrals still use tokens.
- Third-party brand marks (the Google logo's own SVG fills; the button around it uses tokens), print-only artwork (certificates) and the crash report
  of `StrictErrorBoundary` (a white diagnostic box in both themes).

### Migrating a component

`frontend/scripts/tokenize-colors.mjs` rewrites raw palette classes to tokens with a fixed mapping
(neutrals by shade and role, green → brand, red → danger, amber/yellow → warning, orange → orange,
blue/sky/… → info; `dark:` colour variants are dropped because tokens already follow the theme).

```bash
node scripts/tokenize-colors.mjs --check src/components/foo.tsx
```

```bash
node scripts/tokenize-colors.mjs src/components/foo.tsx
```

Use `--neutral-only` for files whose hues are categories.

Do not use shadcn colour names (`text-muted-foreground`, `text-foreground`, `bg-card`, `bg-muted`,
`bg-background`, `*-destructive`): `globals.css` never defined them, so Tailwind emits no CSS and the
element silently gets no colour. `--aliases-only` maps them to the tokens above, and the guard test
fails if one appears anywhere in `src`. Always review the result in both themes.
Files that have been migrated are listed in `frontend/src/design-system.spec.ts`, which fails CI if
a raw palette class comes back.

## 2. Typography

Font: Inter (SIL OFL), self-hosted. The Latin face (covers Uzbek ʻ U+02BB and ‘ ’) is preloaded through
`next/font/local`; Latin Extended and Cyrillic faces come from `@fontsource-variable/inter` with
`unicode-range`, so they download only when a page contains those characters.

Four reading levels plus `text-display` (numbers, hero) and `text-overline` (12 px uppercase labels in dense panels only, never sentences); reading text never smaller than 14px (`--text-xs` and `--text-sm` are both 14px):

| Class | Size / line | Weight | Use |
|---|---|---|---|
| `text-display` | 48 / 52 | 700 | band score, landing headline |
| `text-title` | 28 / 34 | 700 | page title (one per page) |
| `text-subtitle` | 20 / 26 | 600 | section and card titles |
| `text-body` | 16 / 24 | 400 | reading text, answers |
| `text-caption` | 14 / 20 | 400–600 | labels, metadata, status chips |

Numbers that change (timers, scores, counts) use `tabular-nums`.

## 3. Shape, elevation, motion, spacing, touch

Redesign 2026-11 (`DIRECTION.md` §3). Values live in `globals.css`; use the named utilities, never
`rounded-[Npx]` or a coloured shadow (`src/design-system.spec.ts` fails CI; fix with
`node scripts/tokenize-shape.mjs <file>`).

- Radius: `rounded-chip` 6 (chips, palette cells), `rounded-field` 8 (small inner controls),
  `rounded-control` 10 (buttons, inputs, selects, menus), `rounded-card` 14 (cards, panels),
  `rounded-dialog` 18 (dialogs, sheets), `rounded-full` (pills).
- Elevation: flat cards (border only). `shadow-e1` sticky bars and hovered interactive cards,
  `shadow-e2` menus, popovers, toasts, `shadow-e3` dialogs and sheets. Tailwind's `shadow-sm…2xl` are
  mapped onto these, so every shadow is neutral in both themes. Never coloured or glowing.
- Motion: `duration-fast` 120 ms (hover, press), `duration-base` 180 ms (popover, tab), `duration-slow`
  260 ms (sheet, dialog); `ease-out` / `ease-in` tokens. Only opacity and transform animate;
  `prefers-reduced-motion` turns them off.
- Spacing: 4px grid; page gutters `px-4` on phones, `sm:px-6`, `lg:px-8`; card padding `p-4 sm:p-5`.
- Touch targets: at least 44×44px (`buttonVariants` guarantees `min-h-[44px]`; inputs and selects are `h-11`).
- Focus: the global `:focus-visible` outline (2px brand, 2px offset) — do not remove it.
- Input borders use `border-input-border` (≥ 3:1 against the surface, WCAG 1.4.11).

## 4. Primitives (`frontend/src/components/ui`)

Gallery: `/dev/ui` (development builds only; 404 in production).

| Primitive | Variants |
|---|---|
| `Button` / `buttonVariants` | `primary` (one per screen), `outline`, `ghost`, `subtle`, `danger`, `link`; sizes `sm`, `md`, `lg`, `icon`; `loading` |
| `Badge` | `neutral`, `outline`, `brand`, `success`, `danger`, `warning`, `info`; sizes `sm`, `md`. At most two on a card. |
| `Card` + `CardHeader/Title/Description/Content/Footer` | `interactive` for clickable cards |
| `Input`, `Textarea`, `Field`, `Select`, `Dialog`, `DropdownMenu` | token-styled; `Field` wires label, hint, error and `aria-invalid` |
| `Tabs` | `TabsList variant="underline"` (page sections) or `"segmented"` (2–4 views, e.g. practice / exam) |
| `Table` + `TableHeader/Body/Row/Head/Cell/Caption` | `numeric` cells align right; scrolls sideways inside its card |
| `StatTile` | label, value, `hint`, `trend` (`up`/`down`/`flat`), `loading`, `href` (`StatCard` renders it) |
| `ProgressRing` | `role="meter"` with the real value; tones `brand`, `warning`, `danger`, `neutral` |
| `feedback.tsx` | `Skeleton`, `Spinner`, `EmptyState`, `ErrorState` (retry label from `common.retry`) |
| Toast | `sonner` (`toast.success` / `toast.error`), styled in `providers.tsx` |

## 5. Exam runner

The runner header must answer, at a glance: which section and exam, how many are answered, whether
answers are saved, how much time is left, and how to finish. One 56 px row on every size.

- Header: section badge + exam title · answered chip · save state · tools (Info, highlight, notes,
  dictionary, focus — grouped between dividers, neutral icons) · **timer** (bordered 36 px pill, 16 px
  tabular digits) · next section (full test) · **Finish** (`primary`). Phones keep title, save state,
  Info, timer and Finish; everything else is under Info. Buttons are 44 px on phones.
- Timer (`lib/exam-settings.ts`): neutral above 5:00, `warning` colours under 5 minutes, `danger` in the
  last minute. A calm notice appears under the clock for ten seconds at 5:00 and at 1:00 (and is
  announced once); nothing flashes or pulses. The time always comes from the server.
- Canvas: the exam area spans the window (max 1680 px) on a `bg-subtle` page; at 1366×768 the passage
  and questions take ~84% of the height. Reading passage on wide screens is a plain column (no card in
  a card), 17 px / 1.75; the split is resizable (`ReadingSplitDivider`).
- Question card: number square (filled brand when answered) · prompt 16 px · **Flag** at the end of the
  same row (`aria-pressed`, 44 px on phones, label from 1024 px).
- Navigator: answered = brand fill, unanswered = outlined, flagged = warning outline + corner mark,
  current = 2 px ring; legend in the "All questions" sheet. On phones the sheet slides up from the
  bottom with 44 px cells.

Never change timing, text selection rules, autosave, audio or microphone behaviour when restyling the
runner.
