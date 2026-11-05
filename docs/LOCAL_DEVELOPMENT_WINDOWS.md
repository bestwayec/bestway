# BESTWAY — Windows 10 da lokal ishga tushirish (4 GB RAM uchun yengil rejim)

Faqat **lokal ishlab chiqish** uchun. Production ma'lumotlari, kalitlar va serverlarga hech qanday ulanish yo'q.

## Nima ishlaydi
| Qism | Port | Izoh |
|---|---|---|
| PostgreSQL 17 (mavjud Windows xizmati) | 5432 | alohida baza `bestway_local`, alohida rol `bestway_local` |
| Django REST API (`backend-django`) | 8100 | `runserver --noreload`, `config.settings.local` |
| Next.js frontend (`frontend`) | 3300 | `next dev`, `API_URL=http://127.0.0.1:8100/v1` |

O'chirilgan (RAM tejash uchun): Redis, assessment worker, Telegram bot, AI/STT integratsiyalari, Docker.

## Bir martalik sozlash
```powershell
# 1) baza va rol (postgres superuser loopback'da trust bilan kiradi)
psql -U postgres -h 127.0.0.1 -c "CREATE ROLE bestway_local LOGIN PASSWORD '<parol>'"
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE bestway_local OWNER bestway_local"

# 2) env fayllar (git'ga kirmaydi): backend-django\.env, backend\.env, frontend\.env.local
#    DATABASE_URL=postgresql://bestway_local:<parol>@127.0.0.1:5432/bestway_local?schema=public
#    DJANGO_SECRET_KEY, JWT_SECRET — tasodifiy lokal qiymatlar; ASSESSMENT_WORKER_ENABLED=false
#    frontend: API_URL=http://127.0.0.1:8100/v1

# 3) sxema: AVVAL Prisma (legacy), KEYIN Django
cd backend ; npm ci ; npx prisma migrate deploy
cd ..\backend-django ; python -m venv .venv ; .venv\Scripts\pip install -r requirements\dev.txt
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py check_legacy_schema        # "Schema compatible ... ledger verified"

# 4) sintetik ma'lumot (faqat *_local bazada ishlaydi)
.venv\Scripts\python manage.py seed_local_dev
.venv\Scripts\python manage.py seed_cbt_multilevel_exam

# 5) frontend
cd ..\frontend ; npm ci
```

## Kundalik ishlatish
```powershell
powershell -File scripts\local-start.ps1   # Django + Next.js; URL'larni chiqaradi
powershell -File scripts\local-check.ps1   # PASS/FAIL tekshiruv (exit code 0 = hammasi joyida)
powershell -File scripts\local-stop.ps1    # faqat shu loyiha ishga tushirgan jarayonlarni to'xtatadi
```
Skriptlar qayta-qayta ishga tushirilsa xavfsiz: ishlab turgan jarayon qayta ishlatiladi, begona jarayon egallagan port
tegilmaydi (xato xabari chiqadi). Loglar: `.local\*.log`.

## Brauzer smoke-test (haqiqiy Chromium, Playwright)
```powershell
cd scripts\e2e-local ; npm install        # bir marta (brauzer yuklamaydi, keshdagi Chromium ishlatiladi)
node smoke.mjs                              # hisobot: .local\e2e\report.json, skrinshotlar: .local\e2e\*.png
```
Faqat loopback manzillarga ishlaydi (`BW_WEB` boshqa host bo'lsa rad etadi).

## UI ranglar auditi
`node ui-audit.mjs <nom>` (`scripts\e2e-local` ichida) 17 sahifani haqiqiy Chromium bilan ochib, har bir matnning WCAG
kontrastini o'lchaydi va skrinshot saqlaydi (`.local\ui\<nom>\`). Dizayn o'zgarishidan oldin/keyin ishga tushirib solishtiring.

## Sintetik akkauntlar
`seed_local_dev` yaratadi: super_admin / admin / teacher / 2 student / parent (`+99890000000x`). Parol:
`backend-django/apps/core/management/commands/seed_local_dev.py` ichidagi `LOCAL_DEV_PASSWORD`.

## 4 GB RAM bo'yicha eslatmalar
- `next dev` birinchi marta har bir sahifani kompilyatsiya qiladi; bu vaqtda Node event-loop band bo'lib, proksining 8 s
  upstream timeout'i (HTTP 502) ishga tushishi mumkin. `local-start.ps1` asosiy sahifalarni oldindan "isitadi".
- `NODE_OPTIONS=--max-old-space-size=1536` bilan heap cheklangan. Bir vaqtda `tsc`/`vitest`/`next dev` ishlatmang.
- Brauzer testi paytida boshqa og'ir dasturlarni yoping.
