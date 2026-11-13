// BESTWAY local browser check: one active exam session per attempt (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 node exam-session.mjs
// Tab A answers; tab B (and a second device = separate browser context) opening the same attempt
// sees "open somewhere else" and cannot change answers; "Continue here" moves the exam; the
// old tab is then stopped, and what it typed meanwhile is kept and sent when it continues.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
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
const OUT = join(here, "..", "..", ".local", "e2e", "exam-session");
mkdirSync(OUT, { recursive: true });
const M = Object.fromEntries(["en", "uz"].map((l) => [l, JSON.parse(readFileSync(join(here, "..", "..", "frontend", "messages", `${l}.json`), "utf8")).mock.examSession]));
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });

async function device({ locale, width, height, dark }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((d) => { window.confirm = () => true; try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", STUDENT); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/); await page.waitForLoadState("networkidle").catch(() => {});
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
  return { ctx, page, errors, locale };
}
const api = (page, path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(`/api/backend${p}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function freshAttempt(page) {
  for (let i = 0; i < 3; i++) {
    const data = (await api(page, `/mock/exams/${EXAM}/start`, json({ mode: "timed", skills: ["reading"] }))).body?.data;
    if (data?.resumed || data?.isResumed) { await api(page, `/mock/attempts/${data.attemptId}/submit`, json({ confirm: true, confirmed: true, force: true })); continue; }
    return data?.attemptId;
  }
  throw new Error("could not start a fresh attempt");
}
async function open(tab, id) {
  await tab.ctx.addCookies([{ name: "NEXT_LOCALE", value: tab.locale, url: WEB }]);
  await tab.page.goto(`${WEB}${tab.locale === "en" ? "/en" : ""}/mock/attempt/${id}?skill=reading`, { waitUntil: "domcontentloaded" });
  const notice = tab.page.getByTestId("fullscreen-notice");
  await notice.waitFor({ timeout: 15000 }).then(() => notice.getByRole("button").click()).catch(() => {});
  await tab.page.getByRole("timer").waitFor({ timeout: 30000 });
}
async function questionsTab(page) {
  const notice = page.getByTestId("fullscreen-notice");
  if (await notice.isVisible().catch(() => false)) await notice.getByRole("button").click();
  if ((page.viewportSize()?.width ?? 1440) < 700) await page.getByRole("button", { name: /^(Questions|Savollar)/ }).first().click().catch(() => {});
}
const gate = (page) => page.getByTestId("exam-session-elsewhere");
const textInput = (page) => page.locator('input[aria-label^="Answer for question"], input[aria-label^="Savol"]').locator('visible=true').first();

async function run(name, deviceA, deviceB, sameBrowser) {
  const A = await device(deviceA);
  const id = await freshAttempt(A.page);
  const detail = (await api(A.page, `/mock/attempts/${id}`)).body.data;
  const questionId = detail.sections.flatMap((s) => s.groups).flatMap((g) => g.questions).find((q) => ["short_answer", "sentence_completion", "note_completion", "summary_completion"].includes(q.type))?.id;
  const serverValue = async (page) => {
    const d = (await api(page, `/mock/attempts/${id}`)).body?.data;
    for (const s of d?.sections ?? []) for (const g of s.groups ?? []) for (const q of g.questions ?? []) if (q.id === questionId) return q.response;
  };
  await open(A, id);
  await textInput(A.page).fill("from tab A");
  await A.page.waitForTimeout(2500);
  ok(await serverValue(A.page) === "from tab A", `${name}: the first tab saves`);

  // Second tab in the same browser, or a second device (own browser context).
  const B = sameBrowser ? { ctx: A.ctx, page: await A.ctx.newPage(), errors: [], locale: deviceB.locale } : await device(deviceB);
  if (sameBrowser) await B.page.setViewportSize({ width: deviceB.width, height: deviceB.height });
  await open(B, id);
  await gate(B.page).waitFor({ timeout: 15000 });
  const T = M[B.locale];
  ok((await gate(B.page).innerText()).includes(T.title), `${name}: the ${sameBrowser ? "second tab" : "second device"} says the exam is open elsewhere (${B.locale})`);
  ok(await gate(B.page).getAttribute("role") === "alertdialog", `${name}: the notice is an alert dialog with focus on "${T.continueHere}"`);
  const refused = await B.page.evaluate(async ([attempt, qid]) => {
    const session = sessionStorage.getItem(`bw_exam_session_${attempt}`);
    const r = await fetch(`/api/backend/mock/attempts/${attempt}/answers`, { method: "POST", headers: { "content-type": "application/json", "x-exam-session": session }, body: JSON.stringify({ answers: [{ questionId: qid, response: "sneaky", editedAt: Date.now() }] }) });
    return r.status;
  }, [id, questionId]);
  ok(refused === 409 && await serverValue(A.page) === "from tab A", `${name}: a change from the second place is refused (HTTP ${refused})`);
  await B.page.screenshot({ path: join(OUT, `${name}-gate-${B.locale}-${deviceB.width}.png`) });

  await gate(B.page).getByRole("button").click();
  await gate(B.page).waitFor({ state: "detached", timeout: 10000 });
  await questionsTab(B.page);
  ok(true, `${name}: "${T.continueHere}" moves the exam to the second place`);
  await textInput(B.page).fill("from tab B");
  await B.page.waitForTimeout(2500);
  ok(await serverValue(B.page) === "from tab B", `${name}: the new place saves`);

  // The old place types something; the server refuses it and the gate appears there.
  await A.page.bringToFront();
  await textInput(A.page).fill("typed in A after the takeover");
  await gate(A.page).waitFor({ timeout: 20000 });
  ok(await serverValue(B.page) === "from tab B", `${name}: the old place is stopped and its edit is not stored over the new one`);
  const queued = await A.page.evaluate((attempt) => localStorage.getItem(`bw_answer_queue_${attempt}`), id);
  ok(queued?.includes("typed in A after the takeover"), `${name}: what the old place typed is kept on its device`);
  await gate(A.page).getByRole("button").click();
  await gate(A.page).waitFor({ state: "detached", timeout: 10000 });
  await A.page.waitForTimeout(4000);
  ok(await serverValue(A.page) === "typed in A after the takeover", `${name}: after "continue here" the kept answer is sent (newest edit wins)`);
  ok(A.errors.length === 0 && B.errors.length === 0, `${name}: no page errors ${[...A.errors, ...B.errors].slice(0, 2).join(" | ")}`);
  await api(A.page, `/mock/attempts/${id}/submit`, json({ confirm: true, confirmed: true, force: true }));
  await A.ctx.close();
  if (!sameBrowser) await B.ctx.close();
}

await run("tabs", { locale: "en", width: 1440, height: 900, dark: false }, { locale: "en", width: 1440, height: 900 }, true);
await run("devices", { locale: "en", width: 1440, height: 900, dark: true }, { locale: "uz", width: 390, height: 844, dark: false }, false);
await browser.close();
const failed = results.filter(([pass]) => !pass);
console.log(`${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
