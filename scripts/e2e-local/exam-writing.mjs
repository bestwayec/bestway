// BESTWAY local browser check of Writing in the timed exam (Playwright, real Chromium, real keyboard).
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 node exam-writing.mjs
// Outside text pasted with Ctrl+V is refused and logged; the student's own text can be cut and
// pasted inside the answer; the word count follows the counting rule; spell check is off.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const EXAM = process.env.BW_IELTS_EXAM || "ielts-academic-mock-01";
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) { console.error(`Refusing non-loopback host: ${WEB}`); process.exit(2); }
const OUT = join(here, "..", "..", ".local", "e2e", "exam-writing");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
await page.fill("#phone", STUDENT); await page.fill("#password", PASSWORD);
await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
await page.waitForURL(/dashboard/);
const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(`/api/backend${p}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let id;
for (let i = 0; i < 4 && !id; i++) {
  const data = (await api(`/mock/exams/${EXAM}/start`, json({ mode: "timed", skills: ["writing"] }))).body?.data;
  if (data?.resumed || data?.isResumed) await api(`/mock/attempts/${data.attemptId}/submit`, json({ confirm: true, confirmed: true, force: true }));
  else id = data?.attemptId;
}
let anomalies = [];
page.on("request", (r) => { if (r.url().includes(`/mock/attempts/${id}/anomaly`)) anomalies.push(JSON.parse(r.postData() || "{}").event); });
await page.goto(`${WEB}/en/mock/attempt/${id}?skill=writing`, { waitUntil: "domcontentloaded" });
const notice = page.getByTestId("fullscreen-notice");
await notice.waitFor({ timeout: 15000 }).then(() => notice.getByRole("button").click()).catch(() => {});
const answer = page.locator("textarea[data-exam-writing]").first();
await answer.waitFor({ timeout: 30000 });
ok(await answer.getAttribute("spellcheck") === "false", "spell check is off in the answer");
await answer.click();
await page.keyboard.type("Cities grow fast. A well-known - long-term plan helps.");
await page.waitForTimeout(500);
const countText = await page.getByText(/words?$/).first().innerText().catch(() => "");
ok(/\b8 words?\b/.test(countText), `word count follows the rule (hyphenated = 1, lone dash not counted): "${countText}"`);
await page.evaluate(() => navigator.clipboard.writeText("A model answer copied from a website."));
await answer.press("End");
await page.keyboard.press("Control+V");
await page.waitForTimeout(500);
ok(!(await answer.inputValue()).includes("model answer"), "outside text pasted with Ctrl+V is refused");
await page.waitForTimeout(800);
ok(anomalies.includes("paste_blocked"), `the refused paste is logged for the teacher (${anomalies.join(",")})`);
await answer.evaluate((el) => { el.focus(); el.setSelectionRange(0, 7); });   // "Cities "
await page.keyboard.press("Control+X");
await answer.press("End");
await page.keyboard.press("Control+V");
await page.waitForTimeout(500);
const moved = await answer.inputValue();
ok(moved.startsWith("grow fast.") && moved.endsWith("Cities "), `own text can be cut and pasted inside the answer: "${moved}"`);
await page.screenshot({ path: join(OUT, "writing-1440.png") });
ok(errors.length === 0, `no page errors ${errors.slice(0, 2).join(" | ")}`);
await api(`/mock/attempts/${id}/submit`, json({ confirm: true, confirmed: true, force: true }));
await browser.close();
const failed = results.filter(([c]) => !c).length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
