# BESTWAY — egasi uchun yakuniy qabul sinovi (Telegram Bot 2.0 + IELTS Mock 27)

Bu qo'llanma PR #210 (Telegram Bot 2.0 + yagona test dvigateli) va PR #209 (IELTS Academic Mock 27) **merge qilingandan
keyin**, haqiqiy Telegram'da qo'lda tekshirish uchun. Avtomatik tekshiruvlar (Django testlari, PostgreSQL skriptlari, CI)
allaqachon o'tgan; bu yerda faqat **haqiqiy qurilma va haqiqiy Telegram** bilan tasdiqlanadigan narsalar bor.

> Faqat **sintetik / sinov akkauntlari** ishlating (masalan "Test O'quvchi 1", "Test Ustoz 1"). Haqiqiy o'quvchilarni
> sinovga jalb qilmang. Sinov guruhini alohida yarating ("QA guruh"), unga faqat sinov o'quvchilarini qo'shing.

## 0. Tayyorgarlik (bir marta)

| Qadam | Kutilgan natija |
|---|---|
| Merge tartibi: **avval PR #210, keyin PR #209**. | Ikkalasi ham `main`da; `main` CI yashil. |
| Deploy'dan keyin serverda: `python manage.py showmigrations core \| tail -10` | `0018`…`0025`, `0018_mock_exam_gate_and_listening_audio`, `0026_merge_mock27_and_telegram_bot2` — hammasi `[X]`. |
| `python manage.py check_legacy_schema` | `Schema compatible … Prisma ledger verified`. |
| `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` bor; `SUPERADMIN_TELEGRAM_ID` faqat ogohlantirish manzili. | Webhook secret'siz so'rovlar 403 qaytaradi. |
| Outbox worker **ishlamayapti**: `docker compose ps` ichida `telegram-outbox` yo'q. | Bildirishnomalar faqat navbatga yoziladi, hech kimga yuborilmaydi (9-bo'limgacha). |
| 3 ta sinov akkaunti: Test O'quvchi 1, Test O'quvchi 2 (ikkalasi "QA guruh"da), Test Ustoz 1 ("QA guruh" ustozi). Admin akkaunti. | Har biri alohida Telegram akkauntiga ega (ikki telefon yoki Telegram Desktop + telefon). |

**Umumiy xato belgilari:** bot javob bermaydi (webhook/secret yoki token noto'g'ri — server logida `403`); "⚠️ Xatolik"
xabari (server logida `telegram … failed` izi); bir tugma bosilganda ikki marta javob kelishi (dublikat — xato, darhol xabar bering).

## 1. Telegram akkauntini bog'lash

1. Saytga Test O'quvchi 1 sifatida kiring → **"Telegramni ulash"** → bot ochiladi → **Start**.
2. Bot: `✅ Bog'landi! Akkaunt: …` → `/status` → `✅ Bog'langan`.
3. **Salbiy:** o'sha havolani ikkinchi marta yoki boshqa Telegram akkauntidan oching → `❌ Bog'lash havolasi eskirgan yoki ishlatilgan`.
4. **Salbiy:** botni sinov **guruh** chatiga qo'shib, u yerda `/start <havola kodi>` yuboring → `❌ Akkauntni faqat bot bilan shaxsiy chatda bog'lash mumkin.`
5. `/unlink` → `🔌 Uzildi`; keyin qayta bog'lang.

Xato belgisi: bitta havola ikki chatni bog'lasa yoki guruh chati bog'lansa — **P0**, darhol to'xtating.

## 2. O'quvchi testni boshlashi (ustoz yaratgan test kerak — avval 7-bo'limni bajaring)

1. Test O'quvchi 1: `/testlar` → "📝 Mening testlarim" ro'yxati → test kartasi: savollar soni, vaqt chegarasi, muddat, urinishlar.
2. **▶️ Testni boshlash** → "Savol 1/N", taymer (⏱) ko'rinadi.
3. Telegram'ni yopib, 1 daqiqadan keyin `/testlar` → test **▶️** belgisi bilan; ochilganda **javob berilmagan birinchi savoldan** davom etadi.
4. **Salbiy:** guruh chatida `/testlar` → `🔒 Testni shaxsiy chatda ishlang.` (testlar ro'yxati guruhda ko'rinmasligi shart).

## 3. 40 savolli testni yakunlash

1. Ustoz 40 savolli test tuzadi (7-bo'lim, "40" preset), MCQ + True/False + matnli javoblar aralash bo'lsin.
2. O'quvchi barcha savollarga javob beradi: variant tugmalari, True/False, matnli savolga **xabar** yozib yuborish.
3. Bir tugmani tez-tez 2–3 marta bosing → javob **bir marta** saqlanadi ("✅ Saqlandi"), hisob o'zgarmaydi.
4. **🏁 Yakunlash** → "✅ Ha, yakunlash" → natija: `To'g'ri: X / 40`, `Ball: Y%`, sarflangan vaqt.
5. Natija hech qachon "IELTS band" yoki "CEFR" sifatida ko'rsatilmaydi — faqat foiz va to'g'ri javoblar soni.
6. **Kalitlar:** test `maxAttempts = 1` bo'lsa — "🔎 Xatolarni ko'rish" to'g'ri javoblarni ko'rsatadi. `maxAttempts = 2` bo'lsa —
   birinchi urinishdan keyin xatolar ro'yxati to'g'ri javobsiz: `🔒 To'g'ri javob oxirgi urinishdan yoki muddat tugagach ko'rsatiladi`;
   ikkinchi urinishdan keyin to'g'ri javoblar ochiladi.
   (Telegram ustoz wizard'i har doim `maxAttempts = 1` yaratadi; 2 urinishli topshiriqni HTTP API orqali bering:
   `POST /v1/class-quizzes/<quizId>/assign` `{"groupIds":["<QA guruh id>"],"deadline":"…","maxAttempts":2}` ustoz tokeni bilan.)
7. **Muddat:** qisqa vaqt chegarali test (masalan 5 daqiqa) boshlang va kuting → `⌛ Vaqt tugadi…`, natija avtomatik hisoblanadi; keyin javob qabul qilinmaydi.

Xato belgisi: natija ikki marta yoziladi, foiz noto'g'ri (masalan 31/40 ≠ 77.5%), muddatdan keyin javob qabul qilinadi.

## 4. Natija PNG kartasi

1. Natija ekranida **🖼 Natija kartasi** → rasm **faqat o'quvchining shaxsiy chatiga** keladi.
2. Tekshiring: test nomi, `X / N`, foiz (masalan `77.5%`), vaqt, sana; o'zbekcha harflar (o', g', sh) to'g'ri chiqadi, matn kesilmagan.
3. Kartada boshqa o'quvchining ismi, telefon raqami yoki to'g'ri javoblar yo'q.
4. Avtomatik karta bir natija uchun **bir marta** keladi (qayta yakunlash bosilsa ham ikkinchi karta kelmaydi).

## 5. Lug'at mashqi

1. Ustoz/admin sinov lug'at to'plamini yaratadi (10 ta so'z, ba'zilari bir nechta tarjimali: `katta, ulkan`).
2. O'quvchi: `/lugat` → to'plam → mashq turi: inglizcha→o'zbekcha, o'zbekcha→inglizcha, yozilish (spelling), test (variantli), aralash.
3. Tekshiring: `katta` ham, `ulkan` ham to'g'ri; `o‘g‘il` va `o'g'il` (har xil apostrof) bir xil qabul qilinadi; katta/kichik harf farqi yo'q.
4. **Salbiy:** imlo xatosi (`beautifull`) **noto'g'ri** deb hisoblanadi (taxminiy moslashtirish yo'q).
5. Noto'g'ri javobda "javobim qabul qilinsin" so'rovi → ustoz tasdiqlasa, keyingi safar shu variant qabul qilinadi.
6. Natija (`/natija`) saytdagi lug'at natijasi bilan bir xil.

## 6. `/takror` — takrorlash (SRS)

1. Mashqda xato qilingan so'zlar takrorlash navbatiga tushadi. `/takror` → bugungi takrorlanadigan so'zlar.
2. To'g'ri javob → keyingi takrorlash **1, 3, 7, 14, 30 kun** ketma-ketligida uzoqlashadi; noto'g'ri → ~10 daqiqadan keyin qaytadi.
3. Bitta so'zga sayt va botda bir vaqtda javob berilsa ham jadval **bir marta** o'zgaradi.
4. Test O'quvchi 2 ning takrorlash ro'yxati O'quvchi 1 nikidan mustaqil.

## 7. Ustoz test yaratishi (Telegram)

1. Test Ustoz 1: `/yangitest` (yoki `/newtest`) → nom → tur (grammatika / lug'at / aralash) → savollar soni **10/20/30/40** → vaqt chegarasi.
2. Savollarni mavjud formatda joylashtiring (`1. Savol…\nA) …\nB) …`) va javob kalitini (`1 A`, `2 C` …) yuboring.
3. Bot nechta savol import qilinganini ko'rsatadi; xatolar (kalitsiz savol, takroriy variant) aniq aytiladi.

## 8. Guruhga biriktirish va kuzatish

1. Import tugagach bot **faqat ustozning o'z guruhlarini** taklif qiladi → "QA guruh" → muddat (24 soat va h.k.).
2. Muddat tugmasini ikki marta bosish **bitta** topshiriq yaratadi.
3. `/topshiriqlar` → test → natijalar: topshirganlar soni, % bajarilish, o'rtacha, topshirmaganlar ro'yxati; **CSV** va
   **guruh kartasi** faqat ustozning shaxsiy chatiga keladi (kartada ismlar yo'q, faqat umumiy ko'rsatkichlar).
4. **Salbiy:** ikkinchi ustoz akkaunti (Test Ustoz 2) bu topshiriq tugmalarini bossa → ruxsat yo'q xabari, ma'lumot ko'rinmaydi.
5. Ustoz test savolini keyin tahrirlasa, **allaqachon berilgan** topshiriqdagi savollar va natijalar o'zgarmaydi.

## 9. Ustoz — apellyatsiyalar

1. O'quvchi matnli savolda "noto'g'ri" baholangan, lekin ma'noli javob bergan bo'lsin → xatolar ro'yxatida **✍️ N-javobim qabul qilinsin**.
2. Ustoz: `/sorovlar` → so'rov kartasi (savol, o'quvchi javobi, to'g'ri javob) → **Tasdiqlash** yoki **Rad etish**.
3. Tasdiqlanganda: o'quvchining natijasi qayta hisoblanadi (masalan 77.5% → 80%), xuddi shu javobni bergan boshqa o'quvchilar ham avtomatik yangilanadi;
   tuzatish tarixi saqlanadi. Rad etilganda natija o'zgarmaydi.
4. **Salbiy:** O'quvchi 2 O'quvchi 1 ning urinishi uchun so'rov yubora olmaydi; Test Ustoz 2 bu so'rovni ko'rmaydi.

## 10. Bildirishnoma sozlamalari va outbox

1. `/sozlamalar` → til (uz/en), bildirishnomalar yoqish/o'chirish, tinch soatlar (22:00–07:00 Toshkent), turlar bo'yicha o'chirish.
2. Navbatni ko'ring (yuborilmaydi): `SELECT status, kind, count(*) FROM "TelegramOutbox" GROUP BY 1,2;` — `pending` qatorlar.
3. **Faqat qaror qabul qilinganda** worker'ni yoqing: `docker compose --profile telegram-outbox up -d telegram-outbox`
   (django compose'da: `docker compose -f docker-compose.django.yml --profile telegram-outbox up -d telegram-outbox`).
   `--profile workers` uni **ishga tushirmaydi**.
4. Kutilgan: sinov o'quvchilariga "Yangi test" xabari **bir marta** keladi; bildirishnomani o'chirgan o'quvchiga kelmaydi; tinch soatlarda
   kelgan xabar tinch soat tugagach yuboriladi. Worker'ni to'xtatsangiz (`docker compose stop telegram-outbox`) xabarlar navbatda qoladi.
5. Xato belgisi: bitta xabar ikki marta kelishi; o'chirilgan turdagi xabar kelishi; boshqa o'quvchiga tegishli xabar kelishi.

> Muhim: kod bir muddat ishlagan bo'lsa, worker yoqilishidan oldin navbatda eski xabarlar to'planadi. Avval navbatni ko'rib chiqing.

## 11. IELTS Mock 27 — DRAFT ko'rinishi

1. Admin: **Exams → Exam Builder** → "BESTWAY IELTS Academic — Full Mock Test 27" — **Draft** belgisi bilan.
2. O'quvchi akkauntida mock katalogini oching → Mock 27 **ko'rinmasligi kerak**; Telegram `/mock` ro'yxatida ham yo'q.
3. Builder → Review: Listening 40/40, Reading 40/40, Writing 2 topshiriq, Speaking 3 qism; "Blocking publication" ro'yxatida audio va kontent huquqi.
4. **Publish** bosilsa → rad etiladi (`MOCK_NOT_READY` / audio tasdiqlanmagan / huquq tasdiqlanmagan).
5. Xato belgisi: Mock 27 o'quvchiga ko'rinadi yoki javob kalitlari o'quvchi so'rovida keladi — **P0**.

Import hali qilinmagan bo'lsa: `docs/MOCK27_IMPORT_AND_PUBLICATION.md` 3-bo'lim (avval `check_mock27 --stage preflight`).

## 12. Listening audiosini yuklash va tasdiqlash

Batafsil: `docs/MOCK27_IMPORT_AND_PUBLICATION.md` 4-bo'lim. Qisqacha:

1. Admin → Builder → Mock 27 → **Listening** → "Listening audio status". Har bir qism (Q1–10, Q11–20, Q21–30, Q31–40) uchun **Upload audio**
   (`.mp3`/`.m4a`, 1–20 daqiqa, ≤ 200 MB) → **UPLOADED** belgisi, format/davomiylik/hajm ko'rinadi.
2. **Salbiy:** nomi o'zgartirilgan rasm/PDF yoki juda qisqa fayl → aniq xato, qism avvalgi holatida qoladi.
3. Har bir qismni to'liq tinglab **Verify** → "I listened to the whole recording" + eshitilgan savollarni belgilash → **VERIFIED**.
4. Sarlavha **4/4 verified**. Faylni almashtirish yoki kalitni tahrirlash qismni **UPLOADED** ga qaytaradi (qayta tasdiqlash kerak).
5. O'qituvchi o'z imtihoniga yuklay oladi, lekin **tasdiqlay olmaydi**; boshqa o'qituvchi umuman yuklay olmaydi.
6. Kontent huquqi yozma ruxsat bo'lmasa — **tasdiqlamang**; original variant (`import_mock27 --content original`) huquq muammosini yopadi.
   Barcha blokerlar yopilmaguncha Mock 27 DRAFT bo'lib qoladi.

## Rollback

* Kod: oldingi image'ni deploy qiling. Yangi jadvallar ishlatilmay qoladi — ma'lumot o'chmaydi.
* `migrate core 0017` **ikkala** funksiyaning jadvallarini (testlar, apellyatsiyalar, outbox, Mock 27 audio/gate) o'chiradi — faqat eksportdan keyin.
* Bildirishnomalarni to'xtatish: `docker compose stop telegram-outbox`.

## Avtomatik tekshirilmagan (shu qo'llanma bilan tasdiqlanadi)

Haqiqiy Telegram mijozlari (Android/iOS/Desktop) da ko'rinish, haqiqiy push yetkazilishi, haqiqiy Telegram rate-limit'lari,
haqiqiy Listening yozuvlari, ishlab chiqarish serveridagi shriftlar. Bularning hech biri avtomatik testlarda "PASS" deb hisoblanmagan.
