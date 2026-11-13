// BESTWAY local browser check of the timed exam's integrity log (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 node exam-mode.mjs
// The student is told before starting; switching to another tab is recorded but never stops
// the exam (also after several times); the teacher/admin sees the log with the result.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const ADMIN = process.env.BW_ADMIN || "+998900000002";
const EXAM = process.env.BW_IELTS_EXAM || "ielts-academic-mock-01";
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) { console.error(`Refusing non-loopback host: ${WEB}`); process.exit(2); }
const OUT = join(here, "..", "..", ".local", "e2e", "exam-mode");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });

async function login(ctx, phone) {
  const page = await ctx.newPage();
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", phone); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard|students|groups|super-admin/);
  return page;
}
const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await login(sctx, STUDENT);
const errors = [];
page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
const api = (p, path, init) => p.evaluate(async ([x, i]) => { const r = await fetch(`/api/backend${x}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let id;
for (let i = 0; i < 4 && !id; i++) {
  const data = (await api(page, `/mock/exams/${EXAM}/start`, json({ mode: "timed", skills: ["reading"] }))).body?.data;
  if (data?.resumed || data?.isResumed) await api(page, `/mock/attempts/${data.attemptId}/submit`, json({ confirm: true, confirmed: true, force: true }));
  else id = data?.attemptId;
}
await page.goto(`${WEB}/en/mock/attempt/${id}?skill=reading`, { waitUntil: "domcontentloaded" });
const notice = page.getByTestId("fullscreen-notice");
await notice.waitFor({ timeout: 30000 });
const noticeText = await notice.innerText();
ok(/recorded/.test(noticeText) && /teacher/.test(noticeText) && /not stopped/.test(noticeText), "before starting, the student is told what is recorded and that the exam is not stopped");
await notice.getByRole("button").click();
await page.locator('input[aria-label^="Answer for question"]').first().waitFor({ timeout: 30000 });
// Headless Chromium does not report focus or visibility changes between its own pages, so the
// window losing focus is signalled the way the browser does it: a blur event on the window.
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(1800);   // separate events (the guard merges events within 1.5 s)
}
await page.waitForTimeout(1500);
const status = (await api(page, `/mock/attempts/${id}`)).body?.data?.status;
ok(status === "in_progress", `four exits do not hand the exam in (${status})`);
const logged = (await api(page, `/mock/attempts/${id}`)).body?.data?.antiCheatCount;
ok(logged === 4, `each exit is recorded once on the server (${logged})`);
ok(await page.locator('[aria-modal="true"]').count() === 0, "the notice does not block the exam (no modal)");
await page.locator('input[aria-label^="Answer for question"]').first().fill("still working");
ok((await page.locator('input[aria-label^="Answer for question"]').first().inputValue()) === "still working", "the student can keep answering");
await page.screenshot({ path: join(OUT, "student-1440.png") });
await api(page, `/mock/attempts/${id}/submit`, json({ confirm: true, confirmed: true, force: true }));

const actx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const admin = await login(actx, ADMIN);
await actx.addCookies([{ name: "NEXT_LOCALE", value: "uz", url: WEB }]);
await admin.goto(`${WEB}/mock/attempt/${id}`, { waitUntil: "domcontentloaded" });
const log = admin.getByTestId("exam-log-panel");
await log.waitFor({ timeout: 30000 });
const logText = await log.innerText();
ok(/Imtihon jurnali \(\d+\)/.test(logText) && /fokusni yo'qotdi/.test(logText), `the admin sees the log with the result: ${logText.split("\n")[0]}`);
const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 1, "390px no horizontal overflow on the result");
await log.screenshot({ path: join(OUT, "admin-log-uz-390.png") });
ok(errors.length === 0, `no page errors ${errors.slice(0, 2).join(" | ")}`);
await browser.close();
const failed = results.filter(([c]) => !c).length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
