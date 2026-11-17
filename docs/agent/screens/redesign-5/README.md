# Redesign stage 5 — teacher and admin

Teacher (`+998900000003`) and admin (`+998900000002`) on the local stack. **before**: main `bebb130`,
light theme only (the dark run of the "before" capture was interrupted). **after**: this branch, 1366×768
and 390×844, light and dark. `grading-*` is the IELTS attempt opened by the teacher.

| | Before | After |
|---|---|---|
| Teacher workspace (`/teacher`) | entirely hard-coded Uzbek on `/en`, "Teacher Workspace v1.0" badge, gradient hero | en/uz catalogue (`teacherWorkspace`), page header + three StatTiles, EmptyState; cards keyboard-selectable (`aria-pressed`), labelled forms with field errors |
| Group progress | hand-made table, emoji status (✓ ✕ ⏳), 11 px grade button | design-system `Table` with sticky student column, status badges in words, grade cell: Enter saves / Esc cancels |
| New assignment | green toggle, unlabelled selects | segmented type switch, `Field` labels, same payload |
| Teacher dashboard | "New PIN exam" twice; "📲 Ota-onalarga Digest" in Uzbek on `/en`; grading queue last, below payments | one PIN action (in the live exam card); "Send weekly report to parents" (en/uz); **grading queue first** in the side column with the five oldest attempts linked directly |
| KPI tiles | coloured icon squares, glow corner | `StatTile` |
| Grading form | action in a `<select>` | segmented choice (Accept AI / Override / Edit feedback / Regrade / Needs review), criteria in a 4-column grid, **Ctrl/⌘ + Enter saves**; exam log moved below the work to grade |
| Admin exam analytics | 300 px of empty axes under "No activity in this period" | a short empty state |
