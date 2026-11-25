// BESTWAY local end-to-end: S4 practice mode, in a real browser on the local stack.
// Uses the synthetic IELTS exam that ielts-full.mjs builds (run it first). Synthetic accounts only.
//   catalogue → a section button → Practice / one part / part timer → only that part, the part's clock,
//   Show answer; Listening practice: speed, ±10 s, audioscript; result: raw x/y, never a band;
//   the same section under exam rules: no practice tools at all.
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node practice-mode.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const STUDENT = process.env.BW_STUDENT_IELTS || "+998900000011";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = join(here, "..", "..", ".local", "e2e");
const state = JSON.parse(readFileSync(join(OUT, "ielts-full.json"), "utf8"));
const results = [];
const expect = (cond, message) => { if (!cond) throw new Error(message); };

const browser = await chromium.launch({ ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
await page.addInitScript(() => { try { sessionStorage.setItem("bw_fullscreen_notice_seen", "1"); } catch { /* ignore */ } });
const either = page.getByTestId("exam-session-elsewhere").or(page.getByTestId("fullscreen-notice")).first();
await page.addLocatorHandler(either, async () => {
  for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
    const dialog = page.getByTestId(id);
    if (await dialog.count().catch(() => 0)) { await dialog.getByRole("button").first().click({ timeout: 5000 }).catch(() => {}); return; }
  }
}, { noWaitAfter: true });

async function step(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}${note ? `  - ${note}` : ""}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`FAIL  ${name}  - ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: join(OUT, `practice-${name}-FAIL.png`) }).catch(() => {}); }
}
const api = async (method, path, body) => {
  const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, ...(body ? { data: body } : {}) });
  return { status: res.status(), data: (await res.json().catch(() => ({}))).data };
};
async function closeOpen() {
  const mine = (await api("GET", "/mock/attempts/mine")).data;
  for (const a of (Array.isArray(mine) ? mine : mine?.items ?? []).filter((x) => x.examId === state.examId && x.status === "in_progress"))
    await api("POST", `/mock/attempts/${a.id}/submit`, { confirm: true, confirmed: true, force: true });
}
async function openSection(skill) {
  await page.goto(`${WEB}/en/mock`, { waitUntil: "networkidle" });
  const toIelts = page.getByTestId("exam-track-card-IELTS").getByRole("button", { name: /Switch to/ });
  if (await toIelts.count()) await toIelts.click();
  else await page.getByText("IELTS", { exact: true }).first().click();
  const card = page.locator('[data-testid^="mock-card-"]').filter({ hasText: state.title }).first();
  await card.getByRole("button", { name: `Start ${skill} only` }).click();
  return page.getByRole("dialog");
}

await page.goto(`${WEB}/en/login`);
await page.locator('input[type="tel"], input[name="phone"]').first().fill(STUDENT);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
await closeOpen();

await step("01-practice-one-part-with-its-timer", async () => {
  const dialog = await openSection("Reading");
  await dialog.getByLabel("Practice").check();
  await dialog.getByLabel(/^Passage 2/).check();
  await dialog.getByLabel(/^Time for this part/).check();
  const started = page.waitForResponse((r) => /\/mock\/exams\/[^/]+\/start$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Start practice" }).click();
  const body = await (await started).json();
  expect(body.data.mode === "practice" && body.data.practiceOptions.timer === "part", "not a practice with the part timer");
  await page.waitForURL(/\/mock\/attempt\//);
  await page.locator('nav[aria-label="Question navigation"]').waitFor();
  const numbers = await page.locator('[data-testid="part-palette"] button').allInnerTexts();
  expect(numbers[0].trim() === "14" && numbers.length === 13, `palette ${numbers.join(",")}`);
  const clock = await page.locator('[role="timer"]').first().innerText();
  expect(/^(19|20):\d{2}$/.test(clock.trim()), `part clock ${clock}`);
  state.practiceAttempt = body.data.attemptId;
  return `Passage 2 only (questions 14–26), clock ${clock.trim()}`;
});

await step("02-show-answer-in-practice", async () => {
  await page.getByRole("button", { name: "Show answer" }).first().click();
  const shown = await page.getByTestId("practice-revealed").first().innerText();
  expect(/Answer: (TRUE|Choice A|alpha)/.test(shown), `revealed ${shown}`);
  return shown.split("\n")[0];
});

await step("03-practice-result-is-raw-never-a-band", async () => {
  // Answer three questions (the first option of each), then hand in.
  const blocks = page.locator("[id^='q-']");
  for (let i = 0; i < 3; i++) {
    const radio = blocks.nth(i).locator('input[type="radio"]').first();
    await radio.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await radio.check();
  }
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Finish" }).first().click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button").filter({ hasText: /Finish|Submit|Yes/ }).last().click();
  await page.waitForURL(/\/mock\/attempt\//);
  await page.getByText(/correct ·/).first().waitFor({ timeout: 30000 });
  const text = await page.locator("main").innerText();
  expect(!/Band \d/.test(text) && !/Overall band/i.test(text), "a band is shown for practice");
  expect(text.includes("answer shown"), "the revealed answer is not marked");
  return (text.match(/\d+\/\d+ correct · \d+%/) || [""])[0];
});

await step("04-listening-practice-tools", async () => {
  await closeOpen();
  const dialog = await openSection("Listening");
  await dialog.getByLabel("Practice").check();
  await dialog.getByLabel(/^Part 1/).check();
  await dialog.getByRole("button", { name: "Start practice" }).click();
  await page.waitForURL(/\/mock\/attempt\//);
  const tools = page.getByTestId("practice-audio-tools").first();
  await tools.waitFor();
  expect(await tools.getByRole("button", { name: "−10 s" }).count() === 1 && await tools.getByRole("button", { name: "+10 s" }).count() === 1, "no ±10 s");
  await tools.locator("select").selectOption("1.25");
  const rate = await page.locator("audio").first().evaluate((a) => a.playbackRate);
  expect(rate === 1.25, `playback rate ${rate}`);
  await page.getByRole("button", { name: "Show the audioscript" }).click();
  await page.getByRole("region", { name: "Audioscript" }).getByText("The answer is choice A").waitFor();
  return "speed 1.25×, ±10 s, audioscript shown";
});

await step("05-exam-rules-have-no-practice-tools", async () => {
  await closeOpen();
  const dialog = await openSection("Listening");
  await dialog.getByLabel("Exam rules").check();
  await dialog.getByRole("button", { name: "Start the exam" }).click();
  await page.waitForURL(/\/mock\/attempt\//);
  await page.locator('nav[aria-label="Question navigation"]').waitFor();
  await page.waitForTimeout(1500);
  const counts = await Promise.all([
    page.getByTestId("practice-audio-tools").count(),
    page.getByRole("button", { name: "Show answer" }).count(),
    page.getByRole("button", { name: "Show the audioscript" }).count(),
  ]);
  expect(counts.every((n) => n === 0), `practice tools in an exam: ${counts}`);
  expect(await page.getByRole("button", { name: /Play audio \(once only\)/ }).count() > 0, "the exam player is not the single-play one");
  await closeOpen();
  return "single-play player, no speed, no ±10 s, no audioscript, no answers";
});

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
