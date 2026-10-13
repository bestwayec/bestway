# Education Center — Database Schema & Migrations

Ushbu katalog BestWay tizimi uchun PostgreSQL ma'lumotlar bazasi sxemasi va migratsiyalarini o'z ichiga oladi (Prisma ORM).

## Arxitektura
- Asosiy backend: **Django** (`backend-django/`)
- Frontend: **Next.js** (`frontend/`)
- Desktop: **Tauri** (`bw-tauri/`)
- Ushbu katalog (`backend/prisma`): faqat PostgreSQL ma'lumotlar bazasi sxemasi va migratsiyalari uchun xizmat qiladi.

## Migratsiyalarni qo'llash
```bash
npx prisma migrate deploy
```
