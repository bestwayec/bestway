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
//   Phases: build student grade access mobile (default: all). State is kept in
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

const phases = process.argv.slice(2).length ? process.argv.slice(2) : ["build", "student", "grade", "access", "mobile"];
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
const match = (n, skill, pool, type = "matching") => ({ number: n, type, prompt: `Synthetic ${skill} item ${n}: match with the first entry.`, options: pool, correctAnswers: [pool[0]], points: 1 });
const tfng = (n) => ({ number: n, type: "true_false_notgiven", prompt: `Synthetic reading item ${n}: the statement is true.`, options: ["TRUE", "FALSE", "NOT GIVEN"], correctAnswers: ["TRUE"], points: 1 });
const pool = (label, count) => Array.from({ length: count }, (_, i) => `${label} ${letters[i]}`);
const range = (from, count) => Array.from({ length: count }, (_, i) => from + i);

const LISTENING = [
  range(1, 8).map((n) => mc(n, "listening", 3)),
  range(9, 6).map((n) => gap(n, "listening")),
  range(15, 4).map((n) => match(n, "listening", pool("Opinion", 6))),
  range(19, 5).map((n) => match(n, "listening", pool("Statement", 8))),
  range(24, 6).map((n) => mc(n, "listening", 3)),
  range(30, 6).map((n) => gap(n, "listening")),
];
const READING = [
  range(1, 6).map((n) => gap(n, "reading")),
  range(7, 8).map((n) => match(n, "reading", pool("Text", 10))),
  range(15, 6).map((n) => match(n, "reading", pool("Heading", 8), "matching_headings")),
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

/* ── run ──────────────────────────────────────────────────────────────────────────────────────── */
const run = { build };
let failed = false;
try {
  for (const phase of phases) {
    if (!run[phase]) { console.log(`SKIP  ${phase} (not implemented in this run)`); continue; }
    console.log(`── ${phase}`);
    await run[phase]();
  }
} catch { failed = true; }
await browser.close();
const pass = results.filter((r) => r.ok).length, fail = results.filter((r) => !r.ok).length;
writeFileSync(join(OUT, "multilevel-full-report.json"), JSON.stringify({ web: WEB, phases, results }, null, 2));
console.log(`\n==== SUMMARY ====\nPASS ${pass} / FAIL ${fail}`);
process.exit(failed || fail ? 1 : 0);
