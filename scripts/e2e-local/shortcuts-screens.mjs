// BESTWAY local check and screenshots of the exam window's keyboard shortcuts ("?" list, N / P / F),
// the dashboard's Today's plan card and the part tab names on the Uzbek site. Synthetic IELTS exam
// from ielts-full.mjs, synthetic account, loopback only.
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node shortcuts-screens.mjs OUT_DIR
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = process.argv[2] || join(here, "..", "..", ".local", "e2e", "shortcuts");
mkdirSync(OUT, { recursive: true });
const state = JSON.parse(readFileSync(join(here, "..", "..", ".local", "e2e", "ielts-full.json"), "utf8"));
const VIEWPORTS = [[1366, 768], [390, 844], [360, 640]];

const browser = await chromium.launch({ ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
for (const theme of ["light", "dark"]) for (const [width, height] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
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
  const hide = () => page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});

  // Dashboard: the Today card.
  await page.goto(`${WEB}/en/dashboard`, { waitUntil: "networkidle" });
  await hide();
  const today = page.locator('[aria-labelledby="today-title"]').first();
  const todayTitle = (await today.count()) ? await page.locator("#today-title").innerText() : "none";
  await today.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: join(OUT, `today-${width}x${height}-${theme}.png`) });

  // Exam window: "?" and N / P / F.
  const mine = await api("GET", "/mock/attempts/mine");
  for (const a of (Array.isArray(mine) ? mine : mine?.items ?? []).filter((x) => x.examId === state.examId && x.status === "in_progress"))
    await api("POST", `/mock/attempts/${a.id}/submit`, { confirm: true, confirmed: true, force: true });
  const started = await api("POST", `/mock/exams/${state.examId}/start`, { mode: "practice", flow: "single_skill", skills: ["reading"] });
  await page.goto(`${WEB}/en/mock/attempt/${started.attemptId}`, { waitUntil: "networkidle" });
  for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
    const dialog = page.getByTestId(id);
    if (await dialog.count()) await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {});
  }
  await hide();
  await page.locator('nav[aria-label="Question navigation"]').waitFor();
  await page.locator("body").click({ position: { x: 5, y: height - 5 } }).catch(() => {});
  // The open question's number from the palette (present on every size; phones hide the bar, not the DOM).
  const current = async () => (await page.locator('[data-qid][aria-current="true"]').first().evaluate((el) => el.textContent ?? "").catch(() => "?")).replace(/[^0-9]/g, "");
  const start = await current();
  await page.keyboard.press("n"); await page.keyboard.press("n");
  const afterNext = await current();
  await page.keyboard.press("p");
  const afterPrev = await current();
  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  const flagged = await page.locator('[data-qid][aria-current="true"]').first().getAttribute("aria-label").catch(() => "");
  await page.keyboard.press("Shift+Slash");
  const dialog = await page.getByTestId("shortcuts-list").count();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `shortcuts-${width}x${height}-${theme}.png`) });
  await page.keyboard.press("Escape");
  // Typing in an answer box must not move: the IELTS gap fill / short answer fields are text inputs.
  const textBox = page.locator("[id^='q-'] input[type='text']").first();
  let typed = "no text field";
  if (await textBox.count()) { const before = await current(); await textBox.click(); await page.keyboard.type("n"); typed = (await current()) === before ? "stayed" : "MOVED"; }

  // The same Reading attempt on the Uzbek site: part tab names.
  await page.goto(`${WEB}/uz/mock/attempt/${started.attemptId}`, { waitUntil: "networkidle" });
  await hide();
  const tabs = await page.locator('nav [role="tablist"] [role="tab"]').allInnerTexts().catch(() => []);
  await page.screenshot({ path: join(OUT, `uz-tabs-${width}x${height}-${theme}.png`) });
  // Writing: N typed in the answer is a letter, not "next question".
  if (typed === "no text field") {
    await api("POST", `/mock/attempts/${started.attemptId}/submit`, { confirm: true, confirmed: true, force: true });
    const writing = await api("POST", `/mock/exams/${state.examId}/start`, { mode: "practice", flow: "single_skill", skills: ["writing"] });
    await page.goto(`${WEB}/en/mock/attempt/${writing.attemptId}`, { waitUntil: "networkidle" });
    await hide();
    const area = page.locator("textarea").first();
    const before = await current();
    await area.click(); await page.keyboard.type("np f");
    typed = (await current()) === before && (await area.inputValue()).endsWith("np f") ? "stayed (Writing, text typed)" : "MOVED";
    await api("POST", `/mock/attempts/${writing.attemptId}/submit`, { confirm: true, confirmed: true, force: true });
  }

  console.log(`${theme} ${width}x${height}: Today title "${todayTitle}"; N,N ${start}→${afterNext}, P → ${afterPrev}; F flag: ${/flag/i.test(flagged || "") ? "yes" : "no"}; ? list ${dialog ? "shown" : "none"}; typing n in a field: ${typed}; uz tabs: ${tabs.map((x) => x.replace(/\s+/g, " ").trim()).join(" | ")}`);
  await api("POST", `/mock/attempts/${started.attemptId}/submit`, { confirm: true, confirmed: true, force: true });
  await ctx.close();
}
await browser.close();
