// BESTWAY mobile Listening practice check (Playwright, real Chromium, phone emulation).
// Synthetic local accounts only (seed_local_dev), loopback only.
//   node mobile-listening.mjs   -> report + screenshots in ../../.local/e2e/mobile/
// Verifies: launcher shows server durations, Listening practice includes Part 1 (35 questions),
// palette numbers match the question numbers, the Part 4 map image really loads, the fixed
// palette does not cover the last question, answers persist, and section results carry no level.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", ".local", "e2e", "mobile");
mkdirSync(OUT, { recursive: true });
const WEB = process.env.BW_WEB || "http://127.0.0.1:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password
const STUDENT = process.env.BW_MOBILE_STUDENT || "+998900000011";
const EXAM = process.env.BW_RECORD_MOCK || "MOCK-RECORD-01";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) {
  console.error("Refusing to run against a non-loopback host");
  process.exit(2);
}

function findChromium() {
  const root = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    for (const sub of ["chrome-win64", "chrome-win"]) {
      const exe = join(root, d, sub, "chrome.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
    console.log(`PASS ${name} — ${detail ?? ""}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: String(e?.message || e).slice(0, 400) });
    console.log(`FAIL ${name} — ${String(e?.message || e).slice(0, 400)}`);
  }
}

const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
const sizes = [
  { name: "360x640", viewport: { width: 360, height: 640 } },
  { name: "390x844", viewport: { width: 390, height: 844 } },
];
const ctx = await browser.newContext({ ...devices["Pixel 5"], viewport: sizes[1].viewport });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);

await step("01-login-mobile", async () => {
  await page.goto(`${WEB}/en/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#phone");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.fill("#phone", STUDENT);
  await page.fill("#password", PASSWORD);
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  if (resp.status() !== 200) throw new Error(`login HTTP ${resp.status()}`);
  await page.waitForURL(/dashboard/);
  return "student signed in at 390x844";
});

let attemptId = null;
await step("02-catalog-durations-and-practice-scope", async () => {
  const list = await (await ctx.request.get(`${WEB}/api/backend/mock/exams`)).json();
  const exam = (list.data || []).find((e) => e.id === EXAM);
  if (!exam) throw new Error("record mock not in catalogue");
  if (exam.sectionDurations?.listening !== 45) throw new Error(`listening duration ${exam.sectionDurations?.listening}`);
  if (!(exam.practiceSkills || []).includes("listening")) throw new Error("listening not practice-ready");
  return `listening ${exam.sectionDurations.listening} min, practice skills ${exam.practiceSkills.join(",")}`;
});

await step("03-start-listening-practice", async () => {
  const resp = await ctx.request.post(`${WEB}/api/backend/mock/exams/${EXAM}/start`, {
    data: { mode: "timed", skills: ["listening"], retake: true, force: true },
  });
  const json = await resp.json();
  if (!resp.ok()) throw new Error(`start HTTP ${resp.status()} ${JSON.stringify(json).slice(0, 200)}`);
  attemptId = json.data?.attemptId || json.data?.id || json.data?.attempt?.id;
  if (!attemptId) throw new Error(`no attempt id in ${JSON.stringify(json.data).slice(0, 200)}`);
  const detail = await (await ctx.request.get(`${WEB}/api/backend/mock/attempts/${attemptId}`)).json();
  const listening = (detail.data.sections || []).find((s) => s.skill === "listening");
  const numbers = listening.groups.flatMap((g) => g.questions.map((q) => q.number));
  if (numbers.length !== 35) throw new Error(`expected 35 questions, got ${numbers.length}`);
  if (numbers[0] !== 1) throw new Error(`first question is ${numbers[0]}, Part 1 missing`);
  return `attempt with ${numbers.length} questions, ${listening.groups.length} parts, numbers ${numbers[0]}–${numbers.at(-1)}`;
});

await step("04-runner-palette-matches-question-numbers", async () => {
  await page.goto(`${WEB}/en/mock/attempt/${attemptId}?skill=listening`, { waitUntil: "domcontentloaded" });
  const palette = page.locator('[aria-label="Question palette"] button');
  await palette.first().waitFor();
  const labels = await palette.allInnerTexts();
  const nums = labels.map((x) => Number(x.replace(/[^\d]/g, "")));
  if (nums.length !== 35 || nums[0] !== 1 || nums.at(-1) !== 35) throw new Error(`palette ${nums.slice(0, 5)}…${nums.at(-1)} (${nums.length})`);
  await page.screenshot({ path: join(OUT, "04-part1-390.png") });
  return "palette shows 1…35, Part 1 visible";
});

await step("05-part4-map-loads-and-palette-maps-to-q20", async () => {
  await page.getByRole("tab", { name: /Part 4/ }).click();
  const img = page.locator('[data-testid="exam-group-image"]').first();
  await img.waitFor();
  await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 60000 });
  const natural = await img.evaluate((el) => `${el.naturalWidth}x${el.naturalHeight}`);
  const src = await img.getAttribute("src");
  if (!src.startsWith("/api/backend/")) throw new Error(`image not proxied: ${src}`);
  const q20 = page.locator('[aria-label^="Question 20,"]');
  await q20.click();
  const current = await page.locator('[aria-label="Question palette"] [aria-current="true"]').innerText();
  if (current.trim() !== "20") throw new Error(`palette current ${current}`);
  await page.screenshot({ path: join(OUT, "05-part4-map-390.png"), fullPage: false });
  return `map ${natural} via ${src}; palette 20 is current`;
});

// Q19-23: the printed plan carries A-H, the answer buttons are the same bare letters,
// and nothing else (no prose plan) competes with the picture.
for (const size of sizes) {
  await step(`05b-part4-map-letters-${size.name}`, async () => {
    await page.setViewportSize(size.viewport);
    await page.getByRole("tab", { name: /Part 4/ }).click();
    const img = page.locator('[data-testid="exam-group-image"]').first();
    await img.waitFor();
    await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 60000 });
    await img.scrollIntoViewIfNeeded();
    const m = await img.evaluate((el) => ({ nw: el.naturalWidth, cw: el.getBoundingClientRect().width }));
    if (m.nw < 1000) throw new Error(`map image is only ${m.nw}px wide; letters would blur on phones`);
    // The big room letters are ~8% of the image height; they must stay >= 12 CSS px tall.
    const letterPx = (m.cw / m.nw) * 55;
    if (letterPx < 12) throw new Error(`map letters render ${letterPx.toFixed(1)}px tall at ${size.name}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`horizontal page overflow ${overflow}px`);
    for (const n of [19, 20, 21, 22, 23]) {
      const q = page.locator(`#q-mock-record-01-ql${n}`);
      const letters = await q.locator("button[aria-pressed]").allInnerTexts();
      if (letters.join("") !== "ABCDEFGH") throw new Error(`Q${n} options are "${letters.join("|")}"`);
    }
    const body = await page.innerText("body");
    if (/Room [A-H]\b/.test(body)) throw new Error('answer options still read "Room X"');
    await page.screenshot({ path: join(OUT, `05b-part4-map-${size.name}.png`) });
    return `map ${m.nw}px wide shown at ${Math.round(m.cw)}px (letters ~${letterPx.toFixed(0)}px), Q19–23 offer A–H`;
  });
}
await page.setViewportSize(sizes[1].viewport);

await step("06-answer-persists-and-palette-marks-it", async () => {
  await page.getByRole("tab", { name: /Part 1/ }).click();
  const radio = page.locator('[role="radio"], input[type="radio"]').first();
  await radio.waitFor();
  const save = page.waitForResponse((r) => /\/answers?$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 30000 });
  await radio.click();
  const resp = await save;
  if (resp.status() >= 400) throw new Error(`save HTTP ${resp.status()}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[aria-label^="Question 1, "][aria-label*=", answered"]').waitFor({ timeout: 60000 });
  return "question 1 answered, saved, still answered after reload";
});

for (const size of sizes) {
  await step(`07-layout-${size.name}`, async () => {
    await page.setViewportSize(size.viewport);
    await page.getByRole("tab", { name: /Part 2/ }).click();
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`horizontal page overflow ${overflow}px`);
    // The last question must be reachable above the sticky palette.
    const lastInput = page.locator('input[aria-label^="Answer for question"]').last();
    await lastInput.scrollIntoViewIfNeeded();
    const covered = await lastInput.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !(top === el || el.contains(top));
    });
    const paletteHeight = await page.locator('[aria-label="Question palette"]').evaluate((el) => el.closest(".sticky")?.getBoundingClientRect().height ?? 0);
    await page.screenshot({ path: join(OUT, `07-part2-${size.name}.png`) });
    if (covered) throw new Error("last answer field is covered by fixed controls");
    if (paletteHeight > size.viewport.height * 0.4) throw new Error(`palette takes ${Math.round(paletteHeight)}px of ${size.viewport.height}`);
    return `no overflow, last field reachable, palette ${Math.round(paletteHeight)}px`;
  });
}

await step("08-section-result-has-no-level", async () => {
  const detail = await (await ctx.request.get(`${WEB}/api/backend/mock/attempts/${attemptId}`)).json();
  const sec = detail.data.sections.find((s) => s.skill === "listening");
  const answers = Object.fromEntries(sec.groups.flatMap((g) => g.questions.map((q) => [q.id, q.options?.length ? "A" : "x"])));
  const put = await ctx.request.post(`${WEB}/api/backend/mock/attempts/${attemptId}/answers`, { data: { answers: Object.entries(answers).map(([questionId, response]) => ({ questionId, response })) } });
  if (put.status() >= 400) throw new Error(`answers HTTP ${put.status()}`);
  const sub = await ctx.request.post(`${WEB}/api/backend/mock/attempts/${attemptId}/submit`, { data: { confirm: true } });
  if (sub.status() >= 400) throw new Error(`submit HTTP ${sub.status()} ${(await sub.text()).slice(0, 200)}`);
  await page.setViewportSize(sizes[1].viewport);
  await page.goto(`${WEB}/en/mock/attempt/${attemptId}`, { waitUntil: "domcontentloaded" });
  await page.getByText(/Bo'lim mashqi/).first().waitFor({ timeout: 120000 });
  // Result cards stack without overlapping on phones (a video suggested they did; it was compression).
  for (const size of sizes) {
    await page.setViewportSize(size.viewport);
    await page.waitForTimeout(300);
    const layout = await stackedWithoutOverlap(page);
    if (layout.clashes.length) throw new Error(`overlapping result blocks at ${size.name}: ${layout.clashes.join("; ")}`);
    if (layout.overflow > 1) throw new Error(`horizontal overflow ${layout.overflow}px at ${size.name}`);
  }
  await page.setViewportSize(sizes[1].viewport);
  const body = await page.innerText("body");
  for (const banned of ["Below B1", "Estimated Multilevel Result", "AI bahosi", "Sertifikatni"]) {
    if (body.includes(banned)) throw new Error(`result shows "${banned}"`);
  }
  const pdf = await ctx.request.get(`${WEB}/api/backend/mock/attempts/${attemptId}/certificate`);
  const head = (await pdf.body()).subarray(0, 5).toString();
  await page.screenshot({ path: join(OUT, "08-result-390.png"), fullPage: true });
  return `section result without level; report HTTP ${pdf.status()} ${head}`;
});

// A full mock handed in with no answers: final state at once (nothing queued for AI), a plain
// "no answers" screen, no scores/level/certificate, and no overlapping cards on phones.
async function stackedWithoutOverlap(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="empty-attempt"]')?.parentElement ?? document.querySelector(".mx-auto.max-w-3xl");
    const kids = [...(root?.children ?? [])].filter((el) => el.getBoundingClientRect().height > 0);
    const clashes = [];
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      if (b.top < a.bottom - 1) clashes.push(`${kids[i - 1].tagName}#${i - 1} overlaps #${i} by ${Math.round(a.bottom - b.top)}px`);
    }
    return { clashes, overflow: document.documentElement.scrollWidth - window.innerWidth, blocks: kids.length };
  });
}
await step("09-empty-attempt-final-state-and-layout", async () => {
  const start = await ctx.request.post(`${WEB}/api/backend/mock/exams/${EXAM}/start`, { data: { mode: "timed", retake: true, force: true } });
  const sj = await start.json();
  if (!start.ok()) throw new Error(`start HTTP ${start.status()} ${JSON.stringify(sj).slice(0, 200)}`);
  const id = sj.data?.attemptId || sj.data?.id || sj.data?.attempt?.id;
  const t0 = Date.now();
  const sub = await ctx.request.post(`${WEB}/api/backend/mock/attempts/${id}/submit`, { data: { confirm: true } });
  if (sub.status() >= 400) throw new Error(`submit HTTP ${sub.status()} ${(await sub.text()).slice(0, 200)}`);
  const detail = (await (await ctx.request.get(`${WEB}/api/backend/mock/attempts/${id}`)).json()).data;
  const seconds = (Date.now() - t0) / 1000;
  if (detail.status !== "completed") throw new Error(`status is ${detail.status} after ${seconds.toFixed(1)}s`);
  if (detail.cefrLevel != null || detail.overallScore != null) throw new Error(`empty attempt carries a level: ${detail.cefrLevel} / ${detail.overallScore}`);
  const rows = [];
  for (const size of sizes) {
    await page.setViewportSize(size.viewport);
    await page.goto(`${WEB}/en/mock/attempt/${id}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("empty-attempt").waitFor({ timeout: 120000 });
    const body = await page.innerText("body");
    for (const banned of ["AI bahosi", "tekshirilmoqda", "/75", "raw", "Sertifikat", "Certificate"]) if (body.includes(banned)) throw new Error(`empty result shows "${banned}" at ${size.name}`);
    const layout = await stackedWithoutOverlap(page);
    if (layout.clashes.length) throw new Error(`overlapping blocks at ${size.name}: ${layout.clashes.join("; ")}`);
    if (layout.overflow > 1) throw new Error(`horizontal overflow ${layout.overflow}px at ${size.name}`);
    await page.screenshot({ path: join(OUT, `09-empty-result-${size.name}.png`), fullPage: true });
    rows.push(`${size.name}: ${layout.blocks} blocks, no overlap`);
  }
  return `completed ${seconds.toFixed(1)}s after submit, no level; ${rows.join("; ")}`;
});

await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify({ web: WEB, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
