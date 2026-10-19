# BestWay Platform — Progress & Status Report

## Maqsad
BestWay platformasida Cross-Platform Parity (Web, Desktop, Mobile), Exam Simulator Overhaul (5 ta ilg'or himoya va qulaylik moduli), Advanced Anti-Cheat Telemetry, Native Custom TitleBar, Audio Blob Caching hamda Contabo VPS ga uzilishsiz (zero-downtime) deploy qilish (`v0.8.3`).

---

## Bajarildi

### 1. 5 ta Ilg'or Imtihon Moduli (Multi-Level & IELTS Simulator)
1. **Anti-Cheat & Fullscreen Guard**:
   - Imtihon boshlanishi bilan qat'iy to'liq ekran rejimi faollashadi.
   - Oynadan fokus yo'qolganda (`window.onblur`) yoki sichqoncha oynadan chiqib ketganda darhol ogohlantiruvchi qizil banner/modal chiqadi: *"Diqqat! Imtihon oynasidan chiqish taqiqlanadi! (Hodisa qayd etildi)"*.
   - Kontekst menyu (right-click) va Developer Tools tugmalari (`F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+U`) bloklandi.
   - Har bir anomaliya serverga `/v1/mock/attempts/<id>/telemetry` orqali yoziladi va `anti_cheat_count` oshiriladi.
2. **Offline-First State Sync**:
   - Talabaning javoblari har bir harakatda darhol `IndexedDB` / lokal xotirada keshlanadi (`cacheAnswer`).
   - Taymer ko'rsatkichi har soniyada lokal saqlanadi (`cacheTimerSeconds`, `readCachedTimerSeconds`).
   - Tarmoq uzilganda yuqori panelda *"Offline — javoblar lokal saqlanmoqda"* xabari chiqadi; aloqa tiklanganda avtomatik navbat (`flushOfflineSyncQueue`) orqali barcha javoblar serverga uzatiladi.
3. **Audio Blob Caching (Listening Barqarorligi)**:
   - Listening audio fayli birinchi marta yuklanganda xotirada global `mediaBlobCache` ga joylanadi.
   - Bo'limlar yoki savollar (parts) almashganda tarmoqqa qayta so'rov yuborilmaydi; keshdagi audio manzilidan belgilangan timestampga 0ms kechikish bilan sakraydi.
4. **Native Custom TitleBar (Desktop UI/UX Polish)**:
   - Zamonaviy Obsidian Glassmorphism (`#0B0F17/90`, `backdrop-blur-md`, `border-b border-white/5`) uslubidagi sarlavha paneli (`TitleBar.tsx`) yaratildi.
   - Oynani siljitish (`data-tauri-drag-region`), tarmoq indikatori (Online: Yashil, Offline: Sariq), versiya belgisi (`v0.8.3`) va Tauri oynani boshqarish tugmalari (Kichraytirish, Kattalashtirish, Yopish).
   - Faol imtihon rejimida *"Exam Mode — Fullscreen Protected"* himoyasi yoqiladi va oynani tasodifiy yopib yuborish tugmasi bloklanadi.
5. **Android Back-Button Trap (Orqaga Tugmasi Himoyasi)**:
   - Android qurilmalarda imtihon paytida orqaga tugmasi (Back gesture / hardware button) bosilganda testdan chiqib ketish bloklanadi va maxsus tasdiqlash modali talab qilinadi.
   - Tasdiqlanmasa, imtihon to'xtovsiz davom etadi.

### 2. Backend & Telemetriya API (Django Core)
- **`AttemptTelemetry` API**:
  - `/v1/mock/attempts/<id>/telemetry` va `/v1/assessment/attempts/<id>/telemetry` endpointlari joriy qilindi.
  - Event turlari: `window_blur`, `window_focus`, `fullscreen_exit`, `mouse_leave`, `tab_switch`, `devtools_open`.
  - Audit jurnali `MockCheatEvent` ga to'liq metadata bilan qayd etiladi.
- **Yagona Autentifikatsiya**:
  - `bestway-exam://auth/callback` va `bestway://auth/callback` deep link sxemalari barcha rollar (`student`, `teacher`, `admin`, `super_admin`) uchun faollashtirildi.
  - 1-Click Telegram Magic Token orqali bir zumda sessiya yaratish (`POST /telegram/login`).
  - Desktop yangilanish manifesti: `https://bestwayec.uz/api/v1/desktop/update.json` versiyasi `0.8.3` ga yangilandi.
- **Universal Baholash Endpointi**:
  - `/v1/assessment/overview`: IELTS Band (0-9) va Multi-Level (0-75) CEFR (`A2`, `B1`, `B2`, `C1`), so'nggi 10 urinish, mezonli baholar va zaif modullar tahlilini uzatadi.

### 3. Mobile (Android) Barqarorligi
- **Chrome Custom Tabs**: Google OAuth `accounts.google.com` va `oauth2.googleapis.com` manzillari tizim brauzeri / Custom Tabs orqali ochilib, Google'ning `403 disallowed_useragent` xatoligi to'liq yo'qotildi.
- **Android Ruxsatlari**: `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `CAMERA`, Android 13/14 uchun `READ_MEDIA_IMAGES` to'liq tekshirildi.

### 4. Versiya Yangilanishi (`v0.8.3`)
- `bw-tauri/package.json` -> `0.8.3`
- `bestway/frontend/package.json` -> `0.8.3`
- `bw-tauri/src-tauri/tauri.conf.json` -> `0.8.3`
- `bw-tauri/src-tauri/Cargo.toml` -> `0.8.3`
- `bw-tauri/android/app/build.gradle` -> `versionCode 830`, `versionName "0.8.3"`
- `bw-tauri/src/lib/version.ts` -> `0.8.3`
- `backend-django/apps/core/views.py` -> `0.8.3`

---

## Sifat Darvozasi (100% QA Pass Gate)
- **Backend Pytest**: **463 passed**, 4 skipped, 0 failed (100% PASS)
- **Frontend Vitest**: **51 test fayli, 354 test passed**, 0 failed (100% PASS)
- **Desktop Vitest**: **41 test fayli, 327 test passed**, 0 failed (100% PASS)
- **Frontend Next.js Build**: Turbopack orqali barcha 71 sahifa 0 xatolik bilan yig'ildi.
- **Desktop App Build**: `tsc && vite build` 0 xatolik bilan yig'ildi.

---

## Git & Contabo VPS Zero-Downtime Deploy
- **Git Commits & Tags**:
  - `bestway`: Commit `bd5d895`, Tag `v0.8.3`
  - `bw-tauri`: Commit `7f94076`, Tag `v0.8.3`
  - Muallif: `Komiljon Roziyev <kruziyev0@gmail.com>` (Zero AI attribution qoidasiga 100% muvofiq).
- **Contabo VPS (`169.58.58.229`)**:
  - `git pull origin main` muvaffaqiyatli bajarildi.
  - `docker compose up -d --build backend frontend` orqali konteynerlar xizmat uzilishlarsiz qayta yig'ildi.
  - **Jonli Tekshiruvlar**:
    - `https://bestwayec.uz/login` -> **HTTP 200 OK**
    - `https://api.bestwayec.uz/v1/health` -> **HTTP 200 OK**
    - `https://api.bestwayec.uz/v1/desktop/update.json` -> **HTTP 200 OK** (`version: "0.8.3"`)
    - `https://api.bestwayec.uz/v1/assessment/overview` -> **HTTP 200 OK**

---

### 5. Superadmin Akkaunti, Dual AI (OpenRouter DeepSeek) va Multi-Level Mock Imtihon
- **Superadmin Akkaunti Sozlandi**:
  - Telegram ID `5582178765` egasi (`Komiljon Roziyev`) uchun Django `auth_user` va platforma `User` jadvallarida bosh admin huquqlari (`role="super_admin"`, `is_superuser=True`, `is_staff=True`, `is_active=True`) to'liq berildi.
  - Kirish ma'lumotlari: Login `superadmin` / `admin`, Parol `BestwaySuperAdmin2026!`, Telefon `+998976780066`, Email `admin@bestwayec.uz`.
  - Django Admin (`/admin/`), Web/Desktop ilova (`/login`) hamda Telegram 1-click SSO orqali to'liq autentifikatsiya kafolatlandi.
- **Dual AI Baholash Dvigateli Integratsiyasi**:
  - **OpenRouter API** (`deepseek/deepseek-chat`): VPS muhitida `OPENROUTER_API_KEY` o'rnatildi, `education-backend` konteynerida test so'rovi muvaffaqiyatli (HTTP 200 OK) sinovdan o'tkazildi.
  - **xKiro API** (`qwen/qwen3.8-max:free`): Fallback provayder sifatida sozlangan.
- **Yangi Multi-Level Mock Imtihon Kiritildi (`multilevel-writing-speaking-01`)**:
  - Writing va Speaking bo'limlaridan iborat rasmiy CEFR Multi-Level imtihoni yaratildi va VPS bazasiga seed qilindi:
    - **Writing** (70 ball):
      - Task 1.1 (Norasmiy xat, ~50 so'z): Shahar musiqa festivali tashkilotchilariga minnatdorchilik va tavsiyalar.
      - Task 1.2 (Rasmiy xat, 120–150 so'z): Festival komitetiga takliflar, xizmat ko'rsatish kamchiliklari va yechimlar.
      - Task 2 (Fikr-mulohaza posti, 180–200 so'z): Masofaviy ta'lim (Online learning) va an'anaviy ta'lim afzalliklari bo'yicha forum posti.
    - **Speaking** (75 ball):
      - Part 1 (Free Time): Bo'sh vaqt, sevimli mashg'ulotlar bo'yicha 3 ta savol.
      - Part 2 (Cue Card): "Describe a person who has had a positive influence on your life" (1 min tayyorgarlik, 2 min nutq).
  - Django boshqaruv komandasi `seed_multilevel_writing_speaking` yaratildi va `main` tarmog'iga push qilindi.
  - Jonli API `https://api.bestwayec.uz/v1/mock/exams` da imtihon faol ekanligi tasdiqlandi.

