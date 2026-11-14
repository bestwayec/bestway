# BestWay Exam dasturi — IELTS va Multilevel (CEFR) mock platformasi

Maqsad: BestWay imtihon qismini o'zbek bozoridagi eng kuchli IELTS va Multilevel mock platformasiga aylantirish.
Bu fayl dasturning yagona holat jadvali. Har sessiya boshida to'liq o'qiladi (REPAIR_PROGRESS.md bilan birga).

## UMUMIY QOIDALAR

- Javoblar va hisobotlar o'zbek tilida.
- Ish boshida EXAM_PROGRAM.md va REPAIR_PROGRESS.md ni to'liq o'qi, PR'lar holatini tekshir. Merge bo'lmagan PR ustiga qurishga to'g'ri kelsa, menga ayt.
- Commit va PR'lar rozievkomiljon nomi bilan. PR matnida Claude izohi yoki "Generated with" qatori yo'q.
- Force-push yo'q. Main'ga o'zing merge qilma. Har PR kichik va bitta mavzuda, merge tartibi PR matnida.
- Uydirma ma'lumot yo'q: soxta ball, vaqt, PIN, "berildi" xabari, tekshirilmagan da'vo. Ma'lumot bo'lmasa, element chiqmaydi.
- Ball qoidasi (#129): qisqa yoki qisman mashqda band/CEFR yo'q, faqat "N/M to'g'ri · %". Band/daraja faqat to'liq bo'lim (IELTS 40, Multilevel 35) yoki to'liq mock uchun. Grading holatidagi urinish uchun umumiy band chiqmaydi.
- "Tugagan" faqat submittedAt bo'lsa.
- BestWay ballari rasmiy natija emas: UI'da "taxminiy" deb yoziladi, IELTS yoki agentlik nomidan da'vo qilinmaydi.
- Javob kalitlari va to'g'ri javoblar topshirishdan oldin brauzerga yuborilmaydi.
- Backend o'zgarishida migratsiya, testlar va CI PostgreSQL skriptlari. Ma'lumot o'chiradigan migratsiyadan oldin menga ayt.
- Barcha matnlar tarjima kalitlarida (uz/en mos), barcha ranglar mavzu tokenlarida. Yangi fayllar himoya testlari ro'yxatiga qo'shiladi.
- Skrinshotlar repoga qo'shilmaydi. Secret qiymatlarini so'rama va chatga chiqarma.
- Lokal dev server -H 127.0.0.1 bilan ishga tushirilmaydi. O'zbekcha sahifani tekshirganda NEXT_LOCALE cookie'sini qo'y.
- BW-16 yopilgan: serverda token grace window qo'shilmaydi.
- Har PR'dan oldin: backend testlari (tegilgan bo'lsa), vitest, tsc, lint (0 xato), next build, kalitlar mosligi testi; E2E smoke va full-journey (yangi oqimlarga yangi qadamlar); brauzerda yorug'/qorong'i, 390×844 va 1440×900, en va uz, talaba va ustoz. PR ochilgach CI (django, frontend, CodeQL) yashil bo'lishini kut.
- Yakunda: EXAM_PROGRAM.md da bosqich holatini va REPAIR_PROGRESS.md ni yangila (takror bo'limlarsiz). Hisobot: merge qilinganlar; tayyor PR'lar merge tartibi bilan; VERIFIED/UNVERIFIED; muhim topilmalar; qolgan ishlar; mendan kerakli narsalar; NEXT STEP.
- Bosqich sig'masa, eng muhim qismini sifatli tugat, qolganini aniq ro'yxat qil. Yarim ishlangan PR ochma.

## Bosqichlar

| # | Bosqich | Holat | Dalil / PR |
|---|---|---|---|
| 1 | Poydevor: rasmiy format, blueprint, savol turlari, yagona ball mexanizmi, backend qarorlari, kalitlar xavfsizligi | YOPILDI (2-qism — item bank metadata — 2-bosqich boshiga ko'chirildi, pastga qarang) | #138 blueprint · #139 ball moduli · #140 prediction (#129) · #141 vocab battle winners · #142 drill (kalit serverda, bir martalik ball, kunlik chegara) · #143 demo test kalitlari · shu fayl |
| 2 | CD IELTS imtihon oynasi (computer-delivered ko'rinish va vaqt oqimi) | YOPILDI (asosiy qism; qolganlari aniq ro'yxatda, 3-bosqich boshiga ko'chirildi) | #145 javoblar navbati + LWW + Finish 502 · #146 highlight/izoh/belgi serverda · #147 taymer, Settings, Help, Hide, Listening 2 daqiqa · #148 Writing so'z hisobi + clipboard · #149 imtihon rejimi jurnali · shu fayl |
| 3 | Multilevel to'liq moslik (2025 yozish formati, gapirish, daraja chegaralari) + 2-bosqich qoldig'i | KEYINGI | egasi qarori kerak: daraja chegaralari; NEXT STEP ga qarang |
| 4 | AI baholash (Writing/Speaking, mezonlar bo'yicha) | TODO | |
| 5 | Tahlil va o'quv halqasi (zaif nuqtalar → mashq → takror) | TODO | |
| 6 | Sifat darvozasi (barcha rollar, a11y, vizual baza, yuklama) | TODO | |

## Rasmiy format (tekshirilgan 2026-11-12/13)

Har fakt yonida manba. "Tasdiqlanmagan" — rasmiy manbada topilmadi; kodda fakt sifatida yozilmagan (blueprint `unverified` ro'yxatida).

### Manbalar

- [IELTS-F] ielts.org — IELTS Academic test format (Listening, Reading, Writing, Speaking sahifalari): https://ielts.org/take-a-test/test-types/ielts-academic-test
- [IELTS-S] ielts.org — IELTS scoring in detail: https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail
- [UZ-F] uzbmb.uz — Test sinovlari formati, Multilevel bo'limi: https://uzbmb.uz/page/test_sinovlari_formati
- [UZ-B] Bilimni baholash agentligi — ko'p darajali test baholash mezonlari (2023-03-16; gov.uz da 2026-01-26 qayta joylangan): https://uzbmb.uz/upload/file/pdf/Multilevel-bm.pdf
- [UZ-W] Yozish bo'limi topshiriq tafsilotlari, yangi format (2025-10-13): https://api-portal.gov.uz/uploads/165/2025/10/13/99dfbb36-0f1d-2c70-8a4e-e1382a5f255b_media_.pdf
- [UZ-S] Gapirish ko'nikmasi yangi formati: https://uzbmb.uz/upload/file/pdf/phone/Speaking_format.pdf
- [UZ-R] Rating scale for Multilevel speaking exams (yangi format): https://uzbmb.uz/upload/file/pdf/phone/yangi_format_eng.pdf
- [IDP-CD] IDP — How computer-delivered IELTS works: https://ielts.idp.com/canada/prepare/article-how-computer-delivered-ielts-works
- [IELTS-L] ielts.org — IELTS Academic Listening format (savol turlari, so'z chegarasi): https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-listening
- [IELTS-G] ielts.org — IELTS Guide for Test Takers (PDF): https://ielts.org/cdn/ielts-downloadable-assets/ielts-guidance-and-support/ielts-guides/ielts-guide-for-test-takers.pdf

### IELTS (Academic va General Training)

| Fakt | Holat | Manba |
|---|---|---|
| Listening: 4 qism, 40 savol (har qismda 10), ~30 daqiqa, yozuv bir marta eshittiriladi | tasdiqlandi | IELTS-F |
| Listening: kompyuterda oxirida 2 daqiqa tekshirish, javob ko'chirish vaqti yo'q | tasdiqlandi (2-bosqichda; blueprint `unverified` ro'yxatini yangilash 3-bosqichga) | IDP-CD |
| Listening: "30–34 daqiqa" | tasdiqlanmagan (faqat "approximately 30 minutes") | — |
| Listening: yozuvlar faqat bir marta eshittiriladi | tasdiqlandi | IELTS-G |
| Reading: 3 matn (2150–2750 so'z), 40 savol, 60 daqiqa | tasdiqlandi | IELTS-F |
| Reading: Academic va General Training alohida konvertatsiya (GT da bir xil band uchun ko'proq to'g'ri javob) | tasdiqlandi | IELTS-S |
| Writing: 2 vazifa, 60 daqiqa; Task 1 kamida 150 so'z (~20 daq), Task 2 kamida 250 so'z (~40 daq); Task 2 ikki barobar og'ir | tasdiqlandi | IELTS-F |
| Speaking: 3 qism, 11–14 daqiqa; 1-qism 4–5 daq; 2-qism 1 daq tayyorlanish + 2 daq gapirish (jami 3–4 daq); 3-qism 4–5 daq | tasdiqlandi | IELTS-F |
| Umumiy band = 4 bo'lim o'rtachasi, eng yaqin 0.5 ga; .25 → yuqori yarim band, .75 → keyingi butun band | tasdiqlandi | IELTS-S |
| L/R: har to'g'ri javob 1 ball, 40 dan 9 ballik shkalaga; o'rtacha ko'rsatkichlar: Listening 16/23/30/35 → 5/6/7/8; Academic Reading 15/23/30/35 → 5/6/7/8; GT Reading 15/23/30/35 → 4/5/6/7; aniq chegara test versiyasiga qarab o'zgaradi | tasdiqlandi (faqat shu o'rtachalar) | IELTS-S |
| BestWay L/R jadvallarining qolgan qatorlari | tasdiqlanmagan (taxminiy) | — |

### Multilevel (CEFR, Bilimni baholash agentligi)

| Fakt | Holat | Manba |
|---|---|---|
| Yozma qism 2 soat 45 daqiqa | tasdiqlandi | UZ-F |
| Listening: 6 qism, 35 savol, 45 daqiqa (8+6+4+5+6+6); har matn **ikki marta** eshittiriladi, oldin 15–30 soniya savollarni o'qish; javob varaqasi uchun qo'shimcha 10 daqiqa | tasdiqlandi | UZ-F |
| Reading: 5 qism, 35 savol, 60 daqiqa (6+8+6+9+6) | tasdiqlandi | UZ-F |
| Writing (2025 yangi format): 60 daqiqa; 1-qism — bitta xatga javoban 2 ta e-mail: norasmiy ~50 so'z (0–5) va rasmiy 120–150 so'z (0–5), ~25 daq tavsiya; 2-qism — onlayn nashr uchun matn 180–200 so'z (0–6), ~35 daq tavsiya; ekspert bahosi 16 dan 75 ga jadval bilan | tasdiqlandi | UZ-W |
| Writing (eski matn): "Task 1 100–150 so'z, 12 ball; Task 2 200–250 so'z, 24 ball; jami 36 → 75 jadval" | eski 2023 mezoni (UZ-B) va format sahifasi (UZ-F: 150 / 250 so'z); 2025 yangi format (UZ-W) uni almashtirgan. Kod 2025 formatiga mos (5+5+6=16, 33 qatorli jadval — testda tekshirilgan) | UZ-B, UZ-F, UZ-W |
| Speaking: 1.1 — 3 savol, 30 s, tayyorlanishsiz; 1.2 — 2 rasm, 3 savol, 45 s + 30 s + 30 s, tayyorlanishsiz; 2 — rasm + 3 savol, 1 daq tayyorlanish, 2 daq javob; 3 — argumentning ikki tomoni, 1 daq tayyorlanish, 2 daq | tasdiqlandi | UZ-S |
| Speaking baholash: Q1–3, Q4–6, Q7 har biri 0–5, Q8 0–6 (jami 21) | tasdiqlandi | UZ-R |
| Speaking kompyuterda, jami 15 daqiqa | tasdiqlanmagan | — |
| Speaking 21 → 75 jadvali | tasdiqlanmagan (agentlik jadvali topilmadi; BestWay jadvali taxminiy) | — |
| L/R natijasi Rasch modeli bilan, T = 50 + 10Z, +2.5 logitdan yuqori → 75; BestWay jadvali faqat taxminiy | tasdiqlandi | UZ-B |
| Har bo'lim 0–75; daraja 4 bo'lim o'rtachasidan: C1 65–75, B2 51–64, B1 38–50, 38 dan past — B1 dan quyi (sertifikat yo'q); taxminiy to'g'ri javoblar 28–35 / 18–27 / 10–17 / 0–9 | tasdiqlandi | UZ-B |

## CD IELTS imtihon oynasi (2-bosqich, 2026-11-13)

Rasmiy kompyuter versiyasining xatti-harakati (kod ko'chirilmadi, faqat tavsif bo'yicha) va BestWay'dagi holati. "Tasdiqlanmagan" — rasmiy manbada topilmadi; UI da "rasmiy" deb yozilmaydi.

| Rasmiy xatti-harakat | Manba | BestWay | PR |
|---|---|---|---|
| Soat Reading va Writing'da oxirgi 10 va 5 daqiqada miltillaydi | IDP-CD | `role="timer"`, server deadline'idan; 10:00 va 5:00 da miltillash (motion-safe) + ekran o'quvchiga e'lon; oxirgi daqiqa xavf rangi | #147 |
| Vaqt tugasa javoblar saqlanadi va bo'lim yopiladi | IDP-CD | mavjud avto-topshirish saqlangan; Finish 502 / tarmoq uzilsa server holati so'raladi, ikkinchi urinish yaratilmaydi | #145 |
| Settings: matn o'lchami va fon rangi | IDP-CD | Regular / Large / Extra large; Standard / Sariq-qora / Qora-krem; ovoz balandligi; faqat shu qurilmada | #147 |
| Hide → "Resume test"; vaqt to'xtamaydi | IDP-CD | to'liq ekran qopqog'i, vaqt ko'rinib turadi va yuradi, fokus "Davom etish" ga | #147 |
| Help tugmasi | IDP-CD | navigatsiya + faqat joriy bo'limdagi savol turlari | #147 |
| Reading: matn chapda, savollar o'ngda; belgilash + o'ng tugma bilan highlight va izoh | IDP-CD | highlight, izoh va "ko'rib chiqish" belgisi urinish bilan serverda; qayta yuklash / boshqa qurilmada tiklanadi; izohlar paneli | #146 |
| Listening: pastda 40 savol navigatsiyasi, oldinga/orqaga, Review tugmasi (kvadrat → doira), yuqori o'ngda ovoz | IDP-CD | mavjud navigatsiya va belgi; ovoz Settings'da, barcha pleerlar uchun bitta | #146, #147 |
| Listening: yozuv bir marta, oxirida 2 daqiqa tekshirish | IELTS-G, IDP-CD | to'xtatib bo'lmaydi; 2 daqiqa faqat oxirgi qismdan keyin (avval har qism tugaganda bo'lim topshirilib qolardi — tuzatildi) | #147 |
| Writing: istalgan vazifadan boshlash, avto-saqlash, so'z soni pastda chapda | IDP-CD | vazifalar orasida erkin o'tish, avto-saqlash ko'rsatkichi, so'z soni | mavjud + #148 |
| So'z sanash: defisli so'z bitta so'z | IELTS-L | `countWords`: defisli so'z va qisqartma bitta; harf/raqamsiz belgi so'z emas | #148 |
| Copy/paste, imlo tekshiruvi | tasdiqlanmagan (faqat norasmiy manbalar) | BestWay qarori: tashqi matnni qo'yish taqiqlangan va qayd etiladi, o'z matnini javob ichida ko'chirish mumkin; imlo tekshiruvi o'chiq | #148 |

Qarorlar:
- Imtihon ranglari sayt mavzusidan alohida: rasmiy test fonni faqat test ichida o'zgartiradi; "Standard" sayt mavzusiga ergashadi. Palitralar mavzu tokenlarini mahalliy qayta belgilaydi, kontrast ≥ 4.5:1 (qiymatlar `globals.css` izohida).
- Imtihon rejimi (faqat timed): to'liq ekran faqat talaba tugmasi bilan so'raladi; chiqish, tab/ilova almashtirish bir marta vaqti bilan qayd etiladi, imtihon to'xtatilmaydi (avval 3-ogohlantirishda avto-topshirardi — olib tashlandi); talaba boshlashdan oldin ogohlantiriladi; ustoz natija sahifasida "Imtihon jurnali" ni ko'radi.
- Ishonchlilik: javob avval qurilmadagi navbatga, keyin serverga; tartib bilan qayta yuboriladi; serverda oxirgi tahrir yutadi (`editedAt`, server soati); `editedAt` siz eski yo'l o'zgarmagan (desktop mosligi).

Tekshiruv (stack uchi #149): pytest 915/4 skip, CI PostgreSQL skriptlari (yangi `verify_exam_window_postgres` 14/14), vitest 654, tsc, lint 0 xato, next build; E2E smoke 16/16, full-journey 13/13, exam-window 12/12, exam-workspace 20/20, exam-tools 28/28, exam-writing 6/6, exam-mode 8/8 (en/uz, yorug'/qorong'i, 390/1440, talaba va admin). 1- va 2-bosqichning 12 tarmog'i main ustida ziddiyatsiz birlashadi; shu birlashmada pytest 1070/4 skip, barcha CI PostgreSQL skriptlari (points 48/48, exam window 14/14), vitest 669, tsc yashil.

2-bosqichdan qolganlar (3-bosqich boshiga, aniq ro'yxat):
- Bir vaqtda bitta faol sessiya (tablar/qurilmalar orasida) va aniq xabar — backend sessiya qulfi kerak.
- Navigatsiya paneli: to'liq klaviatura boshqaruvi (o'q tugmalari), axe/ARIA auditi, savol raqami/holatini ekran o'quvchiga e'lon qilish (hozir faqat aria-label).
- Reading: sudraladigan ajratgich va ikki ustunning mustaqil aylanishi (telefonda "Matn / Savollar" tablari bor).
- Listening: har qism oldidan savollarni o'qish vaqti; uzilishdan keyin oldindan yuklash / davom ettirish va server bo'yicha to'g'ri 2 daqiqa vaqti; Listening savol matnida highlight.
- Ustozning jonli kuzatuv sahifasi matnlari hali qattiq yozilgan o'zbekcha.
- Multilevel Listening oqimi (ikki marta eshittirish, 15–30 s o'qish vaqti — UZ-F) shu oynada alohida tekshirilmagan.
- Blueprint: `unverified` ro'yxatidagi "Listening 2 daqiqa tekshirish" ni IDP-CD manbasi bilan tasdiqlanganga o'tkazish.

## Muhim topilmalar (egasi uchun)

1. **Multilevel daraja chegaralari koddagi rasmiy manbaga zid.** `mock_scoring.multilevel_level`: C1 ≥ 60, B2 ≥ 46, B1 ≥ 34 (commit b92405a). Rasmiy: 65 / 51 / 38. `prediction_service.MULTILEVEL_SCALE_BANDS` va frontenddagi sertifikat oynasi (60/46/34), guruh bahosi eksporti (60/45/35) ham boshqa. Jadval o'zgartirilmadi (qoida). Qaror kerak: rasmiy 65/51/38 ga o'tkazishmi.
2. Javob kalitlari sizishi: drill (#142) va ochiq demo test (#143) tuzatildi. Boshqa o'quvchi javoblari (mock katalog, CD sessiya, urinish, javob saqlash, lug'at, placement) toza. Runner o'yini `correct` ni dizayn bo'yicha oladi (ball serverda qayta hisoblanadi, #114).
3. Drill savollar banki faqat 3 toifa uchun (tfng, headings, grammar_cohesion); boshqa toifalar tfng ga tushadi; "Reading — Short Answer" kartasi ham TFNG mashqini ochadi. Drill modal matnlari en tilida ham o'zbekcha (eski muammo).
4. (2-bosqich) Listening'da har qism pleeri o'z yozuvi tugaganda 2 daqiqalik tekshiruvni boshlab, keyin bo'limni topshirardi: 1-qismdan keyin 2–4-qismlar eshitilmay Listening yopilishi mumkin edi. #147 da tuzatildi (faqat oxirgi qism).
5. (2-bosqich) Imtihon rejimi 3-ogohlantirishda urinishni avtomatik topshirardi, har chiqishni uch marta yozardi va matnlari faqat o'zbekcha edi. #149 da: faqat qayd, bloklamaydi, bir marta yoziladi, uz/en.

## 2-qism (taksonomiya va item bank) — 3-bosqich boshiga ko'chirildi (2-bosqichda imtihon oynasi ustuvor bo'ldi)

Qilingan: savol turlarining yagona ro'yxati blueprint'da (har qism uchun `allowedTypes`, faqat bazadagi `MockQuestionType` qiymatlari); javob tekshirish qoidalari bitta joyda (`mock_scoring.correct`, `mock_rules`) va mavjud testlar bilan.
Qolgan (aniq ro'yxat):
- IELTS turlarini aniqroq ajratish (form/flow-chart completion, matching features/sentence endings, plan/diagram labelling) — hozir umumiy turlarga tushadi; yangi tur qo'shish = Prisma enum migratsiyasi.
- Har savolga metadata: imtihon, bo'lim, qism, tur, CEFR maqsad darajasi, ko'nikma teglari — additive migratsiya, aniqlab bo'lmaganida `unknown`.
- Javob qoidalari uchun alohida jadval testlari: katta-kichik harf, bo'shliq, muqobil javob, "NO MORE THAN TWO WORDS AND/OR A NUMBER", raqam yozilishi (one/1), defisli so'z bitta so'z.
- Multilevel rasmiy namuna (uzbmb.uz `Ingliz_Multi_V1.zip`) bilan turlarni solishtirish — zip yuklab olinmadi (proksi).

## NEXT STEP (3-bosqich)

1. Egasi merge qiladi: 1-bosqich #138 → #139 → #140 → #141 → #142 → #143 → #144; 2-bosqich #145 → #146 → #147 → #148 → #149 → shu docs PR (#144 ustida). Ikki stack bir-biriga bog'liq emas. Qaror: Multilevel daraja chegaralari (topilma 1).
2. 3-bosqich boshida 2-bosqich qoldig'i (yuqoridagi ro'yxat), ustuvorlik: bitta faol sessiya → Listening o'qish vaqti va davom ettirish → navigatsiya klaviaturasi + axe → Reading ajratgichi → jonli kuzatuv i18n.
3. Item bank metadata migratsiyasi (additive) va javob qoidalari jadval testlari (2-qism ro'yxati).
4. Multilevel to'liq moslik: Listening ikki marta + o'qish vaqti, 2025 Writing formati UI da (50 / 120–150 / 180–200 so'z), Speaking qism vaqtlari, daraja chegaralari egasi qaroridan keyin bitta jadvalda.
5. Har yangi oqimga E2E skript (`scripts/e2e-local/`); uz sahifa uchun dashboard tinchlangach NEXT_LOCALE cookie'si (prefetch uni `en` ga qaytaradi).
