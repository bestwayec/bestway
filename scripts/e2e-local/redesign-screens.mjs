// BESTWAY redesign before/after screenshots of the main screens: landing, login, student dashboard,
// catalogue, the exam window (Listening, Reading, Writing, Speaking), the result page, the teacher
// panel and the admin area. Synthetic accounts and the synthetic IELTS exam that ielts-full.mjs
// builds; loopback only.
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node redesign-screens.mjs OUT_DIR [page ...]
// Pages: landing login dashboard catalogue listening reading writing speaking result teacher workspace grading
//        groups admin builder (default: all). Sizes 1366×768 and 390×844 (BW_SIZES=1366x768,390x844,360x640),
// light and dark. Prints per shot: horizontal overflow and the exam header height.
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const args = process.argv.slice(2);
const OUT = args[0] || join(here, "..", "..", ".local", "e2e", "redesign");
mkdirSync(OUT, { recursive: true });
const ALL = ["landing", "login", "dashboard", "catalogue", "listening", "reading", "writing", "speaking", "result", "teacher", "workspace", "grading", "groups", "admin", "builder"];
const only = args.slice(1).length ? args.slice(1) : ALL;
const state = JSON.parse(readFileSync(join(here, "..", "..", ".local", "e2e", "ielts-full.json"), "utf8"));
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const ACCOUNTS = { student: "+998900000011", teacher: "+998900000003", admin: "+998900000002" };
const SIZES = (process.env.BW_SIZES || "1366x768,390x844").split(",").map((s) => s.split("x").map(Number));
const THEMES = (process.env.BW_THEMES || "light,dark").split(",");

const browser = await chromium.launch({
  ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

async function session(role, width, height, theme) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, isMobile: width < 500, hasTouch: width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript((t) => { try { sessionStorage.setItem("bw_fullscreen_notice_seen", "1"); localStorage.setItem("theme", t); } catch { /* ignore */ } }, theme);
  if (role) {
    await page.goto(`${WEB}/en/login`);
    await page.locator('input[type="tel"], input[name="phone"]').first().fill(ACCOUNTS[role]);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
  }
  const api = async (method, path, body) => {
    const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, ...(body ? { data: body } : {}) });
    return (await res.json().catch(() => ({}))).data;
  };
  return { ctx, page, api };
}

const hide = (page) => page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
async function shot(page, name, width, height, theme, extra = "") {
  await hide(page);
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => -1);
  await page.screenshot({ path: join(OUT, `${name}-${width}x${height}-${theme}.png`) });
  console.log(`${name} ${width}x${height} ${theme}: overflow ${overflow}px${extra}`);
}

async function closeOpenAttempts(api) {
  const mine = await api("GET", "/mock/attempts/mine");
  for (const a of (Array.isArray(mine) ? mine : mine?.items ?? []).filter((x) => x.examId === state.examId && x.status === "in_progress"))
    await api("POST", `/mock/attempts/${a.id}/submit`, { confirm: true, confirmed: true, force: true });
}

async function runner(page, api, skill) {
  await closeOpenAttempts(api);
  const started = await api("POST", `/mock/exams/${state.examId}/start`, { mode: "practice", flow: "single_skill", skills: [skill] });
  await page.goto(`${WEB}/en/mock/attempt/${started.attemptId}`, { waitUntil: "networkidle" });
  for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
    const dialog = page.getByTestId(id);
    if (await dialog.count()) await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  return started.attemptId;
}

const headerHeight = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-exam-header]") || document.querySelector("header");
  return el ? Math.round(el.getBoundingClientRect().height) : -1;
}).catch(() => -1);

for (const theme of THEMES) for (const [width, height] of SIZES) {
  const pages = new Set(only);
  if (pages.has("landing") || pages.has("login")) {
    const { ctx, page } = await session(null, width, height, theme);
    if (pages.has("landing")) { await page.goto(`${WEB}/en`, { waitUntil: "networkidle" }); await shot(page, "landing", width, height, theme); }
    if (pages.has("login")) { await page.goto(`${WEB}/en/login`, { waitUntil: "networkidle" }); await shot(page, "login", width, height, theme); }
    await ctx.close();
  }
  const studentPages = ["dashboard", "catalogue", "listening", "reading", "writing", "speaking", "result"].filter((p) => pages.has(p));
  if (studentPages.length) {
    const { ctx, page, api } = await session("student", width, height, theme);
    for (const p of studentPages) {
      if (p === "dashboard") { await page.goto(`${WEB}/en/dashboard`, { waitUntil: "networkidle" }); await shot(page, p, width, height, theme); }
      else if (p === "catalogue") { await page.goto(`${WEB}/en/mock`, { waitUntil: "networkidle" }); await shot(page, p, width, height, theme); }
      else if (p === "result") {
        await page.goto(`${WEB}/en/mock/attempt/${state.attemptId}`, { waitUntil: "networkidle" });
        await shot(page, p, width, height, theme);
        await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.9));
        await shot(page, "result-more", width, height, theme);
      } else {
        const id = await runner(page, api, p);
        await shot(page, p, width, height, theme, `, header ${await headerHeight(page)}px`);
        await api("POST", `/mock/attempts/${id}/submit`, { confirm: true, confirmed: true, force: true });
      }
    }
    await ctx.close();
  }
  const teacherPages = ["teacher", "workspace", "grading", "groups", "builder"].filter((p) => pages.has(p));
  if (teacherPages.length) {
    const { ctx, page } = await session("teacher", width, height, theme);
    for (const p of teacherPages) {
      const url = { teacher: "/en/dashboard", workspace: "/en/teacher", grading: `/en/mock/attempt/${state.attemptId}`, groups: "/en/groups", builder: `/en/exam-builder/${state.examId}` }[p];
      await page.goto(`${WEB}${url}`, { waitUntil: "networkidle" });
      await shot(page, p, width, height, theme);
    }
    await ctx.close();
  }
  if (pages.has("admin")) {
    const { ctx, page } = await session("admin", width, height, theme);
    await page.goto(`${WEB}/en/dashboard`, { waitUntil: "networkidle" });
    await shot(page, "admin", width, height, theme);
    await ctx.close();
  }
}
await browser.close();
