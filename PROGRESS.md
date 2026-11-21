# BestWay Platform — Progress & Status Report

## Maqsad
BestWay / GRAND EDUCATION platformasining asosiy yo'nalishlari — Faqat Writing va Speaking modullaridan iborat mustaqil imtihonlarni blokerlarsiz o'tkazish (Standalone Writing & Speaking Exam), qog'ozdagi qo'lyozma insholarni rasmga olib yuklash (Multi-page Handwriting Image Upload + Vision OCR & AI Grader), ustoz tomonidan yakuniy bahoni tasdiqlash va qayta belgilash (Teacher Manual Override Engine), imtihon va guruh natijalarini rasmiy tahliliy formatlarda eksport qilish (Excel .xlsx & PDF ReportLab), imtihon va baholash interfeyslarini zamonaviy Dark Obsidian (`#0B0F17`) hamda Zumrad (`emerald-500/600`) uslubiga to'liq o'tkazish, 100% testlardan o'tkazish va Contabo VPS ga uzilishsiz (zero-downtime) deploy qilish.

---

## Bajarildi

### 50-BLOK: Yakuniy integratsiya — PR #210 + PR #209 bitta PostgreSQL sxemasida (2026-11-21) — PR #209, branch `feat/ielts-academic-full-mock-27`
- **Muammo**: ikkala PR ham `core.0017` ustiga `core.0018` qo'shgan va `models.py`, `urls.py`, `ci.yml`, `PROGRESS.md` da to'qnashardi; qaysi biri ikkinchi merge qilinsa, Django `Conflicting migrations detected` bilan migratsiyani rad etardi (deploy to'xtaydi).
- **Yechim**: PR #210 bu branchga merge qilindi (force-push yo'q), `core.0026_merge_mock27_and_telegram_bot2` (operatsiyasiz birlashtiruvchi tugun), `tests/test_migration_graph.py` (bitta leaf).
- **PostgreSQL**: main→#210→birlashgan, main→#209→birlashgan va toza o'rnatish — sxemalar bir xil; 0017 ga rollback o'quvchi ma'lumotlarini saqlaydi; o'rtada yiqilgan migratsiya qayta ishga tushganda tugaydi; idempotent; `check_legacy_schema` o'tdi; `verify_next_migration_upgrade` o'tdi.
- **Birlashgan testlar**: pytest 1573 o'tdi; 17 ta PG skript bitta bazada (Mock 27 81/81 + barcha Telegram skriptlari) o'tdi; HTTP 67/67, worker gate'lari o'tdi.
- **Merge tartibi**: 1) PR #210, 2) PR #209. Egasi uchun qo'lda sinov: `docs/BESTWAY_FINAL_OWNER_ACCEPTANCE.md`. Mock 27 DRAFT holatida qoladi.

### 49-BLOK: Telegram bot 2.0 — mustaqil yakuniy audit va tuzatishlar (2026-11-21) — PR #210, branch `feat/bestway-telegram-exam-engine-2`
- **Xavfsizlik**: guruh chatini o'quvchi akkauntiga bog'lash taqiqlandi (`/start` token va kontakt faqat shaxsiy chatda); bir martalik token parallel so'rovlarda faqat bitta chatni bog'laydi; guruhda `/tests` o'quvchi testlarini ko'rsatmaydi.
- **Test kalitlari**: `maxAttempts > 1` bo'lsa, oxirgi urinish yoki muddat tugaguncha o'quvchiga to'g'ri javob va izoh ko'rsatilmaydi (ustoz ko'radi).
- **Outbox**: har bir xabar yuborishdan oldin lease qayta tekshiriladi (ikki worker bir xabarni ikki marta yubormaydi); `telegram-outbox` alohida opt-in profilida (`--profile workers` uni ishga tushirmaydi).
- **CI**: bildirishnoma/E2E PG skriptlari soatga bog'liq edi (Toshkent 22:00–07:00 tinch soatlari) — tuzatildi; ustoz so'rovlari SQL darajasida filtrlanadi.
- Tekshiruv: pytest 1543 o'tdi; PG: engine 23, class quiz 61, Telegram quiz 33, vocab 65, result cards 47, notifications 88, E2E 41. Tafsilotlar: `docs/TELEGRAM_BOT_2_SECURITY_AUDIT.md` (A1–A7).
- **Merge tartibi**: avval PR #210, keyin PR #209 (unda `core.0026` birlashtiruvchi migratsiya bor).

### 41-BLOK: Mock 27 — yakuniy to'g'rilik va egasiga topshirish (2026-11-21) — PR #209, branch `feat/ielts-academic-full-mock-27`
- **Xatolar**: `save_quick_content` `locked_exam`ni tranzaksiyadan tashqarida chaqirib HTTP 500 berardi — tuzatildi (qulf faqat `_locked_mutation` ichida), nomavjud imtihon 404, egasi bo'lmagan o'qituvchi 403. Gated imtihonda quick-content endi **to'liq readiness** talab qiladi (MOCK_NOT_READY 400). Eslatma: `is_published=True` tayinlanishi avvaldan saqlanmas edi (`bump` faqat versiyani saqlaydi) — haqiqiy nashr bypass'i yo'q edi.
- **Migratsiya tartibi**: `core.0018` asosiy release (`deploy-release.sh`) da `manage.py migrate` bilan qo'llanadi; muqobil `deploy-django.yml` Django migrate'ni chaqirmaydi. Gate kodi jadval yo'q bo'lsa jim holatda (oddiy imtihonlar ishlaydi), import esa rad etadi. PG skriptida sinaldi.
- **Speaking Part 2 tayyorgarligi**: blueprint (60 s + 120 s) e'lon qilingan, IELTS runner server fazasiz yozadi; faqat Multilevel majburlaydi. Barcha IELTS yozuv oqimini o'zgartirmaslik uchun majburlash qo'shilmadi; test bilan qayd etildi.
- **Ruxsatlar**: talaba/boshqa talaba/anonim uchun kalitlar, audio script, saqlash kalitlari sizmasligi; audio oqimi, yuklash, tasdiqlash, huquq endpointlari — hammasi PG skriptida (81 tekshiruv).
- **Reading kalitlari** (40/40) matn bo'yicha mazmunan o'qib tekshirildi (faqat "matnda bor" emas). Listening kalitlari kalit sahifasi va ichki izchillik bilan; eshitib tekshirish administrator tasdig'i orqali.
- **Haqiqiy kontent bilan jarayon** (tashlab yuborilgan imtihon, bir martalik ohang fixturalari, egasining imtihoniga tegilmadi): avtosave → qayta yuklash → resume, server-avtoritar advance, aniq ball (L35→8.0, R34→7.5), variantlar/registr, bir martalik matching dublikat qoidasi, overall band yo'q, Writing/Speaking pending, takroriy submit idempotent — 19/19.
- **Import**: `check_mock27 --stage preflight|post` (faqat o'qiydi), ekstraksiya deterministik (baytma-bayt bir xil), `import_mock27 --content original|supplied`. Huquq hujjati yo'q → **to'liq original Listening/Reading** (`original_listening.py`, `original_reading.py`, 4 ta ovozli skript, 40+40 savol; skriptlar ixcham) tayyorlandi.
- **UI**: 4 ta slotni yuklash+tasdiqlash, "faqat huquq blokeri qoladi", ko'rinish chegaralari — Playwright 37/37. Egasi uchun qadamlar: `docs/MOCK27_IMPORT_AND_PUBLICATION.md` §4.


### 40-BLOK: IELTS Academic Full Mock 27 — audio darvozasi, qoralama import, original Writing/Speaking (2026-11-21) — branch `feat/ielts-academic-full-mock-27`
- **Manba fayllar**: faqat 2 ta PDF yuklangan (Listening, Reading); `Full_test_27.html` ilova qilinmagan. Ikkala PDF'da uchinchi tomon suv belgisi bor → tarqatish huquqi **tasdiqlanmagan**; matnlar repoga kiritilmadi (ommaviy repo). Maxsus ekstraktor (`apps/core/mock27/extract_source.py`) shaxsiy katalogga yozadi.
- **Tekshiruv**: Listening 40/40 (4 qism, 1–40), Reading 40/40 (3 matn, 1–40), barcha kalitlar hal qilinadi, Reading to'ldirish javoblari matnda topildi. Mavjud `validate_package` o'tdi.
- **Audio**: Listening audiosi egasi tomonidan yuklanadi; sintetik audio yaratilmadi. `MockExamGate` + `MockListeningAudio` (migratsiya 0018): MISSING/UPLOADED/VERIFIED, MP3/M4A tekshiruvi (magic bytes, haqiqiy dekod, kodek, davomiylik), xavfsiz almashtirish, tasdiqlash fayl hash'i va javob kalitlariga bog'langan.
- **Nashr darvozasi**: `content_rights` va `listening_audio_verified` readiness'ga qo'shildi; publish, demo va quick-content yo'llari o'tkazmaydi; clone darvozani saqlaydi. Imtihon DRAFT.
- **Original kontent**: Writing Task 1 (Riverside Park 2005/2025, ikkita SVG + PNG, izchillik testlari) va Task 2; Speaking Part 1–3.
- **Import**: `import_mock27` (tranzaksion, idempotent, mavjud `commit_import`). Mavjud xato tuzatildi: `resolve_bindings` naive/aware datetime.
- **Testlar**: pytest 1496 o'tdi; 18 yangi unit test; `verify_mock27_postgres.py` 56/56 (haqiqiy PostgreSQL, CI'ga ulangan); mavjud PG skriptlar (readiness 65, item_bank 11, partial_practice 49, exam_window 24, listening_schedule 11, grading_consistency 79) o'tdi; tsc toza; vitest 873/873; Playwright `mock27-audio` 27/27 va `ielts-full` 10/10.
- **Ochiq** (41-blokda yopilganlari belgilangan): audio egasi yuklashi; huquq tasdig'i; ~~`save_quick_content` 500 xatosi~~ (41-blokda tuzatildi); IELTS Speaking Part 2 tayyorgarlik vaqtini server majburlamaydi (41-blokda ko'rib chiqildi); Mock 27 bo'yicha talaba E2E (audio yo'q) — 41-blokda tashlab yuborilgan imtihonda bajarildi. Batafsil: `docs/MOCK27_IMPORT_AND_PUBLICATION.md`.
### 48-BLOK: Telegram bot 2.0 — M7 to'liq QA, E2E sayohatlar va reliz hujjatlari (2026-11-21) — branch `feat/bestway-telegram-exam-engine-2`
- `verify_e2e_journeys_postgres.py` (41): ustoz — haqiqiy HTTP login → 40 savolli test → tayinlash → muddat → monitoring/CSV; o'quvchi — `/start` token bilan bog'lash → test → 40 savol → natija + karta → xatolar → lug'at → `/takror` 13/15; xavfsizlik — anonim, A/B o'quvchi, A/B ustoz, ota-ona, soxta callback, takroriy yakunlash, 6 ta parallel yakunlash, muddati o'tgan urinish, restartdan keyin davom etish.
- Barcha 7 PG skript CI'da; pytest 1540 o'tdi; frontend `tsc` 0 xato, ESLint 0 xato (413 eski ogohlantirish), Vitest 865 o'tdi, `next build` muvaffaqiyatli.
- Hujjatlar: `docs/TELEGRAM_BOT_2_RELEASE.md` (migratsiyalar, qaytarish, sozlamalar, outbox'ni yoqish, ma'lum bo'shliqlar), xavfsizlik auditiga holat jadvali.
- Ochiq: Mini App yo'q (PARTIAL), ustoz uchun sayt UI yo'q (API bor), haqiqiy Telegram staging tekshiruvi yo'q (UNVERIFIED), migratsiya 0018 raqami PR #209 bilan to'qnashadi (`makemigrations --merge`).

### 47-BLOK: Telegram bot 2.0 — M6 ustoz vositalari, sozlamalar va bardoshli bildirishnomalar (2026-11-21) — branch `feat/bestway-telegram-exam-engine-2`
- **Bardoshli outbox** (`telegram_outbox.py`, `TelegramOutbox`, core 0025): bildirishnoma PostgreSQL'ga yoziladi (unique `dedupe_key`), worker `manage.py run_telegram_outbox` yetkazadi. Lease (90 s) — worker qulasa qator qayta olinadi; `FOR UPDATE SKIP LOCKED` — bir nechta worker takrorlamaydi; xato bo'lsa 1m/5m/15m/1h/6h backoff, 6 urinishdan keyin `dead`, doimiy xato (bot bloklangan) `failed`, 429 — o'tish to'xtaydi; token yo'q — navbat saqlanadi; tezlik: 25 xabar/o'tish va chatga 1 xabar/o'tish; opt-out va tinch soatlar (default 22:00–07:00 Asia/Tashkent) ham yuborishda, ham navbatga qo'yishda tekshiriladi. Compose: `telegram-outbox` xizmati **opt-in profil** (owner ruxsatisiz ishga tushmaydi).
- **Ishlab chiqaruvchilar** (`telegram_notify.py`): yangi test, muddat yaqin (24 s / 2 s), kunlik lug'at takrori (17:00 dan), test yopildi xulosasi (ustozga, faqat sonlar; muddati o'tgan urinishlar avtomatik topshiriladi), natija tayyor (sayt/avto-topshirish), apellyatsiya qarori, yangi apellyatsiya (ustozga), lug'at so'rovi qarori, davomat (o'quvchiga, mavjud ota-ona oqimi o'zgarmadi), ustoz fikri API. Mock-baholash (IELTS) oqimiga ulanmagan — PARTIAL.
- **Ustoz paneli** (`telegram_teacher.py`): /newtest (sarlavha → tur → 10/20/30/40 → vaqt → savollar+KEY → guruh → muddat → tayinlash), guruhlar, topshiriqlar/natijalar (topshirmaganlar ismi, CSV, shaxsiy xulosa kartasi, eslatish), ko'rib chiqish so'rovlari (apellyatsiya + lug'at), lug'at to'plamini mashqqa chaqirish, e'lon (tasdiq bilan). Har chaqiriqda guruh/topshiriq egaligi qayta tekshiriladi (boshqa ustoz uchun rad); wizard konteksti DB dialog holatida, callback faqat qisqa indeks (Telegram 64 bayt chegarasi — barcha PG skriptlarda majburiy tekshiruv).
- **Sozlamalar** (`telegram_settings.py`): til, bildirishnomalar, tinch soatlar, tur bo'yicha o'chirish; `/cancel` — har qanday dialogni to'xtatadi. Menyular: o'quvchi — Lug'at, Testlarim, Xatolarni takrorlash, Natijalarim, Davomatim, O'qituvchi fikri, Sozlamalar; ustoz — Test yaratish, Guruhlarim, Natijalar, Lug'at to'plamlari, Topshiriqlar, So'rovlar, E'lonlar.
- Guruh chatiga avtomatik e'lon/karta yuborilmaydi (Group modelida Telegram chat bog'lanishi yo'q): xulosa kartasi ustozning shaxsiy chatiga, e'lon esa o'quvchilarga shaxsiy xabar sifatida (opt-out bilan) — PARTIAL.
- Tekshiruv: `verify_notifications_teacher_postgres.py` 87 tekshiruv (haqiqiy PG: parallel 3 worker, restartdan tiklash, backoff/dead/failed, tinch soatlar, opt-out, sweep'lar, ustoz A/B izolyatsiyasi, soxta callback'lar), `tests/test_telegram_outbox.py`; barcha 6 PG skript + pytest 1540 o'tdi.

### 46-BLOK: Telegram bot 2.0 — M5 natija kartalari va javob apellyatsiyalari (2026-11-21) — branch `feat/bestway-telegram-exam-engine-2`
- **Natija kartasi** (`result_card.py`, Pillow, 1080×1350 PNG, uz/en): BESTWAY logotipi, test nomi, o'quvchi ismi (faqat o'zining shaxsiy chatida), doiraviy progress, to'g'ri/vaqt/ball, holat xabari, sana (Asia/Tashkent). Faqat **saqlangan** natijadan quriladi (yakunlanmagan natijadan `ValueError`), IELTS bandiga aylantirilmaydi. Namunalar: `docs/evidence/telegram-bot-2/`.
- **Maxfiylik**: avtomatik karta faqat egasining chatiga, natija versiyasi uchun **bir marta** (`ResultCardDelivery` unique, core 0024); "🖼 Natija kartasi" tugmasi qo'lda qayta yuboradi; boshqa o'quvchi/guruh chati uchun yuborilmaydi. Guruh xulosasi kartasi (`group_summary_data`) faqat yig'ma ko'rsatkichlar — ism va shaxsiy ball yo'q (Telegram'ga yuborish M6: ustoz tasdig'i bilan).
- **Apellyatsiya** (`class_quiz_appeals.py`, core 0023): "✍️ javobim qabul qilinsin" faqat noto'g'ri matnli javob uchun; ustoz (o'z guruhi) yoki admin qaror qiladi, boshqa ustoz uchun 404; tasdiqlansa `ClassQuizAcceptedAnswer` qo'shiladi, berilgan snapshot **o'zgarmaydi**, faqat shu savolga bir xil javob bergan topshirilgan urinishlar qayta baholanadi, `result_version` oshadi va har o'zgarish uchun append-only `ClassQuizCorrection` (kim/qachon/oldin/keyin) yoziladi; takroriy qaror hech narsani qayta qo'llamaydi; keyin topshirgan o'quvchi ham shu qoida bilan baholanadi. HTTP: `class-quiz-attempts/<id>/appeals|corrections`, `class-quiz-appeals/pending|<id>|<id>/decision`.
- Tekshiruv: `verify_result_cards_postgres.py` 47 tekshiruv, `verify_telegram_quiz` 33, `verify_vocab_bot` 65 (kartalar qo'shildi), `tests/test_result_card.py`. Dockerfile'ga `fonts-dejavu-core`, `Pillow` aniq bog'liqlik.

### 45-BLOK: Telegram bot 2.0 — M4 lug'at va oraliqli takrorlash (2026-11-21) — branch `feat/bestway-telegram-exam-engine-2`
- **Yangi**: `/lugat /mashq /takror /natija /yordam` (`telegram_vocab.py` + `vocabulary_bot.py`); rejimlar A (EN→UZ), B (UZ→EN), C (imlo), D (variantli), E (aralash); core 0021 (`VocabularyAnswerVariant`, `BotVocabRun`), 0022 (`VocabularyAnswerReport`).
- **Mavjud kod qayta ishlatildi**: amaliyot `VocabularyPracticeSession` + `submit_quiz_attempt` orqali (attempt, ball, ota-ona xabari — bir martalik); `/takror` mavjud `vocabulary_review.due/update_review` (1→3→7→14→30 kun) — ikkinchi SRS yaratilmadi; sayt va bot bir xil `due()` sonini ko'rsatadi.
- **Javob mosligi** (`vocabulary_answers.py`, fuzzy emas): katta-kichik harf, tinish belgisi, apostrof, vergul/nuqtali vergul bilan ajratilgan barcha tarjimalar, sinonimlar (UZ→EN), o'qituvchi tasdiqlagan variantlar; sayt (`score_snapshot`, `srs_submit_view`) ham shu matcherni ishlatadi.
- **Apellyatsiya**: "✍️ Javobim qabul qilinsin" → `VocabularyAnswerReport`; faqat set egasi/guruh ustozi/admin qaror qiladi (boshqa ustoz uchun 404); tasdiqlansa variant qo'shiladi, berilgan snapshot va saqlangan natija o'zgarmaydi.
- **Idempotentlik**: javob run satrida qulflanadi; takroriy tugma/update ikki marta SRS yangilamaydi; sayt javob bergan so'z qayta rejalashtirilmaydi (`reviewCount` himoyasi); tugatish ikki marta ball bermaydi.
- Tekshiruv: `verify_vocab_bot_postgres.py` 62 tekshiruv (haqiqiy PostgreSQL, 13/15 takrorlash xulosasi, restartdan keyin davom etish, muddati o'tgan run, hostile callback, B o'quvchi A runiga kira olmaydi), `tests/test_vocabulary_bot.py`; to'liq pytest 1524 o'tdi.
- Hali yo'q (M5/M6): natija kartasi PNG, o'qituvchi uchun Telegram vositalari, bildirishnoma outbox, Sozlamalar menyusi.

### 44-BLOK: Telegram bot 2.0 — M3 Telegram test oqimi (2026-11-21) — branch `feat/bestway-telegram-exam-engine-2`
- **Yangi**: `telegram_quiz.py` (Testlarim → karta → Boshlash/Ko'rsatmalar → savol → javob → yakun → natija → xatolarni ko'rish), `/testlar` va `📝 Testlarim`; `TelegramDialogState`/`TelegramPreference` (core 0020) — matnli javob holati PostgreSQL'da (restartdan keyin ham).
- **Xavfsizlik**: shaxs faqat bog'langan akkauntdan (callback'dagi id'ga ishonilmaydi); callback ≤64 bayt va qat'iy tekshiriladi; guruh chatida tugmalar rad etiladi; boshqa o'quvchi/ustoz/bog'lanmagan akkaunt rad etiladi; takroriy yetkazish `update_id` bilan, qo'sh bosish engine idempotentligi bilan.
- Tekshiruv: `verify_telegram_quiz_postgres.py` 33 tekshiruv (40 savolli to'liq o'yin, restartdan keyin davom etish, parallel Finish, muddat tugashi, HTTP webhook), 9 unit test.

### 43-BLOK: Telegram bot 2.0 — M2 sinf testlari mexanizmi (2026-11-21) — branch `feat/bestway-telegram-exam-engine-2`
- **Yangi**: `ClassQuiz*` jadvallari (core 0019), `class_quiz.py` xizmat qatlami (sayt ham, bot ham shuni chaqiradi) va `/v1/class-quizzes…` API. Grammatika/lug'at/aralash testlar IELTS band'iga aylantirilmaydi (`isIeltsBand=false`, faqat foiz).
- **Xavfsizlik/yaxlitlik**: ustoz faqat o'z testlari va o'z guruhlari; boshqa ustozning testi 404; tayinlashda o'zgarmas snapshot (keyingi tahrir eski natijani o'zgartirmaydi); server soati (deadline = min(topshiriq muddati, start+limit)); start/javob/yakun idempotent; parallel startlar bitta urinish; muddatdan keyingi javob rad etiladi va urinish avtomatik yakunlanadi; kalitlar topshirishgacha ochilmaydi; ota-ona faqat foiz xulosasi; CSV formula-injection zararsizlantirilgan.
- Tekshiruv: `verify_class_quiz_postgres.py` 57 tekshiruv (haqiqiy PostgreSQL), 12 unit test.

### 42-BLOK: Telegram bot 2.0 — M1 xavfsizlik (2026-11-21) — branch `feat/bestway-telegram-exam-engine-2`
- **P0 tuzatildi**: (1) o'rnatilgan superadmin Telegram ID (4 joyda) + avtomatik akkaunt yaratish/rolni oshirish + web-admin SSO — endi faqat bog'langan, faol `super_admin` akkaunt; (2) OCR to'qilgan insho va to'qilgan band (web'da talaba javobi sifatida saqlanardi, bot'da qat'iy 6.5) — endi fail-closed, ball yo'q; (3) `ensure_superadmin` standart paroli va har ishga tushganda parolni tiklashi; (4) `update_id` dedupe/replay yo'q edi — `TelegramUpdateReceipt` (core 0018) bilan atomik.
- Tekshiruv: pytest 1489 o'tdi, `verify_telegram_engine_postgres.py` 20 tekshiruv (haqiqiy PostgreSQL, HTTP webhook, parallel yetkazish). Audit: `docs/TELEGRAM_BOT_2_SECURITY_AUDIT.md`.
- Eslatma: `core.0018` nomi PR #209 (Mock 27) bilan to'qnashadi — ikkinchi bo'lib merge qilinadigan `makemigrations --merge` qiladi.


### 39-BLOK: R2 qayta tekshiruv + R3 premium frontend (2026-11-21) — branch `claude/beautiful-dirac-e83j8l`
- **Tiklash**: oldingi sessiyaning R2 ishi (`claude/friendly-pascal-gsohro`) allaqachon main'da (#204, #205). R3 commit'lari hech bir remote branch'da yo'q edi (push qilinmagan, konteyner yo'qolgan) — R3 main (`ef3f267`) dan qayta bajarildi. #207 va bw-tauri #39 tegilmadi.
- **R2 (joriy kodda)**: vocab-battle 20/20, drill 24/24, mobile-listening 16/16 (`BW_WEB=http://localhost:3300`; `127.0.0.1` da Next dev formani hydrate qilmaydi — muhit), multilevel-full: **3 ketma-ket yugurish, har biri 16/16** (11:13, 11:28, 11:42; Speaking 8×201, bitta tarmoq uzilishidan keyin qayta yuklash).
- **Muhit saboqi (haqiqiy)**: multilevel-full birinchi 3 yugurishda `speaking stalled at 73/81; SPEAKING_AUDIO_DURATION_INVALID` berdi — sabab mahsulot emas: lokal venv'da faqat `base`+`dev` o'rnatilgan edi, brauzer yozuvlarini (webm/opus) dekod qiluvchi **PyAV** (`faster-whisper` orqali `prod.txt` da) yo'q edi. `requirements/prod.txt` o'rnatilgach (av 19.0.2) o'tdi; `test_mock_audio_probe` endi skip emas.
- **R3.5 Tarix**: `GET /mock/attempts/mine` — ixtiyoriy keyset `cursor` (`started_at`,`id`), tartib `-started_at,-id` (teng vaqtda ham deterministik), `meta.hasMore/nextCursor`; `page/limit` eski mijozlar uchun saqlandi; yaroqsiz cursor va cursor+page → 400. Web: `useMyMockAttempts` butun tarixni (100 × ≤10 sahifa) yuklaydi; `BandTrend` barcha to'liq natijalarni hisobga oladi va qisman yuklansa aytadi. `verify_attempt_history_postgres.py` — 26 tekshiruv (PostgreSQL), cursor unit testlari, `attempt-history.spec.ts`.
- **R3.3 Sidebar**: Learning / Exams / Users / Reports / Settings, `navForRole` dan (yangi yo'l yo'q), yig'iladigan, faol bo'lim ochiq, holat saqlanadi, klaviatura, mobil "More" varag'i ham guruhlangan; admin 4, teacher 3, super_admin 5 bo'lim (brauzerda tekshirilgan).
- **R3.2 Writing**: topshiriq (rasm, ko'rsatma, matn, prompt) yonma-yon javob bilan, ruxsat etilgan o'lchamli ajratgich (strelkalar/Home/End/Enter), telefonda vertikal; ichma-ich split yo'q; autosave, so'z soni, server taymeri, OCR o'zgarmadi. 390/1024/1366/1920 skrinshotlar.
- **R3.1 Builder**: 7 bosqichli yo'l (ma'lumot, yo'nalish/bo'lim, savollar, matn/audio/fayl, javob kalitlari, preview, tekshirish va e'lon) mavjud muharrirlar ustida; holat mavjud tekshiruvlardan; navigatsiya saqlanmagan o'zgarishlar himoyasi orqali; Save Draft va Publish farqi yozilgan; planshetda tugmalar sig'adi. `builder-steps.spec.ts`.
- **R3.4 Infografika**: tokenlarga o'tkazildi; faqat backend band/standart ball; "Taxminiy"/"Tasdiqlangan" belgisi; `role="meter"`.
- **R3.6 Vocabulary**: kutubxona va SRS sahifasi tinchlantirildi (gradient/glow yo'q, "bugun takrorlash" birinchi). Baholash mantiqi o'zgarmadi.
- **R4 natijalari (lokal, sintetik, joriy kod)**: tsc toza; eslint 0 xato; vitest 865/865; `next build` o'tdi; backend pytest 1476 o'tdi/6 skip (PyAV o'rnatilgach audio-probe skip emas; `test_anomaly_endpoint_events_and_logging` alohida faylda yurgizilganda yiqiladi — mock tartibiga bog'liq, main'da ham, to'liq to'plamda o'tadi). PG skriptlar: attempt_history 26, review_evidence 22, classroom, exam_window 23/23, grading_consistency 79, mock_authoring, partial_practice, practice_mode 16, points_integrity 48/48, phase3_auth 22, listening_schedule 10/10, group_contract — hammasi o'tdi.
- **E2E**: vocab-battle 20/20, drill 24/24, mobile-listening 16/16, ielts-full 11/11, smoke 17/17, exam-tools 30/30, full-journey 13/13, exam-writing 6/6, exam-reading-split 20/20, exam-workspace 20/20, exam-a11y 12/12, exam-mode 8/8, **roles-crawl 152/152 sahifa toza (5 rol, en+uz, yorug'+qorong'i; axe serious/critical 0)**, exam-listening 16/16 ×2 (bir marta 14/16 — audio vaqti, qayta chiqmadi, main'da 16/16), responsive-audit o'tdi (360/390 da `profile` sahifasida kichik teginish maydonlari ro'yxatga olingan — ochiq).
- **Main'da ham yiqilgan edi (`ef3f267` da tekshirildi)**: `teacher-live` 10/12 — mahsulot emas: #206 dan beri "Results and analytics" tugmasi ortida ochiladigan natijalar bo'limida jonli kuzatuv bor (brauzerda en/uz da tekshirildi); skript tugmani bosadigan qilib yangilandi → **16/16**. `verify_phase3_refresh_race_postgres.py` — BW-16 ni ataylab ko'rsatuvchi skript (ochiq xato, `fix/bestway-bw16-session-coordination` branch'i bor), main'da ham, bu branch'da ham bir xil; tuzatilmadi — ochiq P1.
- **Halol eslatma**: `CefrResultInfographic`/`ExamTrackDashboard` hech bir jonli sahifada ishlatilmaydi (faqat unit spec) — komponent tokenlarga o'tkazildi va `/dev/ui` da ko'rildi (dev), lekin mahsulotga ulanmagan.
- **Ochiq**: Builder Overview "Content" ustuni 1024 px da siqiq; desktop (bw-tauri) tarixda faqat eng yangi 50 ta (o'zgarmagan, mos).

### 38-BLOK: BESTWAY NEXT — Stage 04: Unified Workspaces, Easy Classroom & Student Deep Linking (2026-11-19) — #206 & #38, branch `feat/bestway-next-00-03`
- **Student Workspace & Dashboard (Phase 04.1)**:
  - Talaba Dashboard'iga jonli dars va sinf sharhi (`StudentClassroomWidget`), topshiriqlar ro'yxati (`StudentAssignmentsWidget`), davomat ko'rsatkichi (`StudentAttendanceWidget`), va oflayn lug'at kesh holati (`StudentOfflineVocabWidget`) to'liq ulandi.
  - O'quvchi taklif kodi orqali guruhga qo'shilish modali (`POST /v1/student/join-cohort`) integratsiya qilindi.
  - Vazifalar ro'yxati (`GET /v1/student/my-assignments`) muddatlar, o'tish ballari, holat nishonlari (`pending`, `overdue`, `awaiting_review`, `passed`, `failed`) bilan dinamik ishlaydi.
- **Teacher Command Center (Phase 04.2)**:
  - Desktop va Web uchun yagona `TeacherDashboard` boshqaruv paneli yaratildi: faol sinflar, o'quvchilar soni, baholash navbatidagi ishlar va Vocabulary Studio holati real vaqtda ko'rsatiladi.
  - Sidebar navigatsiya shartnomasi (`[0] -> proctoring`, `[1] -> grading`, `[2] -> groups`, `[3] -> exams`) 100% buzilmagan holda saqlanib, dashboard va vocabulary bo'limlari kengaytirildi.
- **Classroom Workspace & Unified Student Profile (Phase 04.3 & 04.4)**:
  - `UnifiedStudentProfileModal` komponenti yaratildi: `GET /v1/groups/<id>/member-history/<student_id>` orqali o'quvchi ma'lumotlari, davomat darajasi, uy vazifalari topshirig'i, barcha imtihon natijalari (L/R/W/S/Overall Band) va tasdiqlangan o'qituvchi/AI diagnostik xulosalari ko'rsatiladi.
  - `ClassroomWorkspace.tsx` va `GroupsResults.tsx` da talaba ismlari bosilganda to'g'ridan-to'g'ri to'liq profil ochiladi.
- **Exams & Assignments Deep Linking (Phase 04.5)**:
  - Talaba topshiriqlaridan "Lug'atni o'rganish" to'g'ridan-to'g'ri lug'at trenajyoriga, "Imtihonni boshlash" esa mos test yoki mock imtihoniga yo'naltiradi (`onStartExamById`).
  - Jarayondagi imtihonlarni saqlangan holatdan davom ettirish (resume) funksiyasi kafolatlandi.
  - `bestway/frontend/src/components/dashboard/StudentAssignmentsWidget.tsx` da qattiq yozilgan `/en` prefiksi olib tashlanib, ko'p tilli (uz/ru/en) yo'naltirish to'liq to'g'rilandi.
- **Stage 04 Yakuniy Integratsiya & Handoff (Phase 04.A - 04.K)**:
  - `backend-django/apps/core/teacher_views.py`: O'qituvchilar uchun ajratilgan topshiriqlar va baholash navbati API'si (`GET /v1/teacher/submissions` va `POST /v1/teacher/submissions/<id>/grade`) yaratildi. Ruxsat faqat o'qituvchining o'z guruhlari o'quvchilari uchun beriladi (`student__group__teacher_id=actor.id`). Pagination (offset/limit) qo'llab-quvvatlanadi.
  - `backend-django/tests/test_teacher_submissions.py`: 4/4 ta avtorizatsiya va izolyatsiya testi yozildi (100% PASS, 0.007s).
  - `frontend/scripts/tokenize-colors.mjs` va `tokenize-shape.mjs`: ESM hashbang masalasi tuzatilib, barcha 74 ta dizayn tizimi testi (`src/design-system.spec.ts`) to'liq o'tdi.
  - `docs/BESTWAY_NEXT_STAGE04_FINAL_REPORT.md` tayyorlandi.
- **Sifat va Testlar**:
  - `bw-tauri`: 59 ta test fayli, 471 ta vitest testi (100% PASS); `cargo check` (100% PASS); `npm run build` (100% PASS).
  - `bestway/frontend`: 126 test fayli, 837 ta vitest testi (100% PASS); `npm run lint` (0 xato); `next build` (88/88 statik sahifalar, 100% PASS).
  - `backend-django`: `tests.test_teacher_submissions` va `tests.test_vocabulary_offline_sync` (10/10 PASS).
  - Hosted CI: barcha CI quvurlari ishga tushirildi va yashil. Push tasdiqlandi: `191b73f70b6e3678549799cc610fa74793dda0b1` (PR #206).

### 37-BLOK: BESTWAY NEXT — Stage 03 Offline Vocabulary Sync & Handoff (2026-11-19) — #206, branch `feat/bestway-next-00-03`
- **Oflayn Lug'at va Fleshkarta API**:
  - `GET /v1/student/assignments/<id>/vocabulary/snapshot`: ruxsat etilgan talabalar uchun to'liq so'zlar to'plami va versiyasini (revision) qaytaradi.
  - `POST /v1/student/assignments/<id>/vocabulary/flashcards/sync`: turg'un `opId` lar bilan idempotent paketli familiarity o'zgarishlarini qabul qiladi va `acknowledgedOpIds` bilan tasdiqlaydi.
  - `PATCH /v1/student/assignments/<id>/vocabulary/flashcards`: mavjud yagona so'zli yangilanishlar bilan to'liq orqaga mos (backward-compatible) saqlandi.
  - OpenAPI spec (`docs/contracts/groups.v1.openapi.json`) va frontend DTOlar yangilandi.
- **PostgreSQL va Regressiya Testlari**:
  - `backend-django/tests/test_vocabulary_offline_sync.py`: 6/6 ta unit test muvaffaqiyatli o'tdi (0.032s).
  - `backend-django/scripts/verify_vocabulary_homework_postgres.py`: sinxronizatsiyani tekshirish tartibi dars topshirig'i topshirilganidan keyingi nuqtaga ko'chirildi, barcha PostgreSQL tekshiruvlari 100% o'tdi.
- **Hosted CI**:
  - GitHub Actions run `44557947516`: `frontend` (2m31s, PASS), `django` (3m11s, PASS) — 100% muvaffaqiyatli yakunlandi.
- **Hujjatlar**:
  - `docs/BESTWAY_NEXT_STAGE03_OFFLINE_REPORT.md` va `docs/BESTWAY_NEXT_AGENT_HANDOFF.md` yaratildi.

### 36-BLOK: E2E barqarorligi — multilevel 3×, vocab-battle, mobile-listening, drill (2026-11-18)
- **multilevel-full ketma-ket 3 marta: 16/16, 16/16, 16/16** (#204 dan keyin; Speaking har safar 8/8×201, tarmoq uzilishidan keyin bitta qayta yuklash).
- **vocab-battle 18/20 → 20/20**: skript ICU plural xabarni (`+{points, plural, …} added`) oddiy almashtirish bilan formatlardi — eskirgan; skriptga minimal ICU plural formatlovchi qo'shildi. Mahsulot to'g'ri edi.
- **mobile-listening 15/16 → 16/16**: katalog talabaning faol yo'nalishini ko'rsatadi; Record Mock — Multi-Level, sintetik talaba esa IELTS'da edi. Skript yo'nalishni Multi-Level'ga o'tkazadi va oxirida qaytaradi. Mahsulot to'g'ri edi.
- **drill (yiqilardi) → 24/24**: **mahsulot xatosi** — drill modalidagi "Tekshirish" tugmasi qattiq yozilgan o'zbekcha edi (en sahifada ham); endi `uiText.drill.check` (en "Check answer"). Skript eskirgan katta-kichik harfli yorliqlar o'rniga katalog yorliqlarini ishlatadi.

### 35-BLOK: Speaking yuklash 400 — talaba javobi yo'qolishi (2026-11-18)
- **Sabab (dalil bilan)**: qabul qilingan Multilevel yozuvlari javob oynasidan doim **60–240 ms qisqa** dekodlanadi (lokal bazadagi 19 ta yozuv: 30 s → −60…−120 ms, 120 s → −60…−240 ms) — MediaRecorder `start()` dan keyin kechikib yozishni boshlaydi. Chegara esa simmetrik ±0.25 s edi: sal kechroq start (sekin qurilma, band CPU) → `SPEAKING_AUDIO_DURATION_INVALID` (400), va **mijoz yozuvni o'chirib yuborardi**; boshqa 400/5xx xatolarda avtomatik qayta urinish yo'q edi → timed Speaking ketma-ketligi to'xtab qolardi (E2E: "stalled at 76/81; uploads 201,201,201,400").
- **Server**: javob 1 s gacha qisqa yoki 0.5 s gacha uzun bo'lishi mumkin (`duration_bounds`), yozuv ichidagi bo'shliq 0.5 s gacha, dekod timeout 30 s; faza `minDurationMs/maxDurationMs` shu chegaralarda. Baholash mantiqi o'zgarmadi.
- **Mijoz** (`lib/speaking-upload.ts`): muvaffaqiyatsiz yuklash yozuvni **hech qachon o'chirmaydi**; tarmoq, 5xx, 408/409/423/429 va "oyna hali ochiq" — avtomatik qayta urinish (2, 4, 8, 15, 30, 30 s); davomiylik rad etilsa yangi yozuv mumkin, eskisi qurilmada saqlanadi. Yuklash idempotent: timed javob birinchi qabul qilingan yozuvni saqlaydi.
- **Testlar**: `test_speaking_response_window.py` (chegaralar), `speaking-upload.spec.ts`, recorder'da avtomatik retry. multilevel-full rad etilgan yuklashning xato kodini yozadi; Google skriptining sandbox'dagi o'z xatosi (`gis is not defined`) uchinchi tomon deb hisoblanadi.
- **multilevel-full ketma-ket 3 marta**: natija 36-BLOK'da.

### 34-BLOK: Redizayn — yakuniy roles-crawl va E2E (2026-11-17) — #202, main `3191dda`
- **roles-crawl** (axe WCAG 2.0/2.1 A+AA; student, teacher, admin, parent, super_admin; en ikki tema + uz): 187/196 toza edi; topilmalar tuzatildi — `/videos` (tokenlarga o'tkazildi; yorug' temada oq sarlavha oq fonda edi, sariq nishon 4.0:1), `/audit` (amal id'si `mock.attempt.force_submit` so'z bilan ko'rsatiladi), `/students/:id` (rose va slate-400 → tokenlar), landing xarita tugmasi (#101704 brand ustida 3.65:1), xarita yorlig'i. Qayta tekshiruv (axe, ikki tema): hammasi toza. `videos-view.tsx` dizayn guard'iga qo'shildi.
- **E2E (lokal, sintetik)**: smoke 16/16, ielts-full 10/10, exam-a11y 12/12, exam-workspace 20/20, exam-listening 16/16, exam-reading-split 20/20, exam-writing 6/6, exam-mode 8/8, practice-mode 5/5, exam-session 20/20, exam-tools 30/30, exam-window 12/12, runner-layout (telefonda kontent 74–81%), full-journey (barcha qadamlar), teacher-live 16/16, demo 15/15, responsive-audit (overflow yo'q). multilevel-full: selektor tuzatilgach **16/16** (oraliq yugurishlardan birida speaking yuklash bir marta 400 berdi — keyingisida o'tdi, beqaror).
- **Redizayndan oldin ham xuddi shunday yiqiladi** (bazaviy `3b46c08` da tekshirildi): vocab-battle 18/20 (+10 podium), mobile-listening 15/16 (record mock katalogda yo'q — lokal ma'lumot), drill (uz "Keyingi Savol" dialog tugmasi).
- **E2E skriptlar**: "Start full exam" yozuvi (`smoke`, `full-journey`, `multilevel-full`), smoke track tekshiruvi `aria-current` bo'yicha, `responsive-audit` `BW_CHROMIUM` ni qabul qiladi.
- **Muhit eslatmasi**: `exam-listening` — `BW_LONG_AUDIO` (60 s WAV), `exam-tools`/`full-journey` — `BW_AUDIO`, `demo` — `BW_PYTHON` + `DJANGO_SETTINGS_MODULE=config.settings.local`, `responsive-audit OUT_DIR`.
- **Ochiq**: `docs/design/DIRECTION.md` §6.

### 33-BLOK: Redizayn, 6-bosqich — landing va kirish — branch `claude/friendly-pascal-gsohro` (2026-11-17)
- **Landing hero**: shior o'rniga aniq qiymat taklifi (en/uz), ikki tugma, uchta halol fakt va imtihon oynasining **haqiqiy skrinshoti** (seed qilingan IELTS Academic mock, yorug'/qorong'i, `public/product/*.webp`, `next/image`).
- **"Nimalarga ega bo'lasiz"**: imtihon oynasi, natija, ustozlar — havolalar bilan; natija namunasi "demo ma'lumot (haqiqiy o'quvchi emas)" deb belgilangan. "Ekotizim" bloki (Vision OCR / Smart Analytics chiplari) olib tashlandi; ishlatilmagan `STATS` (500+ o'quvchi va h.k.) olib tashlandi.
- **Header**: JellyNav va SpecularButton (neon-lime) o'rniga oddiy havolalar va design-system tugmalari; aria-label'lar tarjima qilindi.
- **Kirish**: segmentli usul tanlagich ("Parol" / "Telegram kodi") bir qatorda, `aria-pressed`; karta telefonda yuqoridan boshlanadi; bezak bloblar va `text-slate-100` olib tashlandi; Telegram havolasi kontrasti tuzatildi (2.1:1 edi).
- **Tekshiruv**: tsc, lint, vitest 832. Skrinshotlar: `docs/agent/screens/redesign-6/`.
- **Keyingi**: yakuniy roles-crawl (axe) va E2E to'plami — 34-BLOK.

### 32-BLOK: Redizayn, 5-bosqich — o'qituvchi va admin — branch `claude/friendly-pascal-gsohro` (2026-11-17)
- **O'qituvchi kabineti** (`/teacher`, 4 fayl): butunlay qattiq yozilgan o'zbekcha → `teacherWorkspace` (en/uz); PageHeader + StatTile; guruh kartalari klaviatura bilan tanlanadi; formalar `Field` (label, xato); progress jadvali `Table` (sticky ustun, so'zli holatlar, emoji yo'q); baho katagi Enter/Esc. API va payload'lar o'zgarmadi. Fayllar `no-hardcoded-ui-text` guard'iga qo'shildi.
- **O'qituvchi dashboard**: "New PIN exam" dublikati olib tashlandi; "📲 Ota-onalarga Digest" → en/uz "Ota-onalarga haftalik hisobot"; **baholash navbati** yon ustunda birinchi, 5 ta urinish to'g'ridan-to'g'ri havola bilan; KPI → StatTile.
- **Baholash formasi** (`AssessmentReviewForm`): amal tanlovi segmentli radiogroup, mezonlar 4 ustunli panjara, **Ctrl/⌘+Enter** saqlaydi; xodim sahifasida imtihon jurnali baholashdan keyin. Baholash mantiqi o'zgarmadi.
- **Admin**: faoliyat bo'lmasa 300 px bo'sh grafik o'rniga qisqa bo'sh holat.
- **Tekshiruv**: tsc, lint (0 xato), vitest 832. Skrinshotlar: `docs/agent/screens/redesign-5/`.
- **Ochiq**: admin sidebar'ida 14 band guruhsiz (`lib/nav.ts`ga bo'lim tushunchasi kerak); Exam builder bosqichma-bosqich oqimi va preview avvalgidek (PreviewDialog/StudentPreview mavjud) — bu bosqichda o'zgartirilmadi.
- **Keyingi**: 6-bosqich — landing va auth, so'ng yakuniy roles-crawl va E2E.

### 31-BLOK: Redizayn, 4-bosqich — talaba dashboard va katalog — branch `claude/friendly-pascal-gsohro` (2026-11-17)
- **Dashboard**: "Bugungi reja" birinchi (davom ettirish qatori ajratilgan + "Davom etish"), keyin 3 ta raqam, keyin tavsiya etilgan test. **Soxta "kunlik streak" olib tashlandi** (urinishlar sonidan 7 gacha o'ylab topilgan, localStorage'da) — o'rniga "Oxirgi natija" (faqat to'liq natija, unga havola). `ielts_academic` → "IELTS Academic".
- **`StatTile`** `href` endi i18n `Link` (locale prefiksi to'g'ri).
- **Katalog**: track almashtirgich va holat filtri bitta qatorda (telefonda o'raladi, yon tomonga aylanmaydi); karta: "Yoki bitta bo'lim" — 2×2, 44 px tugmalar; "To'liq imtihonni boshlash"; topshirilgan imtihonda "Oxirgi natijani ko'rish". E2E selektorlar (`ielts-full.mjs`, `multilevel-full.mjs`) yangi yozuvni qabul qiladi.
- **Tekshiruv**: tsc, lint, vitest. Skrinshotlar: `docs/agent/screens/redesign-4/` (360 px ham).
- **Ochiq**: `/mock/attempts/mine` oxirgi 20 tani qaytaradi — trend va "oxirgi natija" shu oyna ichida.
- **Keyingi**: 5-bosqich — o'qituvchi va admin.

### 30-BLOK: Redizayn, 3-bosqich — natija va tahlil — branch `claude/friendly-pascal-gsohro` (2026-11-17)
- **Hero**: overall band bir marta (ilgari 3 marta: infografika, karta, "IELTS BAND" qutisi), 48 px; "CEFR C1" nishoni + en/uz tavsif (ilgari faqat inglizcha qattiq yozilgan); Multilevel — standart ball /75 va daraja.
- **Diagramma** `SkillBandChart` (`components/mock/result-overview.tsx`): ko'nikmalar bo'yicha bitta rangli gorizontal bar (IELTS — 9 dan band, Multilevel — 75 dan standart ball); kutilayotgan/4.0 dan past yozuv bilan; taxminiy (AI) ballar `*` va izoh bilan.
- **Writing/Speaking**: hosilaviy "Accuracy 72%" o'rniga mezon ballari (TA/TR, CC, LR, GRA; FC, LR, GRA, P) `diagnosticFeedback.criteria_scores` dan.
- **Keyingi qadamlar** (`NextSteps`): eng zaif va eng kuchli savol turlari — faqat talabaning tekshirilgan javoblaridan (`/mock/attempts/mine/type-accuracy`, har turda ≥ 4 javob). **Band trendi** (`BandTrend`): to'liq IELTS natijalari ≥ 2 bo'lsa SVG chiziq.
- **Tugmalar**: "Certificate (PDF) (PDF)" xatosi tuzatildi; primary / outline / ghost.
- **Tekshiruv**: tsc, lint, vitest 828 (result spec'da ma'lumot yuklovchi bloklar mock qilindi). Skrinshotlar: `docs/agent/screens/redesign-3/`.
- **Ochiq**: `CefrResultInfographic` hali Exam Track sahifasida (rang-barang ko'nikma ranglari) — 4-bosqichda.
- **Keyingi**: 4-bosqich — talaba dashboard va katalog.

### 29-BLOK: Redizayn, 2-bosqich — imtihon oynasi — branch `claude/friendly-pascal-gsohro` (2026-11-17)
- **Maydon**: imtihon oynasi butun kenglikda (max 1680 px, `bg-subtle` fon), 1366×768 da matn+savollar balandlikning ~84% i; Reading matni kengda "karta ichida karta" emas, 17 px / 1.75; split o'lchami o'zgaradi (avvalgidek).
- **Flag** savol raqami yonida (`aria-pressed`, telefonda 44 px). **Navigator**: javob berilgan — yashil fon, belgilangan — sariq chegara + burchak, joriy — halqa; telefonda pastdan chiqadigan varaq, 44 px katakchalar.
- **Taymer** (`lib/exam-settings.ts`): 5 daqiqadan kam — warning rangi, oxirgi daqiqa — danger; 5:00 va 1:00 da 10 soniyalik sokin xabar (hamma bo'limda), miltillash yo'q. Vaqt serverdan — o'zgarmadi.
- **Writing**: neytral segmentli "Yozish / Rasm" tanlagich, muharrir ekran balandligini to'ldiradi. **Listening**: qism sarlavhasi sticky pleyer ostida yashirinmaydi.
- **i18n**: runner'dagi "Previous/Next", "Shared situation", "Map", "Response timing", rasm alt matnlari → en/uz. `bg-surface-subtle` (aniqlanmagan token) → `bg-bg-subtle`, guard testi.
- **Imtihon qoidalari o'zgarmadi**: audio bir marta, server vaqti, autosave, finish oqimi.
- **Tekshiruv**: tsc, lint, vitest (828), E2E: `exam-a11y.mjs` 12/12 (axe serious/critical 0), `exam-workspace.mjs` 20/20, `shortcuts-screens.mjs` (360/390/1366, ikki tema).
- **Skrinshotlar**: `docs/agent/screens/redesign-2/{before,after}/` (timed rejim).
- **Keyingi**: 3-bosqich — natija va tahlil.

### 28-BLOK: Redizayn, 1-bosqich — dizayn tizimi — branch `claude/friendly-pascal-gsohro` (2026-11-17)
- **Tokenlar** (`globals.css`): yorug' temada iliq "qog'oz" neytrallar, qorong'ida chuqurroq va kamroq ko'k fon; `input-border` (3:1), `danger-fg`, `surface-elevated` (ilgari aniqlanmagan edi — `EmptyState` belgisi rangsiz edi); radius `chip/field/control/card/dialog`; soya `shadow-e1..e3` (Tailwind `shadow-sm…2xl` ularga bog'langan, rangli glow yo'q); motion `duration-fast/base/slow`, `ease-out/in`; `text-display`, `text-overline`.
- **Codemod** `frontend/scripts/tokenize-shape.mjs`: `rounded-[Npx]` → tokenlar, rangli soyalar olib tashlandi (146 fayl).
- **Komponentlar**: Button (`link`, bosilish, fokus), Input/Select 44 px, Card, Dialog (yopish yorlig'i katalogdan), Badge o'lchamlari, segmentli Tabs, yangi `Table`, `StatTile` (`StatCard` uni ishlatadi), `ProgressRing`; `ErrorState` "Qayta urinish" qattiq yozuvi o'rniga `common.retry`.
- **`/dev/ui`** — komponentlar galereyasi (faqat dev; production'da 404), `devUi` kalitlari en/uz.
- **Testlar**: `design-system.spec.ts` — shakl guard'i (har `src` fayli) va har ikki temada matn tokenlarining WCAG kontrasti (≥ 4.5:1, input chegarasi ≥ 3:1). vitest 823 → yashil, tsc, lint (0 xato).
- **Skrinshotlar**: `docs/agent/screens/redesign-1/after/` (before — `redesign-0/before/`).
- **Keyingi**: 2-bosqich — imtihon oynasi.

### 27-BLOK: Redizayn, 0-bosqich — audit va dizayn yo'nalishi — branch `claude/friendly-pascal-gsohro` (2026-11-17)
- **Skrinshotlar**: `docs/agent/screens/redesign-0/before/` — landing, login, talaba dashboard, katalog, imtihon oynasi (L/R/W/S, practice), natija, o'qituvchi dashboard, workspace, baholash, guruhlar, builder, admin; 1366×768 va 390×844, yorug'/qorong'i. Skript: `scripts/e2e-local/redesign-screens.mjs OUT [sahifa...]`.
- **`docs/design/DIRECTION.md`**: har ekranning 3 ta asosiy UX muammosi, yo'nalish (akademik, sokin, premium; shablon ko'rinishsiz), tipografiya/rang/spacing/radius/soya/motion tokenlari, ekranlar ustuvorligi.
- **Topilgan aniq xatolar** (keyingi bosqichlarda): natijada overall band ikki marta va "Certificate (PDF) (PDF)"; `/en/teacher` butunlay qattiq yozilgan o'zbekcha; dashboardda `ielts_academic` xom qiymati; teacher dashboardda "📲 Ota-onalarga Digest" (en sahifada) va ikki marta "New PIN exam"; admin'da bo'sh grafik 400 px joy egallaydi.
- **Keyingi**: 1-bosqich — tokenlar va komponentlar, `/dev/ui`.
- **Lokal stek (Linux)**: Postgres 16 `bestway_local`, Prisma `migrate deploy` → Django `migrate` → `seed_local_dev`, `seed_cbt_multilevel_exam`; API `runserver 127.0.0.1:8100`, `next dev -p 3300` (`frontend/.env.local`: `API_URL=http://127.0.0.1:8100/v1`).

### 26-BLOK: Baholash auditi, 4-bosqich (egasi javoblari) — branch `claude/elegant-cerf-9zge8g` (2026-11-17)
- **`rescore_cefr_levels`**: eski CEFR xaritasi noto'g'ri edi — "saqlangan daraja qoladi" qarori **bekor** (testdagi "owner decision" izohi yangilandi). Berilgan sertifikatlar o'zgarmaydi: sertifikat va uning ochiq tekshiruvi (`verify`) har safar attempt qatoridan chiziladi, shuning uchun `--apply` qatorni yozishdan oldin sertifikat aytgan qiymatlarni (overall score/band, daraja, Writing/Speaking'da bosilgan ball) `mediaState.certificateAsIssued` ga nusxalaydi; sertifikat va `verify` avval shuni o'qiydi. Hali qayta hisoblanmagan eski attempt'lar ham avvalgidek chiqadi (qolgan `practiceGrade` bosilgan ball sifatida o'qiladi). Test: qayta hisoblashdan oldin va keyin sertifikat bir xil (`before == after`) va `verify` bir xil. `--apply` men tomonimdan prod'ga ishga tushirilmadi; lokal bir martalik bazada qaytariladigan tranzaksiyada tekshirildi.
- **Guruh "o'rtacha band"i**: o'tkazib yuborilgan bo'limli attempt overall'i guruh uchun faqat topshirilgan bo'limlar bo'yicha olinadi (`mock_scoring.overall_without_skipped`; Multilevel overall'i allaqachon shunday) va "to'liq emas" belgisi bilan chiqadi: API'da `overallBandIncomplete` (talaba qatori) va `incompleteOverallCount` (guruh), Excel'da "Overall Note" ustuni, guruh sahifasida belgi. Attempt'ning o'z overall'i (talaba natijasi), `statistics.py` CSV va sertifikat o'zgarmadi.
- **Hujjatlar**: `docs/agent/AI_GRADING_PLAN.md`, `REPAIR_PROGRESS.md` — 35–50 siyosati "olib tashlandi (#190)" deb belgilandi.
- **Eslatma**: Multilevel + Writing/Speaking natijasi bor attempt'lar endi (practice grade bo'lmasa ham) "ichki natija" sertifikati qoidasiga (ustoz tasdig'i) tushadi.
- bw-tauri LiveProctoring (demo ro'yxat, `?? 52`) — alohida PR (bestwayec/bw-tauri).

### 25-BLOK: Baholash auditi, 3-bosqich (egasi javoblari) — branch `claude/elegant-cerf-9zge8g` (2026-11-17)
- **GRADE_POLICY `..._CAP55_V1` (35 + 15·raw/max, 35–50)** — tekshirildi: talabaga ko'rinardi (natija sahifasi, assessment panel, reyting, eksport) **va** overall/CEFR'ga kirardi (`mock_grading.internal_overall`), reytingda alohida `min(55, …)` ham bor edi. **Olib tashlandi**: `practice_grade`, `attach_grade`dagi hisob, `annotate_practice_grades`, `internal_overall`, `gradingPolicy` yangi snapshot'larda, job/ranking javobidagi `practiceGrade`/`aiPracticeGrade`/`teacherPracticeGrade`/`finalPracticeGrade`, reyting `min(55)`. Endi ball = AI/ustozning haqiqiy bahosi (Multilevel Writing/Speaking: `convert_expert` standart ball), "taxminiy" belgisi o'z joyida. Qisman mashqda reyting bali = `75·raw/max` (oldin 35–50). Eski saqlangan natijalardagi `practiceGrade` kaliti hamon qabul qilinadi, lekin hech qayerda hosil qilinmaydi va ko'rsatilmaydi. Sertifikat: Multilevel + Writing/Speaking natijasi bo'lsa "ichki natija" sertifikati va ustoz tasdig'i talabi saqlandi (`assessment_quality.manual_result_skills`), standart ball haqiqiy baho.
- **O'rtachalar** (`groups.py`, `statistics.py`): javobsiz (skipped) bo'lim o'rtachaga va talaba ballariga 0 bo'lib kirmaydi (`mock_scoring.skipped_skills`); guruh tahlilida `skippedSections` (har ko'nikma + jami, talaba qatorida ham), Excel'da "SKIPPED SECTIONS" qatori va "Skipped" yacheykasi, CSV'da "O'tkazilgan bo'limlar" ustuni, guruh sahifasida son. Attempt overall'i o'zgarmadi (rasmiy hisob: to'liq testda 4 ga bo'linadi).
- **bw-tauri**: `ScorePredictionWidget`, Dashboard va LiveProctoring CSV'dagi 3 ta mahalliy ball→daraja jadvali (A2 0–33, B1 34–45, B2 46–59, C1 60–75 — serverning 38/51/65 shkalasiga zid) olib tashlandi; daraja faqat server javobidan (`src/lib/cefr.ts`: C2, C1, B2, B1, BELOW_B1, eski A2/A1); oflayn taxmin darajasiz. Alohida PR (bestwayec/bw-tauri).
- **`rescore_cefr_levels`** (`--dry-run` default, `--apply`, `--json`, `--limit`, `--batch`): tugagan natijalarning CEFR'ini hozirgi shkalalarga keltiradi — IELTS: `overallBand` → ielts.org xaritasi; Multilevel: bo'lim darajalari, overall = saqlangan bo'lim standart ballari o'rtachasi, daraja (65/51/38), qolib ketgan `practiceGrade` `rawScores`dan olib tashlanadi. Tegmaydi: bo'lim bandlari, IELTS overall band, xom ballar, berilgan sertifikatlar, tugamagan va bo'lim mashqi attempt'lari. Takroran ishga tushirish o'zgarish bermaydi. Prod'da egasi ishga tushiradi: avval `--dry-run`.
- **Nest solishtirish testi**: `bandFromRaw` kutilgan qiymati endi `nest_band` (jadval qatori, "4.0 dan past" qoidasisiz); farq `test_python_differs_from_nest_only_below_the_published_range` bilan (Nest dist'siz ham) belgilangan.
- **Tekshiruv**: lokal Postgres 16 (Prisma SQL migratsiyalari `psql` bilan) — butun backend pytest 1459 yashil, CI'dagi 9 ta `verify_*_postgres.py` skripti yashil (3 tasi yangilandi); frontend vitest 787, tsc, lint yashil; bw-tauri vitest 422, tsc, build yashil.
- **Ochiq**: `docs/agent/AI_GRADING_PLAN.md`, `REPAIR_PROGRESS.md` — tarixiy hujjatlar, 35–50 siyosatini hamon tasvirlaydi (yangilanmadi). Tauri LiveProctoring'dagi demo ro'yxat (qattiq yozilgan `estimatedScore`) va CSV'dagi `?? 52` — alohida masala.

### 24-BLOK: Baholash auditi, 2-bosqich (egasi javoblari) — branch `claude/elegant-cerf-9zge8g` (2026-11-17)
- **IELTS → CEFR** (`cefr_band`): ielts.org xaritasi — C2 ≥ 8.5, C1 ≥ 7.0, B2 ≥ 5.5, B1 ≥ 4.0; 4.0 dan past `BELOW_B1` (UI'da `mock.levelBelowB1`, PDF/Telegram/Excel'da yozma). Eski: C1 ≥ 8, B2 ≥ 6.5, B1 ≥ 5, A2 ≥ 4, A1. Frontend'da C2 belgisi qo'shildi.
- **Guruh eksporti** (`compute_cefr_level(score, exam_type, existing_cefr)`): Multilevel — asosiy shkala (C1 ≥ 65, B2 ≥ 51, B1 ≥ 38, past `BELOW_B1`); IELTS — yuqoridagi xarita; ball turi qiymatdan taxmin qilinmaydi (`<9 = IELTS` olib tashlandi), `exam.type` dan olinadi; noma'lum tur yoki shkaladan tashqari ball → "-". Hisobot matnidagi eski chegaralar (70/55/40) olib tashlandi; taqsimotda C2 va `BELOW_B1`, eski A2/A1 faqat saqlangan natijalar bo'lsa.
- **Multilevel AI prompti**: 55/75 cheklovi va uni yashirish buyrug'i olib tashlandi; `PROMPT_VERSION` → `..._V3`. **Kodda qolgan**: `GRADE_POLICY = ..._CAP55_V1` (`assessment_quality.practice_grade`: 35 + 15·raw/max, 35–50 oralig'ida "ichki amaliy ball") — prompt emas, server hisobi; o'zgartirilmadi.
- **Rasmiy oraliqdan past ball** (Listening < 11, Academic < 10, General < 15): `sectionBands` da 3.5 (overall uchun), `bandBelowRange: true` — UI/PDF "4.0 dan past" ko'rsatadi, 3.5 emas. Admin jadvali bu qatorlarni o'zgartira olmaydi. Hech narsa javobsiz (40 savollik bo'lim) → band 0 (oldin `null`). Qisqa bo'lim — band yo'q.
- **`check_band_tables`** (faqat o'qiydi): bazadagi 3 ta band jadvalini standart bilan solishtiradi (`DEFAULT` / `SAME_AS_DEFAULT` / `DIFFERENT` + har xom ball farqi / `INVALID_IGNORED`), `--json`.
- **O'chirildi**: `instant_evaluator._round_to_half`, `_map_band_to_cefr` (ishlatilmasdi).
- **Testlar**: `tests/test_cefr_and_band_floor.py`, frontend `mock-result-view.spec.ts`. Lokal: Postgres'siz testlar yashil; DB talab qiladigan testlar (64 ta) lokal ishga tushmadi — CI'da.
- **Ochiq / ma'lumot**: eski saqlangan natijalar eski CEFR qiymati (A1/A2/…) bilan qoladi — qayta hisoblanmadi; `test_mock_scoring.py::test_reference_arithmetic_and_answers` Nest dist bilan solishtiradi (CI'da o'tkazib yuboriladi) — dist bo'lsa 3.5 farqi chiqadi; bw-tauri'ning o'z CEFR xaritasi (`ScorePredictionWidget`) o'zgartirilmadi.

### 23-BLOK: Baholash to'g'riligi auditi — branch `claude/elegant-cerf-9zge8g` (2026-11-17)
- **Listening / Reading (Academic, General)**: `mock_scoring` jadvallari ielts.org indikativ jadvallariga rasmiy chop etilgan oraliqlarda (L ≥11, AR ≥10, GT ≥15) to'liq mos — o'zgartirilmadi. Undan pastki qatorlar rasmiy emas (savol egasiga).
- **Overall**: `round_half` (.25 → .5, .75 → yuqori butun, .125 → pastga) to'g'ri; to'liq imtihon 4 ga bo'linadi.
- **Writing**: Task 2 og'irligi 2× ikkala joyda ham to'g'ri (`ielts_writing_band`, `assessment_results.score`). Xato: natija sahifasidagi mezonlar ro'yxati kalit bo'yicha takrorlanishni olib tashlardi — **Task 2 ning 4 mezoni va izohlari umuman ko'rinmasdi**. Endi har task alohida: Task 1 — TA, CC, LR, GRA; Task 2 — TR, CC, LR, GRA (`criteria_by_part`, `criteria_scores` da `code`/`part`). Speaking: FC, LR, GRA, P.
- **Taxminiy belgisi**: attempt detail `provisionalSkills` va har `diagnosticFeedback[skill].provisional`; bo'lim kartasida "Taxminiy", AI tahlil kartasida "Taxminiy — ustoz tasdiqlashi kutilmoqda". Qoida `teacherConfirmed` bilan bir xil (TEACHER manbasi yoki accept/override audit yozuvi).
- **Kalibrovka**: `python manage.py calibrate_ai_scores --teacher t.csv [--ai a.csv] [--json]` — har mezon bo'yicha MAE, bias, ±0.5 ulushi (`apps/core/calibration.py`); AI ballari bazadan tanlangan AI evaluation'dan olinadi, faqat o'qiydi.
- **Testlar**: `tests/test_ielts_rubric_and_calibration.py` — har rasmiy xom ball (0–40) uchun band, 29/30/31, 38/39/40 va har chegaraning ±1, overall chorak yaxlitlash, Writing og'irligi, mezonlar, taxminiy, MAE.
- **O'zgartirilmadi, egasining qarori kerak**: IELTS→CEFR xaritasi (`cefr_band`: C1 ≥8, B2 ≥6.5, B1 ≥5, A2 ≥4; ielts.org: C2 8.5, C1 7.0, B2 5.5, B1 4.0); guruh eksportidagi `compute_cefr_level` (Multilevel 70/55/40/30, blueprint 65/51/38; 0–9 oralig'idagi ball IELTS deb olinadi); Multilevel AI promptidagi yashirin 55/75 chegarasi; ishlatilmaydigan `instant_evaluator._round_to_half` (Python `round`, 6.25 → 6.0) va C2 ≥8.0.

### 22-BLOK: Finish (imtihonni yakunlash) 502 — branch `fix/finish-502` (2026-11-15)
- **Sabab (dalil bilan)**: prod nginx loglarida (13-okt – 15-noy) submit hech qachon 502 bermagan; nginx 600 s, gunicorn 120 s, Next proksi esa 8 s timeout — 502 faqat proksidan keladi. Submit qator qulfi ostida har javobga alohida UPDATE (97 so'rovdan 71 tasi), har speaking yozuvini SHA-256 bilan o'qish, job/bildirishnoma, yakunlangan urinishda sinxron Telegram post (40 s timeout) va web jarayon ichida AI tick'ni bajarardi; takroriy bosish hammasini qaytadan qilardi.
- **Tuzatish**: submit faqat deterministik natijani saqlaydi (69 ms / 18 so'rov); og'ir ish `SubmissionHandoff` outbox orqali javobdan keyin, aynan bir marta; takroriy Finish saqlangan holatni darhol qaytaradi; qolib ketgan hand-off'ni assessment-worker oladi; proksi Finish uchun 30 s.
- **Yuklama testi**: `verify_finish_load_postgres.py` — 30 parallel Finish 201, 30 takroriy 201, 60 job (dublikat yo'q). 4 slotda: oldin max 3.8 s, keyin 2.1 s.
- **Holat**: PR #184 merge qilindi (91ffbec), CI yashil. 2026-11-15 prod'ga deploy qilindi: `buildCommit` 91ffbec, bestwayec.uz va api 200, core.0010 migratsiyasi qo'llandi, deploydan keyin 5xx yo'q. Deploy 0b6073a dan keyingi barcha PR'larni (#103–#184) chiqardi.

## Keyingi qadamlar
- Record Mock: prod'da faqat 8 s placeholder WAV bor — haqiqiy Listening audio `media/exams/record_mock_1/` ga qo'yilmaguncha imtihon nashr qilinmaydi.
- Birinchi haqiqiy guruh imtihonidan keyin `SubmissionHandoff` jadvalida `done_at IS NULL` qatorlar qolmaganini tekshirish.

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
