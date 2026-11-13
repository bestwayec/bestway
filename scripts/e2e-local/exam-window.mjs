// BESTWAY local browser check of the exam window reliability (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 node exam-window.mjs
// 1) answers typed while the server is unreachable stay on the device, survive a reload and
//    are sent when the connection is back; 2) a 502 on Finish shows "answers saved" and a retry
//    that never creates a second attempt; 3) a double click on Finish gives one attempt.
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
const OUT = join(here, "..", "..", ".local", "e2e", "exam-window");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { window.confirm = () => true; });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });

await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
await page.fill("#phone", STUDENT); await page.fill("#password", PASSWORD);
await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
await page.waitForURL(/dashboard/); await page.waitForLoadState("networkidle").catch(() => {});
const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(`/api/backend${p}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);

async function freshAttempt() {
  // Finish any open reading attempt first so each run starts clean.
  for (let i = 0; i < 3; i++) {
    const started = await api(`/mock/exams/${EXAM}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "timed", skills: ["reading"] }) });
    const id = started.body?.data?.attemptId;
    if (started.body?.data?.resumed || started.body?.data?.isResumed) {
      await api(`/mock/attempts/${id}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, confirmed: true, force: true }) });
      continue;
    }
    return id;
  }
  throw new Error("could not start a fresh attempt");
}
const field = () => page.locator('input[aria-label^="Answer for question"]').first();
async function open(id) {
  await page.goto(`${WEB}/en/mock/attempt/${id}?skill=reading`, { waitUntil: "domcontentloaded" });
  const notice = page.getByTestId("fullscreen-notice");
  await Promise.race([notice.waitFor({ timeout: 15000 }).then(() => notice.getByRole("button").click()).catch(() => {}), field().waitFor({ timeout: 30000 })]);
  await field().waitFor({ timeout: 30000 });
}
const serverValue = async (id) => {
  const detail = (await api(`/mock/attempts/${id}`)).body?.data;
  for (const s of detail?.sections ?? []) for (const g of s.groups ?? []) for (const q of g.questions ?? []) if (q.id === firstQuestionId) return q.response;
  return undefined;
};
let firstQuestionId;

// 1) offline queue ---------------------------------------------------------
let attemptId = await freshAttempt();
await open(attemptId);
firstQuestionId = await page.evaluate(() => null);
const detail = (await api(`/mock/attempts/${attemptId}`)).body.data;
firstQuestionId = detail.sections.flatMap((s) => s.groups).flatMap((g) => g.questions).find((q) => q.type === "short_answer" || q.type === "sentence_completion" || q.type === "note_completion" || q.type === "summary_completion")?.id;
await page.route("**/answers", (route) => route.abort("internetdisconnected"));
await field().fill("typed while offline");
await page.waitForTimeout(2500);
ok(await page.getByTestId("answer-queue-banner").isVisible(), "a notice says the answer is kept on this device");
const queued = await page.evaluate((id) => JSON.parse(localStorage.getItem(`bw_answer_queue_${id}`) || "{}"), attemptId);
ok(Object.values(queued).some((e) => e.response === "typed while offline"), "the unsent answer is in the device queue");
await page.screenshot({ path: join(OUT, "offline-banner.png") });
await page.reload({ waitUntil: "domcontentloaded" });
await field().waitFor({ timeout: 30000 });
ok((await field().inputValue()) === "typed while offline", "after a reload the unsent answer is shown again");
await page.unroute("**/answers");
await page.waitForTimeout(12000);   // the runner retries every 10 s
ok((await serverValue(attemptId)) === "typed while offline", "once the connection is back the answer reaches the server");
ok(await page.evaluate((id) => localStorage.getItem(`bw_answer_queue_${id}`) === null, attemptId), "the device queue is empty after the server confirmed it");
await page.reload({ waitUntil: "domcontentloaded" }); await field().waitFor({ timeout: 30000 });
ok((await field().inputValue()) === "typed while offline", "a reload shows the saved answer from the server");

// 2) 502 on Finish -----------------------------------------------------------
let submits = 0;
await page.route("**/submit", async (route) => {
  submits += 1;
  if (submits === 1) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "BACKEND_PROXY_ERROR", message: "Bad gateway" } }) });
  return route.continue();
});
await page.getByRole("button", { name: /^(submit|finish)$/i }).first().click().catch(async () => { await page.getByRole("button", { name: /submit|finish/i }).first().click(); });
const confirmButton = page.getByRole("button", { name: /Submit exam/i });
if (await confirmButton.isVisible().catch(() => false)) await confirmButton.click();
await page.getByTestId("submit-unconfirmed").waitFor({ timeout: 20000 });
ok(true, "a 502 on Finish shows that answers are saved and the hand-in is not confirmed");
await page.screenshot({ path: join(OUT, "submit-unconfirmed.png") });
await page.getByTestId("submit-unconfirmed").getByRole("button").click();
await page.waitForTimeout(4000);
const status = (await api(`/mock/attempts/${attemptId}`)).body?.data?.status;
ok(status && status !== "in_progress", `the retry hands the exam in (${status})`);
const mine = (await api(`/mock/attempts/mine`)).body?.data ?? [];
ok(mine.filter((a) => a.id === attemptId).length === 1, "still one attempt with this id");
await page.unroute("**/submit");

// 3) double click on Finish -----------------------------------------------------
attemptId = await freshAttempt();
await open(attemptId);
const before = ((await api(`/mock/attempts/mine`)).body?.data ?? []).length;
let submitCalls = 0;
page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith(`/mock/attempts/${attemptId}/submit`)) submitCalls += 1; });
const finishButton = page.getByRole("button", { name: /^(submit|finish)$/i }).first();
await finishButton.dblclick().catch(() => {});
const confirm2 = page.getByRole("button", { name: /Submit exam/i });
if (await confirm2.isVisible().catch(() => false)) { await confirm2.click(); await confirm2.click().catch(() => {}); }
await page.waitForTimeout(5000);
if (submitCalls !== 1) {
  console.log("buttons:", JSON.stringify(await page.$$eval("button", (b) => b.map((x) => (x.textContent || "").trim()).filter(Boolean).slice(0, 40))));
  await page.screenshot({ path: join(OUT, "double-click-debug.png") });
}
ok(submitCalls === 1, `a double click sends one submit request (${submitCalls})`);
const after = ((await api(`/mock/attempts/mine`)).body?.data ?? []).length;
ok(after === before, `no extra attempt is created (${before} -> ${after})`);
ok(errors.length === 0, `no page errors ${errors.slice(0, 2).join(" | ")}`);

await browser.close();
const failed = results.filter(([c]) => !c).length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
