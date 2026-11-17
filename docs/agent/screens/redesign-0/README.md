# Redesign stage 0 — baseline

Main `3b46c08`, local stack (Postgres 16, Django `runserver`, `next dev`), synthetic accounts from
`seed_local_dev` and the synthetic IELTS exam from `ielts-full.mjs`. 1366×768 and 390×844, light and dark.

```bash
BW_WEB=http://localhost:3300 BW_CHROMIUM=/path/to/chrome node scripts/e2e-local/redesign-screens.mjs docs/agent/screens/redesign-0/before
```

Pages: landing, login, dashboard (student), catalogue, listening, reading, writing, speaking (practice
attempts started through the API), result, teacher (dashboard), workspace (`/teacher`), grading
(attempt page as teacher), groups, builder, admin. The audit is in `docs/design/DIRECTION.md`.
