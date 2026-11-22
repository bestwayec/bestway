# BESTWAY Exam Builder 2.0 — amalga oshirish hisoboti

**Branch:** `claude/blissful-planck-wa3s0n` · **PR:** [#220](https://github.com/bestwayec/bestway/pull/220)
· **Asos:** NEXT 3.0 integratsiya qilingan `main` = `ec82893`.

Texnik tafsilotlar (inglizcha): `EXAM_BUILDER_AUDIT.md`, `EXAM_BUILDER_IMPLEMENTATION.md`,
`EXAM_JSON_SCHEMA.md`, `EXAM_BUILDER_USER_GUIDE.md`, `EXAM_BUILDER_TEST_REPORT.md`.

## Takrorlanishning oldini olish (Part D)

Yangi dvigatel yaratilmadi. Qayta ishlatilgan: mavjud schema-1.0 importeri (`mock_import_validate`,
`mock_imports`), `MockExam/MockSection/MockQuestionGroup/MockQuestion` modellari, Smart Import
(Gemini 3.0 wizard'i o'zgartirilmadi), Multilevel blueprint (`multilevel.py`), readiness,
attempt/scoring dvigateli, CBT runner. Yangi model ham, migratsiya ham yo'q. Bitta JSON sxema
(schema 1.0) qo'shimcha ixtiyoriy maydonlar bilan kengaytirildi.

## Talablar holati (C1–C10)

| Talab | Holat | Izoh |
|---|---|---|
| C1 Dashboard: barcha / draft / published, qidiruv, filtr, dublikat, tahrir, preview, **export**, unpublish, xavfsiz o'chirish | **Bajarildi** (export yangi; qolganlari mavjud edi va tekshirildi) | "Archived" holati yo'q — modelda bunday ustun yo'q; qo'shish migratsiya talab qiladi (qoldirildi) |
| C2 Yaratish wizard'i (tur → ko'nikmalar → usul → metama'lumot → muharrir) | **Mavjud** (`/exam-builder/new`, `ExamSetup`) + JSON/shablon yo'li import oynasida | Wizard ichida "duplicate existing"/"question bank" usullari alohida qadam emas |
| C3 Vizual muharrir (sidebar, markaziy muharrir, xususiyatlar, rich text, jadval, rasm, audio, kalitlar, autosave, validatsiya, preview, bulk entry) | **Mavjud** (oldingi bosqichlar) | Undo/redo qo'shilmadi |
| C4 IELTS mualliflik (barcha L/R savol turlari, Writing Task 1/2 + GT xat, Speaking 1–3) | **Bajarildi**: yangi IELTS Writing (Academic, General Training), Speaking va to'liq mock shablonlari | |
| C5 CEFR Multilevel | **Bajarildi**: to'liq mock va har bir ko'nikma shabloni platformaning `UZBMB_MULTILEVEL_EN_2026_V2` blueprint'idan; "rasmiy" deb belgilanmagan; ball konversiyasi to'qilmagan | |
| C6 JSON import/eksport | **Bajarildi**: to'liq/ko'nikma import, draftga qo'shish, **boshqariladigan almashtirish** (yangi), to'liq va ko'nikma **eksport** (yangi), sxema validatsiyasi, takroriy kalitlar, aniq xatolar (qator/ustun, o'qiladigan yo'l), atomik tranzaksiya, eski paketlar mosligi; IMPORT → SAVE → EXPORT → REIMPORT 18 shablon uchun avtomatik sinalgan | "Shablon eksporti" (kalitsiz) va savol bankiga import qilinmadi |
| C7 Savol banki va shablonlar | Shablonlar: **bajarildi** (18 ta, har bir tugma ishlaydi, har biri importer orqali sinalgan). Savol banki: mavjud `mock/item-bank` (qidiruv/filtr) — o'zgartirilmadi | Bankdan imtihonga qo'shish UI qo'shilmadi |
| C8 Nashr va versiyalash | Mavjud qoidalar saqlandi: readiness to'liq bo'lmaganda nashr bloklanadi (E2E: shablon qoralamasi 400 `MOCK_NOT_READY`), urinish boshlangan imtihon tarkibi qulflangan | DRAFT→VALIDATED→PUBLISHED→ARCHIVED alohida holatlar sifatida yo'q (model `is_published` + readiness) |
| C9 Xavfsizlik | **Tekshirildi**: eksport faqat egasi/admin; talaba 403 (validate, commit, export); talaba payload'ida kalit yo'q; 2 MiB limit; noma'lum maydonlar rad; HTML sanitizatsiya; tranzaksiya rollback | |
| C10 Haqiqiy E2E | **Bajarildi**: Playwright (real Chromium + Next prod build + Django + PostgreSQL) | Natijalar test hisobotida |

## Topilgan va tuzatilgan xatolar

`EXAM_BUILDER_AUDIT.md` jadvalida 11 ta tasdiqlangan nuqson. Eng muhimlari: 12 shablondan 3 tasi
(jumladan standart "Full CBT") importerda rad etilardi; Multilevel shabloni aslida IELTS
tarkibi edi; to'rt ko'nikmali IELTS paketi hech qachon import bo'lmasdi; bir nechta task-guruhli
Reading full mock readiness'dan o'tmasdi; eksport yo'q edi. Integratsiya paytida yana bittasi
topildi: muharrirdan ochilgan import oynasida qoralama ro'yxati yuklanguncha tugma "Create draft"
ko'rsatar va bosilsa **yangi imtihon** yaratardi — endi qoralama aniqlanmaguncha tugma o'chiq.
