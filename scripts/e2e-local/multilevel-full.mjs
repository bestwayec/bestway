// BESTWAY local end-to-end: a full Multilevel (CEFR) mock from the Exam Builder to the certificate.
// Real browser, real local stack, synthetic accounts and synthetic content only.
//
//   teacher  : creates a Full Mock with the blueprint structure in the Exam Builder (UI), fills the
//              parts (first Listening part through the UI incl. audio upload, the rest through the
//              same authoring API the Builder calls, with the teacher's own session), checks the
//              pre-publish panel and publishes (UI)
//   student  : finds the exam, device check, Listening (server play limit, reload resume), Reading,
//              Writing (draft safety), Speaking (server window, one upload per answer, retry after a
//              network drop), Finish (double click), pending result
//   teacher  : grades Writing and Speaking per part; final 75-point score and level
//   also     : a student of another group is denied; phone-size run (390x844)
//
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... BW_PYTHON=... node multilevel-full.mjs [phase...]
//   Phases: build student finish grade access mobile (default: all). State is kept in
//   ../../.local/e2e/multilevel-full.json so a phase can be re-run on its own.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", ".local", "e2e");
mkdirSync(OUT, { recursive: true });
const STATE_FILE = join(OUT, "multilevel-full.json");

const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic, local only (seed_local_dev)
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT || "+998900000010";
const OUTSIDER = process.env.BW_OUTSIDER || "+998900000031"; // created by this script (another group)
const PYTHON = process.env.BW_PYTHON || "python";
const BACKEND = join(here, "..", "..", "backend-django");
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }

const phases = process.argv.slice(2).length ? process.argv.slice(2) : ["build", "student", "finish", "grade", "access", "mobile"];
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
const AUDIO = wavFile("ml-listening.wav", LISTENING_SECONDS);
const PICTURE = pngFile("ml-speaking.png");

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
    await page?.screenshot({ path: join(OUT, `ml-${name}-FAIL.png`), fullPage: true }).catch(() => {});
    throw e;
  }
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `ml-${name}.png`) }).catch(() => {});
const expect = (cond, message) => { if (!cond) throw new Error(message); };

/** The frontend's own API proxy with the page's session cookies (same calls the Builder makes). */
async function api(page, method, path, body, { multipart, allow } = {}) {
  const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, ...(multipart ? { multipart } : body !== undefined ? { data: body } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok() && !(allow || []).includes(res.status())) throw new Error(`${method} ${path} HTTP ${res.status()} ${JSON.stringify(json).slice(0, 300)}`);
  return { status: res.status(), data: json.data, error: json.error };
}

function manage(...args) {
  return execFileSync(PYTHON, ["manage.py", ...args], { cwd: BACKEND, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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

const LISTENING = [
  range(1, 8).map((n) => mc(n, "listening", 3)),
  range(9, 6).map((n) => gap(n, "listening")),
  range(15, 4).map((n, k) => match(n, "listening", pool("Opinion", 6), "matching", k)),
  range(19, 5).map((n, k) => match(n, "listening", pool("Statement", 8), "matching", k)),
  range(24, 6).map((n) => mc(n, "listening", 3)),
  range(30, 6).map((n) => gap(n, "listening")),
];
const READING = [
  range(1, 6).map((n) => gap(n, "reading")),
  range(7, 8).map((n, k) => match(n, "reading", pool("Text", 10), "matching", k)),
  range(15, 6).map((n, k) => match(n, "reading", pool("Heading", 8), "matching_headings", k)),
  [...range(21, 4).map((n) => mc(n, "reading", 4)), ...range(25, 5).map((n) => tfng(n))],
  [...range(30, 4).map((n) => gap(n, "reading")), ...range(34, 2).map((n) => mc(n, "reading", 4))],
];
const PASSAGE = (n) => `Synthetic reading text ${n}. This paragraph exists only for the local end-to-end test. The answer word is alpha and every statement about it is true.`;
const WRITING = [
  { stimulus: "Synthetic situation: your study group plans a visit to a museum next Saturday.", prompt: "Write a short informal note to a friend about the visit (about 50 words).", type: "essay_task1" },
  { stimulus: "Synthetic situation: your study group plans a visit to a museum next Saturday.", prompt: "Write a formal email to the museum asking about group tickets (120–150 words).", type: "essay_task1" },
  { stimulus: null, prompt: "Write a short article for a student magazine: are museums still useful for young people? (180–200 words)", type: "essay_task2" },
];
const SPEAKING = [
  ["Synthetic question: describe your street.", "Synthetic question: what do you do on Sundays?", "Synthetic question: which season do you like?"],
  ["Synthetic question: describe the picture.", "Synthetic question: what is different on the left side?", "Synthetic question: which side do you prefer?"],
  ["Synthetic question: talk about a useful school subject."],
  ["Synthetic question: should homework be optional? Give reasons for and against."],
];

async function tree(page, examId) { return (await api(page, "GET", `/mock/exams/${examId}`)).data; }
async function putContent(page, group, questions, extra = {}) {
  return api(page, "PUT", `/mock/groups/${group.id}/content`, { ...extra, questions, deletedQuestionIds: [] });
}

/* ── phase: build ─────────────────────────────────────────────────────────────────────────────── */
async function build() {
  const teacher = await session(TEACHER);
  const title = `E2E Multilevel ${Date.now().toString(36)}`;
  await step(teacher, "01-create-full-mock-from-blueprint", async () => {
    await teacher.goto(`${WEB}/en/exam-builder/new`, { waitUntil: "networkidle" });
    await teacher.getByRole("radiogroup", { name: "Exam type" }).locator("button, label, [role=radio]").filter({ hasText: "Multilevel" }).first().click();
    await teacher.locator("button, label, [role=radio]").filter({ hasText: "Full Mock" }).first().click();
    await teacher.locator("#eb-title").fill(title);
    const created = teacher.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/mock/exams"));
    await teacher.getByRole("button", { name: "Create & Continue" }).click();
    const res = await created;
    expect(res.status() === 201, `create HTTP ${res.status()} ${(await res.text()).slice(0, 200)}`);
    await teacher.waitForURL(/exam-builder\/(?!new)[0-9a-f-]+/);
    state.examId = teacher.url().split("/").pop().split("?")[0];
    state.title = title; saveState();
    const exam = await tree(teacher, state.examId);
    const shape = exam.sections.map((s) => `${s.skill}:${s.groups.length}p/${s.durationMinutes}min`).join(" ");
    expect(exam.profile === "full_mock", `profile is ${exam.profile}`);
    expect(shape === "listening:6p/45min reading:5p/60min writing:3p/60min speaking:4p/30min", `starter structure: ${shape}`);
    expect(exam.totalQuestions === 0, "the starter structure must not contain invented questions");
    return `${state.examId} — ${shape}, 0 questions`;
  });

  await step(teacher, "02-listening-part-1-through-the-builder", async () => {
    await teacher.waitForLoadState("networkidle");
    // Open Listening → Part 1 in the Builder and upload the audio there.
    await teacher.getByRole("button", { name: /Listening/ }).first().click();
    await teacher.getByText("Part 1", { exact: false }).first().click().catch(() => {});
    const input = teacher.locator('main input[type="file"]').first();
    await input.waitFor({ state: "attached" });
    const upload = teacher.waitForResponse((r) => r.request().method() === "POST" && /\/mock\/groups\/[^/]+\/media$/.test(new URL(r.url()).pathname), { timeout: 60000 });
    await input.setInputFiles(AUDIO);
    // Some editors upload on Save.
    const saveButton = teacher.locator("main").getByRole("button", { name: "Save", exact: true }).first();
    if (await saveButton.count()) await saveButton.click().catch(() => {});
    const res = await upload;
    expect(res.status() === 201, `media HTTP ${res.status()}`);
    const body = (await res.json()).data;
    expect(body.audioDurationSec === LISTENING_SECONDS, `server measured ${body.audioDurationSec}s, the file is ${LISTENING_SECONDS}s`);
    await shot(teacher, "02-builder-listening");
    return `audio uploaded in the Builder; server measured ${body.audioDurationSec}s`;
  });

  await step(teacher, "03-fill-all-parts", async () => {
    const exam = await tree(teacher, state.examId);
    const by = Object.fromEntries(exam.sections.map((s) => [s.skill, s]));
    for (const [i, group] of by.listening.groups.entries()) {
      if (i > 0 || !group.hasAudio) await api(teacher, "POST", `/mock/groups/${group.id}/media`, undefined, { multipart: { audio: { name: `part-${i + 1}.wav`, mimeType: "audio/wav", buffer: readFileSync(AUDIO) } } });
      await putContent(teacher, group, LISTENING[i], { instructions: `Synthetic listening part ${i + 1}.` });
    }
    for (const [i, group] of by.reading.groups.entries()) await putContent(teacher, group, READING[i], { passageText: PASSAGE(i + 1) });
    for (const [i, group] of by.writing.groups.entries()) await putContent(teacher, group, [{ number: i + 1, type: WRITING[i].type, prompt: WRITING[i].prompt, options: [], points: group.maxScore }], WRITING[i].stimulus ? { passageText: WRITING[i].stimulus } : {});
    let number = 1;
    for (const [i, group] of by.speaking.groups.entries()) {
      if (i === 1) await api(teacher, "POST", `/mock/groups/${group.id}/media`, undefined, { multipart: { image: { name: "picture.png", mimeType: "image/png", buffer: readFileSync(PICTURE) } } });
      await putContent(teacher, group, SPEAKING[i].map((prompt) => ({ number: number++, type: "speaking_task", prompt, options: [], points: group.maxScore })));
    }
    const filled = await tree(teacher, state.examId);
    const counts = filled.sections.map((s) => `${s.skill}:${s.groups.reduce((n, g) => n + g.questions.length, 0)}`).join(" ");
    expect(counts === "listening:35 reading:35 writing:3 speaking:8", `question counts: ${counts}`);
    return counts;
  });

  await step(teacher, "04-pre-publish-panel-and-publish", async () => {
    const ready = (await api(teacher, "GET", `/mock/exams/${state.examId}/readiness`)).data;
    const failing = ready.items.filter((item) => !item.ok).map((item) => `${item.key}: ${item.detail}`);
    expect(ready.ready && !failing.length, `not ready: ${failing.join(" | ").slice(0, 600)}`);
    await teacher.reload({ waitUntil: "networkidle" });
    await teacher.getByRole("button", { name: /^Review/ }).locator("visible=true").first().click();
    await teacher.getByText("Review exam").waitFor();
    await shot(teacher, "04-review-panel");
    await teacher.getByRole("button", { name: "Publish", exact: true }).locator("visible=true").first().click();
    await teacher.getByRole("button", { name: "Publish now" }).click();
    const dialog = teacher.getByRole("dialog");
    await dialog.waitFor();
    const patch = teacher.waitForResponse((r) => r.request().method() === "PATCH" && /\/mock\/exams\/[^/]+$/.test(new URL(r.url()).pathname));
    await dialog.getByRole("button", { name: /publish/i }).last().click();
    const res = await patch;
    expect(res.status() < 300, `publish HTTP ${res.status()} ${(await res.text()).slice(0, 300)}`);
    const exam = await tree(teacher, state.examId);
    expect(exam.isPublished, "exam is not published");
    return "readiness all green; published through the review panel";
  });
  await teacher.context().close();
}

/* ── student helpers ─────────────────────────────────────────────────────────────────────────── */
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
  const anyway = page.getByRole("button", { name: "Move on anyway" });
  if (await anyway.count()) await anyway.click();
  await page.waitForTimeout(2000);
  await startSectionIfAsked(page);
}

/* ── phase: student ──────────────────────────────────────────────────────────────────────────── */
async function student() {
  const teacherView = await session(TEACHER);
  const exam = await tree(teacherView, state.examId); // answer key for the synthetic content (teacher view)
  await teacherView.context().close();
  const by = Object.fromEntries(exam.sections.map((s) => [s.skill, s]));
  const page = await session(STUDENT);
  // A re-run starts clean: hand in the attempt an earlier run left open.
  if (state.attemptId) await api(page, "POST", `/mock/attempts/${state.attemptId}/submit`, { confirm: true, confirmed: true, force: true }, { allow: [400, 403, 404, 409] });
  const submits = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/submit$/.test(new URL(r.url()).pathname)) submits.push(r.url()); });

  await step(page, "05-student-finds-exam-and-checks-device", async () => {
    await page.goto(`${WEB}/en/mock`, { waitUntil: "networkidle" });
    const card = page.locator('[data-testid^="mock-card-"]').filter({ hasText: state.title }).first();
    await card.waitFor();
    await card.getByRole("button").filter({ hasText: /^(Start|Retake|Start again|Resume)$/ }).first().click();
    const dialog = page.getByRole("dialog"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "Check my device" }).click();
    await dialog.getByText(/Connected · server replied/).waitFor({ timeout: 20000 });
    const started = page.waitForResponse((r) => /\/mock\/exams\/[^/]+\/start$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await dialog.getByRole("button", { name: /Start the full exam/ }).click();
    const res = await started;
    expect(res.status() === 201, `start HTTP ${res.status()}`);
    const body = (await res.json()).data;
    expect(body.mode === "timed", `mode ${body.mode}`);
    state.attemptId = body.attemptId; saveState();
    await page.waitForURL(/\/mock\/attempt\//); await page.waitForLoadState("networkidle");
    await dismissExamNotices(page);
    return `timed attempt ${state.attemptId}, deadline ${body.deadlineAt}`;
  });

  await step(page, "06-listening-server-plays-and-reload", async () => {
    const notes = [];
    for (const [i, group] of by.listening.groups.entries()) {
      await openPart(page, i + 1);
      const region = page.getByRole("region", { name: /listening/i }).first();
      const preview = region.getByRole("button", { name: "Preview this part" });
      if (await preview.count()) await preview.click();
      for (let play = 1; play <= 2; play++) {
        const playButton = region.getByRole("button", { name: "Play audio" });
        await expectEnabled(playButton, 40000);
        const granted = page.waitForResponse((r) => r.url().includes(`/listening/${group.id}/play`));
        await playButton.click();
        expect((await granted).status() === 201, "play refused");
        if (i === 0 && play === 1) {
          await page.reload({ waitUntil: "networkidle" }); await dismissExamNotices(page); await openPart(page, 1);
          await page.getByRole("region", { name: /listening/i }).first().getByText("Plays 1/2").waitFor({ timeout: 15000 });
          notes.push("reload keeps plays 1/2");
        }
        await page.waitForTimeout((LISTENING_SECONDS + 1) * 1000);
      }
      await region.getByText("Plays 2/2").waitFor();
      expect(await region.getByRole("button", { name: "Play audio" }).isDisabled(), "a third play was offered");
      for (const q of group.questions) await answerObjective(page, q);
    }
    // The server refuses a third play even when asked directly.
    const third = await api(page, "POST", `/mock/attempts/${state.attemptId}/listening/${by.listening.groups[0].id}/play`, undefined, { allow: [403] });
    expect(third.status === 403 && third.error?.code === "AUDIO_REPLAY_BLOCKED", `third play: ${third.status} ${third.error?.code}`);
    await page.waitForTimeout(2500);
    const answered = await answeredCount(page);
    expect(answered === 35, `answered after Listening: ${answered}`);
    await finishSection(page);
    return `6 parts × 2 server plays, third play 403 AUDIO_REPLAY_BLOCKED; ${notes.join("; ")}; 35/35 answered`;
  });

  await step(page, "07-reading", async () => {
    for (const [i, group] of by.reading.groups.entries()) { await openPart(page, i + 1); for (const q of group.questions) await answerObjective(page, q); }
    await page.waitForTimeout(2500);
    const answered = await answeredCount(page);
    expect(answered === 70, `answered after Reading: ${answered}`);
    await finishSection(page);
    return "35/35 answered";
  });

  await step(page, "08-writing-draft-safety", async () => {
    const texts = [
      "Hi Sam, we visit the museum on Saturday at ten. Meet me at the main gate and bring your student card. It will be fun and we can have lunch after. See you, Ali",
      "Dear Sir or Madam, I am writing on behalf of a study group of twelve students. We would like to visit the museum next Saturday morning and ask whether group tickets are available. Could you tell me the price per student and whether a guide can join us? We would also like to know if bags can be left at the entrance. I look forward to your reply. Yours faithfully, Ali Karimov",
      "Are museums still useful for young people? Many teenagers say that everything is online now, so a visit to a museum is a waste of time. In my view this is only partly true. Online pictures are useful, but a real object tells a story that a screen cannot. When a student stands in front of an old manuscript, history stops being a list of dates. Museums also teach patience and attention, which phones often destroy. However, museums must change. They should open in the evening, use short guided tours and let visitors touch copies of objects. In conclusion, museums are still useful, but only if they speak the language of young people.",
    ];
    for (const [i] of by.writing.groups.entries()) {
      await page.locator(`[aria-label^="Task ${["1.1", "1.2", "2"][i]}"]`).first().click();
      const area = page.locator("main textarea").first();
      if (i === 0) {
        await area.fill(texts[0].slice(0, 60)); await page.waitForTimeout(2500);
        await page.context().setOffline(true);
        await area.pressSequentially(texts[0].slice(60), { delay: 2 });
        await page.getByText(/kept on this device/).first().waitFor();
        await page.context().setOffline(false);
        await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 20000 });
        await page.reload({ waitUntil: "networkidle" }); await dismissExamNotices(page);
        await page.locator(`[aria-label^="Task 1.1"]`).first().click();
        expect((await page.locator("main textarea").first().inputValue()) === texts[0], "the offline part of the essay was lost");
      } else await area.fill(texts[i]);
    }
    await page.waitForTimeout(2500);
    expect((await answeredCount(page)) === 73, `answered after Writing: ${await answeredCount(page)}`);
    await finishSection(page);
    return "3 tasks; typed offline, sent when back online, intact after reload";
  });

  await step(page, "09-speaking-sequence-upload-retry", async () => {
    const mic = page.getByRole("button", { name: "Start the test (5 seconds)" });
    if (await mic.count()) { await mic.click(); await page.getByRole("button", { name: /I can hear it/ }).click({ timeout: 20000 }); }
    const uploads = [];
    page.on("response", (r) => { if (r.request().method() === "POST" && /\/speaking\/[^/]+$/.test(new URL(r.url()).pathname)) uploads.push(r.status()); });
    await page.getByRole("button", { name: "Test microphone" }).first().click();
    await page.locator('meter[aria-label="Microphone input level"]').first().waitFor();
    await page.getByRole("button", { name: "Start response" }).first().click();
    // Network drop at the end of the first response: the take is kept and sent when back online.
    await page.waitForTimeout(26000);
    await page.context().setOffline(true);
    await page.getByText(/Audio upload failed\. Your recording has been preserved/).waitFor({ timeout: 30000 });
    await page.context().setOffline(false);
    // The remaining 7 answers start on their own (server timing: up to 60 s preparation + 120 s).
    const deadline = Date.now() + 15 * 60 * 1000;
    while ((await answeredCount(page)) < 81) {
      if (Date.now() > deadline) throw new Error(`speaking stalled at ${await answeredCount(page)}/81; uploads ${uploads.join(",")}`);
      await page.waitForTimeout(5000);
    }
    expect(await page.getByRole("button", { name: "Previous", exact: true }).isDisabled(), "Previous is enabled in timed Speaking");
    return `8/8 answers uploaded one by one (${uploads.filter((s) => s === 201).length}×201), one retried after a network drop, no way back`;
  });

  await page.context().close();
}

/* ── phase: finish (hand-in of the attempt the student phase left open) ─────────────────────── */
async function finish() {
  const page = await session(STUDENT);
  const submits = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/submit$/.test(new URL(r.url()).pathname)) submits.push(r.url()); });
  await page.goto(`${WEB}/en/mock/attempt/${state.attemptId}`, { waitUntil: "networkidle" });
  await dismissExamNotices(page);
  await step(page, "10-finish-double-click", async () => {
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Before you submit" });
    await review.waitFor();
    const reviewText = (await review.innerText()).replace(/\s+/g, " ");
    expect(!/Not reached yet/.test(reviewText) && (reviewText.match(/Submitted · /g) || []).length === 3, `pre-submit review: ${reviewText.slice(0, 300)}`);
    const yes = review.getByRole("button", { name: "Submit exam" });
    await yes.dblclick().catch(() => {});
    await page.waitForTimeout(4000);
    const attempt = (await api(page, "GET", `/mock/attempts/${state.attemptId}`)).data;
    expect(["grading", "completed"].includes(attempt.status), `status ${attempt.status}`);
    const mine = (await api(page, "GET", "/mock/attempts/mine")).data;
    const list = Array.isArray(mine) ? mine : mine?.items ?? [];
    const same = list.filter((a) => a.examId === state.examId && ["grading", "completed", "submitted"].includes(a.status) && a.id === state.attemptId);
    expect(same.length === 1, "the attempt is not listed exactly once");
    return `review lists Listening/Reading/Writing as submitted; status ${attempt.status}; submit requests: ${submits.length}, one attempt`;
  });

  await step(page, "11-honest-pending-result", async () => {
    await page.goto(`${WEB}/en/mock/attempt/${state.attemptId}`, { waitUntil: "networkidle" });
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    expect(/Awaiting grading/.test(text), "no pending state for Writing/Speaking");
    const attempt = (await api(page, "GET", `/mock/attempts/${state.attemptId}`)).data;
    expect(attempt.overallScore == null && attempt.cefrLevel == null, `a result before grading: ${attempt.overallScore} ${attempt.cefrLevel}`);
    await shot(page, "11-pending");
    return "Listening/Reading shown, Writing/Speaking awaiting grading, no overall score or level";
  });
  await page.context().close();
}
async function expectEnabled(locator, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await locator.count() && !(await locator.isDisabled())) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("button stayed disabled");
}

/* ── phase: grade ────────────────────────────────────────────────────────────────────────────── */
async function grade() {
  const teacher = await session(TEACHER);
  const scores = [4, 4, 5, 4, 4, 4, 4, 4, 4, 4, 5]; // Writing 1.1/1.2/2, Speaking 1.1×3, 1.2×3, 2, 3
  const maxima = [5, 5, 6, 5, 5, 5, 5, 5, 5, 5, 6];
  await step(teacher, "12-teacher-grades-each-part", async () => {
    await teacher.goto(`${WEB}/en/mock/attempt/${state.attemptId}`, { waitUntil: "networkidle" });
    const fields = teacher.locator("input[data-grade-score]");
    await fields.first().waitFor();
    expect((await fields.count()) === 11, `grade fields: ${await fields.count()}`);
    const max = await fields.evaluateAll((els) => els.map((e) => Number(e.max)));
    expect(JSON.stringify(max) === JSON.stringify(maxima), `rubric maxima ${max}`);
    const players = await teacher.locator("main audio").count();
    expect(players >= 8, `audio players: ${players}`);
    for (const [i, value] of scores.entries()) {
      const field = fields.nth(i);
      await field.fill(String(value));
      const saved = teacher.waitForResponse((r) => /\/grade$/.test(new URL(r.url()).pathname));
      await field.locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]").getByRole("button", { name: "Save", exact: true }).click();
      const res = await saved;
      expect(res.status() === 201, `grade ${i} HTTP ${res.status()}`);
      if (i < scores.length - 1) { await field.focus(); await teacher.keyboard.press("Alt+ArrowDown"); }
    }
    return "11 per-part scores saved (Writing 4/4/5, Speaking 4×7 + 5)";
  });
  await step(teacher, "13-final-result-75-scale-and-level", async () => {
    const blueprint = (await api(teacher, "GET", "/exam-blueprints/multilevel")).data;
    const levels = blueprint.exam?.scale?.levels;
    const attempt = (await api(teacher, "GET", `/mock/attempts/${state.attemptId}`)).data;
    expect(attempt.overallScore != null, `no overall score; status ${attempt.status}`);
    const score = Number(attempt.overallScore);
    expect(score >= 0 && score <= 75, `overall ${score}`);
    const expected = (levels || []).find((l) => score >= l.min && score <= l.max);
    expect(expected, `no level row for ${score} in ${JSON.stringify(levels)}`);
    expect(attempt.cefrLevel === expected.level || (expected.level === "BELOW_B1" && !attempt.cefrLevel), `level ${attempt.cefrLevel}, table says ${expected.level}`);
    state.overallScore = score; state.level = attempt.cefrLevel; saveState();
    const certificate = await api(teacher, "GET", `/mock/attempts/${state.attemptId}/certificate`, undefined, { allow: [400, 403, 404, 409] });
    state.certificate = certificate.status; saveState();
    if (expected.certificate === false) expect(certificate.status !== 200, "certificate issued below B1");
    await teacher.goto(`${WEB}/en/mock/attempt/${state.attemptId}`, { waitUntil: "networkidle" });
    await shot(teacher, "13-result");
    return `status ${attempt.status}; overall ${score}/75 → ${attempt.cefrLevel ?? "below B1"} (table row ${expected.min}–${expected.max}); certificate HTTP ${certificate.status}${certificate.error ? " " + certificate.error.code : ""}`;
  });
  await teacher.context().close();
}

/* ── phase: access ───────────────────────────────────────────────────────────────────────────── */
async function access() {
  const admin = await session(process.env.BW_ADMIN || "+998900000002");
  await step(admin, "14-another-group-is-denied", async () => {
    const stamp = Date.now().toString(36).slice(-5);
    const otherTeacherPhone = `+9989000003${String(parseInt(stamp, 36) % 100).padStart(2, "0")}`;
    const teacher2 = await api(admin, "POST", "/users", { name: `E2E Teacher ${stamp}`, phone: otherTeacherPhone, password: PASSWORD, role: "teacher" }, { allow: [409] });
    const teacherId = teacher2.data?.id ?? (await api(admin, "GET", `/users?search=${encodeURIComponent(otherTeacherPhone)}`)).data?.items?.[0]?.id;
    const group = await api(admin, "POST", "/groups", { name: `E2E Group ${stamp}`, teacherId });
    const outsiderPhone = `+9989000004${String(parseInt(stamp, 36) % 100).padStart(2, "0")}`;
    await api(admin, "POST", "/users", { name: `E2E Outsider ${stamp}`, phone: outsiderPhone, password: PASSWORD, role: "student", groupId: group.data.id }, { allow: [409] });
    const outsider = await session(outsiderPhone);
    const read = await api(outsider, "GET", `/mock/attempts/${state.attemptId}`, undefined, { allow: [403, 404] });
    const questionId = (await tree(admin, state.examId)).sections[1].groups[0].questions[0].id;
    const write = await api(outsider, "POST", `/mock/attempts/${state.attemptId}/answers`, { answers: [{ questionId, response: "alpha" }] }, { allow: [400, 403, 404, 409] });
    await outsider.context().close();
    const otherTeacher = await session(otherTeacherPhone);
    const tRead = await api(otherTeacher, "GET", `/mock/attempts/${state.attemptId}`, undefined, { allow: [403, 404] });
    const writingId = (await tree(admin, state.examId)).sections[2].groups[0].questions[0].id;
    const tGrade = await api(otherTeacher, "POST", `/mock/attempts/${state.attemptId}/grade`, { questionId: writingId, score: 1 }, { allow: [400, 403, 404] });
    await otherTeacher.context().close();
    expect([403, 404].includes(read.status) && [403, 404].includes(write.status), `student of another group: read ${read.status}, write ${write.status}`);
    expect([403, 404].includes(tRead.status) && [403, 404].includes(tGrade.status), `teacher of another group: read ${tRead.status}, grade ${tGrade.status}`);
    return `other group's student: read ${read.status}, write ${write.status}; other group's teacher: read ${tRead.status}, grade ${tGrade.status}`;
  });
  await admin.context().close();
}

/* ── phase: mobile ───────────────────────────────────────────────────────────────────────────── */
async function mobile() {
  const page = await session(process.env.BW_STUDENT_TWO || "+998900000011", { width: 390, height: 844 });
  // A re-run starts clean: hand in this exam's attempts an earlier run left open.
  const mine = (await api(page, "GET", "/mock/attempts/mine")).data;
  for (const open of (Array.isArray(mine) ? mine : mine?.items ?? []).filter((a) => a.examId === state.examId && a.status === "in_progress"))
    await api(page, "POST", `/mock/attempts/${open.id}/submit`, { confirm: true, confirmed: true, force: true }, { allow: [400, 403, 404, 409] });
  await step(page, "15-phone-390x844", async () => {
    await page.goto(`${WEB}/en/mock`, { waitUntil: "networkidle" });
    const toMultilevel = page.getByRole("button", { name: /Switch to Multi-Level/ });
    if (await toMultilevel.count()) { await toMultilevel.click(); await page.waitForTimeout(2500); }
    const card = page.locator('[data-testid^="mock-card-"]').filter({ hasText: state.title }).first();
    await card.waitFor();
    await card.getByRole("button", { name: /^(start|resume)$/i }).click();
    const dialog = page.getByRole("dialog"); await dialog.waitFor();
    await dialog.getByRole("button", { name: /Start Reading/ }).click();
    await page.waitForURL(/\/mock\/attempt\//); await page.waitForLoadState("networkidle");
    await dismissExamNotices(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 1, `horizontal overflow ${overflow}px`);
    const exam = (await api(page, "GET", `/mock/exams/${state.examId}`)).data;
    const first = exam.sections.find((s) => s.skill === "reading").groups[0].questions[0];
    await page.getByRole("button", { name: /^Questions \(\d+\)/ }).locator("visible=true").first().click();
    await page.getByLabel(`Answer for question ${first.number}`, { exact: true }).fill("alpha");
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: "networkidle" }); await dismissExamNotices(page);
    await page.getByRole("button", { name: /^Questions \(\d+\)/ }).locator("visible=true").first().click();
    expect((await page.getByLabel(`Answer for question ${first.number}`, { exact: true }).inputValue()) === "alpha", "answer lost after reload on the phone");
    // The exam header must not stack its badge on top of the toolbar on a phone.
    const overlap = await page.evaluate(() => {
      const header = document.querySelector("header") || document.body;
      const boxes = [...header.querySelectorAll("button, [class*='badge'], span")].filter((e) => e.offsetParent && e.getBoundingClientRect().top < 120).map((e) => e.getBoundingClientRect());
      return boxes.some((a, i) => boxes.some((b, j) => j > i && a.width && b.width && a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2 && !(a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom) && !(b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom)));
    });
    expect(!overlap, "header items overlap on the phone");
    await shot(page, "15-phone-reading");
    return "catalogue → launcher → Reading on 390×844, no horizontal scroll, answer kept after reload";
  });
  await page.context().close();
}

/* ── run ──────────────────────────────────────────────────────────────────────────────────────── */
const run = { build, student, finish, grade, access, mobile };
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
writeFileSync(join(OUT, "multilevel-full-report.json"), JSON.stringify({ web: WEB, phases, results }, null, 2));
console.log(`\n==== SUMMARY ====\nPASS ${pass} / FAIL ${fail}`);
process.exit(failed || fail ? 1 : 0);
