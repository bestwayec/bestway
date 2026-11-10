# BESTWAY — Education Center System

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![CI](https://github.com/bestwayec/bestway/actions/workflows/ci.yml/badge.svg)](https://github.com/bestwayec/bestway/actions/workflows/ci.yml)
[![Code of Conduct](https://img.shields.io/badge/Code_of_Conduct-Contributor_Covenant-4baaaa.svg)](CODE_OF_CONDUCT.md)

> **BESTWAY EC** — English & International Exams (IELTS / Multilevel / General)
> Shofirkon, Bukhara · Since 2007 · Founder **Aziz Akhtamov**

One platform for the whole center — students, teachers, parents and admins — with transparent attendance, points, payments and exam results.

**Quick links:** [Architecture](#-architecture) · [Local development](#-local-development) · [Features](#-features) · [Desktop exam client](#️-desktop-exam-client) · [Checks](#-checks) · [Contributing](CONTRIBUTING.md)

---

## 🏗 Architecture

```
Browser --/api/backend/*--> Next.js 16 (3005) --Bearer--> Django 5.2 + DRF (gunicorn, 3001) --> PostgreSQL 17
                              | httpOnly cookies, token refresh   | /v1 API, /admin, media streaming     (+ Redis cache)
                              | next-intl (uz default, en)        | JWT auth, role guards
                                                                   |
                          background containers from the same Django image:
                          assessment-worker (AI/teacher grading queue) · game-scheduler · telegram-bot
```

| Part | Directory | Notes |
|---|---|---|
| API | `backend-django/` | Django 5.2, Django REST Framework, JWT. Apps: `core` (users, groups, attendance, payments, mock exams, assessment), `exams`, `bamboozle`, `notifications`, `legacy_schema` (models over the existing tables). Entry: `config.wsgi`, settings in `config/settings/{base,local,production,test}.py`. |
| Database schema | `backend/prisma/` | **Only** the authoritative PostgreSQL schema and migrations (Prisma). It is applied *before* Django's own migrations; there is no NestJS server any more. See `backend/README.md`. |
| Web | `frontend/` | Next.js 16 (App Router), React 19, Tailwind v4, next-intl, TanStack Query, Radix UI. `src/proxy.ts` handles locale and route guards. |
| Desktop / Android | [`bestwayec/bw-tauri`](https://github.com/bestwayec/bw-tauri) | Tauri 2 exam client, released from that repository. |
| Deployment | `docker-compose*.yml`, `scripts/deploy-release.sh`, `.github/workflows/` | Production deploys are manual and approval-gated. |

Compose services (`docker-compose.yml`): `postgres`, `django-cache` (Redis), `db-migrator`, `backend`, `assessment-worker`, `game-scheduler`, `telegram-bot`, `frontend`.

---

## 💻 Local development

Windows 10 with 4 GB RAM and no Docker is the supported lightweight setup. Everything needed (database, env files, seed users, start/stop/check scripts, browser smoke tests) is described in **[docs/LOCAL_DEVELOPMENT_WINDOWS.md](docs/LOCAL_DEVELOPMENT_WINDOWS.md)**. In short:

```powershell
powershell -File scripts\local-start.ps1    # Django :8100 + Next.js :3300
powershell -File scripts\local-check.ps1    # PASS/FAIL health check
powershell -File scripts\local-stop.ps1
```

Docker (full stack, closer to production):

```bash
cp backend-django/.env.example backend-django/.env   # fill in secrets locally; never commit them
docker compose up -d --build
# web http://localhost:3005 · API http://localhost:3001/v1/health
```

Never run seed commands or tests against a production database. Local seeding (`manage.py seed_local_dev`) refuses to run outside a `*_local` database.

---

## ✨ Features

| Module | Path | What it does |
|---|---|---|
| **Attendance** | `/attendance` | Excel-like grid, present/late/absent, stats, CSV |
| **Payments** | `/payments` | 12-month grid, partial/paid/unpaid, debtors + reminders |
| **Points & Game** | `/points`, `/game` | ± points with reason, leaderboard, monthly reset |
| **Groups/Users** | `/groups`, `/students` | CRUD, schedule, teacher assignment |
| **Tests** | `/tests` | Auto + manual grading, anti-cheat, PDF certificate |
| **Mock Exams** | `/mock` | IELTS and Multi-Level (CEFR) mocks, full exam or single-section practice, timed/practice, listening player, speaking recordings, Writing/Speaking AI + teacher review |
| **Videos** | `/videos` | Upload, signed stream URLs, manual purchase confirm |
| **Articles/Gallery/Teachers** | `/news`, gallery | CMS for the marketing site |
| **Notifications** | `/notifications` | In-app + Telegram broadcast (all/role/group/debtors) |
| **Stats/Audit/Settings** | `/dashboard`, `/audit` | Income chart, CSV exports, audit log (super_admin) |

---

## 🖥️ Desktop exam client

The Tauri 2 kiosk exam client lives in [`bestwayec/bw-tauri`](https://github.com/bestwayec/bw-tauri): AES-GCM secure storage, per-platform lockdown and CSP/capability review. Desktop and Android releases ship from that repo.

---

## 🔐 Roles

| Role | Access |
|---|---|
| **super_admin** | everything, including audit and settings |
| **admin** | students, groups, attendance, payments, tests, videos, articles |
| **teacher** | own groups: attendance, points, grading |
| **student** | tests and mocks, own data, videos, leaderboard |
| **parent** | read-only view of linked children |

Route guards: `frontend/src/lib/nav.ts`, `frontend/src/proxy.ts`. The API enforces roles on every endpoint (`403` otherwise); the web guards are UX only.

---

## 📁 Structure

```
.
├── backend-django/        # Django API, workers, management commands, pytest suite (tests/)
├── backend/prisma/        # PostgreSQL schema + migrations (applied before Django migrations)
├── frontend/              # Next.js app, vitest specs next to the code, messages/{uz,en}.json
├── scripts/               # local-*.ps1, deploy-release.sh, e2e-local/ (Playwright checks)
├── media/                 # exam media used by the importers (SEED_MEDIA_DIR)
├── nginx/                 # reverse-proxy config
└── docs/                  # runbooks, local development, specs
```

---

## ✅ Checks

```bash
# backend
cd backend-django && python -m pytest

# frontend
cd frontend && npx tsc --noEmit && npm run lint && npm test && npm run build

# browser checks against the local stack (loopback only)
cd scripts/e2e-local && node smoke.mjs && node mobile-listening.mjs
```

CI (`.github/workflows/ci.yml`) runs the Django suite on PostgreSQL (Prisma schema first, then Django migrations, schema ledger check, HTTP and worker integration checks, container build) and the frontend lint + unit tests. Desktop releases are built in [`bestwayec/bw-tauri`](https://github.com/bestwayec/bw-tauri).

---

## 🤝 Community

* [Contributing](CONTRIBUTING.md) — setup, checks, commit style, PR rules
* [Code of Conduct](CODE_OF_CONDUCT.md) — report to `otashdev1@gmail.com`
* [Security](SECURITY.md) — private reporting via Advisory or email
* [License](LICENSE) — GPL-3.0
