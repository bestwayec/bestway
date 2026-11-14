// BESTWAY local browser check of the Reading split (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 node exam-reading-split.mjs
// Wide screens: passage | divider | questions; dragging the divider changes the widths, the
// choice is remembered after a reload, both columns scroll on their own. Phones: no divider,
// the Passage / Questions tabs.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const EXAM = process.env.BW_IELTS_EXAM || "ielts-academic-mock-01";
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) {
  console.error(`Refusing to run against non-loopback host: ${WEB}`);
  process.exit(2);
}
const OUT = join(here, "..", "..", ".local", "e2e", "exam-reading-split");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });

async function run(name, { locale, width, height, dark }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((d) => { window.confirm = () => true; try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", STUDENT); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/); await page.waitForLoadState("networkidle").catch(() => {});
  const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(`/api/backend${p}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
  const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let id;
  for (let i = 0; i < 4 && !id; i++) {
    const data = (await api(`/mock/exams/${EXAM}/start`, json({ mode: "timed", skills: ["reading"] }))).body?.data;
    if (data?.resumed || data?.isResumed) { await api(`/mock/attempts/${data.attemptId}/submit`, json({ confirm: true, confirmed: true, force: true })); continue; }
    id = data?.attemptId;
  }
  const open = async () => {
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
    await page.goto(`${WEB}${locale === "en" ? "/en" : ""}/mock/attempt/${id}?skill=reading`, { waitUntil: "domcontentloaded" });
    const notice = page.getByTestId("fullscreen-notice");
    await notice.waitFor({ timeout: 15000 }).then(() => notice.getByRole("button").click()).catch(() => {});
    await page.getByRole("timer").waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
  };
  await open();
  const divider = page.getByTestId("reading-split-divider");
  const passage = page.getByRole("region", { name: /Reading passage|O‘qish matni/ });
  if (width >= 1024) {
    ok(await divider.isVisible(), `${name}: the divider is shown between the passage and the questions`);
    const before = (await passage.boundingBox()).width;
    const box = await divider.boundingBox();
    // Grab it where the grip is (30 % down), which is always above the question palette.
    const gripY = box.y + box.height * 0.3;
    await page.mouse.move(box.x + box.width / 2, gripY);
    await page.mouse.down();
    await page.mouse.move(box.x - 200, gripY, { steps: 8 });
    await page.mouse.up();
    const after = (await passage.boundingBox()).width;
    ok(after < before - 120, `${name}: dragging the divider narrows the passage (${Math.round(before)} → ${Math.round(after)} px)`);
    const value = await divider.getAttribute("aria-valuenow");
    await open();
    ok(await page.getByTestId("reading-split-divider").getAttribute("aria-valuenow") === value, `${name}: the width is remembered after a reload (${value} %)`);
    await page.getByTestId("reading-split-divider").focus();
    await page.keyboard.press("Enter");
    ok(await page.getByTestId("reading-split-divider").getAttribute("aria-valuenow") === "50", `${name}: Enter on the divider puts it back in the middle`);
    // Independent scrolling: each column scrolls by itself, the page does not.
    const scroll = await page.evaluate(() => {
      const p = document.querySelector('[role="region"][tabindex="0"]');
      const q = document.querySelector("[data-testid=reading-split-divider]")?.nextElementSibling;
      const pageY = window.scrollY;
      p.scrollTop = 300;
      return { passageScrolls: p.scrollHeight > p.clientHeight && p.scrollTop > 0, questionsOwnScroll: getComputedStyle(q).overflowY === "auto", pageUnchanged: window.scrollY === pageY };
    });
    ok(scroll.passageScrolls && scroll.pageUnchanged, `${name}: the passage scrolls on its own (page stays)`);
    ok(scroll.questionsOwnScroll, `${name}: the questions column has its own scroll`);
  } else {
    ok(!(await divider.isVisible().catch(() => false)), `${name}: no divider on a phone`);
    ok(await page.getByRole("button", { name: /^(Passage|Matn)$/ }).first().isVisible(), `${name}: the Passage / Questions tabs are shown`);
  }
  await page.screenshot({ path: join(OUT, `${name}-${locale}-${dark ? "dark" : "light"}-${width}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `${name}: no horizontal overflow (${overflow})`);
  ok(errors.length === 0, `${name}: no page errors ${errors.slice(0, 2).join(" | ")}`);
  await api(`/mock/attempts/${id}/submit`, json({ confirm: true, confirmed: true, force: true }));
  await ctx.close();
}

await run("A", { locale: "en", width: 1440, height: 900, dark: false });
await run("B", { locale: "uz", width: 1440, height: 900, dark: true });
await run("C", { locale: "uz", width: 390, height: 844, dark: false });
await browser.close();
const failed = results.filter(([pass]) => !pass);
console.log(`${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
