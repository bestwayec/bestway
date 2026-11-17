// BESTWAY local screenshots of the public site (landing, download page, footer) and the exam window's
// Clear answers dialog. Synthetic accounts and exams only, loopback only.
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node site-screens.mjs OUT_DIR [--no-exam]
// Prints, per page and size: horizontal overflow, Uzbek words found on an English page, and the
// header menu entries. The exam part needs the synthetic IELTS exam that ielts-full.mjs builds.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = process.argv[2] || join(here, "..", "..", ".local", "e2e", "site");
mkdirSync(OUT, { recursive: true });
const withExam = !process.argv.includes("--no-exam");
const STATE = join(here, "..", "..", ".local", "e2e", "ielts-full.json");
const VIEWPORTS = [[1366, 768], [390, 844], [360, 640]];
// Words that only appear in Uzbek copy (checked on /en pages).
const UZBEK = /\b(Barcha|huquqlar|himoyalangan|Sizda|so'm|Yuklab|Ilovasi|Ruxsat|Bering|O'rnatgich\w*|Platformalar|uchun|bilan|qiling|kiring|tayyorlanmoqda)\b/;

const browser = await chromium.launch({ ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
let problems = 0;
for (const theme of ["light", "dark"]) for (const [width, height] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch { /* ignore */ } }, theme);
  for (const [name, path] of [["landing", "/en"], ["download", "/en/download"]]) {
    await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const text = await page.locator("body").innerText();
    const uz = text.split("\n").filter((line) => UZBEK.test(line));
    const menu = await page.locator('header [role="tablist"] [role="tab"], header nav a[href*="#"]').allInnerTexts().catch(() => []);
    await page.screenshot({ path: join(OUT, `${name}-top-${width}x${height}-${theme}.png`) });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${name}-bottom-${width}x${height}-${theme}.png`) });
    if (overflow > 0 || uz.length) problems++;
    console.log(`${theme} ${width}x${height} ${name}: overflow ${overflow}px; Uzbek lines on /en: ${uz.length ? uz.map((l) => JSON.stringify(l.slice(0, 60))).join(", ") : "none"}${menu.length ? `; menu: ${menu.join(" | ")}` : ""}`);
  }
  await ctx.close();
}

if (withExam && existsSync(STATE)) {
  const state = JSON.parse(readFileSync(STATE, "utf8"));
  for (const theme of ["light", "dark"]) for (const [width, height] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, isMobile: width < 500, hasTouch: width < 500 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    await page.addInitScript((t) => { try { sessionStorage.setItem("bw_fullscreen_notice_seen", "1"); localStorage.setItem("theme", t); } catch { /* ignore */ } }, theme);
    await page.goto(`${WEB}/en/login`);
    await page.locator('input[type="tel"], input[name="phone"]').first().fill(process.env.BW_STUDENT_IELTS || "+998900000011");
    await page.locator('input[type="password"]').fill(process.env.BW_PASSWORD || "LocalDev-2026!");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
    const api = async (method, path, body) => {
      const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, ...(body ? { data: body } : {}) });
      return (await res.json().catch(() => ({}))).data;
    };
    const mine = await api("GET", "/mock/attempts/mine");
    for (const a of (Array.isArray(mine) ? mine : mine?.items ?? []).filter((x) => x.examId === state.examId && x.status === "in_progress"))
      await api("POST", `/mock/attempts/${a.id}/submit`, { confirm: true, confirmed: true, force: true });
    const started = await api("POST", `/mock/exams/${state.examId}/start`, { mode: "practice", flow: "single_skill", skills: ["reading"] });
    await page.goto(`${WEB}/en/mock/attempt/${started.attemptId}`, { waitUntil: "networkidle" });
    for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
      const dialog = page.getByTestId(id);
      if (await dialog.count()) await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {});
    }
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
    // Answer two questions of the first passage, then open Info → Clear answers.
    const radios = page.locator("[id^='q-'] input[type='radio']");
    if (width < 500) { const toQuestions = page.getByRole("button", { name: /Questions|Go to questions/ }).first(); if (await toQuestions.count()) await toQuestions.click(); }
    for (const i of [0, 3]) { await radios.nth(i).evaluate((el) => el.scrollIntoView({ block: "center" })); await radios.nth(i).check(); }
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^(Info|Exam info)/ }).first().click();
    await page.getByRole("button", { name: "Clear answers" }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
    const choice = await page.getByTestId("clear-scope").count();
    await page.screenshot({ path: join(OUT, `clear-dialog-${width}x${height}-${theme}.png`) });
    console.log(`${theme} ${width}x${height} clear dialog: ${choice ? "part / section choice" : "section only"}`);
    await page.keyboard.press("Escape");
    await api("POST", `/mock/attempts/${started.attemptId}/submit`, { confirm: true, confirmed: true, force: true });
    await ctx.close();
  }
}
await browser.close();
console.log(problems ? `\n${problems} page(s) with overflow or Uzbek text on /en` : "\nno overflow, no Uzbek text on /en");
