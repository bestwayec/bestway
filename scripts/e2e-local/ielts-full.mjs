// BESTWAY local end-to-end: a full IELTS Academic mock from the Exam Builder to the band score.
// Real browser, real local stack, synthetic accounts and synthetic content only.
//
//   teacher  : creates a Full Mock with the IELTS starter structure in the Exam Builder (UI), fills
//              40 Listening / 40 Reading questions, two Writing tasks and three Speaking parts through
//              the Builder's own authoring API, checks the review panel and publishes (UI)
//   student  : finds the exam on the IELTS track, answers every section in the browser, records the
//              Speaking parts (recorded practice mode), finishes
//   teacher  : grades Writing with TA/CC/LR/GRA and Speaking with FC/LR/GRA/P (one part with no
//              recording: live mode, the teacher enters the criteria from the interview)
//   result   : section bands from the official conversion, overall band; no AI score anywhere
//
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node ielts-full.mjs [phase...]
//   Phases: build student grade (default: all). State: ../../.local/e2e/ielts-full.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", ".local", "e2e");
mkdirSync(OUT, { recursive: true });
const STATE_FILE = join(OUT, "ielts-full.json");

const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic, local only (seed_local_dev)
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT || "+998900000010";
const STUDENT_IELTS = process.env.BW_STUDENT_IELTS || "+998900000011";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }

const phases = process.argv.slice(2).length ? process.argv.slice(2) : ["build", "student", "grade"];
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const results = [];

/* ── synthetic fixtures (a tone and a gradient; never a person, never real exam content) ───────── */
function wavFile(name, seconds) {
  const rate = 16000, n = rate * seconds, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 330 * i) / rate)), 44 + i * 2);
  const path = join(OUT, name); writeFileSync(path, buf); return path;
}
function pngFile(name, w = 320, h = 200) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (1 + w * 3) + 1 + x * 3; raw[o] = (x * 255) / w; raw[o + 1] = (y * 255) / h; raw[o + 2] = 120; }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const path = join(OUT, name);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  return path;
}
const LISTENING_SECONDS = 6;
const AUDIO = wavFile("ielts-listening.wav", LISTENING_SECONDS);

/* ── helpers ──────────────────────────────────────────────────────────────────────────────────── */
// Fake microphone: Speaking records Chromium's synthetic tone, never a person.
const browser = await chromium.launch({
  ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

async function session(phone, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => { results.push({ step: "pageerror", ok: false, note: e.message.slice(0, 200) }); console.log(`PAGEERROR ${e.message.slice(0, 200)}`); });
  await page.addInitScript(() => { try { sessionStorage.setItem("bw_fullscreen_notice_seen", "1"); } catch { /* ignore */ } });
  // The exam window shows a one-time full-screen notice a moment after it opens; accept it whenever it appears.
  // "Open somewhere else" (each test browser is a new device) sits above it; always answer the top one first.
  const notices = page.getByTestId("exam-session-elsewhere").or(page.getByTestId("fullscreen-notice")).first();
  await page.addLocatorHandler(notices, async () => {
    for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
      const dialog = page.getByTestId(id);
      if (await dialog.count()) { await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {}); return; }
    }
  }, { noWaitAfter: true });
  await page.goto(`${WEB}/en/login`);
  await page.locator('input[type="tel"], input[name="phone"]').first().fill(phone);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
  return page;
}

async function step(page, name, fn) {
  try {
    const note = await fn();
    results.push({ step: name, ok: true, note: note ?? "" });
    console.log(`PASS  ${name}${note ? `  - ${note}` : ""}`);
  } catch (e) {
    results.push({ step: name, ok: false, note: e.message.split("\n")[0] });
    console.log(`FAIL  ${name}  - ${e.message.split("\n")[0]}`);
    await page?.screenshot({ path: join(OUT, `ielts-${name}-FAIL.png`), fullPage: true }).catch(() => {});
    throw e;
  }
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `ielts-${name}.png`) }).catch(() => {});
const expect = (cond, message) => { if (!cond) throw new Error(message); };

/** The frontend's own API proxy with the page's session cookies (same calls the Builder makes). */
async function api(page, method, path, body, { multipart, allow } = {}) {
  const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, ...(multipart ? { multipart } : body !== undefined ? { data: body } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok() && !(allow || []).includes(res.status())) throw new Error(`${method} ${path} HTTP ${res.status()} ${JSON.stringify(json).slice(0, 300)}`);
  return { status: res.status(), data: json.data, error: json.error };
}

/* ── synthetic content that follows the blueprint part by part ────────────────────────────────── */
const letters = "ABCDEFGHIJ";
const mc = (n, skill, count) => ({ number: n, type: "multiple_choice", prompt: `Synthetic ${skill} item ${n}: choose option A.`, options: Array.from({ length: count }, (_, i) => `Choice ${letters[i]} for item ${n}`), correctAnswers: [`Choice A for item ${n}`], points: 1 });
const gap = (n, skill) => ({ number: n, type: "short_answer", prompt: `Synthetic ${skill} item ${n}: write the word "alpha".`, options: [], correctAnswers: ["alpha"], points: 1, wordLimit: 1, answerRule: "ONE_WORD" });
// Matching options are used once each, so every item has its own answer (item k → option k).
const match = (n, skill, pool, type = "matching", k = 0) => ({ number: n, type, prompt: `Synthetic ${skill} item ${n}: choose entry ${letters[k]}.`, options: pool, correctAnswers: [pool[k]], points: 1 });
const tfng = (n) => ({ number: n, type: "true_false_notgiven", prompt: `Synthetic reading item ${n}: the statement is true.`, options: ["TRUE", "FALSE", "NOT GIVEN"], correctAnswers: ["TRUE"], points: 1 });
const pool = (label, count) => Array.from({ length: count }, (_, i) => `${label} ${letters[i]}`);
const range = (from, count) => Array.from({ length: count }, (_, i) => from + i);

async function tree(page, examId) { return (await api(page, "GET", `/mock/exams/${examId}`)).data; }
async function putContent(page, group, questions, extra = {}) {
  return api(page, "PUT", `/mock/groups/${group.id}/content`, { ...extra, questions, deletedQuestionIds: [] });
}

async function dismissExamNotices(page) {
  for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
    const dialog = page.getByTestId(id);
    // The full-screen notice may already have been accepted by the page-level handler.
    if (await dialog.count()) { await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(800); }
  }
}
async function startSectionIfAsked(page) {
  const now = page.getByRole("button", { name: /^Start .* now$/ });
  if (await now.count()) { await now.first().click(); await page.waitForTimeout(1500); }
}
const correct = (q) => (q.correctAnswers || [])[0];
async function answerObjective(page, q) {
  if (q.type === "short_answer") await page.getByLabel(`Answer for question ${q.number}`, { exact: true }).fill(correct(q));
  else {
    const radio = page.locator(`input[name="objective-answer-${q.id}"][value="${correct(q).replace(/"/g, '\\"')}"]`);
    // Like a student: scroll the option to the middle of the screen (the question palette sits at the bottom), then click it.
    await radio.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await radio.check();
  }
}
async function openPart(page, n) {
  await page.locator(`[aria-label^="Part ${n}:"], [aria-label^="Part ${n} "]`).first().click();
  await page.waitForTimeout(600);
}
async function answeredCount(page) {
  const text = await page.locator("body").innerText();
  return Number((text.match(/(\d+) \/ 81 answered/) || [])[1] ?? -1);
}
async function finishSection(page) {
  await page.getByRole("button", { name: "Next section" }).locator("visible=true").first().click();
  // Multilevel asks "Move on anyway"; the IELTS window asks "Yes, next section".
  const anyway = page.getByRole("button", { name: /^(Move on anyway|Yes, next section)$/ }).first();
  if (await anyway.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) await anyway.click();
  await page.waitForTimeout(2000);
  await startSectionIfAsked(page);
}


async function expectEnabled(locator, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await locator.count() && !(await locator.isDisabled())) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("button stayed disabled");
}

/* ── synthetic IELTS content (counts from the blueprint: 40 / 40 / 2 tasks / 3 parts) ─────────── */
const IELTS_LISTENING = [range(1, 10), range(11, 10), range(21, 10), range(31, 10)]
  .map((part, i) => part.map((n) => (i % 2 ? gap(n, "listening") : mc(n, "listening", 3))));
// Product rule: question numbers run across the whole IELTS exam (Reading continues at 41).
const IELTS_READING = [range(41, 13), range(54, 13), range(67, 14)]
  .map((part) => part.map((n) => (n % 2 ? tfng(n) : mc(n, "reading", 4))));
const IELTS_WRITING = [
  { type: "essay_task1", prompt: "The chart shows synthetic visitor numbers at three museums. Summarise the information (at least 150 words)." },
  { type: "essay_task2", prompt: "Some people think museums should be free. Discuss both views and give your opinion (at least 250 words)." },
];
const IELTS_SPEAKING = [
  ["Synthetic Part 1: where do you live?", "Synthetic Part 1: what do you study?"],
  ["Synthetic Part 2: describe a museum you visited. You should say where it is, when you went and why you liked it."],
  ["Synthetic Part 3: should museums be free for students?"],
];

/* ── phase: build ─────────────────────────────────────────────────────────────────────────────── */
async function build() {
  const teacher = await session(TEACHER);
  const title = `E2E IELTS ${Date.now().toString(36)}`;
  await step(teacher, "01-create-ielts-full-mock", async () => {
    await teacher.goto(`${WEB}/en/exam-builder/new`, { waitUntil: "networkidle" });
    await teacher.getByRole("radiogroup", { name: "Exam type" }).locator("button, label, [role=radio]").filter({ hasText: "IELTS Academic" }).first().click();
    await teacher.locator("button, label, [role=radio]").filter({ hasText: "Full Mock" }).first().click();
    await teacher.locator("#eb-title").fill(title);
    const created = teacher.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/mock/exams"));
    await teacher.getByRole("button", { name: "Create & Continue" }).click();
    expect((await created).status() === 201, "create failed");
    await teacher.waitForURL(/exam-builder\/(?!new)[0-9a-f-]+/);
    state.examId = teacher.url().split("/").pop().split("?")[0]; state.title = title; saveState();
    const exam = await tree(teacher, state.examId);
    const shape = exam.sections.map((s) => `${s.skill}:${s.groups.length}`).join(" ");
    expect(exam.type === "ielts_academic" && exam.profile === "full_mock", `${exam.type} ${exam.profile}`);
    expect(exam.totalQuestions === 0, "the starter structure must not contain invented questions");
    return `${state.examId} — ${shape}, 0 questions`;
  });
  await step(teacher, "02-fill-and-publish", async () => {
    const exam = await tree(teacher, state.examId);
    const by = Object.fromEntries(exam.sections.map((s) => [s.skill, s]));
    for (const [i, group] of by.listening.groups.entries()) {
      await api(teacher, "POST", `/mock/groups/${group.id}/media`, undefined, { multipart: { audio: { name: `part-${i + 1}.wav`, mimeType: "audio/wav", buffer: readFileSync(AUDIO) } } });
      await putContent(teacher, group, IELTS_LISTENING[i], { instructions: `Synthetic listening part ${i + 1}.` });
    }
    for (const [i, group] of by.reading.groups.entries()) await putContent(teacher, group, IELTS_READING[i], { passageText: `Synthetic passage ${i + 1}. The answer word is alpha and every statement is true.` });
    for (const [i, group] of by.writing.groups.entries()) await putContent(teacher, group, [{ number: 81 + i, type: IELTS_WRITING[i].type, prompt: IELTS_WRITING[i].prompt, options: [], points: 9 }]);
    let number = 83;
    for (const [i, group] of by.speaking.groups.entries()) await putContent(teacher, group, IELTS_SPEAKING[i].map((prompt) => ({ number: number++, type: "speaking_task", prompt, options: [], points: 9 })));
    const ready = (await api(teacher, "GET", `/mock/exams/${state.examId}/readiness`)).data;
    const failing = ready.items.filter((item) => !item.ok).map((item) => `${item.key}: ${item.detail}`);
    expect(ready.ready && !failing.length, `not ready: ${failing.join(" | ").slice(0, 600)}`);
    await teacher.reload({ waitUntil: "networkidle" });
    await teacher.getByRole("button", { name: /^Review/ }).locator("visible=true").first().click();
    await teacher.getByText("Review exam").waitFor();
    await teacher.getByRole("button", { name: "Publish", exact: true }).locator("visible=true").first().click();
    await teacher.getByRole("button", { name: "Publish now" }).click();
    const dialog = teacher.getByRole("dialog"); await dialog.waitFor();
    const patch = teacher.waitForResponse((r) => r.request().method() === "PATCH" && /\/mock\/exams\/[^/]+$/.test(new URL(r.url()).pathname));
    await dialog.getByRole("button", { name: /publish/i }).last().click();
    expect((await patch).status() < 300, "publish failed");
    const filled = await tree(teacher, state.examId);
    return filled.sections.map((s) => `${s.skill}:${s.groups.reduce((n, g) => n + g.questions.length, 0)}`).join(" ") + "; readiness green; published";
  });
  await teacher.context().close();
}

const roundHalf = (x) => { const f = Math.floor(x), r = x - f; return r < 0.25 ? f : r < 0.75 ? f + 0.5 : f + 1; };
async function openBlock(page, n) {
  await page.locator(`[aria-label^="Part ${n}:"], [aria-label^="Passage ${n}:"], [aria-label^="Task ${n}:"], [aria-label^="Part ${n} "], [aria-label^="Passage ${n} "], [aria-label^="Task ${n} "]`).first().click();
  await page.waitForTimeout(600);
}
async function answered(page) {
  const text = await page.locator("body").innerText();
  return Number((text.match(/(\d+) \/ 86 answered/) || [])[1] ?? -1);
}

/* ── phase: student ──────────────────────────────────────────────────────────────────────────── */
async function student() {
  const teacherView = await session(TEACHER);
  const exam = await tree(teacherView, state.examId);
  await teacherView.context().close();
  const by = Object.fromEntries(exam.sections.map((s) => [s.skill, s]));
  const page = await session(STUDENT_IELTS);
  // A re-run starts clean: hand in this exam's attempts an earlier run left open.
  const mine = (await api(page, "GET", "/mock/attempts/mine")).data;
  for (const open of (Array.isArray(mine) ? mine : mine?.items ?? []).filter((a) => a.examId === state.examId && a.status === "in_progress"))
    await api(page, "POST", `/mock/attempts/${open.id}/submit`, { confirm: true, confirmed: true, force: true }, { allow: [400, 403, 404, 409] });
  await step(page, "03-student-starts-on-ielts-track", async () => {
    await page.goto(`${WEB}/en/mock`, { waitUntil: "networkidle" });
    const toIelts = page.getByTestId("exam-track-card-IELTS").getByRole("button", { name: /Switch to/ });
    if (await toIelts.count()) { await toIelts.click(); await page.waitForTimeout(2500); }
    const card = page.locator('[data-testid^="mock-card-"]').filter({ hasText: state.title }).first();
    await card.getByRole("button").filter({ hasText: /^(Start|Resume)$/ }).first().click();
    const dialog = page.getByRole("dialog"); await dialog.waitFor();
    const started = page.waitForResponse((r) => /\/mock\/exams\/[^/]+\/start$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await dialog.getByRole("button", { name: /Start the full exam/ }).click();
    const res = await started; expect(res.status() === 201, `start ${res.status()}`);
    state.attemptId = (await res.json()).data.attemptId; saveState();
    await page.waitForURL(/\/mock\/attempt\//); await page.waitForLoadState("networkidle");
    await dismissExamNotices(page);
    return `timed IELTS attempt ${state.attemptId}`;
  });
  await step(page, "04-listening-reading", async () => {
    for (const [i, group] of by.listening.groups.entries()) {
      await openBlock(page, i + 1);
      const play = page.getByRole("button", { name: /Play audio/ }).first();
      if (await play.count() && !(await play.isDisabled())) await play.click();
      for (const q of group.questions) await answerObjective(page, q);
    }
    await page.waitForTimeout(2500);
    expect((await answered(page)) === 40, `after Listening: ${await answered(page)}`);
    await finishSection(page);
    for (const [i, group] of by.reading.groups.entries()) { await openBlock(page, i + 1); for (const q of group.questions) await answerObjective(page, q); }
    await page.waitForTimeout(2500);
    expect((await answered(page)) === 80, `after Reading: ${await answered(page)}`);
    await finishSection(page);
    return "40 + 40 answered in the browser";
  });
  await step(page, "05-writing", async () => {
    const essay = (words) => Array.from({ length: words }, (_, i) => ["museums", "visitors", "students", "history", "culture"][i % 5]).join(" ") + ".";
    for (const [i, group] of by.writing.groups.entries()) {
      await openBlock(page, i + 1);
      await page.getByLabel(`Written response to question ${group.questions[0].number}`).fill(essay(i ? 260 : 160));
    }
    await page.waitForTimeout(2500);
    expect((await answered(page)) === 82, `after Writing: ${await answered(page)}`);
    await finishSection(page);
    return "Task 1 (160 words) and Task 2 (260 words)";
  });
  await step(page, "06-speaking-recorded-parts", async () => {
    const mic = page.getByRole("button", { name: "Start the test (5 seconds)" });
    if (await mic.count()) { await mic.click(); await page.getByRole("button", { name: /I can hear it/ }).click({ timeout: 20000 }); }
    const live = by.speaking.groups[2].questions[0]; // Part 3 is taken live with the teacher: nothing is recorded
    let recorded = 0;
    for (const [i, group] of by.speaking.groups.entries()) {
      if (i === 2) continue;
      await openBlock(page, i + 1);
      for (const q of group.questions) {
        const box = page.locator(`#question-${q.id}, [data-question-id="${q.id}"]`).first();
        const scope = (await box.count()) ? box : page.locator("main").last();
        const record = scope.getByRole("button", { name: /^Record/ }).first();
        await record.click();
        await page.waitForTimeout(6000);
        const upload = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/speaking/${q.id}`), { timeout: 60000 });
        await scope.getByRole("button", { name: /^Stop/ }).first().click();
        expect((await upload).status() === 201, `upload for question ${q.number}`);
        recorded++;
      }
    }
    state.liveQuestionId = live.id; saveState();
    await page.waitForTimeout(2000);
    return `${recorded} recorded answers uploaded; Part 3 left for the live interview`;
  });
  await step(page, "07-finish", async () => {
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    const confirm = page.getByRole("button", { name: /^(Yes, finish|Submit exam|Submit anyway|Finish anyway)/ }).first();
    if (await confirm.count() || await confirm.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) await confirm.click();
    await page.waitForTimeout(4000);
    const attempt = (await api(page, "GET", `/mock/attempts/${state.attemptId}`)).data;
    expect(["grading", "completed", "submitted"].includes(attempt.status), `status ${attempt.status}`);
    expect(attempt.overallBand == null, `overall band before grading: ${attempt.overallBand}`);
    return `status ${attempt.status}; no overall band before the teacher grades`;
  });
  await page.context().close();
}

/* ── phase: grade ────────────────────────────────────────────────────────────────────────────── */
async function grade() {
  const teacher = await session(TEACHER);
  await step(teacher, "08-teacher-grades-criteria", async () => {
    await teacher.goto(`${WEB}/en/mock/attempt/${state.attemptId}`, { waitUntil: "networkidle" });
    const fields = teacher.locator("input[data-grade-score]");
    await fields.first().waitFor();
    const n = await fields.count();
    expect(n === 6, `grade fields: ${n}`);
    // Writing: TA/CC/LR/GRA; Speaking: FC/LR/GRA/P (the live Part 3 too, from the interview).
    const criteria = [[6, 6, 6, 6], [7, 7, 7, 7], [7, 7, 7, 7], [7, 7, 7, 7], [7, 7, 7, 7], [7, 7, 7, 7]];
    for (const [i, values] of criteria.entries()) {
      const form = fields.nth(i).locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]");
      const inputs = form.locator('input[type="number"]:not([data-grade-score])');
      expect((await inputs.count()) === 4, `criteria fields in form ${i}: ${await inputs.count()}`);
      for (const [k, v] of values.entries()) await inputs.nth(k).fill(String(v));
      const saved = teacher.waitForResponse((r) => /\/grade$/.test(new URL(r.url()).pathname));
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const res = await saved;
      expect(res.status() === 201, `grade ${i} HTTP ${res.status()} ${(await res.text()).slice(0, 200)}`);
    }
    const labels = await teacher.locator("input[aria-label]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("aria-label")))].filter((l) => /Task|Coherence|Lexical|Grammatical|Fluency|Pronunciation/i.test(l)));
    return `6 forms graded by criteria (${labels.join(", ").slice(0, 160)})`;
  });
  await step(teacher, "09-band-from-official-conversion", async () => {
    const attempt = (await api(teacher, "GET", `/mock/attempts/${state.attemptId}`)).data;
    const bands = attempt.sectionBands || {};
    expect(bands.listening === 9 && bands.reading === 9, `L/R bands ${bands.listening} ${bands.reading}`);
    expect(bands.writing === roundHalf((6 + 2 * 7) / 3), `writing band ${bands.writing}`);
    expect(bands.speaking === 7, `speaking band ${bands.speaking}`);
    const overall = roundHalf((bands.listening + bands.reading + bands.writing + bands.speaking) / 4);
    expect(attempt.overallBand === overall, `overall ${attempt.overallBand}, rule gives ${overall}`);
    const ai = JSON.stringify(attempt).match(/"aiScore":\s*[0-9]/);
    expect(!ai, "an AI score is present");
    await teacher.goto(`${WEB}/en/mock/attempt/${state.attemptId}`, { waitUntil: "networkidle" });
    await shot(teacher, "09-result");
    return `L 9 · R 9 · W ${bands.writing} (Task 2 counts twice) · S ${bands.speaking} → overall ${attempt.overallBand}; status ${attempt.status}`;
  });
  await teacher.context().close();
}

/* ── run ──────────────────────────────────────────────────────────────────────────────────────── */
const run = { build, student, grade };
let failed = false;
try {
  for (const phase of phases) {
    if (!run[phase]) { console.log(`SKIP  ${phase} (not implemented in this run)`); continue; }
    console.log(`── ${phase}`);
    await run[phase]();
  }
} catch (e) { failed = true; if (!results.some((r) => !r.ok)) console.log(`ERROR ${e.message.split("\n")[0]}`); }
await browser.close();
const pass = results.filter((r) => r.ok).length, fail = results.filter((r) => !r.ok).length;
writeFileSync(join(OUT, "ielts-full-report.json"), JSON.stringify({ web: WEB, phases, results }, null, 2));
console.log(`\n==== SUMMARY ====\nPASS ${pass} / FAIL ${fail}`);
process.exit(failed || fail ? 1 : 0);
