# BESTWAY NEXT 3.0 — merge hisoboti

**Sana:** 2026-11-22 · **Boshlang'ich main:** `7e0e1f3` · **Yakuniy main (Gemini):** `ec82893`

## Deploy xavfsizligi (merge'dan oldin tekshirildi)

- `deploy.yml` va `deploy-django.yml` faqat `workflow_dispatch` (qo'lda), "DEPLOY TO PRODUCTION"
  tasdiq matni va himoyalangan environment tasdig'ini talab qiladi. `main` ga push faqat `CI` va
  CodeQL'ni ishga tushiradi.
- Hech bir Gemini PR `.github/workflows` ni o'zgartirmagan.
- Har bir merge'dan keyin `main` dagi workflow run'lari tekshirildi: faqat CI / CodeQL; **deploy
  ishga tushmagan**.

## PR'lar (ketma-ket, force-push'siz, `expectedHeadSha` bilan)

| Bosqich | PR | Branch | Ko'rib chiqishdan keyingi head | Hosted CI (head) | Merge SHA |
|---|---|---|---|---|---|
| 1 IELTS audit | [#214](https://github.com/bestwayec/bestway/pull/214) | `feat/bestway-next3-phase1-exam-audit` | `28b13bb` | django ✓ frontend ✓ CodeQL py ✓ js ✓ | `344086a` |
| 2 Smart Import 3.0 | [#215](https://github.com/bestwayec/bestway/pull/215) | `feat/bestway-next3-phase2-smart-import` | `7b3e240` | 4/4 ✓ | `4446bb7` |
| 3 CBT 3.0 | [#216](https://github.com/bestwayec/bestway/pull/216) | `feat/bestway-next3-phase3-cbt` | `442ef99` | 4/4 ✓ | `6832fdf` |
| 4 AI baholash | [#217](https://github.com/bestwayec/bestway/pull/217) | `feat/bestway-next3-phase4-ai-evaluation` | `f0db9c0` | 4/4 ✓ | `e3e380d` |
| 5 Analitika | [#218](https://github.com/bestwayec/bestway/pull/218) | `feat/bestway-next3-phase5-analytics` | `e03f2a8` | 4/4 ✓ | `be0a46a` |
| 6 Hardening | [#219](https://github.com/bestwayec/bestway/pull/219) | `feat/bestway-next3-phase6-hardening` | `75e4e27` | 4/4 ✓ | `ec82893` |

Bog'liqlik grafi: branch'lar 1→2→…→6 zanjir bo'lib qurilgan, lekin hammasi `main` ga
yo'naltirilgan (har biri oldingilarini o'z ichiga oladi). 3→4, 4→5, 5→6 da bir xil i18n tuzatishi
alohida cherry-pick qilingan edi (diverge). Har bir tuzatilgan branch keyingisiga oddiy merge
orqali o'tkazildi, shuning uchun har bir PR'ning test qilingan daraxti merge'dan keyingi `main`
daraxti bilan bir xil.

Har bir PR tavsifiga "Independent review — corrected before merge" bo'limi qo'shildi (nima
o'zgargani va nega).

## Ko'rib chiqish tuzatishlari (commit'lar)

| Commit | PR | Mazmun |
|---|---|---|
| `28b13bb` | #214 | Kechikkan javoblarni saqlash teshigi yopildi; `@transaction.atomic` tartibi tiklandi |
| `eeac94b` | #215 | Hech qachon ishlamagan "draft status" kodi va soxta-model testi olib tashlandi |
| `f0db9c0` | #217 | Transkriptdan "noto'g'ri talaffuz" chiqarish to'xtatildi |
| `75e4e27` | #219 | Yiqila olmaydigan tautologik test olib tashlandi |

Batafsil: `docs/BESTWAY_NEXT_3_OPUS_REVIEW.md`.

## Lokal tekshiruv (har bir tuzatilgan branch)

| Branch | pytest (PostgreSQL 16) | tsc | vitest |
|---|---|---|---|
| phase1 | 1615 ✓, 4 skip | — | — |
| phase2 | 1619 ✓, 4 skip | 0 | 907/907 |
| phase3 | 1619 ✓, 4 skip | 0 | 910/910 |
| phase4 | 1624 ✓, 4 skip | — | — |
| phase6 (yakuniy stek) | 1630 ✓, 4 skip | 0 | 910/910, ESLint 0 xato |

4 ta skip — mavjud bo'lmagan eski NestJS `dist` ga bog'liq differensial testlar (asl `main` da ham).

`main` = `be0a46a` da PostgreSQL skriptlari (CI env bilan): grading 79/79, E2E journeys 41/41,
Mock 27 81/81, readiness contract o'tdi.

## Main'dagi push-CI haqida eslatma

GitHub `concurrency` guruhi bir vaqtda bitta ishlayotgan va bitta kutayotgan run'ni saqlaydi:
ketma-ket merge'larda oraliq `main` SHA'lari (`4446bb7`, `6832fdf`, `e3e380d`) uchun kutayotgan
push-run'lar **bekor qilindi** (cancelled). Bu SHA'lar PR CI'da (bir xil daraxt) sinalgan; to'liq
push-CI natijasi yakuniy `main` uchun `BESTWAY_FINAL_INTEGRATION_REPORT.md` da qayd etilgan.
