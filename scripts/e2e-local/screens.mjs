// BESTWAY local before/after screenshots (Playwright, real Chromium). Loopback + synthetic accounts only.
//   node screens.mjs before   -> ../../.local/screens/before/<page>-<viewport>.png
//   node screens.mjs after    -> ../../.local/screens/after/...
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] || "after";
const OUT = join(here, "..", "..", ".local", "screens", label);
mkdirSync(OUT, { recursive: true });

const WEB = process.env.BW_WEB || "http://127.0.0.1:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) {
  console.error("Refusing to run against a non-loopback host");
  process.exit(2);
}

function findChromium() {
  const root = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    for (const sub of ["chrome-win64", "chrome-win"]) {
      const exe = join(root, d, sub, "chrome.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const PAGES = (process.env.BW_PAGES || "dashboard,leaderboard,notifications,exam-track,profile,videos,mock").split(",");
const VIEWPORTS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "390x844", width: 390, height: 844 },
];

const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/en/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#phone");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.fill("#phone", STUDENT);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/, { timeout: 120000 });
  for (const p of PAGES) {
    const url = `/en${p.startsWith("/") ? p : `/${p}`}`;
    try {
      await page.goto(`${WEB}${url}`, { waitUntil: "domcontentloaded", timeout: 180000 });
      await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const name = p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_");
      await page.screenshot({ path: join(OUT, `${name}-${vp.name}.png`), fullPage: false });
      if (process.env.BW_FULL) await page.screenshot({ path: join(OUT, `${name}-${vp.name}-full.png`), fullPage: true });
      console.log(`ok ${name} ${vp.name}`);
    } catch (e) {
      console.log(`FAIL ${p} ${vp.name}: ${e.message.split("\n")[0]}`);
    }
  }
  await ctx.close();
}
await browser.close();
