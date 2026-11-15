// BESTWAY local all-roles crawl + accessibility check (Playwright + axe-core, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev), loopback only:
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node roles-crawl.mjs [--theme light|dark|both] [--locale en|uz]
// For every role it signs in, follows the in-app links (same locale, breadth first, a few pages per
// route pattern) and checks each page: it loads (HTTP < 400), no page error, no error boundary, no raw
// translation key, no horizontal overflow, and axe (WCAG 2.0/2.1 A + AA) finds no critical or serious
// violation. Report: ../../.local/e2e/roles-crawl.json. Exit 1 when any page fails.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", ".local", "e2e");
mkdirSync(OUT, { recursive: true });
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const themes = opt("--theme", "light") === "both" ? ["light", "dark"] : [opt("--theme", "light")];
const locale = opt("--locale", "en");
const MAX_PAGES = Number(process.env.BW_MAX_PAGES || 45);
const PER_PATTERN = 2;
const ROLES = [
  ["student", process.env.BW_STUDENT || "+998900000011"],
  ["teacher", process.env.BW_TEACHER || "+998900000003"],
  ["admin", process.env.BW_ADMIN || "+998900000002"],
  ["parent", process.env.BW_PARENT || "+998900000020"],
];
if (process.env.BW_SUPER) ROLES.push(["super_admin", process.env.BW_SUPER]);
const AXE = readFileSync(join(here, "..", "..", "frontend", "node_modules", "axe-core", "axe.min.js"), "utf8");
const messages = JSON.parse(readFileSync(join(here, "..", "..", "frontend", "messages", "en.json"), "utf8"));
// A raw key looks like "<top-level namespace>.<key>" (e.g. mock.stepper.palette).
const RAW_KEY = new RegExp(`\\b(?:${Object.keys(messages).join("|")})\\.[A-Za-z_]+(?:\\.[A-Za-z_]+)*\\b`);
const SKIP = /\/(logout|login)(\/|$)|\/api\/|\.(pdf|png|jpe?g|csv|xlsx)$/i;

const pattern = (path) => path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\/\d+(?=\/|$)/g, "/:n").replace(/MOCK-[A-Z0-9-]+/g, ":code");

const browser = await chromium.launch({ ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}), args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const report = [];

async function crawl(role, phone, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript((t) => { try { localStorage.setItem("theme", t); sessionStorage.setItem("bw_fullscreen_notice_seen", "1"); } catch { /* ignore */ } }, theme);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(`${WEB}/${locale}/login`);
  await page.locator('input[type="tel"], input[name="phone"]').first().fill(phone);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
  const start = new URL(page.url()).pathname;

  const queue = [start];
  const seen = new Set();
  const perPattern = new Map();
  let visited = 0;
  while (queue.length && visited < MAX_PAGES) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const key = pattern(path);
    if ((perPattern.get(key) ?? 0) >= PER_PATTERN) continue;
    perPattern.set(key, (perPattern.get(key) ?? 0) + 1);
    visited += 1;
    errors.length = 0;
    const row = { role, theme, path, ok: true, problems: [] };
    try {
      const res = await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (res && res.status() >= 400) row.problems.push(`HTTP ${res.status()}`);
      const finalPath = new URL(page.url()).pathname;
      if (finalPath !== path) row.redirect = finalPath;
      const text = await page.locator("body").innerText().catch(() => "");
      const raw = text.match(RAW_KEY);
      if (raw) row.problems.push(`raw translation key "${raw[0]}"`);
      if (/Something went wrong|Application error|Unhandled Runtime Error/.test(text)) row.problems.push("error screen");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) row.problems.push(`horizontal overflow ${overflow}px`);
      await page.addScriptTag({ content: AXE });
      const axe = await page.evaluate(async () => window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        exclude: [["nextjs-portal"]], // the Next.js dev overlay is not part of the product
      }));
      for (const v of axe.violations.filter((x) => x.impact === "critical" || x.impact === "serious")) {
        const node = v.nodes[0];
        const d = node?.any?.[0]?.data;
        row.problems.push(`axe ${v.impact} ${v.id} ×${v.nodes.length}: ${node?.target?.join(" ")}${d?.contrastRatio ? ` (${d.fgColor} on ${d.bgColor} ${d.contrastRatio}:1)` : ""}`);
      }
      if (errors.length) row.problems.push(...errors.map((e) => `page error: ${e}`));
      const links = await page.evaluate((loc) => [...document.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href"))
        .filter((h) => h && h.startsWith(`/${loc}/`))
        .map((h) => h.split("#")[0].split("?")[0]), locale);
      for (const link of links) if (!SKIP.test(link) && !seen.has(link)) queue.push(link);
    } catch (e) {
      row.problems.push(`navigation: ${String(e.message).split("\n")[0]}`);
    }
    row.ok = row.problems.length === 0;
    report.push(row);
    console.log(`${row.ok ? "PASS" : "FAIL"}  ${role.padEnd(8)} ${theme.padEnd(5)} ${path}${row.redirect ? ` → ${row.redirect}` : ""}${row.ok ? "" : `\n        ${row.problems.join("\n        ")}`}`);
  }
  await ctx.close();
}

for (const theme of themes) for (const [role, phone] of ROLES) await crawl(role, phone, theme);
await browser.close();
writeFileSync(join(OUT, "roles-crawl.json"), JSON.stringify(report, null, 2));
const failed = report.filter((r) => !r.ok);
const axeBad = report.filter((r) => r.problems.some((p) => p.startsWith("axe ")));
console.log(`\n${report.length - failed.length}/${report.length} pages clean; pages with axe critical/serious: ${axeBad.length}`);
process.exit(failed.length ? 1 : 0);
