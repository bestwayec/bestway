// BESTWAY local browser check of the teacher's live exam pages (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev), loopback only:
//   BW_WEB=http://localhost:3300 node teacher-live.mjs
// The live PIN room panel (Mock page) and the group's live monitoring are in the page's
// language (no leftover Uzbek on the English page and the reverse), on theme tokens, with
// no page errors, at 1440 and 390, light and dark. A student in a timed exam who left the
// window shows as "Recorded: n", never as a violation.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const TEACHER = process.env.BW_TEACHER || "+998900000003";
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) {
  console.error(`Refusing to run against non-loopback host: ${WEB}`);
  process.exit(2);
}
const OUT = join(here, "..", "..", ".local", "e2e", "teacher-live");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
// Words of the old hard-coded panels in each language.
// Words found only in these two panels (old hard-coded text and the other language's keys).
const LEFTOVER = { en: /Jonli imtihon|Faol xona|Yangi Live|PIN nusxalash|Qoidabuzarlik|Xavfsiz rejimda|Monitoring ma|ogohlantirish/, uz: /Live exam room|Open a live exam|No active room|Nothing recorded|Live exam monitoring|Live Exam Room/ };

async function run(name, { locale, width, height, dark }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((d) => { try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", TEACHER); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard|teacher/); await page.waitForLoadState("networkidle").catch(() => {});
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
  const prefix = locale === "en" ? "/en" : "";

  await page.goto(`${WEB}${prefix}/mock`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /PIN/ }).first().click({ timeout: 30000 });
  const panel = page.getByText(locale === "en" ? "Live exam room (PIN)" : "Jonli imtihon xonasi (PIN)").first();
  await panel.waitFor({ timeout: 30000 });
  ok(!LEFTOVER[locale].test(await page.locator("main").innerText()), `${name}: the live room panel has no text of the other language`);
  const openButton = page.getByRole("button", { name: locale === "en" ? "Open a live exam (PIN)" : "Jonli imtihon ochish (PIN)" });
  ok(await openButton.isVisible(), `${name}: the "open a live exam" button is in the page language`);
  await openButton.click();
  const form = await page.locator("form").filter({ hasText: locale === "en" ? "Set up a live exam room" : "Jonli imtihon xonasini sozlash" }).first().innerText();
  ok(!LEFTOVER[locale].test(form), `${name}: the room form has no text of the other language`);
  await page.screenshot({ path: join(OUT, `room-${name}-${locale}-${dark ? "dark" : "light"}-${width}.png`) });

  await page.goto(`${WEB}${prefix}/groups`, { waitUntil: "domcontentloaded" });
  const groupLink = page.locator('a[href*="/groups/"]').first();
  await groupLink.waitFor({ timeout: 30000 });
  await groupLink.click();
  const monitor = page.getByText(locale === "en" ? "Live exam monitoring" : "Jonli imtihon kuzatuvi").first();
  const shown = await monitor.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  ok(shown, `${name}: the group's live monitoring is in the page language`);
  if (shown) {
    ok(!LEFTOVER[locale].test(await page.locator("main").innerText()), `${name}: the live monitoring has no text of the other language`);
    ok(!/Qoidabuzarlik|Xavfsiz rejimda|🔴|🟢/.test(await page.locator("main").innerText()), `${name}: no accusing wording ("violation", red/green emoji)`);
    await page.screenshot({ path: join(OUT, `monitor-${name}-${locale}-${dark ? "dark" : "light"}-${width}.png`) });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `${name}: no horizontal overflow (${overflow})`);
  ok(errors.length === 0, `${name}: no page errors ${errors.slice(0, 2).join(" | ")}`);
  await ctx.close();
}

await run("A", { locale: "en", width: 1440, height: 900, dark: false });
await run("B", { locale: "uz", width: 390, height: 844, dark: true });
await browser.close();
const failed = results.filter(([pass]) => !pass);
console.log(`${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
