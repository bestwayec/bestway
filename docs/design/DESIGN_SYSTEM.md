# BestWay design system

One source of truth for colour, type, shape and the shared UI primitives of the website
(`frontend/`). It formalises what `frontend/src/app/globals.css` and `frontend/src/components/ui`
already defined, and states the rules screens must follow.

## 1. Colour: semantic tokens only

The app has a light and a dark theme; **dark is the default** (`components/providers.tsx`,
`ThemeProvider defaultTheme="dark"`). Only the semantic tokens below follow the theme. Raw Tailwind
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

Use them with any colour utility: `bg-surface`, `text-fg-muted`, `border-danger-border`,
`ring-brand/40`, `from-brand`.

**Allowed exceptions** (keep raw colours, and say why in the component):

- `bg-black/<opacity>` for modal and media overlays (black in both themes).
- `text-white` on a saturated colour fill (e.g. a red badge); on brand green use `text-brand-fg`.
- Colours that carry meaning as categories: per-skill colours, annotation highlighter colours,
  question-type chips, game answer colours. They must stay distinct, so they keep their hues; their
  neutrals still use tokens.
- Third-party brand marks (Google sign-in), print-only artwork (certificates) and the crash report
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

Use `--neutral-only` for files whose hues are categories. Always review the result in both themes.
Files that have been migrated are listed in `frontend/src/design-system.spec.ts`, which fails CI if
a raw palette class comes back.

## 2. Typography

Four levels, never smaller than 14px (`--text-xs` and `--text-sm` are both 14px):

| Class | Size / line | Weight | Use |
|---|---|---|---|
| `text-title` | 28 / 34 | 700 | page title (one per page) |
| `text-subtitle` | 20 / 26 | 600 | section and card titles |
| `text-body` | 16 / 24 | 400 | reading text, answers |
| `text-caption` | 14 / 20 | 400–600 | labels, metadata, status chips |

Numbers that change (timers, scores, counts) use `tabular-nums`.

## 3. Shape, spacing, touch

- Radius: `rounded-[12px]` (`--radius-card`, `--radius-control`) for cards, inputs and buttons;
  `rounded-full` for chips and pills.
- Cards: `Card` (`border border-border bg-surface`), no shadows or glows.
- Spacing: 4px grid; page gutters `px-4` on phones, `sm:px-6` and wider above.
- Touch targets: at least 44×44px for buttons and links (`buttonVariants` guarantees `min-h-[44px]`).
- Focus: the global `:focus-visible` outline (2px brand) — do not remove it.

## 4. Primitives (`frontend/src/components/ui`)

| Primitive | Variants |
|---|---|
| `Button` / `buttonVariants` | `primary` (one per screen), `outline`, `ghost`, `subtle`, `danger`; sizes `sm`, `md`, `lg`, `icon` |
| `Badge` | `neutral`, `outline`, `brand`, `success`, `danger`, `warning`, `info` |
| `Card` + `CardHeader/Title/Description/Content/Footer` | `interactive` for clickable cards |
| `Input`, `Textarea`, `Select`, `Tabs`, `Dialog`, `DropdownMenu` | token-styled |
| `feedback.tsx` | `Skeleton`, `EmptyState`, `ErrorState` |

## 5. Exam runner

The runner header must answer, at a glance: which section and exam, which question, how many are
answered, how many are flagged, whether answers are saved, how much time is left, and how to
finish.

- Row 1: section badge + exam title; timer pill (only when the attempt has a deadline; turns
  `danger` under 5 minutes); next-section button (full test); **Finish** (`primary`).
- Row 2, status chips: current question, answered / total, flagged count (`warning`, only when > 0),
  save state (`success` saved, neutral saving, `danger` error or offline with a Retry button).
  Only the save chip is an `aria-live` region.
- Question palette: answered = brand, flagged = warning, current = ring. Legend always visible.

Never change timing, text selection rules, autosave, audio or microphone behaviour when restyling the
runner.
