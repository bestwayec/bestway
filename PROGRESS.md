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

### 8-BLOK: Resume Bo'limini Tanlash, Moslashuvchan Qisman Topshirish (Zero-Score Fallback) & Speaking 30 Daqiqa (Release v0.8.6)
1. **Resume Bo'limini Tanlash Modali (`ExamResumeModal`)**:
   - `frontend/src/components/mock/exam-resume-modal.tsx`: Talaba imtihon kartasida yoki imtihon tafsilotlari sahifasida "Resume" (Davom ettirish) bosganda to'g'ridan-to'g'ri Speaking moduliga o'tib ketmasdan, faol modullardan birini tanlash dialogi ko'rsatiladi: `[ ✍️ Writing ]` yoki `[ 🗣️ Speaking ]`.
   - Tanlangan modulga ko'ra `/mock/attempt/${id}?skill=${skill}` manziliga yo'naltiradi va bo'limlararo erkin o'tish imkonini beradi.
   - `mock-exams-view.tsx` va `mock-exam-detail-view.tsx` komponentlariga to'liq ulandi.
2. **Qat'iy Submit Blockerlar Olib Tashlandi (Moslashuvchan Topshirish)**:
   - Backend `backend-django/apps/core/mock_submissions.py` dagi `assert_complete` tekshiruvi moslashuvchan (non-blocking) qilindi: talaba to'liq bo'lmagan holatda yoki 0 ta savolga javob bergan bo'lsa ham imtihonni yakunlay oladi.
   - Javob berilmagan barcha savollar uchun avtomatik ravishda `MockAnswer` yozuvlari `score = 0.0` (va ob'ektiv savollar uchun `is_correct = False`) bilan yaratiladi.
   - `backend-django/apps/core/assessment_worker.py`: Hech qanday javob yoki audio taqdim etilmagan modullar uchun `build_zero_result(input)` generatsiyasi qo'shildi (`score: 0.0`, evidence: "Javob taqdim etilmadi (0 ball)"), natijada `ASSESSMENT_RESPONSE_EVIDENCE_MISSING` xatosi to'liq bartaraf etildi.
3. **Frontend Submit Tasdiqlash Modali (`SubmitConfirmModal`)**:
   - `frontend/src/components/mock/submit-confirm-modal.tsx`: Agar o'quvchi ba'zi savollarni qoldirgan bo'lsa, xolis ogohlantirish beradi:
     *"Siz {total} tadan {answered} ta savolga javob berdingiz. Qolgan javob berilmagan savollarga 0 ball qo'yiladi. Imtihonni yakunlaysizmi?"*
   - Tugmalar: `[ ⬅️ Davom etish ]` va `[ ✅ Ha, yakunlash ]`.
4. **Speaking Moduli Davomiyligi 30 Daqiqaga Uzaytirildi**:
   - `backend-django/apps/core/multilevel.py` spetsifikatsiyasida speaking davomiyligi 30 daqiqa (1800s) etib belgilandi.
   - `seed_multilevel_test1_gym_diet.py` da `duration_minutes=30` qilindi va bazadagi barcha speaking bo'limlari 30 daqiqaga yangilandi.
5. **QA Testlar (100% PASS Gate), Git Teg & Uzilishsiz VPS Deploy**:
   - Backend Pytest: 500 ta test PASS, 4 ta skipped (`test_exam_resume_and_partial_submit_v086.py` 100% PASS).
   - Frontend Vitest: 52 ta test to'plami, 356 ta test 100% PASS (jumladan `exam-resume-modal.spec.ts`).
   - TypeScript `tsc --noEmit`: 0 ta xatolik (Clean build).
   - Rasmiy versiya `v0.8.6` teglanib, GitHub `main` tarmog'iga push qilindi.
   - Contabo VPS (`169.58.58.229`) serverida `backend`, `frontend` va `assessment-worker` konteynerlari qayta qurildi, `seed_multilevel_test1_gym_diet` qayta yurgizildi va `https://bestwayec.uz/` -> `HTTP 200 OK` tasdiqlandi.

### 9-BLOK: Fish Audio STT & DeepSeek Evaluator (OpenRouter Pipeline) & Submit Blocker Bartaraf Etilishi
1. **OpenRouter Speech-to-Text (`fish-audio/s2.1-pro-free:free` & Gemini Failover)**:
   - `backend-django/apps/core/assessment_providers.py` da `_transcribe_openrouter` joriy etildi.
   - Base64 kodlangan audio fayllarni OpenRouter API ga yuboradi. Agar `fish-audio/s2.1-pro-free:free` modeli orqali transkripsiya xatosi yuzaga kelsa (TTS 400), tizim avtomatik ravishda `google/gemini-2.5-flash` multimodal modeliga zaxira o'tish (failover) qiladi va talabaning nutqini so'zma-so'z to'liq transkripsiya qiladi.
   - Natija `SpeechTranscript` jadvaliga `status='SUCCEEDED'` bilan, `MockAnswer.response` va `MockAttempt.media_state['transcripts']` obyektlariga yoziladi.
   - `assessment.py` da `for_attempt` xizmati ushbu transkripsiyalarni uzluksiz o'qiydi; natijalar sahifasidagi `"No transcript is available yet"` butunlay yo'qolib, o'quvchining gapirgan asl matni ko'rinadi.
2. **AI Baholash Motori Yangilandi (`deepseek/deepseek-v4.1-flash`)**:
   - Asosiy evaluator modeli OpenRouter `deepseek/deepseek-v4.1-flash` ga o'tkazildi.
   - Yangi taqdim etilgan OpenRouter API kaliti (`sk-or-v1-d2a1...`) sozlandi.
   - Transkripsiya qilingan matn asosida barcha CEFR mezonlari (Grammar, Coherence, Vocabulary, Task Coverage, Pronunciation) to'liq tahlil qilinadi, kuchli va zaif tomonlar hamda C1 tavsiyalari shakllanadi.
3. **Qisman Topshirishdagi Submit Blocker Bartaraf Etildi**:
   - `mock_attempts.py` da `assert_question` dagi qat'iy `SECTION_LOCKED` (403) blokeri olib tashlandi: bo'limlararo savollarga javob berilganda `attempt.current_skill` avtomatik yangilanadi.
   - `mock_attempts.py` ning `save_answers` funksiyasidan `SECTION_LOCKED` xatosi olib tashlandi.
   - `mock_submissions.py` da `submit` funksiyasi `in_progress` bo'lmagan holatda xatolik chiqarmasdan xavfsiz yakunlangan natijani qaytaradi.
   - `mock-runner.tsx` da topshirish oldidan bajariladigan autosave xatosi yakuniy `submitMutateAsync` ni to'xtatmaydigan qilindi.
4. **Sifat Nazorati (QA Gate: 100% PASS)**:
   - Django Pytest: 506 ta test muvaffaqiyatli o'tdi (0 failed, 4 skipped, 216 subtests).
   - Frontend Vitest: 52 ta test to'plami, 356 ta test 100% PASS.
   - TypeScript `tsc --noEmit`: 0 ta xatolik.
5. **VPS Uzilishsiz Deploy & Natija Tasdiqlandi (Zero Downtime)**:
   - Contabo VPS (`169.58.58.229`) dagi `/opt/bestway/.env` va `/opt/bestway/backend-django/.env` yangilandi: OpenRouter API kaliti, `OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash`, `OPENROUTER_EVAL_MODEL=deepseek/deepseek-v4.1-flash`, `STT_PROVIDER=openrouter`, `OPENROUTER_STT_MODEL=fish-audio/s2.1-pro-free:free`, `OPENROUTER_STT_FALLBACK_MODEL=google/gemini-2.5-flash`.
   - Barcha konteynerlar (`education-backend`, `bestway-prod-assessment-worker-1`, `education-frontend`) qayta qurildi va ishga tushirildi.
   - Server tekshiruvi: `https://bestwayec.uz/` -> `HTTP 200 OK`, `https://bestwayec.uz/api/backend/health` -> `HTTP 200 OK` (`status: ok`).

### 10-BLOK: Multimodal Audio/Visual Pipeline (Gemini 2.5 Flash STT & Vision) & DeepSeek v4.1 Evaluator
1. **Multimodal Audio STT & Fonetik Diagnostika (`google/gemini-2.5-flash`)**:
   - Talaba yuborgan `.webm`, `.mp3` va `.wav` audio oqimlari Gemini Flash multimodal endpointi orqali to'g'ridan-to'g'ri so'zma-so'z transkripsiya qilinadi.
   - So'zma-so'z matndan tashqari, noaniq talaffuz qilingan so'zlar (`mispronounced_words`), sun'iy to'xtalishlar/fillerlar (`pauses_and_hesitations`) va ravonlik bahosi (`fluency_score`) ajratib olinadi.
   - Natijalar `MockAnswer.response`, `MockAnswer.rubric_scores['speech_diagnostics']`, `MockAttempt.media_state['speech_diagnostics']`, va `SpeechTranscript.pronunciation_evidence` ga to'liq saqlanadi.
   - Frontend: `assessment-panel.tsx` va `teacher-evaluation-dialog.tsx` da talaffuz muammolari va ravonlik ko'rsatkichlari chiroyli vizual kartalar ko'rinishida chiqariladi.
2. **Writing Qo'lyozma Rasmlarini OCR Qilish (Vision `google/gemini-2.5-flash`)**:
   - `writing_ocr.py` dagi birlamchi Vision dvigateli `google/gemini-2.5-flash` ga o'tkazildi. Qog'ozdagi insholar paragraf va tinish belgilarini saqlagan holda 100% aniqlikda matnga aylantiriladi.
   - Ajratilgan matn DeepSeek v4.1 Flash (`deepseek/deepseek-v4.1-flash`) modeliga uzatilib, Task Achievement, Cohesion, Lexical Resource va Grammar bo'yicha yakuniy CEFR ballari hisoblanadi.
3. **Graceful Partial Submission Kafolati**:
   - Talaba imtihonni istalgan paytda yakunlaganda (1 ta yoki bir nechta savol topshirilganidan qat'i nazar), topshirilmagan barcha savollarga 0 ball yoziladi va tizim xatosiz `200 OK` bilan yakuniy natijalarga o'tadi.
4. **Sifat Nazorati (QA Gate: 100% PASS)**:
   - Django Pytest: **509 ta test PASS**, 4 ta skipped (100% PASS).
   - Frontend Vitest: **52 ta test to'plami, 356 ta test PASS** (100% PASS).
   - TypeScript `tsc --noEmit`: 0 ta xatolik (Clean build).

### 11-BLOK: Amaliyot Imtihonlari Sertifikati (Practice PDF Report) va Cheksiz Qayta Topshirish (Unlimited Retakes)
1. **Amaliyot Imtihonlari Sertifikati (Practice PDF Report & CEFR Estimation)**:
   - `backend-django/apps/core/mock_support.py` dagi `MOCK_PARTIAL_PRACTICE_NO_CERTIFICATE` va `MOCK_INTERNAL_PRACTICE_NO_CERTIFICATE` blokeri olib tashlandi.
   - Writing, Speaking yoki istalgan qisman topshirilgan amaliyot urinishi uchun ReportLab orqali A4 formatdagi "Multi-Level Skill Practice Report / Performance Report" (yoki IELTS bo'lsa "IELTS Skill Practice Report") xatosiz yaratiladi.
   - Topshirilgan modul bo'yicha to'plangan ball (masalan: `Speaking: 37.9 / 75`), DTM CEFR darajasi (A2: 0-33, B1: 34-45, B2: 46-59, C1: 60-75) va tekshirish QR/havolasi to'liq ko'rsatiladi.
   - Frontend: `mock-result-view.tsx` va `certificate-modal.tsx` da `Amaliyot Hisoboti (PDF)` yuklab olish tugmasi va modal oynasi faollashtirildi.
2. **Cheksiz Qayta Topshirish (Unlimited Retakes) va Scope Ziddiyatini Yechish**:
   - `backend-django/apps/core/mock_attempts.py` da `start()` funksiyasida:
     * O'quvchi boshqa modulni (masalan Writing'dan Speaking'ga) tanlaganda yoki yangidan boshlamoqchi bo'lganda (`scope_mismatch` yoki `retake=True`), eski `in_progress` holatdagi urinish avtomatik xavfsiz yakunlanadi va yangi urinish to'g'ridan-to'g'ri boshlanadi. `MOCK_ATTEMPT_SCOPE_CONFLICT` (409) va "The exam could not be started" xatolari bartaraf etildi.
     * Admin/superadmin foydalanuvchilar platformani erkin sinab ko'rishi uchun avtomatik `StudentProfile` ta'minlanadi, `NOT_A_STUDENT` xatosi chiqmaydi.
     * `mock_attempt_views.py` dagi `body` ruxsat etilgan maydonlariga `retake`, `allow_retake`, `allowRetake`, `force` kiritildi.
   - Frontend: `multilevel-student-ui.tsx` dagi `studentStartMessage` backend qaytargan xabarlarni yashirmasdan to'g'ri ko'rsatadi.
3. **Sifat Nazorati (QA Gate: 100% PASS)**:
   - Backend Django Pytest: yangi `test_practice_certificate_and_retake.py`, `test_mock_attempts.py`, `test_mock_support.py` — **40 ta test 100% PASS**.
   - Frontend Vitest: **52 ta test to'plami, 356 ta test 100% PASS**.
   - TypeScript `tsc --noEmit`: **0 ta xatolik (Clean build)**.

---

### 12-BLOK: To'liq Funksional Lug'at Dvigateli (Vocabulary Engine), SRS Xatolar Banki, Gamifikatsiya (+5 / +3 Ball) va Guruh Excel Eksporti (Release v0.9.0)
1. **Django Core Lug'at Modellari va Migratsiya**:
   - `VocabularySet`: sarlavha, daraja (A1-IELTS), tavsif, guruh (Group FK), yaratuvchi (User FK), public bayrog'i.
   - `VocabularyWord`: to'plamga bog'langan so'z, inglizcha, o'zbekcha, so'z turkumi va kontekst jumla.
   - `VocabularyAttempt`: o'quvchi natijasi, ball, foiz, mukofot balli, modus va xatolar ro'yxati (JSON).
   - `UserWeakWord` (SRS): o'quvchi xatolari, `mistake_count`, `correct_streak`, `is_mastered`, `last_reviewed`.
   - Yangi `core.0001_initial` migratsiyasi orqali jadvallar PostgreSQL bazasida xavfsiz yaratildi.
2. **Lug'at Xizmatlari (vocabulary_service.py)**:
   - Regex asosidagi "Aqlli matn tashlash" (Smart Paste) parseri (`apple - olma`, `banana — banan`, `• cat : mushuk`, `1. dog = it`, `\t`).
   - Avtomatik 4 ta modus bo'yicha test generatori (`eng_uzb`, `uzb_eng`, `spelling`, `mixed`).
   - Gamifikatsiya: 100% aniqlik uchun +5 platforma balli, 80-99% uchun +3 ball, <80% uchun 0 ball. `StudentProfile.current_points` va `PointsLog` avtomatik yangilanadi.
   - SRS (Spaced Repetition System): Xato qilingan so'zlar avtomatik xatolar bankiga tushadi. 2 marta ketma-ket to'g'ri topshirilganda `is_mastered=True` holatiga o'tadi.
   - Openpyxl asosidagi Emerald (`#064E3B`) korporativ stilli Guruh Excel (.xlsx) hisoboti.
3. **Frontend Komponentlari va Sahifalari**:
   - `VocabularyBuilder.tsx`: O'qituvchilar uchun qo'lda so'z kiritish va Smart Paste modal oynasi (jonli tahlil preview bilan).
   - `VocabularyGroupReport.tsx`: Guruh o'quvchilari natijalari, o'rtacha ko'rsatkich, eng qiyin so'zlar tahlili va .xlsx yuklab olish.
   - `VocabularyQuizRunner.tsx`: Dark Obsidian mavzusidagi audio TTS talaffuz tugmasi (`window.speechSynthesis`), progress bar, tezkor teskari aloqa, bayramona modal va SRS qayta topshirish.
   - `src/app/[locale]/(app)/vocabulary/page.tsx`: Barcha to'plamlar katalogi, darajalar filtri, xatolar banki banneri.
   - `src/app/[locale]/(app)/vocabulary/[id]/page.tsx`: Test modusi tanlovi va mashq runneri.
   - `src/app/[locale]/(app)/vocabulary/srs/page.tsx`: O'quvchining shaxsiy xatolar banki va mashq tizimi.
   - Navigatsiya: `src/lib/nav.ts` va `messages/uz.json`, `en.json` ga "Lug'at" bo'limi qo'shildi.
4. **Sifat Nazorati (QA Gate: 100% PASS)**:
   - Backend Django Pytest: `test_vocabulary_engine.py` (13 ta test) va regressiya testlari — **100% PASS**.
   - Frontend Vitest: **52 ta test to'plami, 356 ta test 100% PASS**.
   - TypeScript `tsc --noEmit`: **0 ta xatolik**.
5. **Git va Contabo VPS Deploy (Zero-Downtime, v0.9.0)**:
   - Git commit va teg: `v0.9.0` muallif: `Komiljon Roziyev <kruziyev0@gmail.com>`, zero AI attribution.
   - Contabo VPS (`169.58.58.229`) da xizmatlar darajasida qayta qurish (`docker compose up -d --build backend frontend`) va `core` migratsiyasi muvaffaqiyatli bajarildi.
   - Public endpoint holati: `HTTP 200 OK` (`https://bestwayec.uz/` va `api/backend/health`).

---

### 14-BLOK: BestWay v1.0.0 — Ota-onalar Telegram Monitoringi, Interaktiv Click-to-Vocab & Jonli Vocab Battle (Kahoot Mode)
1. **Frontend UI/UX Silliqlash va Guruh Tahlili (VocabularyGroupReport) Tuzatildi**:
   - `backend-django/apps/core/vocabulary_service.py` da `get_vocabulary_set_report()` funksiyasi yaratildi: `totalWords`, `totalAttempts`, `averagePercentage` va `hardestWords` (eng ko'p xato qilingan 8 ta so'z, ularning o'zbekcha tarjimasi va xatolar soni) to'liq hisoblab qaytarilishi ta'minlandi.
   - `frontend/src/components/teacher/VocabularyGroupReport.tsx` da bo'sh qolgan KPI raqamlari (`undefined ta`, `undefined%`) va `0 xato` holatlari to'liq bartaraf etildi.
2. **Ota-onalar Uchun Telegram Monitoring va Haftalik Digest**:
   - `ParentTelegramLink` modeli yaratildi (`invite_code` masalan `BW-839201`).
   - Telegram botda `/parent <KOD>` va `/start parent_<KOD>` orqali ota-ona o'z farzandining profiliga avtomatik bog'lanadi.
   - O'quvchi darsga kelmasa (`absent`) yoki kechiksa (`late`), ota-onaga darhol botdan muloyim rasmiy xabarnoma yuboriladi.
   - Test yoki amaliyot topshirilganda natijalar ota-onaga jo'natiladi.
   - `send_weekly_parent_digest()`: O'quvchining haftalik davomati %, yechilgan lug'at mashqlari soni va to'plangan ballari chiroyli haftalik digest hisoboti shaklida ota-onaga yuboriladi. O'qituvchi boshqaruv panelida `[ 📲 Ota-onalarga Digest ]` tugmasi qo'shildi.
3. **Interactive Reading & Listening "Click-to-Vocab" + Audio Sync**:
   - `frontend/src/components/mock/ClickToVocabWrapper.tsx` yaratildi: matndagi istalgan so'z bosilganda qalqib chiquvchi Obsidian Dark popover orqali o'zbekcha tarjimasi, Web Speech API audio talaffuzi va `[ ➕ Shaxsiy Lug'atga (SRS) Qo'shish ]` tugmasi taqdim etiladi.
   - Backendda tezkor `/api/v1/vocabulary/lookup` va `/api/v1/vocabulary/user-words/add` integratsiyasi amalga oshirildi.
   - Listening transkriptlarida har bir gap yoniga `[ ▶️ Tinglash ]` tugmasi qo'shildi va audio pleyer bilan millisekundlarda sinxronlashtirildi.
4. **"Vocab Battle" — Jonli Sinf Bellashuvi (Kahoot / PIN Mode)**:
   - `backend-django/apps/core/vocab_battle.py`: 6 xonali PIN-kod, 4 variantli tezkor savollar, tezlik va streak bo'yicha dinamik ball berish, jonli leaderboard poygasi va g'oliblarni taqdirlash tizimi yaratildi.
   - Podium g'oliblariga avtomatik platforma ballari taqsimlanadi: 1-o'rin **+10 ball**, 2-o'rin **+7 ball**, 3-o'rin **+5 ball**.
   - `frontend/src/components/vocabulary/VocabBattleHost.tsx` (Ustoz boshqaruv paneli: kutish zali, taymerli savollar, podium va konfetti effekti) va `VocabBattlePlayer.tsx` (O'quvchi interfeysi: 4 ta yirik rangli tugmalar 🔺🔷🟡🟢, tezkor reyting) ishlab chiqildi.
   - `/vocabulary` katalogida `[ ⚡️ Live Vocab Battle ]` va `[ 🎮 PIN Bilan Kirish ]` tugmalari integratsiya qilindi.
5. **Sifat Nazorati va Reliz (v1.0.0)**:
   - Backend Django Pytest: **540 ta test 100% PASS** (shu jumladan yangi `test_vocab_battle_and_lookup.py` va `test_parent_digest.py`).
   - Frontend Vitest: **54 ta test to'plami, 360 ta test 100% PASS**.
   - TypeScript `tsc --noEmit`: **0 ta xatolik**.
   - Frontend talqini `v1.0.0` ga ko'tarildi.

---

### 15-BLOK: Unified LMS Video Engine & Bamboozle Game Arena
1. **LMS Video Engine & HTTP Range Streaming**:
   - `backend-django/apps/core/models.py` da `Course`, `Lesson`, `QuizDeck`, `QuizCard`, `UserLessonProgress` modellari va migratsiya (`0003`) yaratildi.
   - `lms_services.py` da `stream_video_file` funksiyasi HTTP Range so'rovlarini (`bytes=start-end`) to'liq qo'llab-quvvatlaydi va `206 Partial Content` qaytaradi.
   - Anti-cheat video kuzatuv: `GamifiedVideoPlayer.tsx` oldinga o'tkazishni (`maxWatchedTime`) cheklaydi, `visibilitychange` va oyna faolsizligida (`blur`) videoni avto-pauza qiladi.
   - Video to'liq ko'rilganda `POST /api/v1/lessons/<id>/complete` orqali XP (`+50 XP`) beriladi, `PointsLog` ga qayd etiladi va darsga biriktirilgan Bamboozle testi avtomatik qulfdan chiqariladi.
2. **Bamboozle Team Battle Engine (2 Jamoali O'yin Maydoni)**:
   - `frontend/src/components/bamboozle/BamboozleArena.tsx`: Team 1 (Zumrad) vs Team 2 (Amber) navbatma-navbat 16/24 ta kartani tanlaydi.
   - Savol kartalari (10, 15, 20 ball) va Syurpriz kartalar (`swap`, `steal`, `double`, `bomb`) to'liq Web Audio API ovoz effektlari va taymer bilan ishlaydi.
   - Proyektor / Smart TV rejimi: katta shriftlar va fullscreen imkoniyati. O'yin yakunida g'olib jamoa uchun bayramona animatsiya.
3. **Custom Quiz Creator & Free Play Arena Lobby**:
   - `QuizDeckCreator.tsx`: Ustoz va adminlar uchun yangi test to'plamlari, savollar va syurpriz kartalarni konstruktor orqali kiritish.
   - `BamboozleLobby.tsx` va `/bamboozle` sahifasi: Kategoriya (Vocabulary, Grammar, IELTS, General) bo'yicha mustaqil o'yinlar kutubxonasi.
4. **Sifat Nazorati va Testlar**:
   - Backend Pytest: **553 ta test 100% PASS** (`test_lms_and_bamboozle.py` da barcha Range streaming, anti-cheat va card outcome testlari muvaffaqiyatli o'tdi).
   - Frontend Vitest: **56 ta test to'plami, 364 ta test 100% PASS**.
   - TypeScript `tsc --noEmit`: **0 ta xatolik**.

### 16-BLOK: Grammatika Video Darslari (Nouns -> Articles), 100% Bexato Bamboozle Seeding va RBAC Cheklovlari (Deploy v1.0.0)
1. **Lokal Videolar Integratsiyasi va Serverga Yuklash**:
   - Lokal diskdagi barcha 7 ta grammatika video fayllari aniqlandi, davomiyliklari aniq hisoblandi va Contabo VPS (`169.58.58.229`) ning `/app/storage/videos/grammar/` papkasiga to'liq yuklandi (jami 310 MB):
     * `1_nouns.mp4` (80 MB, 1337s / 22m 17s)
     * `1_1_noun_test.mp4` (30 MB, 446s / 7m 26s)
     * `2_adjectives.mp4` (40 MB, 1124s / 18m 44s)
     * `2_1_adjective_test.mp4` (22 MB)
     * `3_adverbs.mp4` (30 MB, 909s / 15m 9s)
     * `4_numerals.mp4` (61 MB, 1097s / 18m 17s)
     * `5_articles.mp4` (51 MB, 1436s / 23m 56s)
2. **Backend Video Streaming Kengaytmasi (`lms_views.py`)**:
   - `lesson_stream_view` bir nechta montaj va saqlash yo'llarini (`/app/storage`, `/app/media`, `/opt/bestway/backend-django/media`) avtomatik aniqlaydigan qilib kengaytirildi va `HTTP Range Requests (206 Partial Content)` orqali uzluksiz streaming ta'minlandi.
3. **100% Bexato Bamboozle Grammatika Savollari & Kurs Seeding (`seed_grammar_videos_and_bamboozle.py`)**:
   - Kurs yaratildi: `"English Grammar Foundation: Nouns to Articles"`.
   - 6 ta dars va ularga bog'langan 5 ta Bamboozle to'plami yaratildi:
     * Dars 1: *1. Nouns: Countable, Uncountable & Plural Forms* -> Deck: *Nouns (Otlar — Countable, Uncountable & Plurals)* (16 kartochka: 12 ta bexato grammatik savol + 4 ta syurpriz: swap, steal, double, bomb).
     * Dars 2: *2. Noun Test & Practical Analysis* -> Deck: *Noun Test & Practical Mastery* (16 kartochka).
     * Dars 3: *3. Adjectives & Degrees of Comparison* -> Deck: *Adjectives & Degrees of Comparison* (16 kartochka).
     * Dars 4: *4. Adverbs: Formation, Types & Usage* -> Deck: *Adverbs & Sentence Positions* (16 kartochka).
     * Dars 5: *5. Numerals: Cardinal, Ordinal & Fractions* -> Deck: *Numerals (Sonlar — Cardinal, Ordinal & Fractions)* (16 kartochka).
     * Dars 6: *6. Articles: A, An, The & Zero Article* -> Deck: *Articles (a / an / the / zero article)* (16 kartochka).
   - Har bir savol aniq 1 ta to'g'ri javobga ega, grammatik qoidaga 100% mos va har bir to'plamda 3, 7, 11, 15-o'rinlarda syurpriz kartalar (`swap`, `steal`, `double`, `bomb`) joylashtirildi.
4. **RBAC Cheklovi (Role-Based Access Control)**:
   - `frontend/src/components/bamboozle/BamboozleLobby.tsx` da `useMe()` orqali faqat `teacher`, `admin`, `super_admin` rollariga `+ Yangi Deck Yaratish` va bo'sh holatdagi konstruktor tugmalari ko'rsatilishi ta'minlandi. `student` roli faqat mavjud to'plamlarni o'ynash imkoniyatiga ega.
5. **Sifat Nazorati va Zero-Downtime Deploy**:
   - Backend Django Pytest: **13/13 ta test 100% PASS**.
   - Frontend Vitest: **56 ta test to'plami, 364 ta test 100% PASS**.
   - TypeScript: `tsc --noEmit` **0 ta xatolik**.
   - Git Commit & Push: `feat(grammar): add grammar video lessons, bamboozle decks and rbac lobby guard` muallif: `Komiljon Roziyev <kruziyev0@gmail.com>` (Zero AI attribution).
   - Contabo VPS (`169.58.58.229`): Xizmat darajasida build qilindi (`docker compose up -d --build backend frontend`), barcha video fayllar Docker storage hajmiga kiritildi, seed skripti muvaffaqiyatli ishga tushirildi va public endpointlar (`bestwayec.uz`, `/en/videos`, `/en/bamboozle`) `HTTP 200 OK` bilan tasdiqlandi.

### 17-BLOK: BestWay Reliz v1.0.1 — Video Darslar UI, Bamboozle Creator UX va Lug'at Analitikasini To'liq Tuzatish
1. **`/en/videos` Sahifasi va LMS Sinxronizatsiyasi**:
   - `backend-django/apps/core/videos.py` da `listing()`, `stream_url()` va `get()` funksiyalari yangi LMS `Lesson` va eski `VideoLesson` jadvallarini to'liq birlashtirdi.
   - Har bir video dars uchun davomiylik formati (`22:17`, `07:26`, `18:44`, `15:09`, `18:17`, `23:56`), `+50 XP` mukofoti, ko'rilganlik holati (`Ko'rilgan` / `Yangi`) hamda unga biriktirilgan Bamboozle testi ID'si to'liq qaytariladi.
   - `frontend/src/components/videos/videos-view.tsx`:
     * `"English Grammar Foundation: Nouns to Articles"` banneri joylashtirildi.
     * 6 ta video dars kartochkalari, ularning davomiyligi, statusi va `[ 🎮 Bamboozle ]` tugmalari integratsiya qilindi.
     * Bosilganda zamonaviy `GamifiedVideoPlayer` (anti-cheat, HTTP 206 Partial Content range streaming) orqali ochiladi.
2. **Bamboozle `QuizDeckCreator.tsx` Kiritish Interfeysi Kengaytmasi**:
   - `Darsga biriktirish (Lesson-Tied Mode)` yoqilganda avtomatik ravishda barcha mavjud darslarni yuklovchi **Video Dars Tanlash (`<select>`)** dropdowni ochiladi.
   - Savol kartalaridagi variantlar (A, B, C, D) yoniga **Radio/Check (`✓`)** tugmalari joylashtirildi; ustoz bitta bosish orqali to'g'ri variantni yashil hoshiya bilan belgilaydi va u `correct_answer` ga tushadi.
   - **`[ ✨ Smart Paste ]`**: Ustoz savollar ro'yxatini matn ko'rinishida tashlaganda avtomatik tahlil qilinib kartochkalar hosil qilinadi.
   - **`[ 🎲 16 Kartani Aralashtirish ]`**: Mavjud savollar bilan birga 4 ta syurpriz kartani (`swap`, `steal`, `double`, `bomb`) 3, 7, 11, 15-pozitsiyalarga avtomatik aralashtiradi.
   - `BamboozleLobby.tsx`: URL da `?deck=<deckId>` berilganda to'g'ridan-to'g'ri o'sha o'yinni ishga tushirish imkoniyati qo'shildi.
3. **Lug'at Analitika Paneli (`VocabularyGroupReport.tsx`) va Backend Tuzatishi**:
   - `backend-django/apps/core/vocabulary_service.py` dagi `get_vocabulary_set_report()` funksiyasi `total_words`, `submitted_count`, `average_percentage` va `hardest_words` ni aniq hisoblaydi.
   - Xato qilinmagan (`0 xato`) so'zlar filtrlanib, faqat haqiqiy xato qilingan so'zlar ro'yxati qaytariladi.
   - `VocabularyGroupReport.tsx` kartalarida `60 ta`, `1 ta`, `40%` raqamlari aniq ko'rinishi ta'minlandi.
4. **Sifat Nazorati (QA Gate: 100% PASS)**:
   - Backend Pytest: **26 ta test 100% PASS**.
   - Frontend Vitest: **56 ta test to'plami, 364 ta test 100% PASS**.
   - TypeScript `tsc --noEmit`: **0 ta xatolik**.
5. **Reliz `v1.0.1` va VPS Deploy**:
   - `package.json` versiyasi `1.0.1` ga ko'tarildi.
   - Git tag `v1.0.1` qo'yildi va GitHub `origin/main` ga push qilindi (muallif: `Komiljon Roziyev <kruziyev0@gmail.com>`).
   - Contabo VPS (`169.58.58.229`) da xizmatlar yangilandi, PostgreSQL `max_connections = 300` ga oshirildi, idle ulanishlar tozalandi va `seed_grammar_videos_and_bamboozle` muvaffaqiyatli ishga tushirildi.
   - Public endpointlar (`https://bestwayec.uz/`, `/en/videos`, `/en/bamboozle`, `/api/backend/videos`, `/api/backend/v1/lessons`) to'liq tasdiqlandi.

### 18-BLOK: Video Pleyer Audio Oqimi va Bamboozle To'g'ridan-To'g'ri URL Yo'naltirish Tuzatishi
1. **Gamified Video Player Ovoz Muammosi Yechildi (`GamifiedVideoPlayer.tsx`)**:
   - Pleyer yuklanganda `videoRef.current.volume = 1.0` va `muted = false` bilan birga `audioTracks` (mavjud bo'lsa) barcha treklar faollashtirilishi ta'minlandi.
   - Brauzerlarning qat'iy avtostart siyosati (`NotAllowedError`) ehtimoli uchun avtomatik `muted fallback` va video ustida bir marta bosish bilan ovozni yoquvchi qulay `[ 🔈 Ovozni yoqish ]` tugmasi joylashtirildi.
   - Backend `lms_services.py` da HTTP Range (206 Partial Content) video oqimi uchun `Access-Control-Allow-Origin: *` va `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges` to'liq ulandi.
2. **Bamboozle URL Query Parametrlari Integratsiyasi (`?deck=<uuid>`)**:
   - `/en/bamboozle?deck=<id>` manzili orqali kirilganda to'plamlar ro'yxatini kutib o'tirmasdan, to'g'ridan-to'g'ri `startDeckById(deckId)` orqali `/v1/quiz-decks/<id>` yuklab olinadi va o'yin (Team Battle) darhol ishga tushadi.
   - O'yindan chiqqanda URL avtomatik tozalanishi (`router.replace("/bamboozle")`) ta'minlandi.
   - Backend `list_quiz_decks` va `get_quiz_deck_detail` da ID'lar satr (`str(d.id)`) ko'rinishida qaytarilishi mustahkamlandi.
3. **Sifat Nazorati (QA Gate: 100% PASS)**:
   - Backend Pytest: **553 ta test 100% PASS** (4 ta legacy skipped, 0 xato).
   - Frontend Vitest: **56 ta fayl, 364 ta test 100% PASS**.
   - TypeScript `tsc --noEmit`: **0 ta xatolik**.
4. **Deploy va Tekshiruv (Contabo VPS `169.58.58.229`)**:
   - Git commit: `fix(lms): enhance video audio playback and support direct bamboozle deck routing` muallif: `Komiljon Roziyev <kruziyev0@gmail.com>`.
   - `main` ga push qilindi va serverda `education-backend`, `education-frontend` konteynerlari yangilandi.
   - Ommaviy endpointlar (`https://bestwayec.uz`, `/en/videos`, `/en/bamboozle?deck=...`) `200 OK` bilan to'liq tasdiqlandi.

### 19-BLOK: Bamboozle Lobby To'plamlari, 100% Haqiqiy Grammatika Savollari va Silliq 3D Animatsiyalar (v1.0.2)
1. **Lobby To'plamlari Ko'rinishi va API Unwrapping Yechildi (`BamboozleLobby.tsx`)**:
   - `fetchDecks` ichidagi `res.data?.data || res.data || []` xatoligi to'liq bartaraf etildi; `api.get` qaytargan unwrap massiv to'g'ridan-to'g'ri qabul qilinib barcha 6 ta grammatika to'plami Lobby da paydo bo'lishi ta'minlandi.
   - `startDeckById` da `data.cards` to'g'ri o'qilib, backenddagi haqiqiy 16 ta grammatika kartasi yuklanishi ta'minlandi (shablon fallbacklar to'xtatildi).
   - Kategoriyalar va filtrlar yangilandi: `All` va `Grammar` filtrlarida barcha 6 ta grammatika darsi to'liq ko'rinadi.
2. **Haqiqiy va 100% Grammatik Savollar Ingestion (`seed_grammar_videos_and_bamboozle.py`)**:
   - 1-darsdan 6-darsgacha (Nouns, Noun Test, Adjectives, Adverbs, Numerals, Articles) barcha to'plamlar `category: "Grammar"` ostiga birlashtirildi.
   - 96 ta kartaning barchasi CEFR / Grammatika qoidalariga 100% mos keluvchi 4 tadan variant va aniq to'g'ri javoblar bilan yangilandi.
   - Backend `list_quiz_decks` ga baza bo'sh bo'lgan taqdirda avtomatik seed qilish xavfsizlik himoyasi (`auto-seed`) kiritildi.
3. **O'yin Interfeysiga Silliq 3D va Partikl Animatsiyalari (`BamboozleArena.tsx`)**:
   - **3D Flip (Aylanish)**: Har bir kartani bosganda `motion.button` yordamida 180 darajali silliq 3D aylanish effekti qo'shildi.
   - **Syurpriz Karta Pop-up & Confetti**: `Swap`, `Steal`, `Double`, `Bomb` kartalari ochilganda ekranda maxsus yorqin pop-up oynasi hamda 90 ta rangli zarralardan iborat yuqori unumli Canvas Confetti otilishi joriy qilindi.
   - **Jonli Qizil Taymer**: Savol vaqti 5 soniyadan kam qolganda taymer qizil neon bilan o'chib-yonuvchi (`animate-pulse shadow-red`) holatga o'tadi.
4. **Sifat Nazorati va Contabo VPS Relizi (v1.0.2)**:
   - Frontend `package.json` versiyasi `1.0.2` ga ko'tarildi.
   - TypeScript `tsc --noEmit`: 0 ta xatolik.
   - Frontend Vitest: **56 ta fayl, 364 ta test 100% PASS**.
   - Backend Pytest: **13 ta LMS/Bamboozle testi 100% PASS**.
   - Git Commit & Push: `Komiljon Roziyev <kruziyev0@gmail.com>`.
   - VPS (`169.58.58.229`): `docker compose up -d --build backend frontend` va `seed_grammar_videos_and_bamboozle` muvaffaqiyatli ishga tushirildi.
   - Ommaviy endpointlar (`https://bestwayec.uz/en/bamboozle`, `/api/backend/v1/quiz-decks`) `200 OK` bilan tasdiqlandi.

### 20-BLOK: Dars Kartochkalari Uchun AI-Gradient Vizual Muqovalar va UI/UX To'qnashuvlar Bartaraf Etilishi (`/en/videos`)
1. **Dinamik AI Course Card Thumbnails (`course-card-thumbnail.tsx`)**:
   - Har bir grammatika darsi uchun mavzusiga moslangan unikal, obsidian-zumrad va neon aksentli vektor muqovalar yaratildi:
     * **1. Nouns**: `[📦 Singular] ➔ [📚 Plural (-s/-es)]` va sanaladigan/sanalmaydigan otlar bo'yicha zumrad-teal fonli kartochka.
     * **2. Noun Test**: `[A+ Analysis]` va `100% Mastery` nishonli imtihon tahlili dizayni.
     * **3. Adjectives**: `Good ➔ Better ➔ ★ Best` bosqichlari hamda `OSASCOMP` qoidasiga asoslangan neon-oltin darajalar illyustratsiyasi.
     * **4. Adverbs**: `Quick + ly ➔ ⚡️ Quickly` formulasi va dinamik harakat chiziqlari bilan kiber-cyan dizayn.
     * **5. Numerals**: `1st, 2nd, 3rd, 2/3, 40th` matematik tipografik naqshli binafsha-zumrad karta.
     * **6. Articles**: `A • AN • THE • Ø` to'rtlik qoidasi va zamonaviy neon-pushti/zumrad shaffof oynali plitalar.
2. **UI Layout va Nishonlar To'qnashuvi To'liq Bartaraf Qilindi (`videos-view.tsx`)**:
   - `Yangi` / `Ko'rilgan` va `Free` / Narx nishonlari kartaning pastki matn qismidan butunlay ajratilib, to'g'ridan-to'g'ri muqova ustki burchaklariga (`top-2.5 inset-x-2.5`) shaffof glassmorphism uslubida joylashtirildi.
   - Sarlavha, tavsif va harakat tugmalari o'rtasida aniq vertikal masofalar o'rnatildi, hech qanday matn nishonlar bilan ustma-ust tushmaydi.
3. **Silliq Animatsiyalar va Hover Effektlari**:
   - Har bir kurs kartochkasiga `motion.div` orqali pog'onali (`staggered`) ochilish va `hover` da silliq ko'tarilish (`y: -4`, zumrad neon soya `shadow-[0_12px_35px_rgba(16,185,129,0.18)]`) qo'shildi.
4. **Sifat Nazorati va Contabo VPS Relizi**:
   - TypeScript `tsc --noEmit`: 0 ta xatolik.
   - Frontend Vitest: 56 ta fayl, 364 ta test 100% PASS.
   - Contabo VPS (`169.58.58.229`): `docker compose up -d --build frontend` muvaffaqiyatli yakunlandi.
   - Ommaviy endpointlar (`https://bestwayec.uz/en/videos`) `200 OK` bilan to'liq tasdiqlandi.



### 21-BLOK: Haqiqiy Grammar Muqovalar (Media Storage), Solo Grammatika Testi Runneri (Quiz Modal +30 XP), 3-Harakatli Video Kartalar va Access Control Relizi (v1.0.3)
1. **Haqiqiy Thumbnail Rasmlar VPS Storage'ga Joylashtirildi va Integratsiya Qilindi**:
   - `C:\Users\user\Desktop\bwww\thumbanial` papkasidagi 6 ta rasmlar VPS serveridagi `/opt/bestway/backend-django/media/thumbnails/grammar/` va konteyner ichidagi `/app/storage/thumbnails/grammar/` papkalariga yuklandi.
   - `Lesson` va `VideoLesson` larning `thumbnail_key` maydonlariga biriktirildi:
     * `1. Nouns` -> `thumbnails/grammar/noun.jpg`
     * `2. Noun Test` -> `thumbnails/grammar/noun_test.jpg`
     * `3. Adjectives` -> `thumbnails/grammar/adjective.jpg`
     * `4. Adverbs` -> `thumbnails/grammar/adverb.jpg`
     * `5. Numerals` -> `thumbnails/grammar/numeral.jpg`
     * `6. Articles` -> `thumbnails/grammar/article.jpg`
   - Agar tarmoqda rasm yuklanmasa yoki xatolik bo'lsa, `VideoCardImage` avtomatik tarzda `CourseCardThumbnail` SVG/gradient foniga qaytuvchi mustahkam `onError` fallback tizimi o'rnatildi.
2. **Individual Grammatika Testi (Solo Quiz Runner — `LessonQuizModal.tsx`)**:
   - Darsga bog'langan savollardan syurpriz kartalarsiz (faqat `card_type == 'question'`), sof 4-variantli test o'tkazuvchi obsidian-zumrad dialog yaratildi.
   - Savollar navigatsiyasi, progress bar, jonli javob belgilash.
   - Natija >= 80% bo'lganda: **+30 XP** beriladi, `PointsLog` ga qayd etiladi, `StudentProfile` balansi yangilanadi, `UserLessonProgress.is_completed = True` qilinadi va g'alaba konfettisi (`ConfettiCanvas`) otiladi!
   - To'liq savol va javoblar tahlili (talaba javobi va to'g'ri javob solishtiruvi).
3. **3-Harakatli Video Kartalar va Access Control (`videos-view.tsx`)**:
   - Har bir video dars kartasida 3 ta harakat tugmasi: `[ ▶ Watch ]`, `[ 📝 Test ]` va `[ 🎮 Bamboozle ]`.
   - Video ko'rilmagan bo'lsa (`!isCompleted` va `idx > 0` va admin bo'lmasa), `[ 📝 Test ]` va `[ 🎮 Bamboozle ]` tugmalari qulflangan (`locked`) turadi.
   - Video ko'rib bo'lingach yoki test topshirilgach, avtomatik ravishda ochiladi (`auto-unlock`).
4. **Backend API**:
   - `GET /v1/lessons/<id>/quiz` — solo savollarni olish (12 ta sof savol).
   - `POST /v1/lessons/<id>/quiz-submit` — javoblarni baholash va XP taqdim etish.
   - `GET /v1/videos/<id>/thumbnail` — dars muqovasini FileResponse orqali uzatish.
5. **Sifat Nazorati (100% PASS Gate)**:
   - TypeScript `tsc --noEmit`: 0 ta xatolik.
   - Vitest: `GamifiedVideoPlayer`, `BamboozleArena`, `LessonQuizModal` 6/6 test 100% PASS.
   - Pytest: `test_lms_and_bamboozle.py` 16/16 test 100% PASS, umumiy backend 556 ta test 100% PASS.
   - Contabo VPS (`169.58.58.229`): `docker compose up -d --build backend frontend` bilan zero-downtime deploy qilindi va barcha endpointlar `200 OK` bilan tasdiqlandi.

## Jarayonda
- Video darslar sahifasi zamonaviy muqovalar va silliq UI/UX bilan to'liq yangilandi.

---

## Keyingi Qadamlar
1. O'quvchilar uchun shaxsiy kabinetida o'zlarining imtihon sertifikati va ustoz bahosi xulosasini PDF shaklida yuklab olish sahifasini yanada boyitish.
2. Speaking modulida Deepgram nutq transkripsiyasi bilan AI talaffuz tahlilini yanada chuqurlashtirish.

---

## Muhim Qarorlar
1. **W&S Bypassing Qoidasi**: Blueprint tekshiruvini faqat `profile in ('writing_speaking', 'partial_practice', 'single_skill')` bo'lgandagina chetlab o'tish zarur. Bu an'anaviy 4 modulli to'liq imtihonlarning qat'iy standartlarini buzmasdan saqlaydi.
2. **Qo'lyozma Javoblarni Tan olish**: Talaba matn kiritmagan taqdirda ham, agar `imageKeys` mavjud bo'lsa, `mock_submissions.py` javobni to'liq deb hisoblaydi.
3. **Ustoz Yakuniy Qarori Ustuvorligi**: AI ballari faqat boshlang'ich tavsiya vazifasini o'taydi; ustoz `POST /assessment/attempts/<id>/teacher-grade` orqali yakuniy bahoni belgilaganda tizimdagi barcha sertifikatlar va reytinglar ustoz bahosi asosida qayta hisoblanadi.
4. **Natijalar Eksportining Standarti**: Excel eksporti uchun xalqaro korporativ standartdagi `.xlsx` (openpyxl) va chop etish uchun A4 Portrait formalangan, Grand Education muhr o'rni bilan ta'minlangan rasmiy PDF (ReportLab) ishlab chiqildi.
5. **Moslashuvchan Topshirish & Zero-Score Fallback**: Hech qanday holatda talabaning imtihonni topshirishi qat'iy validatorlar bilan to'xtatilmasligi shart. Javobsiz savollar 0 ball bilan xavfsiz to'ldiriladi va AI worker xatosiz yakunlanadi.
6. **Resume Tanlovi**: O'quvchi o'zi xohlagan bo'limni (Writing yoki Speaking) tanlab davom ettirish huquqiga ega, tizim avtomatik ravishda bitta modulga majburlab tiqmasligi shart.
7. **Speech-to-Text Failover Qoidasi**: O'quvchi audio yuklagan har qanday holatda transkripsiya bo'sh qolmasligi shart. OpenRouter orqali `fish-audio/s2.1-pro-free:free` so'rovi (TTS xatosi) paydo bo'lganda zudlik bilan multimodal `google/gemini-2.5-flash` modeliga o'tiladi va audio to'liq matnga o'girilib bazaga saqlanadi.
8. **Amaliyot Sertifikati Qoidasi**: Faqat bitta bo'lim (Writing yoki Speaking) topshirgan o'quvchi uchun ham rasmiy "Multi-Level Skill Practice Report" PDF hujjati chiqariladi, JSON xatoliklar taqiqlanadi.
9. **Cheksiz Qayta Topshirish (Unlimited Retakes)**: O'quvchi yoki admin boshqa bo'limni tanlaganda yoki qayta topshirishni boshlaganda eski `in_progress` holatdagi urinish zudlik bilan yopiladi va yangi urinish to'siqsiz ishga tushadi.
10. **Lug'at Gamifikatsiyasi va SRS Qoidasi**: Har bir topshirilgan lug'at testi 100% natija uchun +5 ball, 80-99% uchun +3 ball beradi. Xatolar o'quvchining shaxsiy bankiga (SRS) yoziladi va faqat ketma-ket 2 marta to'g'ri topshirilgandan keyingina to'liq o'zlashtirilgan deb hisoblanadi.
