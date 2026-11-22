# BESTWAY — yakuniy integratsiya hisoboti

**Sana:** 2026-11-22 · **Bajaruvchi:** Claude Opus (mustaqil audit, ikki ish oqimi, ketma-ket merge)
**Repozitoriy:** `bestwayec/bestway` (BESTWAY; GRANDEC/LMS emas) · **Production deploy qilinmadi.**

## 1. Gemini NEXT 3.0 — olti bosqich holati

| Bosqich | PR | Holat | Mazmun |
|---|---|---|---|
| 1 To'liq IELTS imtihon auditi | #214 | **Merge qilindi** (tuzatish bilan) | conftest, mudofaa `getattr`, testlar; 2 jiddiy nuqson tuzatildi |
| 2 Smart Import 3.0 | #215 | **Merge qilindi** (tuzatish bilan) | 4 bosqichli wizard UI, HTML tozalash; o'lik kod olib tashlandi |
| 3 IELTS CBT 3.0 | #216 | **Merge qilindi** | 4-rang highlight, submit oynasi hisoblagichlari |
| 4 AI baholash | #217 | **Merge qilindi** (tuzatish bilan) | faqat testlar; transkriptdan "talaffuz" chiqarish to'xtatildi |
| 5 Analitika | #218 | **Merge qilindi** | faqat testlar |
| 6 Production hardening | #219 | **Merge qilindi** (tuzatish bilan) | throttle testlari, hujjatlar; tautologik test olib tashlandi |

Muhim: 4–6-bosqichlar yangi ishlab chiqarish kodi qo'shmagan (mavjud xizmatlar ustiga testlar).

## 2. Gemini auditi

Batafsil: `docs/BESTWAY_NEXT_3_OPUS_REVIEW.md`. Asosiylari:
- **P0** — #214: mijoz yuborgan `force`/`timeUp` bilan server muddati chetlab o'tilardi (kechikkan
  javoblar saqlanib, baholanardi). Tuzatildi (`28b13bb`).
- **P1** — #214: `@transaction.atomic` `@api_view` dan tashqariga ko'chirilib, 4xx xatoda qisman
  yozuvlar commit bo'lardi. Asl tartib tiklandi, real jadvalda isbot testi.
- **P1** — #217: transkriptda so'z uchragani "noto'g'ri talaffuz" deb hisoblanardi (hozir
  ulanmagan funksiya, test uni xususiyat deb tasdiqlagan). Tuzatildi (`f0db9c0`).
- **P2/P3** — #215 hech qachon ishlamagan "draft status" kodi; #219 yiqila olmaydigan test.

## 3. Gemini merge hisoboti

Batafsil: `docs/BESTWAY_NEXT_3_MERGE_REPORT.md`.

| PR | Head (tekshirilgan) | Hosted CI | Merge SHA |
|---|---|---|---|
| #214 | `28b13bb` | 4/4 ✓ | `344086a` |
| #215 | `7b3e240` | 4/4 ✓ | `4446bb7` |
| #216 | `442ef99` | 4/4 ✓ | `6832fdf` |
| #217 | `f0db9c0` | 4/4 ✓ | `e3e380d` |
| #218 | `e03f2a8` | 4/4 ✓ | `be0a46a` |
| #219 | `75e4e27` | 4/4 ✓ | `ec82893` |

Gemini integratsiya nuqtasi: **`ec82893`** — main push-CI **success**, migratsiya yo'q (ziddiyat
yo'q), deploy ishga tushmagan.

## 4. Exam Builder 2.0

Batafsil: `docs/BESTWAY_EXAM_BUILDER_2_IMPLEMENTATION.md` (talablar jadvali C1–C10),
`docs/EXAM_BUILDER_AUDIT.md`, `docs/EXAM_JSON_SCHEMA.md`, `docs/EXAM_BUILDER_USER_GUIDE.md`.

- **IELTS:** Academic to'liq mock, Listening (to'liq + 1–4 qismlar), Reading (to'liq + 1–3 passage),
  Academic Writing (Task 1 vizual + Task 2), General Training Writing (xat + insho), Speaking 1–3.
- **CEFR Multilevel:** to'liq mock (35 + 35 + 3 vazifa + 4 qism, 45/60/60/30 daq.) va har bir
  ko'nikma — platformaning sozlangan blueprint'idan; "rasmiy" deb belgilanmagan; konversiya to'qilmagan.
- **JSON:** eksport (to'liq / ko'nikma), import (yangi / qoralamaga qo'shish / boshqariladigan
  almashtirish), qator/ustunli sintaksis xatolari, o'qiladigan yo'llar, atomik tranzaksiya,
  IMPORT→SAVE→EXPORT→REIMPORT 18 shablon uchun avtomatik sinalgan.
- **Import oynasi:** 3 bosqich, doimo ko'rinadigan tugmalar, paket ko'rinishi, mos kelmaydigan
  qoralamalar o'chirilgan, qoralama yuklanmaguncha "yangi imtihon" ga tushib qolmaydi.
- Yangi dvigatel/model/migratsiya yo'q; Gemini Smart Import 3.0 va CBT 3.0 o'zgartirilmagan.

## 5. Exam Builder merge hisoboti

| PR | Branch | Yakuniy head | Hosted CI | Merge SHA |
|---|---|---|---|---|
| [#220](https://github.com/bestwayec/bestway/pull/220) | `claude/blissful-planck-wa3s0n` | `aac78c3` | django ✓ frontend ✓ CodeQL py ✓ js ✓ | `51cccae` |

## 6. Integratsiyalangan testlar

| To'plam | Natija |
|---|---|
| pytest (PostgreSQL 16) | 1654 passed, 4 skipped (eski NestJS dist skip'lari) |
| Vitest | 140 fayl, 943 passed |
| tsc / ESLint | 0 xato / 0 xato |
| `next build` | muvaffaqiyatli |
| PostgreSQL CI skriptlari (CI env) | hammasi o'tdi (grading 79, E2E 41, Mock27 81, readiness 65, notifications 88, ...; `_local` bazada 6 ta skript) |
| Playwright `exam-builder-2.mjs` | 73/73 (ikki marta) |
| Playwright `ielts-full.mjs` | 10/10 (yaratish → nashr → talaba 4 ko'nikma → o'qituvchi baholashi → band) |
| Playwright `multilevel-full.mjs` | 16/16 |
| Xavfsizlik | talaba: export/validate/commit 403; kalitlar talaba payload'ida yo'q; boshqa o'qituvchi 403; kechikkan javoblar rad etiladi |
| Migratsiya | Prisma manifest mos; yangi migratsiya yo'q |

Batafsil: `docs/EXAM_BUILDER_TEST_REPORT.md`.

## 7. Yakuniy main

**`51cccae`** — ikkala ish oqimini o'z ichiga olgan oxirgi kod commit'i; main push-CI **success**, CodeQL ishga tushdi, deploy ishga tushmagan. Ushbu hisobot keyingi, faqat hujjatdan iborat PR orqali qo'shiladi.

Yakuniy matritsa aynan `51cccae` daraxtida (toza worktree) qayta ishga tushirildi: pytest 1654 ✓ / 4 skip; 26 ta PostgreSQL CI skripti — hammasi o'tdi; tsc 0; Vitest 943/943; ESLint 0 xato; Playwright: exam-builder-2 73/73, ielts-full 10/10, multilevel-full 16/16.

## 8. Qolgan masalalar

- Exam Builder spetsifikatsiyasining bajarilmagan qismlari: alohida ARCHIVED / VALIDATED holatlari
  (model o'zgarishi talab qiladi), undo/redo, savol bankidan imtihonga qo'shish UI va bankka
  import, kalitsiz "shablon eksporti".
- `check_legacy_schema --settings=config.settings.production` lokalda production env talab qiladi —
  hosted CI'da ishlaydi.
- Jonli AI provayderlari (kalit yo'q) bu muhitda sinalmadi; fail-closed holatlar sinalgan.
- Oraliq main SHA'lari (`4446bb7`, `6832fdf`, `e3e380d`) uchun push-CI GitHub navbati tomonidan
  bekor qilingan; ular PR CI'da bir xil daraxt bilan sinalgan.
- Mualliflik siyosati: Gemini hujjatlari "zero AI attribution" ni talab qiladi; bu sessiya
  commit'larida Claude atributsiyasi bor. Egasi qaror qilishi kerak (tarix qayta yozilmaydi).
- Ochiq dependabot PR'lari (#69–#164) bu ish doirasida ko'rib chiqilmadi.

## 9. Production'ga tayyorlik

Tavsiya: **deploy qilish mumkin, lekin faqat egasi tomonidan, qo'lda** (`deploy.yml`,
`workflow_dispatch` + "DEPLOY TO PRODUCTION" + environment tasdig'i). Oldin:
1. Production PostgreSQL zaxira nusxasi (pg_dump) va media zaxirasi.
2. Yangi migratsiya yo'q — rollback = oldingi image/commit'ga qaytish (`ec82893` yoki `7e0e1f3`).
3. Deploy'dan keyin: bitta JSON shablonni qoralamaga import qilish, eksport qilish, talaba sifatida
   mavjud nashr qilingan imtihonni ochish (kalitlar ko'rinmasligi).
Ma'lum xavflar: IELTS paketlarida savol raqamlari endi ko'nikma bo'yicha qayta boshlanishi mumkin
(Mock 27 kabi mavjud imtihonlar allaqachon shunday); Reading full-mock readiness passage
klasterlarini ham qabul qiladi (eski 3-guruh qoidasi o'zgarmagan).

## 10. Yakuniy holat

**FULLY MERGED** — Gemini NEXT 3.0 (#214–#219, tuzatishlar bilan) va Exam Builder 2.0 (#220) bitta tekshirilgan `main` da. Exam Builder spetsifikatsiyasining ayrim qismlari (8-bo'lim) hali amalga oshirilmagan va ochiq qayd etilgan.
