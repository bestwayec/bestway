// BESTWAY local screenshots of the catalogue and the result page (synthetic accounts and exams only).
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node ui-screens.mjs OUT_DIR
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = process.argv[2] || join(here, "..", "..", ".local", "e2e", "ui");
mkdirSync(OUT, { recursive: true });
const state = JSON.parse(readFileSync(join(here, "..", "..", ".local", "e2e", "ielts-full.json"), "utf8"));
const browser = await chromium.launch({ ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
const VIEWPORTS = [[1366, 768], [1440, 900], [390, 844], [360, 640]];
for (const theme of ["light", "dark"]) for (const [width, height] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch { /* ignore */ } }, theme);
  await page.goto(`${WEB}/en/login`);
  await page.locator('input[type="tel"], input[name="phone"]').first().fill(process.env.BW_STUDENT_IELTS || "+998900000011");
  await page.locator('input[type="password"]').fill(process.env.BW_PASSWORD || "LocalDev-2026!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.goto(`${WEB}/en/mock`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: join(OUT, `catalogue-${width}x${height}-${theme}.png`) });
  await page.goto(`${WEB}/en/mock/attempt/${state.attemptId}`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const table = page.locator("table").first();
  await table.waitFor({ timeout: 30000 }).catch(() => {});
  await table.scrollIntoViewIfNeeded().catch(() => {});
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: join(OUT, `result-${width}x${height}-${theme}.png`) });
  console.log(`${theme} ${width}x${height}: catalogue overflow ${overflow}px, result overflow ${overflow2}px, tables ${await page.locator("table").count()}`);
  await ctx.close();
}
await browser.close();
