# BESTWAY NEXT 3.0 — mustaqil audit (Claude Opus)

**Sana:** 2026-11-22 · **Tekshirilgan baza:** `origin/main` = `7e0e1f3` · **PR'lar:** #214–#219
(`feat/bestway-next3-phase1…6`).

## Usul

Har bir PR o'z bazasiga nisbatan o'qildi; da'volar kod va testlar bilan solishtirildi; xavfli
da'volar real PostgreSQL'da testlar bilan isbotlandi yoki rad etildi. Tuzatishlar tegishli
feature-branch'ga **yangi commit** sifatida (force-push'siz) qo'shildi va keyingi branch'larga
merge orqali o'tkazildi. Har bir bosqichda: to'liq pytest, tsc, vitest, keyin hosted CI.

## Hajm (asl Gemini o'zgarishlari)

| Bosqich | PR | Ishlab chiqarish kodi | Qolgani |
|---|---|---|---|
| 1 IELTS audit | #214 | ~25 qator backend | 6 test, conftest |
| 2 Smart Import 3.0 | #215 | `extract_html_text` tozalash, wizard UI (~300 qator) | 4 test |
| 3 CBT 3.0 | #216 | ko'k highlight, submit oynasidagi hisoblagichlar | 3 jsdom test |
| 4 AI baholash | #217 | yo'q (faqat mavjud kodni "tekshirish") | 5 test |
| 5 Analitika | #218 | yo'q | 4 test |
| 6 Hardening | #219 | yo'q | 3 test, hujjatlar |

4–6-bosqichlar yangi funksiya qo'shmagan: ular mavjud xizmatlar ustiga testlar yozgan.

## Tasdiqlangan nuqsonlar va tuzatishlar

| # | Jiddiylik | PR | Nuqson | Isbot | Tuzatish (commit) |
|---|---|---|---|---|---|
| G1 | **P0 (xavfsizlik / imtihon halolligi)** | #214 | `submit_view` mijoz yuborgan `force` / `timeUp` / `timeout` bayrog'ini `save_answers(force=True)` ga uzatardi va server muddati tekshiruvi (`assert_time`) o'tkazib yuborilardi: talaba vaqt tugagandan keyin javob yuborib, ularni saqlatib, ball olishi mumkin edi. Gemini testi aynan shu chetlab o'tishni "to'g'ri" deb tasdiqlagan. | Kod o'qish + test | `28b13bb`: `save_answers` endi `force` qabul qilmaydi; submit bilan kelgan javoblar odatiy muddat bilan saqlanadi, vaqt tugagan bo'lsa tashlanadi, urinish baribir topshiriladi. 3 ta yangi test. |
| G2 | **P1 (ma'lumot yaxlitligi)** | #214 | `@transaction.atomic` uchta baholash/topshiriq view'ida `@api_view` dan **tashqariga** ko'chirilgan. DRF `ContractAPIException` ni ichkarida 4xx javobga aylantiradi, tashqi atomic blok oddiy qaytishni ko'radi va xatodan oldingi yozuvlarni **commit** qiladi. Sabab — testlardagi mock muammosi (o'sha PR'dagi `conftest.py` uni allaqachon hal qilgan). | Real jadvalda DB testi: to'g'ri tartib rollback qiladi, Gemini tartibi qisman yozuvni saqlaydi | `28b13bb`: asl tartib tiklandi + strukturaviy va DB testlari |
| G3 | P2 (soxta funksiya) | #215 | "Draft holatini saqlash": `if hasattr(locked, "status")` — `MockExam` da `status` ustuni yo'q, frontend `isDraft` yubormaydi; kod hech qachon ishlamagan. Test faqat soxta obyektda `status` borligi uchun o'tgan. | Model maydonlari tekshiruvi | `eeac94b`: o'lik kod olib tashlandi, test haqiqiy modelni tekshiradi |
| G4 | P1 (soxta baholash dalili) | #217 | Test `_generate_heuristic_speech_diagnostics` transkriptda "comfortable", "specific" kabi so'zlar *uchragani uchun* ularni "noto'g'ri talaffuz qilingan" deb belgilashini funksiya sifatida tasdiqlagan. Transkript talaffuz dalili emas. Funksiyaning hozir chaqiruvchisi yo'q (STT provayderlari bo'sh diagnostika qaytaradi, worker `pronunciationEvidence=UNAVAILABLE` qiladi) — lekin ulansa, soxta talaffuz fikri chiqardi. | Kod o'qish, chaqiruvlar qidiruvi | `f0db9c0`: funksiya endi hech qachon `mispronounced_words` bermaydi; ikki test halol shartni tekshiradi |
| G5 | P3 (soxta test) | #219 | `test_git_authorship_attribution_hygiene` git tarixini emas, qattiq yozilgan satrni tekshiradi — hech qachon yiqila olmaydi. | Kod o'qish | `75e4e27`: olib tashlandi |

## Nuqson topilmagan joylar

- #215 `extract_html_text`: izohlar, `<script|style|noscript|iframe|xml>`, Office `o:`/`w:` teglar,
  zero-width belgilar olib tashlanadi; matn chiqaruvchi (HTML render qilinmaydi). Wizard UI mavjud
  parser holati ustidagi taqdimot — yangi import dvigateli emas.
- #216: to'rtinchi highlight rangi annotatsiya modelining barcha yo'llaridan o'tadi (faqat
  localStorage, serverga yuborilmaydi); flagged soni runner holatidan; en/uz kalitlari bor.
- #218: RBAC testlari (talaba 403, boshqa o'qituvchi 403) mavjud servislarga mos.
- #219: throttle ierarxiyasi testlari haqiqiy klasslarni tekshiradi.
- Hech bir PR `.github/workflows` ni o'zgartirmagan; migratsiya yo'q.

## Bajarilmagan / tekshirib bo'lmagan Gemini da'volari

- Handoff "115 / 1571 test o'tdi", "4/4 CI" — bular PR #214–#219 dagi haqiqiy CI natijalariga
  mos (tekshirildi), lekin 4–6-bosqichlarning "production-grade overhaul" ta'rifi ortiqcha:
  ular yangi ishlab chiqarish kodi qo'shmagan.
- "Zero AI attribution" — bu loyiha egasining siyosati; repo qoidalarida (CLAUDE.md) yo'q.
  Ushbu sessiya commit'lari Claude Code atributsiyasi bilan yozilgan; egasi boshqacha
  istasa, keyingi commit'larda o'zgartirish mumkin (tarixni qayta yozmasdan).
