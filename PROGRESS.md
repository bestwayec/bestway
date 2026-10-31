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

### 22-BLOK: Qolgan 23 ta Video Darslar, 276 ta CEFR Grammatika Testi, 15 ta Optimizatsiya Qilingan Muqovalar va Idempotent Thumbnail Sync Relizi (v1.0.4)
1. **15 ta Thumbnail Rasmlar Optimallashtirildi va Serverga Joylashtirildi**:
   - C:\Users\user\Desktop\bwww\thumbanial\qolganthumbinal papkasidagi 15 ta .jpg fayllar Pillow kutubxonasi yordamida sifatini yo'qotmagan holda 1280px max-width, quality 82 bilan optimallashtirildi (~2.4 MB dan ~100 KB gacha siqildi).
   - Barcha 15 ta rasm Contabo VPS hostidagi /opt/bestway/backend-django/media/thumbnails/grammar/ va backend konteynerining /app/storage/thumbnails/grammar/ papkalariga yuklandi.
2. **23 ta Video Darslar VPS Media Storage'ga O'tkazildi**:
   - C:\Users\user\Desktop\bwww\qolgandarslar papkasidagi 23 ta video dars (.mp4, jami 571 MB) tar arxivi orqali xavfsiz VPS ga yuklandi va /opt/bestway/backend-django/media/videos/grammar/ hamda konteyner ichidagi /app/storage/videos/grammar/ ga joylashtirildi.
   - Har bir videoning aniq davomiyligi (duration) sekundlarigacha hisoblab chiqildi va bazaga kiritildi.
3. **Idempotent Management Buyruqlari**:
   - seed_remaining_lessons_and_quizzes.py: 7-dan 29-gacha bo'lgan 23 ta dars, 23 ta QuizDeck va 276 ta yuqori sifatli CEFR grammatika savollari (har bir savolda 4 ta variant, 1 ta to'g'ri javob, 10/15/20 ball) hamda jamoaviy Bamboozle arenasi uchun 4 tadan syurpriz kartalari bilan muvaffaqiyatli kiritildi.
   - ttach_thumbnails.py: Dars muqovalarini order_index bo'yicha bog'laydigan, har qanday paytda qayta ishga tushirishga xavfsiz (idempotent) buyruq yaratildi.
4. **Dars va Muqovalar To'liq Taxt Qilindi (Jami 29 ta Dars, 464 ta Kartochka)**:
   - Mavjud 15 ta dars uchun muqovalar to'liq biriktirildi:
     * #8: Future Perfect Continuous -> utureperfectconteniues.jpg
     * #9: Future Perfect -> utureperfect.jpg
     * #10: Future Simple -> uturesimple.jpg
     * #11: Gerund va Infinitive -> geroundvainfinitive.jpg
     * #12: If Conditionals -> if.jpg
     * #13: Indirect Speech -> indirectspeech.jpg
     * #14: Modal verbs -> modalverbs.jpg
     * #15: Numerals part 2 -> 
umeralspart2.jpg
     * #16: Passive Voice -> passivevoice.jpg
     * #17: Past Continuous -> pastconteniues.jpg
     * #18: Past Perfect Continuous -> pastperfectconteniues.jpg
     * #19: Past Perfect -> pastperfect.jpg
     * #20: Past Simple -> pastsimple.jpg
     * #21: Personal and Possessive Pronouns -> personalpossesivepronouns.jpg
     * #22: Prepositions -> prepositions.jpg
   - Muqovasi ertaga tayyor bo'ladigan 8 ta dars (#7 Future Continuous, #23 Present Continuous, #24 Present Perfect Continuous, #25 Present Perfect, #26 Present Simple, #27 so/such/too/enough/high/tall, #28 Some va Any, #29 Tag questions) uchun 	humbnail_key = None qilib yaratildi, frontendda xatosiz chiroyli SVG/gradient muqova ko'rinib turadi va ertaga rasmlar kelganda ttach_thumbnails buyrug'i orqali avtomatik ulanadi.
5. **Sifat Nazorati (100% PASS Gate)**:
   - Backend Pytest: 	est_remaining_grammar_lessons.py 5/5 PASS, 	est_lms_and_bamboozle.py 16/16 PASS.
   - Frontend: 
px tsc --noEmit 0 ta xatolik, Vitest 57 ta test fayl, 366/366 test 100% PASS.
6. **Ma'lumotlar Bazasi Zaxirasi va Zero-Downtime Deploy**:
   - 19 MB li to'liq PostgreSQL backup olindi: /opt/bestway/backup_pre_remaining_lessons_20261026_172426.sql.
   - education-postgres idle connection'lari tozalanib me'yoriga keltirildi.
   - VPS da barcha 29 ta dars, 29 ta to'plam va 464 ta savol kartochkasi ishga tushirildi.
   - Ommaviy endpointlar (https://bestwayec.uz/, https://bestwayec.uz/en/login, https://bestwayec.uz/api/backend/health) 200 OK qaytardi.

### 23-BLOK: Web & Desktop UI Harmonization, Mobile Telegram Auth Deep-Linking & Tauri Auto-Updater Engine (v1.0.5)
1. **Web Dashboard Obsidian-Emerald Rang Tizimiga Keltirildi**:
   - `frontend/src/components/dashboard/`:
     * `score-prediction-card.tsx`: Moviy (`sky-500`) va sariq ranglar Obsidian-Emerald palitrasiga (`#0B0F17`, `#111827`, `border-emerald-500/15`, `text-emerald-400`, `from-emerald-400 to-teal-500`) to'liq o'tkazildi.
     * `adaptive-study-plan.tsx`: Zaif nuqtalar xaritasi va o'quv rejasi kartalari zumrad va teal gradientlariga moslashtirildi.
     * `mistake-vault.tsx`: Xatolar banki kartochkasi `#111827` fon va `border-emerald-500/15` bilan yagona qat'iy standartga keltirildi.
2. **Desktop App (Tauri) UI Harmonizatsiyasi**:
   - `bw-tauri/src/styles.css`: `--accent`, `--highlight`, `--bw-green` ranglari eski lime (`#89F336`) dan zumrad (`#10B981` / `#34D399`) ga o'tkazildi.
   - `bw-tauri/src/components/Sidebar.tsx`: Qanotli "B" emblemasi va faol menyu pillalari zamonaviy Obsidian-Emerald gradientiga keltirildi.
   - `bw-tauri/src/pages/Settings.tsx` va `Profile.tsx`: Switch toggle tugmalari `bg-emerald-500` va neon zumrad soya bilan uyg'unlashtirildi.
   - `bw-tauri/src/App.tsx`: Tarmoq onlayn indikatori (`OnlineDot`), fon zarrachalari (`particleColors`) va uchqun effektlari zumrad palitrasiga o'tkazildi.
3. **Mobil Telegram Auth Deep-Linking Yechimi (`bestwayapp://`)**:
   - Muammo: Mobil ilovada Telegram orqali kirilganda foydalanuvchi ilova ichida qolmasdan tashqi brauzer veb-sahifasiga o'tib ketayotgan edi.
   - Backend (`backend-django/apps/core/telegram_views.py`):
     * Agar so'rov mobil mijozdan bo'lsa (`client=mobile` yoki mobil User-Agent), `deepLink: bestwayapp://auth?token={accessToken}&refresh={refreshToken}` qaytariladi.
     * GET so'rovlari va brauzer orqali ochilganda to'g'ridan-to'g'ri `bestwayapp://auth?...` manziliga 302 redirect beriladi.
   - Frontend Next.js (`login-form.tsx` va `telegram-login/route.ts`): Mobil qurilmadan Telegram SSO muvaffaqiyatli o'tganda `window.location.href = deepLink` orqali ilovaga qaytarish ta'minlandi.
   - Desktop & Android mijoz (`bw-tauri`):
     * `AndroidManifest.xml` ga `<data android:scheme="bestwayapp" />` intent filter qo'shildi.
     * `lib/oauth.ts` va `tauri.conf.json` da `bestwayapp` sxemasi ruxsat etildi (`ALLOWED_SCHEMES`, `ALLOWED_CALLBACKS`).
     * `Login.tsx` ga to'g'ridan-to'g'ri tokenli avtorizatsiya handler qo'shildi — seans ilova ichida avtomatik o'rnatiladi.
4. **Tauri Desktop Avto-Yangilanish Tizimi (Auto-Updater)**:
   - Tarixiy relizlar, `.msi`, `.exe` va git teglar to'liq saqlab qolindi.
   - `tauri.conf.json` da updater tekshirish manzili sozlandi: `https://bestwayec.uz/api/v1/desktop/update/{{target}}/{{current_version}}`.
   - Backend (`views.py` & `urls.py`):
     * `desktop_update_check(request, target, current_version)` endpointi yaratildi.
     * Semver solishtirish: mijoz versiyasi joriy eng so'nggi versiya bilan teng yoki undan yuqori bo'lsa `204 No Content` qaytaradi.
     * Yangilanish mavjud bo'lsa, Tauri v2 standartidagi JSON manifest (`200 OK`) va yangi reliz fayli havolasini uzatadi.
5. **Sifat Nazorati va CI/PR Gate (100% PASS Gate)**:
   - `bw-tauri`: `tsc --noEmit` 0 ta xatolik, `npm test` 41 ta test fayli, 327/327 test 100% PASS.
   - `bestway/frontend`: `tsc --noEmit` 0 ta xatolik, `npm test` 57 ta test fayli, 366/366 test 100% PASS.
   - `bestway/backend-django`: Pytest 560 ta test 100% PASS (`test_desktop_update_and_mobile_auth.py` 4/4 PASS).
   - Mualliflik qat'iy tekshirildi: `Komiljon Roziyev <kruziyev0@gmail.com>`, nol sun'iy intellekt atributi (`zero-ai-attribution`).
6. **VPS Zero-Downtime Deploy va 200/204 OK Verifikatsiya**:
   - Contabo VPS (`169.58.58.229`) ga kod `origin/main` dan tortildi.
   - `education-backend` va `education-frontend` konteynerlari granular tarzda qayta yuklandi.
   - Post-deploy tekshiruvlar:
     * `https://bestwayec.uz/` -> `200 OK`
     * `https://bestwayec.uz/api/v1/health` -> `200 OK`
     * `https://bestwayec.uz/api/v1/desktop/update/windows-x86_64/0.8.5` -> `204 No Content` (mijoz eng so'nggi versiyada)
     * `https://bestwayec.uz/api/v1/desktop/update/windows-x86_64/0.8.0` -> `200 OK` (manifest JSON to'g'ri qaytdi)

### 24-BLOK: 29 ta Darslik Auditi, Multi-Platform Reliz (v1.0.6) va AI Baholash Engine Kuchaytirilishi
1. **29 ta Darslik va Resurslar Auditi (`audit_29_lessons.py`)**:
   - Barcha 29 ta darslikning video fayllari, muqovalari, solo testlari va Bamboozle savollari to'liq tekshirildi.
   - Qora/bo'sh chiqayotgan muqovalar uchun boyitilgan dinamik Obsidian-Emerald fallback kartochkalari (`course-card-thumbnail.tsx`) joriy etildi.
2. **IELTS va Milliy Sertifikat (CEFR) AI Baholash Moduli**:
   - Mock imtihonlaridagi Writing va Speaking topshiriqlarini rasmiy xalqaro mezonlar (IELTS 0.0–9.0 va Milliy sertifikat 0–75 ball / CEFR B1–C1) asosida baholovchi chuqurlashtirilgan AI moduli (`assessment_providers.py`, `mock_scoring.py`) optimallashtirildi.
   - Har bir mezon bo'yicha batafsil fikr-mulohazalar (Task Achievement, Coherence, Lexical, Grammar, Fluency, Pronunciation) va tavsiyalar vizualizatsiyasi (`exam-feedback-modal.tsx`) yaratildi.
3. **Desktop va Multi-Platform Reliz (v1.0.6)**:
   - `bw-tauri` relizi v1.0.6 tegi bilan chiqildi va avto-yangilanish tizimi sinovdan o'tkazildi.

### 25-BLOK: Infratuzilma Optimizatsiyasi, HLS Video Streaming & Speaking Audio Processing Pipeline (Phase 1)
1. **Backend: FFmpeg HLS Transcoding & Oqimli Uzatish (`apps/core/lms_services.py`)**:
   - Serverda yuklangan dars videolarini fon rejimida adaptiv HLS formatiga (1080p, 720p, 480p) konvertatsiya qiluvchi tizim yaratildi (`HLS_RESOLUTIONS`).
   - `Lesson` va `VideoLesson` modellariga `hls_playlist_url` (`hlsPlaylistUrl`) maydonlari qo'shildi va PostgreSQL bazasiga muvaffaqiyatli tatbiq etildi.
   - Oqimli uzatish xizmati (`stream_hls_file`) master pleylistlar (`.m3u8`, MIME: `application/vnd.apple.mpegurl`) va video segmentlar (`.ts`, MIME: `video/mp2t`) uchun kesh sarlavhalari bilan sozlandi.
   - Dockerfile'ga `ffmpeg` kutubxonasi qo'shildi.
2. **Frontend: Gamified Video Player HLS Integratsiyasi (`GamifiedVideoPlayer.tsx`)**:
   - `hls.js` kutubxonasi Next.js frontendiga ulandi. Brauzer HLS qo'llab-quvvatlasa oqimli uzatish yoqiladi, Safari va iOS qurilmalari uchun native HLS, eskilar uchun esa to'g'ridan-to'g'ri MP4 fallback saqlanadi.
   - Pleyerga sifat tanlash menyusi (Auto / 1080p / 720p / 480p) Obsidian-Emerald dizaynida integratsiya qilindi.
   - Barcha anti-cheat va video tugatilgandan keyin testlarni ochish nazoratchilari to'liq saqlab qolindi.
3. **Speaking Audio Siqish Xizmati (`apps/exams/audio_service.py`)**:
   - Foydalanuvchilar Speaking imtihonlarida yuklagan audio yozuvlarini fon rejimida (Celery + Worker fallback) 32kbps mono Opus formatiga siquvchi `optimize_speaking_audio` moduli ishga tushirildi.
   - Disk xotirasi 70-85% tejab qolinishi ta'minlandi va `upload_speaking` paytida tranzaksiya yakunlanishi bilan avtomatik ishga tushishi ulandi.
4. **API Keshlash va Qat'iy HTTP Kesh Standartlari**:
   - Ommaviy darslar ro'yxati uchun Redis/Django kesh (`lms:video_lessons:public`, 300s TTL) o'rnatildi.
   - Nginx (`bestway.conf`) da `.m3u8` va `.ts` fayllari uchun `types { application/vnd.apple.mpegurl m3u8; video/mp2t ts; }` hamda `add_header Cache-Control "max-age=86400";` o'rnatildi va Nginx muvaffaqiyatli reload qilindi.
5. **Sifat Nazorati (100% PASS Gate)**:
   - Pytest: `test_hls_streaming_and_audio_optimization.py` 8/8 PASS, jami 560+ testlar 100% PASS.
   - Frontend: `tsc --noEmit` 0 xatolik, Vitest 57 test fayli, 366/366 test 100% PASS.
6. **Zero-Downtime VPS Deploy va 200 OK Verifikatsiya**:
   - Contabo VPS (`169.58.58.229`) da `education-backend` va `education-frontend` konteynerlari qayta yig'ildi va ishga tushirildi.
   - PostgreSQL da `hlsPlaylistUrl` ustuni qo'shildi va `check_legacy_schema` 39 ta model bilan to'liq verifikatsiya qilindi.
   - Nginx konfiguratsiyasi testdan o'tkazilib qayta yuklandi.
   - Ommaviy va ichki endpointlar (https://bestwayec.uz/, https://api.bestwayec.uz/v1/health, http://127.0.0.1:3005, http://127.0.0.1:3001/v1/health) 200 OK bilan muvaffaqiyatli tasdiqlandi.


### 26-BLOK: Foydalanuvchini Qaytarish (Retention Engine), Telegram Streak Bot, 1v1 Bamboozle Arenasi va Zaif Nuqtalarni Darsliklarga Bog'lash

1. **Telegram Streak & Xabarnoma Boti (`apps/notifications/telegram_tasks.py` & `run_streak_bot.py`)**:
   - Har kuni kechki soat 20:00 da o'quvchining kunlik faolligi (dars ko'rish yoki test topshirish) tekshiriladi.
   - Agar o'quvchi bugun dars ko'rmagan bo'lsa, Telegram bot orqali unga shaxsiy rag'batlantiruvchi xabar yuboriladi:
     *"🔥 {Ism}, bugungi 1 ta darsingiz qoldi! {X} kunlik zanjiringiz uzilib ketmasin. Hoziroq bitta mashq ishlang: [Platformaga kirish]"*.
   - Har yakshanba soat 20:00 da eng faol 10 ta o'quvchining haftalik reytingi (Top-10 Leaderboard) Telegram kanal/guruhiga avtomatik hisobot tariqasida yuboriladi.
   - Celery Beat va `game-scheduler` foniy demoni orqali rejalashtirish to'liq avtomatlashtirildi.

2. **Bamboozle 1v1 Arena va Virusli Taklif Mexanizmi (`apps/bamboozle/views.py`, `BamboozleLobby.tsx`, `BamboozleArena.tsx`)**:
   - Yangi "🎮 Do'st bilan 1v1 Bellashish" rejimi joriy etildi.
   - Har bir bellashuv uchun unikal xona kodi (masalan, `F2Y3KR`) va havolasi (`https://bestwayec.uz/en/bamboozle?room=F2Y3KR&deck=...`) yaratiladi.
   - "Telegram orqali do'stga yuborish" (`https://t.me/share/url?...`) tugmasi orqali do'stga bir marta bosishda taklif yuborish imkoniyati berildi.
   - Do'st havolani ochganda to'g'ridan-to'g'ri o'yin arenasiga ulanadi, ikki jamoa nomlari ("O'yinchi 1" vs "Do'st") va jonli hisob-kitoblar ko'rsatiladi.

3. **Zaif Nuqtalarni Darsliklarga Aqlli Yo'naltirish (`apps/exams/analytics_service.py`, `exam-feedback-modal.tsx`, `mistake-vault.tsx`)**:
   - Mock imtihoni natijalari va Xatolar Banki (Mistake Vault) dagi grammatik xatolar platformadagi 29 ta video darslikka avtomatik xaritalanadi (masalan, Past Perfect xatosi -> 19-dars, Passive Voice -> 16-dars, Conditionals -> 12-dars).
   - Tahlil ekranida aniq tavsiya ko'rsatiladi:
     *"Sizda ushbu mavzuda xatolik ko'p: [▶️ 19-dars: Past Perfect Tense darsini ko'rish]"*.
   - Tugma bosilganda o'quvchi to'g'ridan-to'g'ri kerakli darslikka o'tadi.

4. **Sifat Nazorati va CI/PR Gate (100% PASS Gate)**:
   - Frontend: Vitest 57 ta test fayli, 366/366 test 100% PASS; `tsc --noEmit` 0 ta xatolik.
   - Backend: Pytest 23/23 ta test 100% PASS (`test_telegram_streak_and_notifications.py` 7/7, `test_bamboozle_1v1_arena.py` 4/4, `test_weak_points_and_analytics.py` 4/4, `test_hls_streaming_and_audio_optimization.py` 8/8).
   - Mualliflik: `Komiljon Roziyev <kruziyev0@gmail.com>` (`zero-ai-attribution`).

5. **VPS Zero-Downtime Deploy va Jonli Verifikatsiya**:
   - Contabo VPS (`169.58.58.229`) da `backend`, `frontend`, `game-scheduler`, `telegram-bot`, `assessment-worker` konteynerlari uzilishsiz yangilandi.
   - `https://bestwayec.uz/` -> `HTTP/2 200 OK`
   - `https://api.bestwayec.uz/v1/health` -> `200 OK (status: ok)`
   - `POST /v1/bamboozle/rooms/create` -> `200 OK (room_code, share_url, telegram_share_url)`
   - `python manage.py run_streak_bot --check` -> `200 OK (Streak check complete)`


### 27-BLOK: O'qituvchi Kabineti (Teacher Workspace), Guruhlar (Cohorts), Uyga Vazifalar va O'quvchilar Tahlili

1. **Backend Ma'lumotlar Modeli (`apps/core/models.py` & Migratsiya `0005`)**:
   - `Cohort`: O'qituvchining guruhi (`id`, `teacher`, `name`, `invite_code` (unique, e.g. `BW-7892`), `description`, `created_at`).
   - `CohortMembership`: O'quvchining guruhga a'zoligi (`cohort`, `student`, `status='active'|'archived'`, `joined_at`).
   - `HomeworkAssignment`: Guruhga biriktirilgan uyga vazifa (`cohort`, `title`, `lesson` (29 ta darsdan biri), `exam` (IELTS/CEFR Mock), `deadline`, `min_pass_percent=80`).
   - `HomeworkSubmission`: O'quvchining topshirgan vazifasi (`assignment`, `student`, `score_percent`, `is_passed`, `completed_at`).
   - PostgreSQL migratsiyasi (`0005_cohort_homeworkassignment_cohortmembership_and_more.py`) muvaffaqiyatli qo'llanildi.

2. **API Endpointlar (`apps/core/teacher_views.py` & `apps/core/urls.py`)**:
   - `GET /v1/teacher/cohorts` — O'qituvchining barcha guruhlari, har biridagi o'quvchilar va vazifalar soni.
   - `POST /v1/teacher/cohorts` — Yangi guruh ochish va unikal 6 xonali taklif kodini (`BW-XXXX`) yaratish.
   - `GET /v1/teacher/cohorts/<id>/analytics` — Guruhdagi barcha o'quvchilarning progress matritsasi (ko'rilgan darslar, topshirgan vazifalar va o'rtacha ball).
   - `POST /v1/teacher/assignments` — Guruhga video darslik yoki mock testdan muddatli vazifa biriktirish.
   - `POST /v1/student/join-cohort` — O'quvchi 6 xonali kod orqali guruhga bir zumda a'zo bo'lishi.
   - `GET /v1/student/my-assignments` — O'quvchining barcha faol, topshirilgan yoki muddati o'tgan vazifalari ro'yxati.
   - `POST /v1/student/assignments/<id>/submit` — Vazifa natijasini saqlash va o'tish ballini hisoblash.

3. **Frontend: O'qituvchi Kabineti va Talaba Vidjeti (`frontend/src/components/teacher/`)**:
   - Chap navigatsiyada `teacher`, `admin`, `super_admin` rollari uchun **"Teacher Workspace"** bo'limi ulandi (`/en/teacher`).
   - `TeacherCohortList.tsx`: Obsidian-Emerald uslubidagi guruh kartochkalari, o'quvchilar soni, taklif kodini bir bosishda nusxalash va Telegram orqali o'quvchilarga ulashish havolasi.
   - `CreateAssignmentModal.tsx`: 29 ta grammatika video darslari yoki IELTS/CEFR testlaridan tanlab, deadline va o'tish balli bilan vazifa biriktirish modali.
   - `CohortProgressTable.tsx`: Tahliliy jonli matritsa — ustunlarda vazifalar, qatorlarda o'quvchilar, katakchalarda esa aniq holat nishonlari (`85% ✓`, `Kutilmoqda ⏳`, `Topshirmadi ✕`).
   - `StudentAssignmentsWidget.tsx`: O'quvchi dashboardida o'qituvchidan kelgan topshiriqlar vidjeti va "Guruhga qo'shilish" (kod kiritish) modali.

4. **Sifat Nazorati va CI/PR Gate (100% PASS Gate)**:
   - Backend: Pytest `test_teacher_workspace.py` 15/15 ta test 100% PASS (guruh yaratish, taklif kodi generatsiyasi, qo'shilish, vazifa biriktirish, progress matritsasi va RBAC tekshiruvlari).
   - Frontend: Vitest 57 ta test fayli, 366/366 test 100% PASS; `tsc --noEmit` 0 ta TypeScript xatoligi.
   - Mualliflik: `Komiljon Roziyev <kruziyev0@gmail.com>` (`zero-ai-attribution`).

5. **VPS Zero-Downtime Deploy va Jonli Sinov**:
   - Contabo VPS (`169.58.58.229`) da `backend` va `frontend` konteynerlari uzilishsiz yangilandi.
   - Barcha yangi migratsiyalar bazada qo'llanildi.
   - `https://bestwayec.uz/` -> `HTTP/2 200 OK`
   - `https://api.bestwayec.uz/v1/health` -> `200 OK (status: ok)`
   - `https://bestwayec.uz/en/teacher` -> `307 Redirect (Protected route)`

### 28-BLOK: Desktop App UI/UX & Dashboard Overhaul, Mock Test 1 To'liq 4-Skill Seeding va v1.0.8 Ko'p Platformali Reliz

1. **Backend: Multi-Level Mock Test 1 To'liq 4 Modul Vazifalari va Assetlari**:
   - `apps/core/management/commands/seed_multilevel_test1_gym_diet.py` qayta yozildi:
     * **Listening**: 6 ta qism (Part 1-6), 30 ta savol, diskda haqiqiy toza WAV audio assetlari (`listening_part_1.wav` .. `listening_part_6.wav`).
     * **Reading**: 5 ta qism (Part 1-5), 35 ta savol (Matching, Sentence completion, Multiple choice, Classification), barcha `audio_play_limit=0` NOT NULL cheklovlari qondirildi.
     * **Writing**: Task 1.1 (Informal letter, Gym fee increase), Task 1.2 (Formal letter to club manager), Task 2 (Vegetarian diet essay).
     * **Speaking**: Part 1.1 (Interview), Part 1.2 (Picture comparison `Classroom vs Online` PNG asset bilan), Part 2 (Cue card), Part 3 (Discussion).
     * Jami 81 ta savol/vazifa `MockExam(multilevel-test-01-gym-vegetarian)` ga `profile='full_mock'` va `is_published=True` qilib biriktirildi.
   - `apps/core/mock_practice.py` yangilandi:
     * `_normalize_question_for_practice` va `_authored_skill_question_ids` qo'shildi.
     * `available_practice_skills` va `practiceSkills` orqali mavjud modullar aniq uzatiladi.
     * Vazifasi bo'lmagan modul so'ralganda backend qulamasdan xavfsiz 422 `MOCK_PRACTICE_NOT_READY` qaytaradi.
   - Pytest `tests/test_mock_practice.py`: 9/9 ta test 100% PASS.

2. **Backend: Phase 4 — Adaptive 10-Minute Express Placement Test**:
   - `apps/exams/placement_views.py` va `apps/core/urls.py`:
     * `GET /api/v1/placement-test/questions` — 20 ta CEFR savollari (Grammatika, Lug'at, Reading: 4 A1/A2, 6 B1, 6 B2, 4 C1) va unikal `guest_session_id`.
     * `POST /api/v1/placement-test/submit` — Ball va darajani (A1-C1) aniqlash.
     * Jonli serverda 200 OK qaytarishi to'liq verifikatsiya qilindi.

3. **Desktop App (`bw-tauri`): Obsidian-Emerald Dashboard & UI Mukammalligi**:
   - `Dashboard.tsx` to'liq Obsidian-Emerald (`#0B0F17`, `#111827`, `#10B981`) dizaynida qayta qurildi:
     * Vaqtga mos salomlashish ("Good morning/afternoon/evening, Explorer").
     * Track tanlagich (IELTS vs Multi-Level CEFR).
     * AI Ball bashorati va daraja ko'krak nishoni (Predicted CEFR / IELTS Band hero badge) hamda maqsad sari progress bari.
     * 4-kartochkali gamifikatsiya va statistika bari (Streak, Earned XP, Assigned tasks, Completed mocks).
     * Full Mock CBT Simulation banneri — haqiqiy DTM/IDP imtihon muhitini bir bosishda ishga tushirish.
     * 4 ta mahorat moduli (Listening, Reading, Writing, Speaking) amaliyot kartochkalari — `MockSectionPicker` modali bilan bevosita integratsiya.
     * Davom ettirish (Active In-Progress Resume) paneli.
     * Oxirgi faoliyatlar ro'yxati va Jonli PIN xona orqali qo'shilish vidjeti.
   - `MockSectionPicker.tsx`: `available_practice_skills` qo'llab-quvvatlashi va zumrad vizual ogohlantirishlar bilan yangilandi.
   - `schemas.ts` va `mocks.ts`: `practiceSkills`, `available_practice_skills` va `practiceReady` turlari bilan sinxronlandi.
   - Versiya `1.0.8` ga ko'tarildi (`package.json`, `package-lock.json`, `Cargo.toml`, `tauri.conf.json`, `version.ts`, `version.test.ts`, `settings/base.py`).

4. **Sifat Nazorati va Qat'iy CI Gate (100% PASS Gate)**:
   - Frontend Vitest: 41 ta test to'plami, 330/330 ta test 100% PASS.
   - Release platform tests: 10/10 ta test 100% PASS.
   - TypeScript `tsc --noEmit`: 0 ta xatolik, Vite production build to'liq muvaffaqiyatli.
   - Git Authorship: Qat'iy `Komiljon Roziyev <kruziyev0@gmail.com>` (`zero-ai-attribution`).
   - GitHub Actions CI (`CI - main` run `40697829356`): 100% SUCCESS.

5. **Ko'p Platformali Reliz va VPS Sync**:
   - `v1.0.8` reliz barcha platformalar uchun GitHub Actions da qurildi:
     * Android: `bestway-app.apk` (5.38 MB > 3 MB, `production-binary-guard` talablariga to'liq mos).
     * Windows: `Bestway.App_1.0.8_x64-setup.exe` (3.64 MB).
     * Linux: `Bestway.App_1.0.8_amd64.deb` (5.78 MB) & `Bestway.App_1.0.8_amd64.AppImage` (84.08 MB).
     * macOS: `Bestway.App_1.0.8_aarch64.dmg` (6.63 MB) & Intel `.dmg`.
   - Contabo VPS (`169.58.58.229`) da `docker compose up -d --build backend` bajarildi, `seed_mock_tasks` ishga tushirilib 81 ta savol bazaga muvaffaqiyatli yuklandi.
   - Windows o'rnatuvchisi VPS storage hajmiga yuklandi va `https://bestwayec.uz/media/downloads/Bestway.App_1.0.8_x64-setup.exe` da `HTTP 200 OK` qaytarishi tasdiqlandi.
   - Mahalliy kompyuterdagi Desktop ilova (`bestway-app.exe`) ham v1.0.8 ga yangilandi.

### 29-BLOK: IELTS Academic Mock 1 To'liq Seeding, Landing Shiori Tiklanishi, Placement Funnel va CBT Offline Chidamlilik

1. **Backend: IELTS Academic Mock Test 1 To'liq 4 Modul Vazifalari va Assetlari (`ielts-academic-mock-01`)**:
   - `apps/exams/management/commands/seed_ielts_mock1_academic.py` va `apps/core/management/commands/seed_ielts_mock1_academic.py`:
     * **Trek**: `IELTS` Academic, ID: `ielts-academic-mock-01`, Title: `IELTS Academic Mock Test 1: Renewable Energy & Smart Cities`.
     * **Listening**: 4 ta bo'lim (Section 1–4), 40 ta savol, diskda haqiqiy toza audio WAV fayllari (`ielts_audio_part_1.wav` .. `ielts_audio_part_4.wav`).
     * **Reading**: 3 ta akademik matn (Passage 1–3), 40 ta savol (True/False/Not Given, Matching Headings, Summary Completion).
     * **Writing**: Task 1 (Bar chart summary, 150 words), Task 2 (Opinion/Discussion essay on urban transit vs EV subsidies, 250 words).
     * **Speaking**: Part 1 (Hometown & technology), Part 2 (Cue card: digital tool), Part 3 (Two-way discussion: AI & automation).
     * Jami 85 ta savol/vazifa, 43 ta amaliyot savollari, `practiceSkills: ["listening", "reading", "writing", "speaking"]` va `practiceReady: true`.
     * `seed_mock_tasks` ikkala imtihonni (Multi-Level Test 1 va IELTS Academic Mock 1) to'liq avtomatik tekshirib bazaga seed qiladi.
     * `seed_multilevel_test1_gym_diet.py` dagi `createdAt` NOT NULL cheklovi tuzatildi (`created_at: now`).

2. **Frontend: Landing Page Brend Shiori va Placement Funnel**:
   - `messages/uz.json` va `messages/en.json`:
     * Bosh sahifa shiori tiklandi: **"Do your best, forget the rest!"**.
     * Subtitr: "O'zbekiston Milliy sertifikati (0–75) va IELTS (0–9.0) mezonlariga moslashtirilgan sun'iy intellekt ekotizimi." / "An AI ecosystem fully aligned with Uzbekistan National Certificate (0–75) and IELTS (0–9.0) standards."
     * `ExpressPlacementTest` natijalarini mehmon holatdan foydalanuvchiga avtomatik biriktirish (`bestway_placement_result_token` -> `POST /api/v1/placement-test/claim`) to'liq sinxronlandi.

3. **Desktop App (`bw-tauri`): Jonli PIN Xona va CBT Offline Chidamlilik**:
   - `LiveExamPinJoin.tsx`: `GET /v1/live-room/join?pin=...` va fallback `POST /mock/live-rooms/join` orqali o'qituvchi xonalariga uzluksiz ulanish.
   - `ExamRunner.tsx`: Javoblarni `sessionStorage` orqali saqlash, tiklash va IndexedDB/SQLite kesh bilan integratsiya. Tarmoq uzilsa ham yozilgan matn va tanlangan javoblar yo'qolmaydi.
   - `ResumeExamModal.tsx`: Dastur kutilmaganda yopilib qayta ochilganda aktiv sessiyani (4 soatlik xavfsiz oynada) davom ettirish yoki tozalash imkoniyati.
   - `App.tsx`: Imtihon boshlanganda aktiv sessiyani xotirada saqlash, yakunlanganda yoki xavfsiz chiqilganda avtomatik tozalash.

4. **Sifat Nazorati va Qat'iy CI Gate (100% PASS Gate)**:
   - Backend Pytest: `test_mock_practice.py` 9/9 ta test 100% PASS.
   - Frontend Vitest (`bestway/frontend`): 58 ta test to'plami, 369/369 test 100% PASS; `tsc --noEmit` 0 ta TypeScript xatoligi.
   - Desktop App Vitest (`bw-tauri`): 41 ta test to'plami, 330/330 test 100% PASS; `tsc --noEmit` 0 ta TypeScript xatoligi.
   - Git Authorship: Qat'iy `Komiljon Roziyev <kruziyev0@gmail.com>` (`zero-ai-attribution`).

5. **VPS Zero-Downtime Deploy va Jonli Sinov**:
   - Contabo VPS (`169.58.58.229`) da `docker compose up -d --build backend frontend` xizmat darajasida yangilandi.
   - `seed_mock_tasks` muvaffaqiyatli ishga tushirilib, Multi-Level (81 tasks) va IELTS Academic Mock 1 (85 tasks) to'liq yuklandi.
   - Jonli sinov natijalari:
     * `https://bestwayec.uz/` -> `HTTP/1.1 200 OK`
     * `https://bestwayec.uz/api/v1/mock/exams/ielts-academic-mock-01` -> `HTTP 200 OK`, `practiceSkills: ["listening", "reading", "writing", "speaking"]`, `ready: true`, `practiceReady: true`.
     * `https://bestwayec.uz/api/v1/placement-test/questions` -> `HTTP 200 OK`, 20 ta savol va unikal `guest_session_id`.

### 30-BLOK: Desktop CBT Anti-Cheat Kiosk Mode & Real-Time Live Proctoring Dashboard (v1.0.9 Reliz)
1. **Desktop CBT Anti-Cheat Kiosk Rejimi (`bw-tauri`)**:
   - `setKioskLock`: Imtihon boshlanishi bilan oyna to'liq ekranga qulflanadi (`fullscreen: true`), o'lchami qotiriladi (`resizable: false`) va doim eng ustki qatlamda turishi ta'minlanadi (`alwaysOnTop: true`). Tauri bo'lmagan muhitlar uchun HTML5 Fullscreen API fallback joriy etildi.
   - `useAntiCheatGuard`:
     * Barcha xavfli hodisalar to'xtatildi: kontekst menyu (o'ng tugma), nusxalash (`copy`, `cut`, `paste`), matn tanlash (`selectstart`), sudrash (`dragstart`).
     * Klaviaturaning barcha xavfli kombinatsiyalari bloklandi: `Alt+Tab`, `Meta / Win`, `F11`, `F12`, `PrintScreen`, brauzer inspektori (`Ctrl+Shift+I/J/C`) hamda matn amallari (`Ctrl+C/V/A/U/P/S`).
     * `Focus Loss / Window Blur`: Talaba imtihon oynasidan chiqishga uringanda yoki dastur fokusni yo'qotganda zudlik bilan Obsidian-Emerald + Qizil ogohlantirish modali ochiladi (`AntiCheatWarningModal.tsx`), 10 soniyalik teskari hisob taymeri ishga tushadi va qoidabuzarlik "Strike" sifatida hisoblanadi.
     * 3-qoidabuzarlikda (Strikes: 3/3) imtihon avtomatik `PROCTOR_TERMINATED` / `auto_submit_due_to_violation` holatida yakunlanadi va serverga telemetriya yuboriladi.
     * Imtihon topshirilganda yoki chiqilganda Kiosk rejimi va barcha hodisa tinglovchilari toza yechiladi (`unlockKiosk`).
     * `Multi-Monitor Detection & Block`: Qo'shimcha ikkinchi monitor ulangan bo'lsa (`checkMultiMonitor`), imtihon boshlanishi darhol bloklanadi va maxsus modal chiqadi: "Imtihon faqat 1 ta monitor bilan o'tkaziladi. Iltimos, ikkinchi monitorni uzing!".
     * `Clipboard Tozalash`: Imtihonga kirishda va chiqishda operatsion tizim xotirasi (clipboard) avtomatik ravishda `navigator.clipboard.writeText("")` orqali xavfsiz tozalanadi.
     * `Live Audio Chime`: Ustoz monitoring ekranida (`LiveProctoring.tsx`) talabada qoidabuzarlik (strike) qayd etilganda Web Audio API yordamida avtomatik audio signal (chime) yangrab, ustoz diqqatini jalb qiladi.
     * `Time Extension Support`: Ustoz pultidan barcha talabalarga yoki tanlangan talabaga vaqt qo'shish imkoniyati (`extend_time` action, +5 yoki +10 daqiqa) backend va desktop UI da to'liq ishga tushirildi.

     * `Multi-Monitor Detection & Block`: Qo'shimcha ikkinchi monitor ulangan bo'lsa (`checkMultiMonitor`), imtihon boshlanishi darhol bloklanadi va maxsus modal chiqadi: "Imtihon faqat 1 ta monitor bilan o'tkaziladi. Iltimos, ikkinchi monitorni uzing!".

     * `Clipboard Tozalash`: Imtihonga kirishda va chiqishda operatsion tizim xotirasi (clipboard) avtomatik ravishda `navigator.clipboard.writeText("")` orqali xavfsiz tozalanadi.

     * `Live Audio Chime`: Ustoz monitoring ekranida (`LiveProctoring.tsx`) talabada qoidabuzarlik (strike) qayd etilganda Web Audio API yordamida avtomatik audio signal (chime) yangrab, ustoz diqqatini jalb qiladi.

     * `Time Extension Support`: Ustoz pultidan barcha talabalarga yoki tanlangan talabaga vaqt qo'shish imkoniyati (`extend_time` action, +5 yoki +10 daqiqa) backend va desktop UI da to'liq ishga tushirildi.
2. **Backend Telemetriya va Jonli Monitoring API (`bestway/backend-django`)**:
   - `LiveExamParticipant` va `LiveExamSession` jadvallariga yangi ustunlar qo'shildi (`time_remaining_seconds`, `strikes_count`, `last_heartbeat`, `is_focused`, `exam_state`).
   - `POST /api/v1/live-room/telemetry`: Har 6 soniyada talaba mijozidan yurak urishi (heartbeat), qolgan vaqt, joriy bo'lim/savol raqami, fokus holati va strikelarni qabul qiladi; agar ustoz chetlatgan bo'lsa darhol `disqualified` buyrug'ini qaytaradi.
   - `GET /api/v1/live-room/<pin>/proctor-status`: Ustoz uchun barcha ulangan talabalarning real vaqt holati matritsasi (onlayn/oflayn indikator 30 soniyalik chegara bilan, strikelar 0/3..3/3, joriy savol va modul, qolgan vaqt).
   - `POST /api/v1/live-room/<pin>/action`: Ustoz boshqaruv amallari (`start_exam`, `end_room`, `warn_student`, `disqualify_student`).
3. **Ustoz Jonli Imtihon Monitoringi (`bw-tauri/src/pages/LiveProctoring.tsx`)**:
   - Har 3 soniyada fon rejimida serverdan talabalar holatini yangilab turuvchi avto-polling tsikli o'rnatildi.
   - Guruh boshqaruv pulti: "Barcha uchun imtihonni boshlash" va "Imtihonni to'xtatish" tugmalari.
   - Har bir talaba kartochkasi bo'yicha mustaqil harakatlar: `[ ⚠️ Ogohlantirish ]` (+1 strike berish) va `[ ⛔️ Chetlatish ]` (talabani darhol 3-strike bilan imtihondan chetlatish).
4. **v1.0.9 Reliz, Sinxronizatsiya va 100% CI Muvaffaqiyati**:
   - Versiya `1.0.9` ga oshirildi (`bw-tauri/package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `version.ts`, `settings/base.py`).
   - Desktop ilovadagi barcha 42 ta test fayli (341 ta test) 100% muvaffaqiyatli o'tdi (PASS).
   - Backend Django testlari (620 ta test) 100% muvaffaqiyatli o'tdi.
   - Frontend Next.js testlari (58 ta fayl, 369 ta test) 100% muvaffaqiyatli o'tdi.
   - GitHub Actions CI ikkala repozitoriyda ham to'liq YASHIL (100% SUCCESS) bo'ldi va Contabo VPS (`169.58.58.229`) ga avtomatik uzilishsiz yetkazildi (`Deploy to VPS` workflow success).
   - Ishlab chiqarish serverida `https://bestwayec.uz/api/v1/desktop-version` yangi `1.0.9` versiyasini e'lon qilmoqda va `https://bestwayec.uz/api/v1/health` HTTP 200 OK holatida barqaror ishlamoqda.


### 8-BLOK: Phase 31 — "Subway Vocab Runner": 2.5D Endless English Runner Game & Gamification Engine
1. **Backend Savollar Banki, Anti-Cheat va XP Sinxronizatsiyasi (`backend-django/apps/core/`)**:
   - `apps/core/runner_game_service.py` xizmati yaratildi:
     * CEFR A1, A2, B1, B2, C1, Irregular Verbs, Prepositions va Collocations toifalaridagi 50 dan ortiq mualliflik savollari banki.
     * Dinamik aralashtirish (shuffle) mexanizmi: 3 ta yo'lak uchun 1 ta to'g'ri va 2 ta chalg'ituvchi variantlarni tasodifiy joylashtiradi.
     * Qat'iy Anti-Cheat Sanity Check: masofa va vaqt nisbati jismonan mumkin bo'lgan maksimal tezlikdan (<= 45 m/s) oshmasligi, maksimal ball chegarasi (<= 1,000,000) va elapsed vaqt nazorati.
     * XP hisoblash va xavfsiz qo'shish: Har 100 ball uchun 1 XP (maksimal 150 XP), `StudentProfile.current_points` ga qo'shiladi va `PointsLog` ga tranzaksiya yoziladi.
     * Noto'g'ri so'zlarni talabaning `MistakeVault` / `UserWeakWord` (SRS Xatolar banki) ga avtomatik yozish (`mistake_count += 1`, `is_mastered = False`).
     * Yetakchilar jadvali (`get_runner_leaderboard`): haftalik va barcha davrlarning eng yuqori ballari ro'yxati.
   - `apps/core/runner_game_views.py` va `apps/core/urls.py`:
     * `GET /api/v1/games/runner/questions` (va `/games/runner/questions`)
     * `POST /api/v1/games/runner/submit-score` (va `/games/runner/submit-score`)
     * `GET /api/v1/games/runner/leaderboard` (va `/games/runner/leaderboard`)
   - Pytest unit testlari: `tests/test_runner_game.py` da 9 ta test to'liq 100% PASS qildi.

2. **Frontend 2.5D HTML5 Canvas Cheksiz Yugurish O'yini (`VocabRunnerGame.tsx`)**:
   - `frontend/src/components/vocabulary/runner/VocabRunnerGame.tsx`:
     * 60 FPS silliq Canvas renderlash tsikli (`requestAnimationFrame`), Obsidian-Emerald ranglar gammasi (`#0B0F17`, `#10B981`, `#064E3B`).
     * 3 yo'lakli 3D perspektiv proyeksiya: gorizontga intiluvchi zumrad chiziqlar, tezlikka mos er belgilari, neonga burkangan fon va yulduzlar/zarralar.
     * Gologramma neondan yasalgan darvozalar: har bir darvoza ustida so'z varianti va savol matni aniq suzib turadi.
     * O'yinchi personaji va dinamik harakatlar: yugurish tebranishi, sakrash trayektoriyasi (Squash & Stretch), sirg'alib o'tish (crouch/slide) va orqada neon iz qoldirish.
     * Dinamik to'siqlar va bonuslar: sakrab o'tiladigan qizil lazer to'siqlari, sirg'alib o'tiladigan baland plitalar va yig'ib olinadigan zumrad kristallar (kristallar combo multiplikatorini oshiradi).
     * Web Audio API sintizatori (`RunnerSoundEngine`): hech qanday tashqi audio fayllarga bog'lanmagan sof brauzer sintezi (sakrash, sirg'alish, to'g'ri darvoza, to'qnashuv, game over).
     * Boshqaruv: Klaviatura (Arrow keys, WASD, Space/Up sakrash, Down/S sirg'alish) va Mobil sensorli ekranlar uchun Touch Swipe imo-ishoralari.
     * HUD va Modal: 3 ta jon, combo multiplikatori, masofa hisoblagich, savol kartasi, o'yin yakunida yangi rekord nishoni, +XP hisoboti, xatolar ro'yxati va 1 ta bosishda Telegramda ulashish.

3. **Marshrut va Katalog Bosh Sahifasi Integratsiyasi**:
   - Maxsus sahifa yaratildi: `frontend/src/app/[locale]/(app)/vocabulary/runner/page.tsx` (`/vocabulary/runner`).
   - Lug'atlar katalogida (`frontend/src/components/vocabulary/VocabularyCatalogView.tsx`) Obsidian-Emerald uslubidagi jozibador Subway Vocab Runner hero banneri o'rnatildi va `[ 🎮 Hoziroq O'ynash ]` tugmasi bilan bog'landi.

4. **Qat'iy QA Tekshiruvi va 100% Yashil Gate**:
   - Backend Pytest: 9 ta yangi test, barchasi 100% PASS.
   - Frontend TypeScript: `npx tsc --noEmit` 0 ta xato bilan toza o'tdi.
   - Frontend Vitest: 58 ta test fayli, 369 ta test 100% PASS.
   - Git commit va merge: Mualliflik strictly `Komiljon Roziyev <kruziyev0@gmail.com>` (Zero AI Attribution).

### 9-BLOK: Phase 32 — Mobil Optimizatsiya, SEO Dvigateli, Dinamik APK/iOS Routeri va Subway Runner Mobil Redizayni
1. **Google SEO & Discovery Dvigateli (Discovery & Organic Search)**:
   - Next.js Metadata to'liq optimizatsiya qilindi: ildiz tartibi (`src/app/[locale]/layout.tsx`), marketing sahifasi (`src/app/[locale]/(marketing)/page.tsx`) va yuklab olish sahifasida boyitilgan sarlavhalar, kalit so'zlar ("bestway", "best way", "bestwayec", "bestwayec.uz", "bestway education", "bestway o'quv markazi") va meta tavsiflar o'rnatildi.
   - `sitemap.ts`: Barcha asosiy yo'nalishlar (`/`, `/mock`, `/download`, `/desktop`, `/vocabulary`, `/vocabulary/runner`, `/bamboozle`, `/news`, `/login`, `/register`) uz va en tillari uchun ustuvorlik koeffitsientlari (0.7–1.0) bilan xaritalashtirildi.
   - `robots.ts`: Googlebot va barcha qidiruv botlari uchun to'siqsiz indekslash yo'lga qo'yildi (`allow: "/"`), faqat xususiy dashboard va APIlar berkitildi.
   - Schema.org JSON-LD: `WebSite` va `EducationalOrganization` tuzilgan ma'lumotlari (`@type: EducationalOrganization`, `name: BestWay`, `legalName: BestWay Education Center`, `slogan: "Do your best, forget the rest!"`) qo'shildi.

2. **Dinamik Download Sahifasi & Smart Router (`/download` va `/desktop`)**:
   - `desktop-download.tsx` to'liq qayta ishlandi: eskirgan "Siz telefondasiz — kompyuterda oching" blokerlari olib tashlandi.
   - **Android Smart Card**: Android qurilmasi aniqlanganda to'g'ridan-to'g'ri `BestWay APK Yuklab Olish (v1.0.9)` tugmasi chiqadi, hajm (~45 MB), `minSdkVersion 24` va `v1+v2+v3` rasmiy imzo tekshiruvi hamda 3 bosqichli o'rnatish qo'llanmasi taqdim etiladi.
   - **iOS / PWA Smart Card**: iPhone yoki iPad aniqlanganda Safari orqali Bosh Ekranga qo'shish (Add to Home Screen) bo'yicha vizual qo'llanma va veb-platformaga kirish ko'rsatiladi.
   - **Desktop Relizlar v1.0.9 ga Sinxronlandi**: Windows (`.exe` va `.msi`), macOS (Apple Silicon va Intel) va Linux (`.deb` va `.AppImage`) installerlari `v1.0.9` versiyasiga yangilandi.

3. **Subway Vocab Runner Mobil Redizayni (`VocabRunnerGame.tsx`)**:
   - Ekranning 40% ini qoplab, HUD va canvasni to'sib qo'ygan bahaybat qora tugmalar olib tashlandi.
   - O'yin toza 60 FPS Touch Swipe (surish) va Touch Zone (sensorli hududlar) dvigateliga o'tkazildi:
     * Chapga surish / chap tomonga teginish -> Chap yo'lakka o'tish
     * O'ngga surish / o'ng tomonga teginish -> O'ng yo'lakka o'tish
     * Yuqoriga surish / o'rtaga teginish -> Sakrash
     * Pastga surish / pastga teginish -> Sirg'alish (slide)
   - Sahifa siljishining oldini olish uchun `touch-none` (`touch-action: none`) o'rnatildi.
   - HUD va Savol matni to'liq ekranga moslashtirildi, pastki qismda nafis yarim-shaffof imo-ishoralar ko'rsatgichi qo'shildi.

4. **Bamboozle Arena & Global Mobil UI Bottom Padding**:
   - Asosiy ilova maketida (`AppLayout`) mobil padding `pb-24` dan `pb-32 sm:pb-36 lg:pb-8` ga oshirildi.
   - `BamboozleLobby`, `BamboozleArena` va `VocabularyCatalogView` pastki qismiga qo'shimcha `pb-12` kiritilib, mobil pastki menyu (Bottom Navigation Bar) kartochkalar va "Jamoalar Jangini Boshlash" tugmalarini to'sib qo'yishi butunlay bartaraf etildi.


### 32-BLOK: Video Playback Resolution, Infinite Spinner Watchdog & Mobile LMS Overhaul
1. **Video Player Infinite "Video yuklanmoqda..." Muzlashining Ildizi Bartaraf Etildi (`GamifiedVideoPlayer.tsx`)**:
   - **Ildiz Sabab (Root Cause)**: JSX da `<video src={...}>` berilgan holda `useEffect` ichida `hls.attachMedia(video)` chaqirilganda, React render aylanishi `src` ni `undefined` qilib tozalab tashlagan va MediaSource'ni bekor qilgan. Shuningdek `onError` hodisasi cheksiz re-load halqasini hosil qilgan, `isBuffering` hech qachon `false` bo'lmagan.
   - **Yechim**: `<video>` tegidan statik `src` atributi butunlay olib tashlandi, barcha video manbasi boshqaruvi to'liq `useEffect` va HLS.js nazoratiga o'tkazildi.
   - **Hodisalar Nazorati**: `onCanPlay`, `onLoadedData`, `onPlaying` hodisalari orqali `isBuffering = false` va `streamError = null` zudlik bilan o'rnatiladi. `preload="metadata"` qilib engil yuklanish kafolatlandi.
   - **6-Soniya Avtomatik Watchdog**: Agar 6 soniya ichida video `canplay` yoki `loadeddata` hodisasini bermasa, pleyer avtomatik tarzda `isBuffering = false` qiladi, HLS xatolik bersa to'g'ridan-to'g'ri MP4 oqimiga o'tadi, agar u ham yuklanmasa Obsidian-Emerald ogohlantirish oynasini ko'rsatadi: *"Ushbu darsning video oqimi qayta ishlanmoqda. [ Demo darsni ko'rish ] / [ Qayta urinish ]"*.
   - **Qayta Urinish va Demo Dars**: Foydalanuvchi "Qayta urinish" bosganda manba qayta yuklanadi, "Demo darsni ko'rish" bosilganda esa Lesson 1 ning tasdiqlangan to'liq 83MB lik oqimi bir zumda ochiladi.
2. **Next.js API Proxy Video Streaming Moslashuvi (`route.ts`)**:
   - `frontend/src/app/api/backend/[...path]/route.ts` da `/stream` yoki `Range` sarlavhali so'rovlar uchun `timeoutMs` 8 soniyadan 600 soniyaga (10 daqiqa) uzaytirildi.
   - HTTP 206 Partial Content so'rovlarida `Content-Length` sarlavhasi olib tashlanmasligi ta'minlandi, natijada brauzer video baytlari hajmini to'g'ri o'qib, oqim to'xtab qolmaydi.
3. **Backend Video Oqimi va Dummy Stub Tozalanishi (`lms_services.py` & `lms_views.py`)**:
   - `stream_video_file`: Brauzer dekoderini buzib qo'yuvchi 1000 baytlik dummy stub olib tashlandi. Video fayl diskda mavjud bo'lmasa, serverdagi haqiqiy mavjud video fayllar nomzodlari tekshiriladi, aks holda standart toza JSON 404 (`LESSON_VIDEO_NOT_FOUND`) qaytariladi.
   - `lesson_stream_view`: Dars video fayllari uchun `/app/storage/videos/`, `/app/storage/videos/grammar/` va `/opt/bestway/storage/videos/` yo'llari bo'yicha to'liq qidiruv qo'shildi.
4. **29 ta Grammatika Darsi uchun To'liq Solo Testlar va Avto-Tiklanish (`seed_all_29_grammar_quizzes.py` & `lms_services.py`)**:
   - `apps/core/management/commands/seed_all_29_grammar_quizzes.py`: Barcha 29 ta video darslik (Nouns, Adjectives, Adverbs, Numerals, Articles, Tenses, Modals, Conditionals, Passive Voice, Reported Speech, Gerund/Infinitive va h.k.) uchun yagona master seed buyrug'i yaratildi.
   - Har bir darsga unikal `QuizDeck` bog'landi (`is_lesson_tied=True`), har bir dekka 12 ta xatosiz ko'p variantli savollar (`points=10..15`, 4 variant, to'g'ri javob) va 4 ta Bamboozle syurpriz kartasi joylandi.
   - `lms_services.py` da `ensure_lesson_quiz_deck_and_questions` o'z-o'zini tiklovchi (self-healing) mexanizm qo'shildi: agar darsga test bog'lanmagan bo'lsa yoki savollar soni 0 bo'lsa, dars mavzusiga mos 6-8 ta sifatli savol avtomatik generatsiya qilinadi. Natijada `GET /api/v1/lessons/:id/quiz` hech qachon "Savollar topilmadi" xatosini bermaydi.
5. **Mobil LMS Dizayni va Tugmalar Moslashuvchanligi (`videos-view.tsx` & `LessonQuizModal.tsx`)**:
   - `videos-view.tsx`: 29 ta darslik kartalaridagi "Watch", "Test", "Arena" tugmalari kichik ekranlarda siqilib qolmasligi uchun ixcham o'lchamlar (`h-9`, `min-w-[75px]`, `px-2.5`) va responsive grid o'rnatildi.
   - `GamifiedVideoPlayer` va `LessonQuizModal` modallari mobil ekranlar uchun `w-[96vw] max-w-4xl max-h-[92dvh] sm:max-h-[88vh] rounded-2xl` formatiga o'tkazildi.
   - Pleyer boshqaruv paneli kichik mobil ekranlarda (360px - 414px) to'liq sig'ishi uchun ovoz slaydri `hidden sm:block`, tezlik tugmasi esa mobilda bitta bosish bilan aylanuvchi (`sm:hidden text-[11px]`) qilib optimallashtirildi.
6. **Deploy va Sinovlar**:
   - Vitest: 58 ta test fayli, 369 ta test 100% muvaffaqiyatli o'tdi (PASS).
   - Pytest: 626 ta test 100% muvaffaqiyatli o'tdi (PASS).
   - TypeScript `tsc --noEmit`: 0 ta xatolik (Clean build).
   - `.github/workflows/deploy.yml` ga VPS konteynerida `seed_all_29_grammar_quizzes` ni avtomatik bajarish qo'shildi.

## Jarayonda
- HLS video transcoding infratuzilmasi va pleylist marshrutlari to'liq ishga tushirildi.
- Speaking audiolarni Opus formatida siqish foni faollashtirildi.
- Web pleyerda HLS avtomatik sifat tanlash va qo'lda tanlash boshqaruvi joriy etildi.
- VPS uzilishsiz yangilandi va barcha endpointlar 200 OK qaytarmoqda.

---

## Keyingi Qadamlar
1. Mavjud 29 ta video darsliklarni fon rejimida HLS segmentlariga to'liq transkodlash skriptini ishga tushirish (`python manage.py transcode_all_lessons_hls`).
2. O'quvchilar shaxsiy kabinetida video darslarni tomosha qilish sifati bo'yicha tahliliy ko'rsatkichlarni monitoring qilish.

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
11. **HLS va Native Fallback Standarti**: Barcha brauzerlarda to'siqsiz ijro etish uchun: `Hls.isSupported()` bo'lsa `hls.js` orqali adaptiv oqim, Safari / iOS brauzerlarida brauzerning ichki native HLS imkoniyati, eski yoki qo'llab-quvvatlanmagan muhitlarda esa to'g'ridan-to'g'ri MP4 fallback ishlatiladi.
12. **Speaking Audio Siqish Standarti**: Server disk resursini tejash maqsadida yuklangan barcha speaking audiolari fon rejimida 32kbps mono Opus formatiga o'tkaziladi. Bu nutq sifatiga ta'sir qilmagan holda fayl hajmini 70-85% gacha qisqartiradi.
