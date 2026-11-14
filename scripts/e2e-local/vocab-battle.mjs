// BESTWAY local browser check of the Live Vocab Battle podium (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev), loopback only. Two runs with the
// teacher and the student on swapped viewport / theme / language:
//   BW_WEB=http://localhost:3300 BW_API=http://127.0.0.1:8100/v1 node vocab-battle.mjs
// Checks: the podium shows only the points the FINISHED state reports in `winners`, a
// player without a game score is not on it, and a repeated /finish gives nothing again.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const API = process.env.BW_API || "http://127.0.0.1:8100/v1";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const STUDENT_ONE = process.env.BW_STUDENT_ONE || "+998900000010";
for (const url of [WEB, API]) {
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname)) {
    console.error(`Refusing to run against non-loopback host: ${url}`);
    process.exit(2);
  }
}
const messages = (locale) => JSON.parse(readFileSync(join(here, "..", "..", "frontend", "messages", `${locale}.json`), "utf8"));
const M = { en: messages("en"), uz: messages("uz") };
const OUT = join(here, "..", "..", ".local", "e2e", "vocab-battle");
mkdirSync(OUT, { recursive: true });
const results = []; const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };

async function ctx(browser, { locale, dark, width, height }) {
  const c = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await c.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
  await c.addInitScript((d) => { try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  return c;
}
async function login(page, phone, locale) {
  await page.goto(`${WEB}/en/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", phone); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard|teacher|super-admin|students|groups/);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);   // /en/login resets it
  await page.goto(`${WEB}${locale === "en" ? "/en" : ""}/vocabulary`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function apiLogin(phone) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: PASSWORD }) });
  const d = (await r.json()).data; return { token: d.accessToken, id: d.user.id };
}
const call = async (token, path, method = "GET", body) => (await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const pointsLogs = async (token, id) => (await call(token, `/points/${id}`)).data;

async function run(name, teacherOpt, studentOpt) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
  const errors = [];
  const tc = await ctx(browser, teacherOpt), sc = await ctx(browser, studentOpt);
  const tp = await tc.newPage(), sp = await sc.newPage();
  for (const [p, who] of [[tp, "teacher"], [sp, "student"]]) {
    // The Google Sign-In widget cannot load on localhost ("gis is not defined"); unrelated to the app.
    p.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(`${who}: ${e.message}`); });
    p.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/") && !/google/.test(r.url())) errors.push(`${who}: HTTP ${r.status()} ${r.url()}`); });
  }
  let hostState = null;
  tp.on("response", async (r) => { if (/vocabulary\/battle\/.*(state|next)/.test(r.url()) && r.status() === 200) { try { const j = await r.json(); hostState = j.data ?? j; } catch {} } });
  const T = M[teacherOpt.locale], S = M[studentOpt.locale];
  const student = await apiLogin(STUDENT), zero = await apiLogin(STUDENT_ONE), teacher = await apiLogin(TEACHER);
  await call(teacher.token, "/vocabulary/sets", "POST", { title: `E2E battle ${Date.now()}`, level: "B1", isPublished: true,
    words: [["river", "daryo"], ["bridge", "ko'prik"], ["forest", "o'rmon"], ["mountain", "tog'"]].map(([english, uzbek]) => ({ english, uzbek })) });
  const before = (await pointsLogs(student.token, student.id)).current, zeroBefore = (await pointsLogs(zero.token, zero.id)).current;

  await login(tp, TEACHER, teacherOpt.locale);
  await login(sp, STUDENT, studentOpt.locale);
  await tp.getByRole("button", { name: T.vocabulary.catalog.liveBattle }).first().click();
  await tp.waitForFunction(() => /\b\d{6}\b/.test(document.body.innerText), null, { timeout: 20000 });
  const pin = (await tp.evaluate(() => document.body.innerText.match(/\b\d{6}\b/)[0]));
  await sp.getByRole("button", { name: S.vocabulary.catalog.joinWithPin }).first().click();
  await sp.getByPlaceholder(S.vocabBattle.player.pinPlaceholder).fill(pin);
  await sp.getByRole("button", { name: S.vocabBattle.player.join }).click();
  await sp.getByText(S.vocabBattle.player.inGame).waitFor({ timeout: 15000 });
  await call(zero.token, "/vocabulary/battle/join", "POST", { pin });           // a second player who never scores
  await tp.getByRole("button", { name: T.vocabBattle.host.start }).click();
  let guard = 0;
  while (guard++ < 12) {
    await tp.waitForFunction(() => true); await tp.waitForTimeout(1800);
    if (!hostState || hostState.status === "FINISHED") break;
    if (hostState.status === "QUESTION") {
      const idx = hostState.currentQuestion.correctIndex, qi = hostState.currentQuestionIndex;
      await sp.waitForTimeout(1800);
      await sp.locator("div.grid > button").nth(idx).click({ timeout: 10000 });
      await sp.getByText(S.vocabBattle.player.correct).waitFor({ timeout: 10000 });
      if (qi === 0) await call(zero.token, `/vocabulary/battle/${pin}/answer`, "POST", { questionIndex: 0, selectedIndex: (idx + 1) % 4, elapsedSec: 1 });
      await tp.getByRole("button", { name: T.vocabBattle.host.showLeaderboard }).click();
      await tp.waitForTimeout(1200);
    }
    const last = hostState.currentQuestionIndex + 1 >= hostState.totalQuestions;
    await tp.getByRole("button", { name: last ? T.vocabBattle.host.announce : T.vocabBattle.host.nextQuestion }).click();
  }
  await tp.getByText(T.vocabBattle.host.podiumTitle).waitFor({ timeout: 15000 });
  await sp.getByText(S.vocabBattle.player.finishedTitle).waitFor({ timeout: 15000 });
  const fmt = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k]);
  const hostText = await tp.evaluate(() => document.body.innerText), playerText = await sp.evaluate(() => document.body.innerText);
  ok(hostText.includes(fmt(T.vocabBattle.pointsAwarded, { points: 10 })), `${name}: host podium shows the +10 the server recorded`);
  ok(!/\+7|\+5/.test(hostText), `${name}: host shows no award for places nobody took`);
  ok(playerText.includes(fmt(S.vocabBattle.player.yourPlace, { rank: 1 })) && playerText.includes(fmt(S.vocabBattle.pointsAwarded, { points: 10 })), `${name}: student sees own place and +10`);
  const state = (await call(teacher.token, `/vocabulary/battle/${pin}/state`)).data;
  ok(state.winners.length === 1 && state.winners[0].studentId === student.id && state.winners[0].pointsAwarded === 10, `${name}: state.winners has only the scorer (zero-score player excluded)`);
  const again = await call(teacher.token, `/vocabulary/battle/${pin}/finish`, "POST");
  await call(teacher.token, `/vocabulary/battle/${pin}/finish`, "POST");
  ok(JSON.stringify(again.data.winners) === JSON.stringify(state.winners), `${name}: repeated /finish returns the same winners`);
  const after = (await pointsLogs(student.token, student.id)).current, zeroAfter = (await pointsLogs(zero.token, zero.id)).current;
  ok(after - before === 10, `${name}: student's points grew by exactly 10 (${before} -> ${after}) after repeated /finish`);
  ok(zeroAfter === zeroBefore, `${name}: zero-score player's points unchanged`);
  for (const [p, who, o] of [[tp, "teacher", teacherOpt], [sp, "student", studentOpt]]) {
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 1, `${name}: ${who} ${o.width}px no horizontal overflow (${overflow})`);
    await p.screenshot({ path: `${OUT}/battle-${name}-${who}-${o.locale}-${o.dark ? "dark" : "light"}-${o.width}.png` });
  }
  ok(errors.length === 0, `${name}: no page errors or API errors ${errors.slice(0, 3).join(" | ")}`);
  await browser.close();
}
(async () => {
  await run("A", { locale: "en", dark: false, width: 1440, height: 900 }, { locale: "uz", dark: true, width: 390, height: 844 });
  await run("B", { locale: "uz", dark: true, width: 390, height: 844 }, { locale: "en", dark: false, width: 1440, height: 900 });
  const failed = results.filter(([c]) => !c).length;
  console.log(`${results.length - failed}/${results.length} PASS`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
