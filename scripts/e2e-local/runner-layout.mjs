// BESTWAY local layout check of the exam window: how much of the screen shows the passage/audio and
// the questions (everything that is not sticky chrome at the top or the bottom).
// Real browser, real local stack, the synthetic IELTS exam created by ielts-full.mjs.
//
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node runner-layout.mjs [--shots DIR] [--theme light|dark|both]
//
// Prints one line per viewport/section: content share of the viewport height and whether the part
// tabs fit on one row. Exit 1 when a part tab row overflows, or when the 1366x768 Reading share is
// below BW_MIN_SHARE (default 0, i.e. report only).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", ".local", "e2e");
mkdirSync(OUT, { recursive: true });
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic, local only (seed_local_dev)
const STUDENT = process.env.BW_STUDENT_IELTS || "+998900000011";
const MIN_SHARE = Number(process.env.BW_MIN_SHARE || 0);
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const args = process.argv.slice(2);
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const themeArg = args.includes("--theme") ? args[args.indexOf("--theme") + 1] : "light";
const themes = themeArg === "both" ? ["light", "dark"] : [themeArg];
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const state = JSON.parse(readFileSync(join(OUT, "ielts-full.json"), "utf8"));
if (!state.examId) { console.error("Run ielts-full.mjs build first"); process.exit(2); }

const VIEWPORTS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "360x640", width: 360, height: 640, mobile: true },
];
const SKILLS = (process.env.BW_SKILLS || "reading,listening").split(",");

const browser = await chromium.launch({ ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });

async function login(viewport, theme) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: shotsDir ? 1 : 1,
    isMobile: Boolean(viewport.mobile), hasTouch: Boolean(viewport.mobile), colorScheme: theme,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript((t) => {
    try { sessionStorage.setItem("bw_fullscreen_notice_seen", "1"); localStorage.setItem("theme", t); } catch { /* ignore */ }
  }, theme);
  const notices = page.getByTestId("exam-session-elsewhere").or(page.getByTestId("fullscreen-notice")).first();
  await page.addLocatorHandler(notices, async () => {
    for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
      const dialog = page.getByTestId(id);
      if (await dialog.count()) { await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {}); return; }
    }
  }, { noWaitAfter: true });
  await page.goto(`${WEB}/en/login`);
  await page.locator('input[type="tel"], input[name="phone"]').first().fill(STUDENT);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
  return page;
}

async function api(page, method, path, body) {
  const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, ...(body !== undefined ? { data: body } : {}) });
  return { status: res.status(), data: (await res.json().catch(() => ({}))).data };
}

/** Sticky/fixed chrome that stays on screen: the content is what lies between the top and the bottom chrome. */
async function measure(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    let top = 0, bottom = vh;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "sticky" && cs.position !== "fixed") continue;
      // The recording bar and the passage pane are content even when they stay in view.
      if (el.closest("[data-layout-content]") || el.closest('[role="region"]') || el.closest('[role="dialog"]')) continue;
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 4 || r.width < window.innerWidth * 0.5 || r.bottom <= 0 || r.top >= vh) continue;
      if (r.height > vh * 0.8) continue; // a full-height column, not chrome
      if (r.top < vh / 2) top = Math.max(top, r.bottom); else bottom = Math.min(bottom, r.top);
    }
    // Non-sticky blocks above the passage (tabs, notices) count as chrome when the page starts.
    const first = document.querySelector("[data-exam-content]") || document.querySelector("#main-content [id^='q-']");
    const contentTop = first ? Math.max(top, Math.min(first.getBoundingClientRect().top, vh)) : top;
    return { top: Math.round(contentTop), bottom: Math.round(bottom), vh, share: Math.max(0, bottom - contentTop) / vh };
  });
}

const rows = [];
for (const theme of themes) for (const viewport of VIEWPORTS) for (const skill of SKILLS) {
  const page = await login(viewport, theme);
  const mine = (await api(page, "GET", "/mock/attempts/mine")).data;
  for (const open of (Array.isArray(mine) ? mine : mine?.items ?? []).filter((a) => a.examId === state.examId && a.status === "in_progress"))
    await api(page, "POST", `/mock/attempts/${open.id}/submit`, { confirm: true, confirmed: true, force: true });
  const started = await api(page, "POST", `/mock/exams/${state.examId}/start`, { mode: "timed", flow: "single_skill", skills: [skill] });
  const attemptId = started.data?.attemptId;
  if (!attemptId) { console.log(`SKIP  ${viewport.name} ${skill}: start HTTP ${started.status}`); await page.context().close(); continue; }
  await page.goto(`${WEB}/en/mock/attempt/${attemptId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
    const dialog = page.getByTestId(id);
    if (await dialog.count()) { await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); }
  }
  // The dev-only Next.js issue badge is not part of the product.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const now = page.getByRole("button", { name: /^Start .* now$/ });
  if (await now.count()) { await now.first().click(); await page.waitForTimeout(1500); }
  await page.screenshot({ path: join(OUT, "runner-layout-debug.png") });
  await page.locator('nav[aria-label="Question navigation"]').waitFor();
  await page.waitForTimeout(1200);
  const m = await measure(page);
  // The part tabs must fit on one row (no hidden tab to scroll to).
  const tabs = page.locator('nav[aria-label="Question navigation"] [role="tablist"]').first();
  m.tabsOverflow = (await tabs.count()) ? await tabs.evaluate((el) => el.scrollWidth - el.clientWidth) : 0;
  rows.push({ theme, viewport: viewport.name, skill, ...m });
  console.log(`${theme.padEnd(5)} ${viewport.name.padEnd(9)} ${skill.padEnd(9)} content ${(m.share * 100).toFixed(0)}% (top chrome ${m.top}px, bottom chrome ${m.vh - m.bottom}px), part tabs ${m.tabsOverflow > 1 ? `overflow ${m.tabsOverflow}px` : "on one row"}`);
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `runner-${skill}-${viewport.name}-${theme}.png`) });
  // Phones: the full palette is a sheet that slides up from the bottom.
  if (shotsDir && viewport.mobile && skill === "reading") {
    const all = page.getByRole("button", { name: /All questions/ }).first();
    if (await all.count()) {
      await all.click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(shotsDir, `runner-palette-${viewport.name}-${theme}.png`) });
      await page.keyboard.press("Escape");
    }
  }
  await api(page, "POST", `/mock/attempts/${attemptId}/submit`, { confirm: true, confirmed: true, force: true });
  await page.context().close();
}
await browser.close();
const key = rows.find((r) => r.viewport === "1366x768" && r.skill === "reading");
const hidden = rows.filter((r) => r.tabsOverflow > 1);
if (hidden.length) { console.log(`FAIL  part tabs do not fit on one row: ${hidden.map((r) => `${r.theme} ${r.viewport} ${r.skill}`).join(", ")}`); process.exit(1); }
if (key && key.share < MIN_SHARE) { console.log(`FAIL  1366x768 reading share ${(key.share * 100).toFixed(0)}% < ${MIN_SHARE * 100}%`); process.exit(1); }
if (existsSync(OUT)) console.log("done");
