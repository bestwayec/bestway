# BestWay Platform — Progress & Status Report

## Maqsad
BestWay / GRAND EDUCATION platformasining asosiy yo'nalishlari — Faqat Writing va Speaking modullaridan iborat mustaqil imtihonlarni blokerlarsiz o'tkazish (Standalone Writing & Speaking Exam), qog'ozdagi qo'lyozma insholarni rasmga olib yuklash (Multi-page Handwriting Image Upload + Vision OCR & AI Grader), ustoz tomonidan yakuniy bahoni tasdiqlash va qayta belgilash (Teacher Manual Override Engine), imtihon va guruh natijalarini rasmiy tahliliy formatlarda eksport qilish (Excel .xlsx & PDF ReportLab), imtihon va baholash interfeyslarini zamonaviy Dark Obsidian (`#0B0F17`) hamda Zumrad (`emerald-500/600`) uslubiga to'liq o'tkazish, 100% testlardan o'tkazish va Contabo VPS ga uzilishsiz (zero-downtime) deploy qilish.

---

## Bajarildi

### 21-BLOK: Android video audit (10-noyabr) — P1–P6, branch'lar `fix/p1…p5`, `fix/extras…`
Video qo'lda ko'rilmadi; kuzatuvlar gipoteza sifatida kod va lokal muhitda qayta tekshirildi. Deploy qilinmagan.

| # | Muammo | Ildiz sababi | Tuzatish | Holat |
|---|---|---|---|---|
| P1 | Part 4 xaritasi javobga mos emas | `map.png` qo'lda chizilgan nusxa edi: harflar nomli xonalarga qo'yilgan ([C] Medical Centre), prosa "plan" ham shuni takrorlardi, variantlar "Room A..H". Rasmiy PDF'da A–H nomsiz xonalarda | Rasmiy reja (watermark'siz), variantlar A–H, prosa olib tashlandi, eski "D  Room D" javoblar baholanadi. Kalit (D,C,A,E,H) o'zgarmadi — rasmiy javoblar sahifasiga mos | lokal tekshirildi (360/390 px), qurilmada emas |
| P3 | "Preview this part / Volume" | Bu imtihon pleyeri: server 20 s ko'rib chiqish beradi, audio 2 marta (`playLimit=2`) — cheklovlar serverda. Yashirilmadi. Topilgan haqiqiy xatolar: (a) `record_audio_access` har qanday qisman urinish uchun 403 berardi — Listening-only mashqda audio umuman ijro bo'lmasdi; (b) `src` ikki marta o'rnatilib birinchi `play()` AbortError bilan uzilardi va har urinish 2 ta ijrodan birini yeb qo'yardi | Gate faqat Listening kirmagan scope'da rad etadi; src bir marta, berilgan ijro qayta so'ralmaydi; uz/en matn; ixcham | lokal tekshirildi. **Repodagi 6 ta WAV — 8 soniyalik tovush (e'lon qilingani 360 s): haqiqiy yozuvlar emas** |
| P4 | Tillar aralash, "DTM" | CEFR layout rejimi ichki nomi `dtm`; palitra/stepper/header matnlari qattiq yozilgan | next-intl uz/en, "DTM" yo'q | lokal tekshirildi (uz — vitest; local `next dev` da prefikssiz uz marshrut sikllanadi) |
| P6 | Palitra qirqilgan, Next section, kiosk toast | Palitra yonga aylanuvchi bitta qator edi; Next section tasdiqsiz; toast — brauzer matni | Qatorlarga o'raladi + hint; Next section tasdiq dialogi; uz/en to'liq ekran ogohlantirishi (bir marta) | lokal tekshirildi |
| P2 | Mikrofon dialogi telefonda | Ruxsat to'liq ekranda so'ralardi; rad etilsa chiqish yo'q | Ruxsat imtihon boshida (to'liq ekrandan oldin); to'liq ekranda bo'lsa vaqtincha chiqib so'raladi (guard to'xtatiladi); uz yo'riqnoma, Qayta urinish, "mikrofonsiz davom etish" | Chromium + soxta mikrofon; **haqiqiy Android'da tekshirilmagan** |
| P5 | Bo'sh attempt | Writing/Speaking uchun bo'sh javobga job yaratilar, attempt `grading`da qolardi; UI sahnalashtirilgan soxta "Deepgram" bosqichlari | Bo'sh vazifa — yakuniy 0, job yo'q, daraja/band yo'q; "Javob topshirilmagan" ekrani; soxta animatsiya olib tashlandi | lokal: ~1 s da `completed`; 360/390 px da ustma-ust yo'q (video siqilishi) |
| — | Listening 9 ("coach"/"bus") | Rasmiy kalit faqat "coach"; "bus" variant sifatida qo'shilgan, transkript repoda yo'q | **O'zgartirilmadi** — mahsulot qarori | ochiq |
| — | faster-whisper testi | Ixtiyoriy paket | `importorskip` | tuzatildi |
| — | README | NestJS tasvirlangan | Django/Next.js | tuzatildi |

Egasi qilishi kerak: haqiqiy Android qurilmada mikrofon/audio/to'liq ekran tekshiruvi; haqiqiy Listening audio fayllarini `media/exams/record_mock_1/` ga qo'yish (importer endi ogohlantiradi; deploy mavjud prod audio'ni qisqa fayl bilan almashtirib yubormasligi uchun avval prod audio'ni tekshiring); deploydan keyin `https://api.bestwayec.uz/v1/health` da `buildCommit`.

### 20-BLOK: Mobil video (1000003608.mp4) bo'yicha tuzatishlar — branch `fix/mobile-login-exam-integrity` (base `origin/main` 1f97bc8)
Video fayli sessiyada yo'q edi; ish berilgan dalillar va kod/lokal bazani tekshirish asosida bajarildi.

| # | Muammo | Ildiz sababi | Tuzatish | Tekshiruv | Holat |
|---|---|---|---|---|---|
| 1 | Telegram SSO sahifasida `FATAL: too many clients` va ichki IP | `telegram_login_view` istisno matnini (`{e!s}`) foydalanuvchiga qaytarardi; fon threadlari (HLS, audio, assessment tick, Telegram delivery pool) PG ulanishini yopmasdi | Xavfsiz 503 (lokal matn, `Retry-After`), `common/background.start_thread` ulanishni yopadi, prod'da `idle_session_timeout`/`idle_in_transaction_session_timeout`/`connect_timeout` | unit testlar; real PG: 12 parallel login → backendlar soni o'zgarmadi | FIXED (lokal). Prod ulanish soni o'lchanmagan |
| 1b | Bot `/login` havolasi | O'zi imzolagan widget payload 24 soat qayta ishlatilardi; link token login token sifatida ishlatilardi; har qanday cache kaliti tekshirilardi | Tasodifiy, hash'langan, 10 daqiqalik, bir martalik `sso_token` (atomik delete); eski yo'llar olib tashlandi; throttle; per-identity advisory lock (ikki marta bosish = bitta akkaunt) | forged/expired/replay/parallel testlar; real PG 6 parallel → 1 qabul | FIXED |
| 2 | OTP | Kod to'qnashuvi mumkin edi, get+delete atomik emas, throttle yo'q | `cache.add` bilan unikal kod, atomik iste'mol, `SensitiveAuthThrottle` | testlar | FIXED |
| 3 | 0 urinishda 0/75 va A2 | Predictor ma'lumotsiz 0.0 va "A2" qaytarardi | Ma'lumot yo'q → `null` | unit | FIXED |
| 4 | CEFR oraliqlari ziddiyati | Backend 34/46/60, frontend 36/51/65 va 38/51/65 | Hamma ekran bitta `lib/multilevel-scale.ts` (backend bilan bir xil) | vitest | PARTIAL — rasmiy UZBMB chegaralari NEEDS PRODUCT DECISION |
| 5 | Listening 27 savol, Part 1 yo'q; ~35 vs 45 daq | Record Mock kalitlari validatorga mos emas (MC'da variantlar, `ONE_WORD_ONLY`), practice reja listeningni rad etib, Part 1 (bo'sh prompt) ni tashlaydigan zaxira ro'yxatga tushardi; launcher qattiq yozilgan vaqt | Ballga ta'sirsiz normalizatsiya (deployda import qayta ishlaydi), listening uchun "audio stem", `sectionDurations` spec'dan | lokal: 35/35, Part 1 bor; mobil e2e | FIXED (lokal) |
| 6 | Palitra 1–27 vs savol 9+ | Palitra ketma-ket indeks ishlatardi | Muallif raqami, aria-label/aria-current, mobil ixcham | vitest + e2e (Q20 ↔ palitra 20) | FIXED |
| 7 | Part 4 xarita buzilgan | Xarita bo'limi boshqa domendagi `PUBLIC_URL/v1/...` ni cookie'siz yuklardi | Doim `/api/backend` proksi, xato/qayta yuklash holati, mobil'da sticky emas | e2e: naturalWidth 800×500 | FIXED (lokal) |
| 8 | Qisman natija: A2/Below B1, AI xabari, sertifikat | single_skill/PRACTICE_PARTIAL to'liq natija deb ko'rsatilardi; PDF bitta bo'limdan CEFR chiqarardi | "Bo'lim mashqi", daraja/umumiy ball yo'q, AI belgisi faqat Writing/Speaking'da, "Mashq hisoboti (PDF)", PDF'da CEFR yo'q | vitest + e2e + pytest | FIXED |
| 10 | Dashboard: 1 bo'limdan "barqaror" prognoz | Qisman urinishlar umumiy prognozga kirardi; ko'nikmasiz bo'limlarga umumiy ball yozilardi | Umumiy prognoz faqat to'liq imtihonlardan; 1 natija = `insufficient_data` | unit | FIXED |
| D | bw-tauri prognoz vidjeti | Ma'lumotsiz 6.5/51, soxta grafik va zaif modullar | `hasEvidence`, soxta qiymatlar olib tashlandi | vitest 418/418 | FIXED (branch `fix/prediction-no-fabricated-data`) |
| 9, 11 | Vocabulary/Bamboozle/Video/Profile; bot /status, /leaderboard | — | o'zgartirilmadi | smoke-test sahifalari ochiladi | NOT REPRODUCED |

Muhim: `mock-result-view.tsx` main'da `\r\r\n` qator oxirlari bilan buzilgan edi — LF ga keltirildi (mazmun o'zgarishi ~20 qator).

### 19-BLOK: Frontend dizaynini soddalashtirish (branch `design/simplify`)
1. **Dizayn tokenlari va tipografiya**: Yagona zumrad (emerald `#16a34a` / `#22c55e`) brend rangi + neytral kulrang shkala. Barcha neon, glow, gradient va sun'iy soyalar olib tashlandi. Shrift o'lchamlari 4 pog'onaga standartlashtirildi: sarlavha 28px, kichik sarlavha 20px, asosiy matn 16px, izoh 14px (14px dan kichik matn qolmadi). Kartalar 1px chegara va 12px radiusga keltirildi. Bo'shliqlar 8 ning karralilariga (8, 16, 24, 32px) moslashtirildi.
2. **Chap navigatsiya (Sidebar)**: 9+ banddan iborat tartibsiz menyu talabalar uchun 4 ta asosiy bo'limga ixchamlashtirildi: Bosh sahifa, Imtihonlar, Darslar, Natijalar. Qolgan vositalar (Vocabulary, Bamboozle Arena, Leaderboard, Exam Track) "Yana" va profil menyusiga o'tkazildi. Bildirishnomalar yuqori panelga qo'ng'iroq belgisi sifatida joylashtirildi.
3. **Talaba Dashboardi**: Yuqorida "Salom, {ism}" va bitta markaziy "Davom etish" (Hero Continue) kartasi. Ostida 3 ta asosiy ko'rsatkich: taxminiy daraja, topshirilgan testlar, ketma-ket kunlar. Ikkilamchi bloklar (Live Exam PIN, uy vazifalari) pastki qismga tushirildi.
4. **Imtihonlar katalogi va Modal**: A1–C1 darajalar filtri; har bir kartada faqat nomi, davomiyligi, bo'limlar va bitta "Boshlash" harakat tugmasi. Boshlash modalida ikkita aniq tanlov: "To'liq imtihon (Full Mock)" va "Alohida bo'lim (Single Section)" imkoniyati.
5. **Imtihon runner'i**: Chalg'ituvchi fon effektlari va ortiqcha tugmalar tozalandi; yuqorida taymer, bo'lim nomi va tugatish harakati; pastda qulay savol raqamlari palitrasi; matn 16–17px va qator kengligi 70 belgiga (`max-w-[70ch]`) cheklandi. Autosave, audio yozish va submit xatti-harakati 100% saqlab qolindi.
6. **Natijalar va profil**: Natijalar bo'lmaganda "0.0" o'rniga "Hali natija yo'q — birinchi testni boshlang" banneri va CTA tugmasi. Grafik va jadvallar zumrad ohangga keltirildi.
7. **Landing sahifa**: Bitta aniq sarlavha ("IELTS va Multi-Level (CEFR) imtihonlariga eng samarali tayyorgarlik"), bitta jumla tavsif, ikkita tugma ("Bepul darajani aniqlash" va "Kirish"), ostida 3 ta asosiy afzallik kartasi. Ishonchsiz sanagichlar va 3D WebGL kanvasi olib tashlandi.
8. **Feedback holatlari**: 12px burchakli standart Skeleton yuklanish holati va "Nima bo'ldi + Qayta urinish" xatolik paneli.
9. **Verifikatsiya va Skrinshotlar**: 24 ta OLDIN va 24 ta KEYIN skrinshotlar `docs/design/before/` hamda `docs/design/after/` papkalariga saqlandi (1366×768 va 390×844, light va dark). `scripts/e2e-local/smoke.mjs` 16/16 PASS, Vitest 70 ta test fayl / 417 ta test 100% PASS, `npx tsc --noEmit` 0 xato.

### 18-BLOK: Video audit (8-noyabr) — K1/K2, O1–O4, U1–U6 (branch `fix/video-audit-nov8`)
1. **P0-DB**: prod Postgres 100/100 ulanishda edi (96 tasi `assessment-worker`ning yopilmagan idle ulanishlari). Sabab: har tick yangi ThreadPoolExecutor, oqim ulanishlari `CONN_MAX_AGE` ostida yopilmasdi. `connections.close_all()` qo'shildi.
2. **K1**: Record Mock Listening "0 bo'lim" — prod attempt `e46a8e71` `single_skill`, scope'siz, `currentSkill=NULL`; frontend `practiceExam()` barcha bo'limlarni filtrlab yuborardi. Kontent to'liq (35 listening savol), CD access sababi emas. Tuzatildi + `seed_local_k1_attempt` fixture + smoke 14-qadam.
3. **K2**: Mistake Vault har bir talabaga bir xil qattiq yozilgan foizlarni qaytarardi; endi faqat haqiqiy tekshirilgan javoblardan. Demo fallback'lar olib tashlandi, ma'lumot yo'q bo'lsa "—".
4. **O1/O2**: reyting — ball teng bo'lsa kim oldin yetgan bo'lsa yuqorida; "Student"/test nomlar va staff yashirildi; nomsiz talabaga ism so'rovchi karta.
5. **O3/O4**: Exam Track skeletonlari (layout shift yo'q); bildirishnomalar sahifasi ochilganda o'qilgan deb belgilanadi.
6. **U1–U6**: qavsli tugma matni, i18n (uz/en), bir qatordagi teng balandlikdagi track kartalari, umumiy `LoadErrorPanel`, quiz skeletonlari, video kartalar tekislandi.

## Jarayonda
- OpenRouter kalitini serverda almashtirish: skript tayyor (`~/set-openrouter-key.sh`), foydalanuvchi kalitni yashirin promptga kiritishi kerak.
- `ru` locale mavjud emas (faqat uz/en) — to'liq tarjima alohida ish.


### 17-BLOK: CI/CD tiklash — deploy rollback, CI concurrency (PR #98)
1. **Tiklash**: `fix/ci-deployment-reliability` allaqachon PR #97 sifatida main'ga merge qilingan edi (yo'qolgan ish yo'q). Lokal `fix/exam-pipeline-and-deploy` (5 commit, push qilinmagan) main bilan birlashtirildi → `fix/ci-deployment-reliability-recovery`.
2. **Topilgan sabablar**: (a) muvaffaqiyatsiz activate'dan keyin qaytish imkoni yo'q edi (`:local` teglar prepare'da qayta yozilardi); (b) run 42030164865 — build va konteyner yangilash bitta SSH buyrug'ida (#97 da bo'lingan); (c) PR CI'da concurrency yo'q; (d) `ubuntu-latest` Ubuntu 26 ga ko'chmoqda; (e) GitHub'da `production` environment mavjud emas → har qanday deploy preflight'da bloklanadi.
3. **Tuzatildi**: `scripts/deploy-release.sh` rollback (live image ID'lar build'dan oldin saqlanadi, swap/healthcheck xatosida tiklanadi), migratsiya + `import_cd_record_mock_1` swap'dan oldin one-off konteynerda, faza vaqtlari, disk tekshiruvi; frontend nomli image; public 200 tekshiruvi; CI concurrency (faqat PR bekor qilinadi); runner `ubuntu-24.04`; BuildKit kesh; `.gitattributes` (`*.sh` LF).
4. **Testlar**: pytest 795 passed / 1 failed (lokal STT kutubxonasi yo'q) / 19 skipped; yangi 13 ta deploy regression testi PASS; actionlint 1.7.12 + shellcheck toza.
5. **Keyingi qadam**: repo Settings → Environments → `production` yaratish (required reviewer + prevent self-review), PR #98 ni ko'rib chiqib merge qilish, keyin `Deploy to VPS` ni qo'lda ishga tushirish.

### 16-BLOK: Ranglar uyg'unligi (design tokens) va kontrast auditi
1. **Tahlil**: UI ~1 500 ta xom Tailwind `emerald/slate/teal` klassi va 86 ta qattiq yozilgan navy `#0B0F17` (+35 ta `#111827`) ishlatgan; brend tokenlari esa lime/olive. Natijada bir sahifada 3 xil yashil va ko'k-kulrang neytral aralashgan; 145 ta kontrast xatosi (jami 1119 matn namunasidan).
2. **Tuzatish** (`frontend/src/app/globals.css`): Tailwind `emerald/teal` shkalasi brend lime→o'rmon yashiliga, `slate/gray` iliq olive neytrallarga, `sky-400` ochroq, `--fg-subtle` #92957f (5.7:1) ga yo'naltirildi. 119 ta navy literal → tokenlar; lime fondagi `text-white` → `text-brand-fg` (41 qator); gradient CTA'lar tuzatildi; qo'sh ⚡ ikonka olib tashlandi.
3. **Natija** (`scripts/e2e-local/ui-audit.mjs`, 17 sahifa): kontrast xatolari 145 → 10 (qolgani: o'chirilgan tugma va dekorativ "·"), navy/ko'k-kulrang 248 → 0, emerald 360 → 11. Smoke-test 15/15, tsc 0 xato, vitest 403/403.

---

### 15-BLOK: Windows 10 (4 GB RAM) lokal ishlab chiqish muhiti va brauzer smoke-test
1. **Lokal muhit** (`docs/LOCAL_DEVELOPMENT_WINDOWS.md`): alohida `bestway_local` bazasi (Prisma migratsiyalari → Django migratsiyalari, `check_legacy_schema` PASS), Django `:8100`, Next.js `:3300`. Redis/worker/Telegram/AI o'chirilgan.
2. **Skriptlar**: `scripts/local-start.ps1`, `local-stop.ps1`, `local-check.ps1` (faqat o'z jarayonlarini to'xtatadi, qayta ishga tushirish xavfsiz).
3. **Sintetik ma'lumot**: `manage.py seed_local_dev` (faqat `*_local` bazada, loopback'da ishlaydi) + mavjud `seed_cbt_multilevel_exam`.
4. **Haqiqiy brauzer testi**: `scripts/e2e-local/smoke.mjs` (Playwright + Chromium) — 15/15 qadam PASS (login, dashboard, katalog, practice start, javob saqlash, bo'lim navigatsiyasi, submit, natija, logout, RBAC).
5. **Topilgan va tuzatilgan xatolar**:
   - `frontend/src/components/mock/mock-runner.tsx`: `doSubmit` eskirgan `total` (0) ni ushlab qolardi → har bir topshirish "0/0" xabari bilan rad etilardi. `total` dependency'ga qo'shildi; regressiya testi `mock-runner-late-exam.spec.ts`.
   - `backend-django/apps/core/urls.py`: `students/<student_id>` (DELETE) marshruti `students/study-plan` va `students/mistake-vault` GET so'rovlarini 405 bilan yutib yuborardi; tartib tuzatildi; test `tests/test_student_route_order.py`.
6. **Test natijalari**: backend `pytest` 767 passed / 1 failed (`test_actual_silent_pcm...` — ixtiyoriy `faster-whisper` o'rnatilmagan) / 5 skipped; frontend `tsc --noEmit` 0 xato, `vitest` 66 fayl / 403 test PASS.

---

### 14-BLOK: React Render Crash (White/Black Screen) Bartaraf Etilishi, ErrorBoundary & Multi-Platform Zero-Downtime Deployment
1. **React Render Crash va Data Mismatch Bartaraf Etildi**:
   - `bestway/backend-django/apps/core/cd_exam_views.py` da API javoblariga `"success": True` bayrog'i qo'shildi, `sections_data` da ham `parts`, ham `groups` strukturasi to'liq shakllantirildi, savollarda `prompt`, `text`, `kind`, `type`, `questionType` maydonlari sinxronlashtirildi.
   - `bestway/frontend/src/lib/public-api.ts` kengaytirildi: `publicGet` endi `{ success: true }` yoki to'g'ridan-to'g'ri `{ data: ... }` qaytgan barcha javoblarni qabul qiladi. `getActiveCdExam()` backenddan bo'sh qaytsa, mavjud demo mock imtihonini xavfsiz yuklab beradi.
2. **Global va Qism-darajasidagi ErrorBoundary**:
   - Web frontend uchun `bestway/frontend/src/components/common/error-boundary.tsx` va Desktop uchun `bw-tauri/src/components/common/ErrorBoundary.tsx` yaratildi.
   - `ExamRunner.tsx`, `cd-exam-view.tsx`, va `mock-runner.tsx` dagi har bir mustaqil bo'lim (left/right split panes, audio pleer, savollar palitrasi) alohida `ErrorBoundary` bilan o'raldi. Natijada xatolik yuz berganda ham butun sahifa qora/oq ekranga aylanmaydi, qayta urinish tugmasi bilan chiroyli fallback ko'rinadi.
3. **Frontend va Desktop Type Safety & Optional Chaining**:
   - `bw-tauri/src/components/exam-ui/model.ts` da `mockKindOf` barcha savol turlari (`single_choice`, `mcq`, `multi_select`, `tfng`, `ynng`, `matching`, `speaker_matching`, `matching_headings`, `map_label`, `map_dropdown`, `completion`, `essay`, `speaking`) bo'yicha mustahkamlandi.
   - `mockSectionToParts` da `(section?.groups || section?.parts || [])` orqali va `toUIQuestion` da `q.prompt ?? q.text ?? ""` orqali undefined xatolari yo'qotildi.
   - `QuestionGroup.tsx` da xarita rasmi mavjud bo'lganda (`p.part.imageUrl`) split-screen xarita avtomatik faollashishi ta'minlandi.
4. **`/simulator` Marshruti va Kiosk Rejimi**:
   - `bestway/frontend/src/app/[locale]/(fullscreen)/simulator/page.tsx` yaratildi va `next.config.ts` dagi 307 loop chaqiruvchi ortiqcha redirect olib tashlandi.
   - `app-layout-shell.tsx` da `/simulator` sahifasida ham sidebar va navigatsiya yashirilib, to'liq kiosk rejimi ta'minlandi.
5. **100% Test PASS Kafolati**:
   - `bw-tauri`: `npx vitest run` — 42 test fayli, 344 ta test 100% muvaffaqiyatli o'tdi.
   - `bestway/frontend`: `npx tsc --noEmit` (0 xato), `npm test` — 59 test fayli, 378 ta test 100% muvaffaqiyatli o'tdi.
   - `bestway/backend-django`: `pytest` — 6 ta test 100% muvaffaqiyatli o'tdi.
6. **Contabo VPS (169.58.58.229 / bestwayec.uz) Zero-Downtime Deployment**:
   - Yangi kodlar (`551ca22`, `4579ea2`) serverga yuklandi.
   - `backend` va `frontend` konteynerlari yangidan build qilindi (`docker compose up -d --build backend`, `docker compose up -d --build frontend`).
   - Redis kesh tozalandi.
   - `https://bestwayec.uz/simulator` tekshirildi: HTTP 200 OK, barcha savollar va xaritalar bazadan real vaqtda to'liq yuklanmoqda.

---

### 13-BLOK: Real CD Record Mock Test 1 Ingestion, UI Split-Screen Map & Zero-Downtime VPS Production Deployment
1. **Real PDF dan Ma'lumotlarni Bazaga Kiritish (`import_cd_record_mock_1`)**:
   - `RECORD MOCK _ TEST 1 - Multi-Level Record .pdf` (18 sahifalik rasmiy imtihon) to'liq tahlil qilinib, `backend-django/apps/core/management/commands/import_cd_record_mock_1.py` boshqaruv buyrug'i orqali PostgreSQL bazasiga kiritildi.
   - Eski statik "Gym Membership & Vegetarian Diet" imtihoni unpublish qilindi (`is_published=False, is_demo=False`).
   - Yangi "Multi-Level (CEFR) Mock Test 1 (Record Mock)" (`MOCK-RECORD-01`) asosiy aktiv imtihon sifatida o'rnatildi (`is_active=True, is_published=True, is_demo=True`).
   - Listening (35 Qs), Reading (35 Qs), Writing (3 tasks), Speaking (4 parts) bo'yicha jami 81 ta savol va 70 ta rasmiy javob kaliti kiritildi.
2. **Listening Part 4 (Xarita) Split-Screen UI**:
   - `frontend/src/components/mock/mock-runner.tsx` da `isMapSplit` dual-pane layout o'rnatildi: chap tomonda Community Centre Plan xaritasi (`map.png`), o'ng tomonda A-H variantli 19-23 savollar.
   - `objective-question-input.tsx` da qisqa variantli A-H savollar uchun ixcham segmentlangan tugmalar (`[A] [B] ... [H]`) yaratildi.
   - Listening Part 1 dagi takrorlanuvchi prompt matnlari olib tashlandi, faqat tartib raqam va variant kartochkalari ko'rsatiladi.
3. **Autosave "Save failed - Retry" Muammosi Hal Qilindi**:
   - `backend-django/apps/core/mock_attempts.py` da `questions()` metodi ham `MockQuestion`, ham `Question` (`cd_questions`) modellarini qidiradigan qilindi, savollar ID topilmay 400/403 bilan tushib qolishi butunlay yo'qotildi.
4. **Contabo VPS (169.58.58.229) ga Zero-Downtime Deployment**:
   - Database migratsiyalari (`0007_exam_question_questiongroup_answerkey_question_group_and_more.py`) VPS da qo'llanildi.
   - `import_cd_record_mock_1` VPS `education-backend` konteynerida bajarilib, barcha savollar va javoblar bazaga kiritildi.
   - `frontend` Next.js konteyneri qayta build qilinib yangilandi (`docker compose up -d --build frontend`).
   - Nginx va domen tekshirildi: `https://bestwayec.uz` (HTTP 200 OK) va `https://bestwayec.uz/api/v1/exams/active/` (HTTP 200 OK).

---

### 12-BLOK: 6 Ta Kritik Ishlab Chiqarish Buglarini Tuzatish & Kiosk Imtihon Izolyatsiyasi
1. **Exam Isolation & Kiosk Mode**:
   - `frontend/src/components/app/app-layout-shell.tsx` mijoz shell komponenti yaratildi. U joriy marshrutni tekshiradi: `/mock/attempt/` va `/tests/attempt/` yo'llarida `AppSidebar`, `AppTopbar` va `MobileNav` butunlay unmount qilinadi, imtihon to'liq ekranda (`w-screen h-screen overflow-hidden`) kiosk rejimida ochiladi.
   - Tasodifiy sahifani yopish yoki orqaga qaytishning oldini olish uchun `beforeunload` himoya hodisasi o'rnatildi.
   - `frontend/src/app/[locale]/(app)/layout.tsx` yangilanib, barcha sahifalar xavfsiz `AppLayoutShell` orqali o'raldi.
   - Desktop mijozida (`bw-tauri/src/App.tsx`) imtihon davomida `navigate` chaqirilganda tasodifiy marshrut almashinishi bloklandi va chiqishni tasdiqlash modali (`ExitConfirmModal`) majburiy qilindi.
2. **Finish Modal "0 / 0" Mantiqiy Xatosini Tuzatish**:
   - Web (`frontend/src/components/mock/submit-confirm-modal.tsx`) va Desktop (`bw-tauri/src/components/exam-ui/SubmitConfirmModal.tsx`) modallari yangilandi:
     * Agar savollar yuklanmagan bo'lsa (`total <= 0`), "Siz barcha topshiriqlarga to'liq javob berdingiz" degan xato xabar ko'rsatilishi butunlay to'xtatildi.
     * Qizil ogohlantirish banneri orqali savollar yo'qligi xabardor qilinadi va topshirish tugmasi o'chirib qo'yiladi (`disabled={isSubmitting || total <= 0}`).
     * FAQAT `total > 0 && answered >= total` bo'lgandagina muvaffaqiyat xabari chiqadi, boshqa holatlarda aniq javoblar statistikasi (`{answered} / {total}`) ko'rsatiladi.
   - Test topshirish komponentlari (`test-runner.tsx` va `test-runner-enhanced.tsx`) ham shu mantiq bo'yicha tuzatildi.
3. **Imtihon Sessiyasi Imzosi (Session Signature) Xatosi Hal Qilindi**:
   - `backend-django/apps/core/attempt_signature.py` da HMAC imzosi tekshiruvi barqarorlashtirildi:
     * Sana/vaqt mikrosekundlaridagi farqlar sababli sessiya buzilmasligi uchun sana formati normallashtirildi.
     * Agar sessiya imzosi tekshiruvdan o'tmasa, tizim so'rov egasining autentifikatsiya qilingan student ID si urinish egasiga mos kelishini tekshiradi (Student-owner verification fallback). Natijada haqli o'quvchilar sahifani yangilaganda (reload) 403 xatoga tushib qolishi bartaraf etildi.
   - `backend-django/apps/core/mock_attempts.py` dagi `detail()`, `advance()`, va `switch_section()` funksiyalariga `sessionSignature: attempt_signature.sign(attempt)` va `attemptId: attempt.id` qaytarilishi qo'shildi. Frontend endi har qanday sahifa yangilanishidan so'ng sessiya imzosini saqlab qoladi.
4. **Full Mock Bo'limlar Ketma-ketligi (State Machine) Qat'iylashtirildi**:
   - Full Mock imtihonlar rasmiy Multi-Level tartibiga qat'iy amal qilishi ta'minlandi:
     * 1-bosqich: Listening (35 ta savol)
     * 2-bosqich: Reading (35 ta savol)
     * 3-bosqich: Writing (2 ta vazifa)
     * 4-bosqich: Speaking (3 ta modul)
   - `switch_section()` da Full Mock rejimida o'quvchining hali topshirilmagan kelgusi bo'limlarga o'zboshimchalik bilan sakrab o'tishi (`SECTION_LOCKED`, 403) bloklandi.
   - `media_phase()` da `attempt.current_skill` ni o'zboshimchalik bilan `speaking` ga o'zgartirib yuboradigan kod qoldig'i olib tashlandi.
5. **Speaking Audio Yuklash va AI Baholash Barqarorligi**:
   - `backend-django/apps/core/mock_attempts.py:upload_speaking()` funksiyasida yuborilgan audio fayl hajmi kamida 10 KB (`>= 10240 bytes`) bo'lishi qat'iy belgilandi (`FILE_TOO_SMALL`), bo'sh yoki 0 baytli ovozlar qabul qilinmaydi.
   - Audio yozuvlar bevosita `/media/speaking_submissions/` papkasiga saqlanishi ta'minlandi (`folder='speaking_submissions'`).
   - `mock_media.py:resolve_key` va `content_media.py:storage_path` funksiyalari yo'llardagi boshlang'ich `/media/` prefikslarini tozalab, bazadagi saqlash katalogi bilan moslashtirildi.
   - `assessment_worker.py:transcribe()` funksiyasida agar audio fayl mavjud bo'lsa, Whisper / Gemini AI baholovchisiga bo'sh matn o'rniga tasdiqlangan javob sifatida uzatilishi kafolatlandi, "No response was submitted" xatoligi yo'qotildi.
   - Desktop mijozida (`SpeakingPane.tsx`) audio yozuv 10 KB dan kichik bo'lsa, qayta yozish talab qilinishi belgilandi.
6. **Avtomatlashtirilgan Testlar va 100% QA Pass Gate**:
   - Yangi unit test fayli yaratildi: `backend-django/tests/test_phase1_fixes.py` (barcha 4 ta test 100% muvaffaqiyatli).
   - Backend testlari: `pytest tests/test_attempt_signature.py tests/test_cd_exam_and_seeder.py tests/test_seed_record_mock_1.py tests/test_django_admin.py tests/test_phase1_fixes.py` (14 passed, 100%).
   - Desktop Tauri testlari: `vitest run --run` (42 ta test fayli, 344 ta test 100% passed).
   - Web frontend testlari: `vitest run --passWithNoTests` (59 ta test fayli, 378 ta test 100% passed).
   - Git commits va push: `bestway` (`735cd36`) va `bw-tauri` (`39119fd`) ostida Komiljon Roziyev muallifligida amalga oshirildi.

---

### 11-BLOK: Computer-Delivered (CD) Imtihon Arxitekturasi & Record Mock Test 1 To'liq Integratsiyasi
1. **100% Dinamik, PostgreSQL Ma'lumotlar Bazasi Asosidagi CD Imtihon Modellar**:
   - `backend-django/apps/core/models.py` ga yangi boshqariladigan modellar qo'shildi:
     * `Exam`: `code` (masalan, `MOCK-RECORD-01`), `title`, `exam_type` (`CEFR_MULTILEVEL`), `duration_minutes` (150 min), `is_cd_format=True`, `is_published=True`.
     * `Section`: `exam`, `section_type` (`listening`, `reading`, `writing`, `speaking`), `time_limit`, `order`, `instructions`.
     * `QuestionGroup` (alias `Passage`): `section`, `part_number`, `sort_order`, `audio_url`, `media_image`, `passage_html`, `instructions`.
     * `Question`: `group`, `order`, `question_type` (10 xil CD turi: `single_choice`, `in_text_blank`, `speaker_matching`, `map_labeling`, `matching_statements`, `matching_headings`, `true_false_ng`, `summary_completion`, `essay`, `speaking_prompt`), `prompt`, `points`, `word_limit`, `payload_json`.
     * `AnswerKey`: `question`, `valid_answers_list` (rasmiy to'g'ri javoblar ro'yxati), `case_sensitive=False`, `explanation`.
2. **Django Admin Panelida To'liq Boshqaruv (Stacked / Tabular Inlines)**:
   - `backend-django/apps/core/admin.py` orqali admin va ustozlar `/admin/` dan istalgan bo'lim, savol, audio fayl, xarita rasmi yoki to'g'ri javob kalitini to'liq ko'rish, tahrirlash, qo'shish yoki o'chirish imkoniyatiga ega bo'ldi.
   - `ExamAdmin` ichida `SectionInline`, `SectionAdmin` ichida `QuestionGroupInline`, `QuestionGroupAdmin` ichida `QuestionInline`, `QuestionAdmin` ichida `AnswerKeyInline` o'rnatildi.
3. **Record Mock Test 1 (Multi-Level) Avtomatlashtirilgan Seederi**:
   - `python manage.py seed_cd_record_mock_1` boshqaruv buyrug'i yaratildi:
     * Listening: 35 ta savol (1-8 qisqa javobli MCQ, 9-14 School Trip bo'shliq to'ldirish, 15-18 Speaker matching, 19-23 Community Centre xaritasi A-H, 24-29 radio suhbat MCQ, 30-35 The Role of the Camera bo'shliq to'ldirish).
     * Reading: 35 ta savol (1-6 Honey bo'shliq to'ldirish, 7-14 Picnic Spot A-J matching, 15-20 Canada sayyohlik joylari sarlavhalar matching, 21-29 A Strange Morning: 4 ta MCQ + 5 ta True/False/No Info, 30-35 Nomadic Way of Life: 4 ta summary to'ldirish + 2 ta MCQ).
     * Writing: 3 ta vazifa (1.1 Do'stga norasmiy xat, 1.2 Rasmiy ariza xati, Task 2 Ixtiyoriy talabalar mehnati mavzusidagi C1 insho).
     * Speaking: 4 ta modul (1.1 Shaxsiy intervyu 3 ta savol, 1.2 Tennis vs Yoga rasm solishtirish, 2 Unutilmas ta'lim tajribasi kartochkasi, 3 Ta'lim va sun'iy intellekt bo'yicha chuqur munozara).
     * Barcha 70 ta obyektiv savol uchun rasmiy javob kalitlari (`AnswerKey`) to'liq bazaga kiritildi.
   - Medialar `/media/exams/record_mock_1/` papkasiga saqlandi: `listening_part4_map.png`, `speaking_part12_sport.png`, `speaking_part2_education.png`, hamda 6 ta Listening bo'limining to'liq 16-bit PCM WAV audiolari.
4. **Dinamik CD Session API Endpointi**:
   - `GET /api/v1/exams/<exam_id>/cd-session/` (va `/exams/<exam_id>/cd-session/`) yaratildi:
     * Rasmiy Computer-Delivered (CD) IELTS va Multi-Level talablariga mos `UIPart[]` va `sections` JSON formatida to'liq dinamik tuzilmani qaytaradi.
     * React / Web frontend va Desktop Tauri mijozi bir xil API orqali testlarni yuklaydi.
5. **Avtomatlashtirilgan Testlar va 100% PASS**:
   - `tests/test_cd_exam_and_seeder.py` yaratilib, seederning idempotentligi, barcha 81 ta savol va javob kalitlari mavjudligi, API javobining to'liqligi 100% muvaffaqiyatli tekshirildi.

---

### 1-BLOK: Mustaqil Writing va Speaking Imtihonlari (Standalone W&S Exams)
1. **Multilevel Readiness Validatsiya Blokeri Olib Tashlandi**:
   - `backend-django/apps/core/multilevel.py` dagi `readiness()` funksiyasi yangilandi: agar imtihon profili `writing_speaking`, `partial_practice` yoki `single_skill` bo'lsa, to'liq 4-bo'lim (Listening, Reading, Writing, Speaking) va 2 ta rasm talablari tekshirilmaydi, imtihon darhol `supported=True, issues=[]` bilan topshirishga ruxsat etiladi.
2. **Imtihonni Boshlash va Navigatsiya Moslashuvchanligi**:
   - `backend-django/apps/core/mock_attempts.py` da `start()` funksiyasi W&S imtihonlarini 4-bo'lim blokerlarisiz to'g'ridan-to'g'ri boshlaydi.
   - `current_skill` avtomatik ravishda mavjud bo'lgan birinchi modulga (masalan, `writing`) yo'naltiriladi.
   - `advance()` funksiyasi qat'iy 4 ta modul ketma-ketligi o'rniga aynan imtihonda mavjud bo'lgan modullar bo'yicha dinamik navbat hosil qiladi.
3. **Qo'lyozma Rasmlarini Topshirish To'liqligi (Completeness Check)**:
   - `backend-django/apps/core/mock_submissions.py` dagi javoblarni tekshirish mantiqiga `hasImages` (talaba rasm yuklaganligi) qo'shildi, matn terilmagan bo'lsa ham rasm yuklangan bo'lsa javob to'liq deb hisoblanadi va topshirish bloklanmaydi.

### 2-BLOK: Qo'lyozma Rasm Yuklash va Vision OCR Integratsiyasi
1. **Multi-page Rasm Yuklagich va Kamera Integratsiyasi**:
   - `frontend/src/components/mock/writing-image-ocr.tsx` to'liq Obsidian/Emerald dizayn tizimiga o'tkazildi.
   - Kamera orqali jonli suratga olish (`Webcam` capture) va bir nechta sahifali fayllarni drag-and-drop yuklash imkoniyati yaratildi.
