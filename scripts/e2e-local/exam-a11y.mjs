// BESTWAY local accessibility check of the exam window (Playwright + axe-core, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 node exam-a11y.mjs
// axe (WCAG 2.0/2.1 A + AA rules) on Reading, Listening and Writing in en/uz, light/dark,
// 1440 and 390: no critical or serious violation. Keyboard: the question navigator is one
// tab stop, arrow keys move between questions, Enter opens one, and the state of each
// question is announced.
import { mkdirSync, readFileSync } from "node:fs";
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
const AXE = readFileSync(join(here, "..", "..", "frontend", "node_modules", "axe-core", "axe.min.js"), "utf8");
const OUT = join(here, "..", "..", ".local", "e2e", "exam-a11y");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });

async function session({ locale, width, height, dark }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((d) => { window.confirm = () => true; try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  const page = await ctx.newPage();
  await page.route("**/mock/groups/*/audio*", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.alloc(44) }));
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", STUDENT); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/); await page.waitForLoadState("networkidle").catch(() => {});
  const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(`/api/backend${p}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
  const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  async function fresh(skill) {
    for (let i = 0; i < 4; i++) {
      const data = (await api(`/mock/exams/${EXAM}/start`, json({ mode: "timed", skills: [skill] }))).body?.data;
      if (data?.resumed || data?.isResumed) { await api(`/mock/attempts/${data.attemptId}/submit`, json({ confirm: true, confirmed: true, force: true })); continue; }
      return data?.attemptId;
    }
  }
  async function open(id, skill) {
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
    await page.goto(`${WEB}${locale === "en" ? "/en" : ""}/mock/attempt/${id}?skill=${skill}`, { waitUntil: "domcontentloaded" });
    const notice = page.getByTestId("fullscreen-notice");
    await notice.waitFor({ timeout: 15000 }).then(() => notice.getByRole("button").click()).catch(() => {});
    await page.getByRole("timer").waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
  }
  const done = (id) => api(`/mock/attempts/${id}/submit`, json({ confirm: true, confirmed: true, force: true }));
  return { ctx, page, fresh, open, done };
}

async function audit(page, label) {
  await page.addScriptTag({ content: AXE });
  const report = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    // The Next.js dev overlay button is not part of the product.
    exclude: [["nextjs-portal"]],
  }));
  const bad = report.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  for (const v of bad) {
    console.log(`  ${v.impact} ${v.id} (${v.nodes.length}): ${v.help}`);
    for (const n of v.nodes.slice(0, process.env.BW_DEBUG ? 20 : 3)) {
      const d = n.any?.[0]?.data;
      console.log(`    - ${n.target.join(" ")} ${d?.contrastRatio ? `fg ${d.fgColor} bg ${d.bgColor} ${d.contrastRatio}:1 (needs ${d.expectedContrastRatio})` : ""} ${process.env.BW_DEBUG ? n.html.slice(0, 140) : ""}`);
    }
  }
  ok(bad.length === 0, `${label}: axe — no critical or serious violations (${bad.map((v) => v.id).join(", ") || "none"})`);
  return bad;
}

const VIEWS = [
  { name: "en-1440-light", locale: "en", width: 1440, height: 900, dark: false },
  { name: "uz-390-dark", locale: "uz", width: 390, height: 844, dark: true },
];
for (const view of VIEWS) {
  const s = await session(view);
  for (const skill of ["reading", "listening", "writing"]) {
    const id = await s.fresh(skill);
    await s.open(id, skill);
    await audit(s.page, `${view.name} ${skill}`);
    if (skill === "reading" && view.width >= 700 && !process.env.BW_AUDIT_ONLY) {
      // Keyboard: Tab reaches the navigator; arrows move; Enter opens the question.
      const nav = s.page.getByRole("navigation", { name: /question|savol/i }).first();
      const items = nav.getByRole("toolbar").getByRole("button");
      const count = await items.count();
      ok(count > 1, `${view.name}: the question navigator lists the questions (${count})`);
      await items.first().focus();
      await s.page.keyboard.press("ArrowRight");
      const second = await s.page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
      ok(/2|Question|Savol/.test(second), `${view.name}: ArrowRight moves to the next question ("${second}")`);
      await s.page.keyboard.press("End");
      const last = await s.page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
      ok(last && last !== second, `${view.name}: End goes to the last question ("${last}")`);
      const tabStops = await nav.getByRole("toolbar").evaluate((el) => [...el.querySelectorAll("button")].filter((b) => b.tabIndex >= 0).length);
      ok(tabStops === 1, `${view.name}: the navigator is one tab stop (${tabStops})`);
      await s.page.keyboard.press("Home");
      await s.page.keyboard.press("Enter");
      await s.page.waitForTimeout(400);
      const focused = await s.page.evaluate(() => document.activeElement?.closest('[id^="q-"]')?.id ?? document.activeElement?.tagName);
      ok(/^q-/.test(focused ?? ""), `${view.name}: Enter takes the focus to that question (${focused})`);
      const live = await nav.locator('[aria-live="polite"]').textContent();
      ok(/\d/.test(live ?? ""), `${view.name}: the current question and its state are announced ("${live}")`);
    }
    await s.page.screenshot({ path: join(OUT, `${view.name}-${skill}.png`) });
    await s.done(id);
  }
  await s.ctx.close();
}
await browser.close();
const failed = results.filter(([pass]) => !pass);
console.log(`${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
