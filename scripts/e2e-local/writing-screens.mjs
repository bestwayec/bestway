// BESTWAY local screenshots of the IELTS Writing editor with a typed three-paragraph answer (the
// guide: words against the target, paragraphs, time on the task). Synthetic IELTS exam from
// ielts-full.mjs, synthetic account, loopback only.
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node writing-screens.mjs OUT_DIR
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = process.argv[2] || join(here, "..", "..", ".local", "e2e", "writing");
mkdirSync(OUT, { recursive: true });
const state = JSON.parse(readFileSync(join(here, "..", "..", ".local", "e2e", "ielts-full.json"), "utf8"));
const VIEWPORTS = [[1366, 768], [390, 844], [360, 640]];
const ANSWER = [
  "The chart compares the number of visitors to three museums between 2010 and 2020.",
  "Overall, the science museum attracted the most visitors, while the art gallery grew the fastest.",
  "In 2010 the science museum had about 3,500 visitors a month, and by 2020 this rose to 5,000.",
].join("\n\n");

const browser = await chromium.launch({ ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
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
  const started = await api("POST", `/mock/exams/${state.examId}/start`, { mode: "practice", flow: "single_skill", skills: ["writing"] });
  await page.goto(`${WEB}/en/mock/attempt/${started.attemptId}`, { waitUntil: "networkidle" });
  for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
    const dialog = page.getByTestId(id);
    if (await dialog.count()) await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {});
  }
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  const area = page.locator("textarea").first();
  await area.fill(ANSWER);
  await page.waitForTimeout(2500);
  const guide = page.locator("textarea").first().locator("xpath=following::*[contains(@class,'rounded-[10px]')][1]");
  await guide.scrollIntoViewIfNeeded().catch(() => {});
  const stats = (await page.getByTestId("writing-stats").count()) ? (await page.getByTestId("writing-stats").first().innerText()).replace(/\n/g, " · ") : "none";
  await page.screenshot({ path: join(OUT, `writing-${width}x${height}-${theme}.png`) });
  console.log(`${theme} ${width}x${height}: ${stats}`);
  await api("POST", `/mock/attempts/${started.attemptId}/submit`, { confirm: true, confirmed: true, force: true });
  await ctx.close();
}
await browser.close();
