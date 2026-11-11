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

// The exam shows a one-time Uzbek/English full-screen notice; accept it whenever it appears.
async function acceptFullscreenNotice(page) {
  await page.addLocatorHandler(page.getByTestId("fullscreen-notice"), async (notice) => {
    await notice.getByRole("button").click();
  });
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

const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ["--disable-gpu", "--disable-dev-shm-usage", "--use-fake-device-for-media-stream"] });
const sizes = [
  { name: "360x640", viewport: { width: 360, height: 640 } },
  { name: "390x844", viewport: { width: 390, height: 844 } },
];
const ctx = await browser.newContext({ ...devices["Pixel 5"], viewport: sizes[1].viewport });
const page = await ctx.newPage();
await acceptFullscreenNotice(page);
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
  const noticeSeen = await page.evaluate((id) => sessionStorage.getItem(`bw_fullscreen_notice_${id}`), attemptId);
  if (noticeSeen !== "1") throw new Error("the one-time full-screen notice was not shown and accepted");
  await page.screenshot({ path: join(OUT, "04-part1-390.png") });
  return "palette shows 1…35, Part 1 visible; full-screen notice shown once";
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
// Audio on a phone-sized Chromium. Part 1 goes through the real exam player (server-granted preview,
// then one granted play). Parts 1-4 files are decoded in step 09.
// Headless Chromium has no speaker: this proves the file is served, decodes and is not silent,
// and that the element really starts playing. It does NOT prove audible output on a device.
await step("05c-listening-player-plays-part-1", async () => {
  await page.getByRole("tab", { name: /Part 1/ }).click();
  const player = page.locator('section[aria-label]').filter({ has: page.locator('audio') }).first();
  await player.waitFor();
  if ((await player.locator("audio[controls]").count()) !== 0) throw new Error("exam audio exposes native controls");
  if ((await player.locator('input[type="range"]').count()) !== 1) throw new Error("exam audio must expose volume only");
  await player.getByRole("button", { name: /Preview this part|Qismni ko/ }).click();
  const playBtn = player.getByRole("button", { name: /Play audio|Audioni boshlash/ });
  await playBtn.waitFor();
  if (!(await playBtn.isDisabled())) throw new Error("Play is enabled during the preview window");
  await page.waitForFunction((el) => !el.disabled, await playBtn.elementHandle(), { timeout: 40000, polling: 500 });
  const audioLog = [];
  page.on("response", (r) => { if (r.url().includes("/audio")) audioLog.push(`${r.status()} ${r.url().slice(-60)}`); });
  page.on("console", (m) => { if (m.type() === "error") audioLog.push(`console: ${m.text().slice(0, 120)}`); });
  await playBtn.click();
  await page.waitForFunction(() => { const a = document.querySelector("audio"); return !!a && !a.paused && a.currentTime > 0.2; }, null, { timeout: 30000 }).catch(async (e) => {
    const state = await page.evaluate(() => { const a = document.querySelector("audio"); return { paused: a?.paused, t: a?.currentTime, ended: a?.ended, err: a?.error?.message, log: undefined, src: a?.currentSrc?.slice(0, 40), ready: a?.readyState, ui: document.querySelector("section[aria-label]")?.innerText }; });
    throw new Error(`audio element never started: ${JSON.stringify(state)} log=${JSON.stringify(audioLog)} (${e.message.split(String.fromCharCode(10))[0]})`);
  });
  const el = await page.evaluate(() => { const a = document.querySelector("audio"); return { seconds: a.duration, volume: a.volume, controls: a.controls }; });
  await page.screenshot({ path: join(OUT, "05c-player-playing-390.png") });
  return `player: no native controls, volume only, Play locked during preview, element playing (${el.seconds.toFixed(1)}s, volume ${el.volume})`;
});

// A CEFR mock must not be labelled "DTM", and the exam chrome comes from the message catalogue.
// (Uzbek strings are covered by the vitest specs: the unprefixed default-locale route loops under
// `next dev` on this machine, so the browser check runs on /en.)
await step("05d-exam-chrome-has-no-dtm-label", async () => {
  await page.getByRole("tab", { name: /Part 1/ }).click();
  await page.getByText(/Question palette/).first().waitFor({ timeout: 30000 });
  const text = await page.innerText("body");
  if (/DTM/i.test(text)) throw new Error("the page still says DTM");
  for (const raw of ["mock.stepper.", "mock.runnerUx."]) if (text.includes(raw)) throw new Error(`missing translation key ${raw}`);
  return "palette titled 'Question palette'; no DTM label, no raw translation keys";
});

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
    // The palette wraps into rows (no sideways scrolling) and says when more rows are hidden.
    const pal = await page.getByTestId("question-palette").evaluate((el) => ({ sideways: el.scrollWidth - el.clientWidth, more: el.scrollHeight > el.clientHeight + 4, hint: !!document.querySelector('[data-testid="palette-more"]') }));
    if (pal.sideways > 1) throw new Error(`palette scrolls sideways by ${pal.sideways}px`);
    if (pal.more && !pal.hint) throw new Error("palette hides rows without a scroll hint");
    const paletteHeight = await page.locator('[aria-label="Question palette"]').evaluate((el) => el.closest(".sticky")?.getBoundingClientRect().height ?? 0);
    await page.screenshot({ path: join(OUT, `07-part2-${size.name}.png`) });
    if (covered) throw new Error("last answer field is covered by fixed controls");
    if (paletteHeight > size.viewport.height * 0.4) throw new Error(`palette takes ${Math.round(paletteHeight)}px of ${size.viewport.height}`);
    return `no overflow, last field reachable, palette ${Math.round(paletteHeight)}px, wraps${pal.more ? " + scroll hint" : ""}`;
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

// Parts 1-4 media decode check (practice attempt: timed attempts only release a part after the previous
// one expired). Not silent, decodable, served as audio.
await step("09-audio-parts-1-4-decode", async () => {
  const start = await ctx.request.post(`${WEB}/api/backend/mock/exams/${EXAM}/start`, { data: { mode: "practice", skills: ["listening"], retake: true, force: true } });
  const sj = await start.json();
  if (!start.ok()) throw new Error(`start HTTP ${start.status()} ${JSON.stringify(sj).slice(0, 200)}`);
  const id = sj.data?.attemptId || sj.data?.id || sj.data?.attempt?.id;
  const detail = await (await ctx.request.get(`${WEB}/api/backend/mock/attempts/${id}`)).json();
  const listening = detail.data.sections.find((s) => s.skill === "listening");
  const rows = [];
  for (const [i, g] of listening.groups.slice(0, 4).entries()) {
    const info = await page.evaluate(async (url) => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const buf = await res.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ac = new Ctx();
      try {
        const audio = await ac.decodeAudioData(buf.slice(0));
        const data = audio.getChannelData(0);
        let sum = 0; for (let k = 0; k < data.length; k++) sum += data[k] * data[k];
        return { type: res.headers.get("content-type"), bytes: buf.byteLength, seconds: audio.duration, rms: Math.sqrt(sum / data.length) };
      } catch (e) { return { error: `decode failed: ${e.message}` }; }
      finally { void ac.close(); }
    }, `/api/backend/mock/groups/${g.id}/audio?attemptId=${id}`);
    if (info.error) throw new Error(`Part ${i + 1}: ${info.error}`);
    if (!/^audio\//.test(info.type || "")) throw new Error(`Part ${i + 1}: content-type ${info.type}`);
    if (info.rms < 0.001) throw new Error(`Part ${i + 1}: audio is silent (rms ${info.rms})`);
    rows.push(`P${i + 1} ${info.seconds.toFixed(1)}s ${(info.bytes / 1024).toFixed(0)}KB rms ${info.rms.toFixed(3)}`);
    if (info.seconds < 60) console.log(`WARN Part ${i + 1} audio is only ${info.seconds.toFixed(1)}s long: placeholder-length media, not a real recording`);
  }
  return `decoded ${rows.join("; ")}`;
});

// Microphone check before Speaking, on a phone-sized Chromium with a FAKE microphone device (no real hardware).
// (a) permission refused -> Uzbek instructions, Retry, and a way on without the microphone;
// (b) permission granted -> the 5 second test completes. A real phone (Android overlay detection,
// Samsung/Chrome prompt) is NOT covered by this.
await step("10-microphone-check-refused-then-allowed", async () => {
  const start = await ctx.request.post(`${WEB}/api/backend/mock/exams/${EXAM}/start`, { data: { mode: "timed", skills: ["speaking"], retake: true, force: true } });
  const sj = await start.json();
  if (!start.ok()) throw new Error(`start HTTP ${start.status()} ${JSON.stringify(sj).slice(0, 200)}`);
  const id = sj.data?.attemptId || sj.data?.id || sj.data?.attempt?.id;
  const url = `${WEB}/en/mock/attempt/${id}?skill=speaking`;

  // (a) refused: this context was never granted the microphone
  await page.setViewportSize(sizes[1].viewport);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Sinovni boshlash/ }).click({ timeout: 90000 });
  const help = page.getByRole("alert").filter({ hasText: /Mikrofon/ });
  await help.waitFor({ timeout: 30000 });
  const helpText = await help.innerText();
  if (!/Ruxsat berish/.test(helpText)) throw new Error(`no Uzbek instructions: ${helpText}`);
  if (/permission denied/i.test(await page.innerText("body"))) throw new Error("English permission error shown");
  await page.getByRole("button", { name: /Qayta urinish/ }).waitFor();
  await page.screenshot({ path: join(OUT, "10a-mic-refused-390.png") });
  await page.getByTestId("mic-continue-without").click();
  await page.getByRole("button", { name: /Sinovni boshlash/ }).waitFor({ state: "detached", timeout: 10000 });
  // the exam is usable again: the header Finish button is reachable (not covered by the modal)
  const finish = page.getByRole("button", { name: /Finish|Yakunlash|Topshirish/ }).first();
  await finish.waitFor();
  const covered = await finish.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(top === el || el.contains(top)); });
  if (covered) throw new Error("exam buttons are still covered after continuing without the microphone");

  // (b) allowed (fake device)
  const ctx2 = await browser.newContext({ ...devices["Pixel 5"], viewport: sizes[1].viewport, permissions: ["microphone"] });
  try {
    const p2 = await ctx2.newPage();
    p2.setDefaultTimeout(90000);
    await acceptFullscreenNotice(p2);
    await p2.goto(`${WEB}/en/login`, { waitUntil: "domcontentloaded" });
    await p2.waitForSelector("#phone");
    await p2.waitForTimeout(1500);
    await p2.fill("#phone", STUDENT); await p2.fill("#password", PASSWORD);
    await Promise.all([p2.waitForResponse((r) => r.url().includes("/api/auth/login")), p2.click('button[type="submit"]')]);
    await p2.waitForURL(/dashboard/);
    await p2.goto(url, { waitUntil: "domcontentloaded" });
    await p2.getByRole("button", { name: /Sinovni boshlash/ }).click();
    await p2.getByText(/Yozuv tayyor/).waitFor({ timeout: 20000 });
    await p2.screenshot({ path: join(OUT, "10b-mic-allowed-390.png") });
    await p2.getByRole("button", { name: /Speakingni boshlash/ }).click();
    await p2.getByRole("button", { name: /Speakingni boshlash/ }).waitFor({ state: "detached", timeout: 10000 });
  } finally { await ctx2.close(); }
  return "refused: Uzbek help + Retry + continue without (buttons free); allowed (fake mic): 5 s test passes";
});

await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify({ web: WEB, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
