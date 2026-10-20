# BestWay Platform — Progress & Status Report

## Maqsad
BestWay / GRAND EDUCATION platformasining asosiy yo'nalishlari — Faqat Writing va Speaking modullaridan iborat mustaqil imtihonlarni blokerlarsiz o'tkazish (Standalone Writing & Speaking Exam), qog'ozdagi qo'lyozma insholarni rasmga olib yuklash (Multi-page Handwriting Image Upload + Vision OCR & AI Grader), ustoz tomonidan yakuniy bahoni tasdiqlash va qayta belgilash (Teacher Manual Override Engine), imtihon va guruh natijalarini rasmiy tahliliy formatlarda eksport qilish (Excel .xlsx & PDF ReportLab), imtihon va baholash interfeyslarini zamonaviy Dark Obsidian (`#0B0F17`) hamda Zumrad (`emerald-500/600`) uslubiga to'liq o'tkazish, 100% testlardan o'tkazish va Contabo VPS ga uzilishsiz (zero-downtime) deploy qilish.

---

## Bajarildi

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
2. **Kattalashtirilgan Ko'rinish (Image Zoom Lightbox Modal)**:
   - `ImageZoomModal` komponenti yaratildi: rasm ustiga bosilganda yuqori aniqlikda zoom (+ / -), reset va to'liq ekranda ko'rish imkoniyati taqdim etiladi.
3. **Vision OCR & AI Baholash Oqimi**:
   - Backendda yuklangan rasmlar saqlanadi (`imageKeys`), Vision OCR orqali matn ajratib olinadi va DeepSeek / Qwen modellari yordamida CEFR / IELTS rubrikalari bo'yicha xolis baholanadi.

### 3-BLOK: Ustoz Nazorati va Yakuniy Baho Qo'yish (Teacher Override Engine)
1. **Backend Teacher Override API**:
   - Yangi rasmiy endpoint: `POST /api/v1/assessment/attempts/<attempt_id>/teacher-grade` (va `/mock/attempts/<attempt_id>/teacher-grade`).
   - Qabul qiladi: `final_score`, `writing_score`, `speaking_score`, `total_score`, `teacher_comment`, `criteria_scores`.
   - Yangilaydi:
     * `MockAttempt`: `overall_band`, `section_bands`, `media_state['is_teacher_reviewed'] = True`, `media_state['is_reviewed_by_teacher'] = True`, `media_state['teacher_score'] = calculated_overall`, `status = 'completed'`.
     * `AssessmentJob`: `teacher_score`, `final_score`, `final_score_source = 'TEACHER'`, `approved_feedback`.
     * `MockAnswer`: `graded_by_id`, `feedback`.
2. **Frontend Ustoz Baholash Paneli (Teacher Evaluation Hub)**:
   - `frontend/src/components/mock/assessment-panel.tsx` da `TeacherAttemptOverrideCard` komponenti yaratildi.
   - Ustoz kabinetida har bir modul bo'yicha AI bergan tavsiyaviy ball yonida yakuniy ballni kiritish va shaxsiy pedagogik izoh yozish imkoniyati joylashtirildi.
   - Baholash panelida talaba yuklagan qo'lyozma varaqlar gallereyasi va AI o'qigan OCR matni aniq ko'rsatiladi.
3. **Natijalar Sahifasidagi Tasdiqlash Ko'rsatkichlari**:
   - `frontend/src/components/mock/mock-result-view.tsx` da:
     * `isTeacherReviewed` bo'lganda: Yashil zumrad `"Ustoz tomonidan tasdiqlangan"` nishoni va ustoz xulosasi ko'rsatiladi.
     * Ko'rib chiqilmagan bo'lsa: Amber rangli `"AI bahosi (Ustoz ko'rib chiqishi kutilmoqda)"` nishoni chiqadi.

### 4-BLOK: Imtihon Topsirish Interfeysi Silliqlashuvi (Mock Runner UI)
1. **Kirish Rejimini Tanlash (Typing vs Handwritten Image Toggle)**:
   - `frontend/src/components/mock/mock-runner.tsx` da Writing vazifalari uchun qulay rejim tanlagich yaratildi:
     * `[ ⌨️ Matn terish ]`: An'anaviy klaviaturada terish, jonli so'z hisoblagich va qoralama avtosave.
     * `[ 📷 Qog'oz / Rasm yuklash (OCR) ]`: Varaqlarni suratga olish, OCR ajratish va olingan matnni to'g'ridan-to'g'ri tahrirlash imkoniyati.
2. **Speaking Audio Yozuvchisi**:
   - Jonli audio to'lqin vizualizatsiyasi (`AudioWaveform`), dark glass obsidian karta va xavfsiz audio saqlash.

### 5-BLOK: DTM Multi-Level Mock Test 1 (Writing & Speaking) Seed va Nashr
1. **Yangi Rasmiy DTM Imtihoni Yaratildi**:
   - `MockExam`: `id = "multilevel-test-01-gym-vegetarian"`
   - Sarlavha: `Multi-Level (CEFR) Mock Test 1: Gym Membership & Vegetarian Diet`
   - Holat: `is_published = True`, `is_demo = False`, `price = 0`, `is_free_for_approved = True` (barcha o'quvchilar darhol topshira oladi).
2. **Writing Bo'limi (60 daqiqa, 70 ball)**:
   - Part 1 Stimulus (Gym Membership fee increase letter) to'liq kiritildi (`stimulus_ref = "gym-membership-increase"`).
   - Task 1.1 — Informal Letter (Do'stga norasmiy xat, ~50 words).
   - Task 1.2 — Formal Letter (Murabbiyga rasmiy xat, 120–150 words).
   - Part 2 — Publication / Forum Discussion (Vegetarian diet essay, 180–200 words).
3. **Speaking Bo'limi (DTM CEFR Standart Taymerlari & 2 ta Rasm Aktivi)**:
   - Part 1.1 Interview: 3 ta savol (Free time, Country, First teacher) — 5s tayyorgarlik, 30s gapirish.
   - Part 1.2 Picture Comparison: `Traditional Classroom` vs `Online Distance Study` yuqori aniqlikdagi rasmlar aktivi (`speaking-1.2-classroom-vs-online.png`) yaratildi va bog'landi. 1 ta asosiy taqqoslash (10s tayyorgarlik, 45s gapirish) va 2 ta follow-up savol (5s prep, 30s speak).
   - Part 2 Cue Card: Muhim o'quv tajribasi / kurs mavzusi (1 daqiqa prep, 2 daqiqa speak).
   - Part 3 Discussion: Ta'lim, sun'iy intellekt va texnologiyalar kelajagi (1 daqiqa prep, 2 daqiqa speak).
4. **Serverda Ishga Tushirish va 200 OK Tekshiruvi**:
   - `python manage.py seed_multilevel_test1_gym_diet` VPS da bajarildi.
   - API tekshiruvi: `GET /api/backend/mock/exams/multilevel-test-01-gym-vegetarian` -> `ready=True`, `practiceReady=True`, `questionCount=11`.

### 6-BLOK: Dual-Layer Baholash va Ko'p Formatli Natijalar Eksporti (Excel .xlsx & PDF)
1. **Guruh Imtihon Natijalari Eksport Xizmati (`apps/core/group_exam_export.py`)**:
   - `get_group_exam_export_data`: Guruh o'quvchilari, ularning topshirgan urinishlari, Writing/Speaking bo'yicha AI va Ustoz ballari, CEFR darajalari (C1, B2, B1, A2) va topshirish ko'rsatkichlarini yig'adi.
   - `generate_group_exam_excel`: `openpyxl` yordamida chuqur zumrad uslubidagi professional `.xlsx` vedomost yaratadi. Unda to'liq jadvallar, zebra ranglar, ko'rsatkichlar va pastki yakuniy tahlil mavjud.
   - `generate_group_exam_pdf`: `reportlab` asosida rasmiy A4 B2B analitik hisobot yaratadi (Grand Education qo'shaloq zumrad hoshiyasi, KPI kartochkalari, CEFR taqsimot statistikasi, o'qituvchi va akademik direktor muhr/imzo bloklari).
2. **API Endpointlar va Qat'iy Xavfsizlik**:
   - `GET /api/v1/groups/<group_id>/exams/<exam_id>/export/excel` (va `/groups/...`) -> `.xlsx` yuklab beradi.
   - `GET /api/v1/groups/<group_id>/exams/<exam_id>/export/pdf` (va `/groups/...`) -> analytical PDF taqdim etadi.
   - Guruh faqat biriktirilgan o'qituvchi yoki admin/super_admin ga ochiq; ruxsatsiz yoki talaba murojaatlari `403 Forbidden` bilan bloklanadi.
3. **Frontend: Split-View Ustoz Baholash Modali (`TeacherEvaluationDialog`)**:
   - `frontend/src/components/teacher/teacher-evaluation-dialog.tsx`:
     * Chap ustunda: O'quvchining asl javobi (matn terilgan bo'lsa so'zlar hisoblagichi bilan; qo'lyozma rasm bo'lsa kattalashtiruvchi Zoom Lightbox bilan) hamda audio pleyer va nutq transkripsiyasi (STT).
     * O'ng ustunda: AI (DeepSeek / Qwen) mezonlar bo'yicha baholari (Task Achievement, Cohesion, Lexical, Grammar, Pronunciation), kuchli tomonlar va xatolar.
     * Pastki panelda: Ustoz baholarini kiritish (`writing_score`, `speaking_score`, `final_score`), pedagogik tavsiya va zumrad rangli `[ ✅ Yakuniy Bahoni Tasdiqlash ]` tugmasi.
4. **Frontend: Guruh Reyting Paneli Yangilanishi (`GroupAiRanking`)**:
   - Imtihon tanlanganda to'g'ridan-to'g'ri `[ 📊 Excel (.xlsx) ]` va `[ 📄 PDF Hisobot ]` yuklab olish tugmalari qo'shildi.
   - Har bir o'quvchi qatorida `[ ✍️ Baholash ]` tugmasi qo'shildi, bosilganda to'g'ridan-to'g'ri `TeacherEvaluationDialog` ochiladi va baho tasdiqlangach jadval jonli ravishda yangilanadi.

### 7-BLOK: QA Testlar, Git Commit va Uzilishsiz VPS Deploy
1. **Avtomatlashtirilgan Testlar (100% PASS Gate)**:
   - Django Pytest: 497 ta test PASS, 4 ta skipped (jumladan `test_teacher_grading_and_export.py` dagi 11 ta yangi unit test 100% PASS).
   - Frontend Vitest: 51 ta test to'plami, 354 ta test 100% PASS.
   - TypeScript `tsc --noEmit`: 0 ta xatolik (Clean build).
2. **Git & Human Authorship (Zero AI Attribution)**:
   - Muallif: `Komiljon Roziyev <kruziyev0@gmail.com>`.
   - Commit: `feat(assessment): implement dual-layer grading override and group exam export`.
   - `main` tarmog'iga birlashtirildi va GitHub ga muvaffaqiyatli push qilindi.
3. **Zero-Downtime VPS Deployment**:
   - Contabo VPS (`169.58.58.229` / `/opt/bestway`) da `git pull origin main` bajarildi.
   - Xizmat darajasida xavfsiz qayta qurildi: `docker compose up -d --build backend frontend assessment-worker`.
   - Public Endpoint 200 OK tekshirildi: `https://bestwayec.uz/` -> `HTTP/1.1 200 OK`.

---

## Jarayonda
- Yangi qo'shilgan Dual-Layer baholash va Excel/PDF eksport oqimini real o'quvchilar va ustozlar sinovida monitoring qilish.

---

## Keyingi Qadamlar
1. O'quvchilar uchun shaxsiy kabinetida o'zlarining imtihon sertifikati va ustoz bahosi xulosasini PDF shaklida yuklab olish sahifasini joriy etish.
2. Speaking modulida Deepgram nutq transkripsiyasi bilan AI talaffuz tahlilini yanada chuqurlashtirish.

---

## Muhim Qarorlar
1. **W&S Bypassing Qoidasi**: Blueprint tekshiruvini faqat `profile in ('writing_speaking', 'partial_practice', 'single_skill')` bo'lgandagina chetlab o'tish zarur. Bu an'anaviy 4 modulli to'liq imtihonlarning qat'iy standartlarini buzmasdan saqlaydi.
2. **Qo'lyozma Javoblarni Tan olish**: Talaba matn kiritmagan taqdirda ham, agar `imageKeys` mavjud bo'lsa, `mock_submissions.py` javobni to'liq deb hisoblaydi.
3. **Ustoz Yakuniy Qarori Ustuvorligi**: AI ballari faqat boshlang'ich tavsiya vazifasini o'taydi; ustoz `POST /assessment/attempts/<id>/teacher-grade` orqali yakuniy bahoni belgilaganda tizimdagi barcha sertifikatlar va reytinglar ustoz bahosi asosida qayta hisoblanadi.
4. **Natijalar Eksportining Standarti**: Excel eksporti uchun xalqaro korporativ standartdagi `.xlsx` (openpyxl) va chop etish uchun A4 Portrait formalangan, Grand Education muhr o'rni bilan ta'minlangan rasmiy PDF (ReportLab) ishlab chiqildi.
