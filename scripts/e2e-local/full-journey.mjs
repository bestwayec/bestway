// BESTWAY full journey E2E (Playwright, real Chromium, local stack, synthetic accounts only).
// Teacher builds and publishes a small IELTS practice exam in the Exam Builder; a student
// finds it, answers all four sections, reloads (answers persist), finishes, and gets a result
// or an honest pending state; the teacher sees the attempt. Then a vocabulary list:
// teacher creates it, the student sees and studies it.
//   BW_AUDIO=<path to a synthetic WAV> node full-journey.mjs
// The audio file is a synthetic test fixture (silence); it is NOT exam audio.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", ".local", "e2e-journey");
mkdirSync(OUT, { recursive: true });
const WEB = process.env.BW_WEB || "http://127.0.0.1:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const AUDIO = process.env.BW_AUDIO;
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
if (!AUDIO) { console.error("Set BW_AUDIO to a synthetic WAV fixture"); process.exit(2); }

const stamp = Date.now().toString(36);
const EXAM = `E2E Journey ${stamp}`;
const VOCAB = `E2E Words ${stamp}`;
const results = [];
// Fake microphone: Speaking records a synthetic tone, never a person.
const browser = await chromium.launch({
  ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

async function session(phone) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => results.push({ step: "pageerror", ok: false, note: e.message.slice(0, 160) }));
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
    await page.screenshot({ path: join(OUT, `${name}-FAIL.png`), fullPage: true }).catch(() => {});
    throw e;
  }
}

/** Sidebar "Add …" for a section, then the section panel's "Create … 1" button. */
async function addBlock(page, sidebarName) {
  await page.getByRole("button", { name: sidebarName }).click();
  await page.getByRole("button", { name: /^Create (Part|Passage|Task) 1/ }).first().click();
  await page.waitForTimeout(1500);
}

/** Block title + instructions (+ passage text when given), then the block's own Save. */
async function fillBlock(page, title, instructions, passage) {
  const main = page.locator("main");
  await main.getByPlaceholder(/^e\.g\. Questions 1/).fill(title);
  await main.getByPlaceholder(/^e\.g\. Complete the notes below/).fill(instructions);
  if (passage) await main.locator("textarea").nth(1).fill(passage);
  await main.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.waitForTimeout(1500);
}

/** A multiple-choice question with custom text and options; option A is correct. */
async function addChoiceQuestion(page, prompt, options) {
  const main = page.locator("main");
  await main.getByRole("button", { name: "Add question" }).first().click();
  await page.waitForTimeout(800);
  await main.getByText("Question text", { exact: true }).last().locator("xpath=following::textarea[1]").fill(prompt);
  for (let i = 0; i < options.length; i++) await main.getByRole("button", { name: "Add option" }).last().click();
  for (const [i, text] of options.entries()) await main.getByPlaceholder(`Option ${"ABC"[i]}`).last().fill(text);
  await main.getByLabel("Mark option A correct").last().check();
}

async function saveDraft(page) {
  await page.getByRole("button", { name: "Save Draft" }).click();
  await page.waitForTimeout(1500);
}

const teacher = await session(TEACHER);
let examUrl = "";
let attemptId = "";
let vocabSetId = "";
try {
  await step(teacher, "01-create-exam", async () => {
    await teacher.goto(`${WEB}/en/exam-builder/new`, { waitUntil: "networkidle" });
    await teacher.locator("button", { hasText: "Full academic format" }).click();
    await teacher.locator("button", { hasText: "Pick 1–4 skills" }).click();
    for (const s of ["listening", "writing", "speaking"]) await teacher.getByRole("button", { name: s, exact: true }).click();
    await teacher.getByRole("checkbox").first().uncheck();
    await teacher.getByPlaceholder("IELTS Mock 1 — Academic").fill(EXAM);
    await teacher.getByRole("button", { name: "Create & Continue" }).click();
    await teacher.waitForURL(/exam-builder\/(?!new)[0-9a-f-]+/);
    await teacher.waitForLoadState("networkidle");
    await teacher.getByRole("button", { name: /Add Part — Listening/ }).waitFor();
    examUrl = teacher.url();
    return examUrl.split("/").pop();
  });
  await step(teacher, "02-listening-block", async () => {
    await addBlock(teacher, /Add Part — Listening/);
    const main = teacher.locator("main");
    await main.locator('input[type="file"]').first().setInputFiles(AUDIO);
    await teacher.waitForTimeout(2500);
    await fillBlock(teacher, "Part 1 — synthetic form", "Choose the correct letter, A, B or C.");
    await addChoiceQuestion(teacher, "What does the speaker order?", ["Coffee", "Tea", "Juice"]);
    await saveDraft(teacher);
    return "audio uploaded, 1 multiple-choice question";
  });
  await step(teacher, "03-reading-block", async () => {
    await teacher.getByRole("button", { name: /Add Passage — Reading/ }).click();
    await teacher.getByRole("button", { name: /^Create (Part|Passage|Task) 1/ }).first().click().catch(() => {});
    await teacher.waitForTimeout(1500);
    const main = teacher.locator("main");
    await main.getByPlaceholder(/Paste the full reading passage/).fill("Synthetic passage. The town of Avalon built its three bridges in 1890.");
    await main.getByRole("button", { name: "Save", exact: true }).first().click();
    await teacher.waitForTimeout(1200);
    await main.getByRole("button", { name: "Add question group" }).first().click();
    await main.getByRole("button", { name: "Multiple choice", exact: true }).first().click();
    await teacher.waitForTimeout(1500);
    await addChoiceQuestion(teacher, "When were the bridges built?", ["In 1890", "In 1920", "Never"]);
    await saveDraft(teacher);
    return "passage + 1 multiple-choice question";
  });
  await step(teacher, "04-writing-task", async () => {
    await teacher.getByRole("button", { name: /Add Task — Writing/ }).click();
    await teacher.waitForTimeout(1500);
    const main = teacher.locator("main");
    await main.getByRole("button", { name: "Add Task 2 content" }).click();
    await teacher.waitForTimeout(1500);
    await main.getByPlaceholder(/^e\.g\. Some people think/).fill("Some people think homework should be banned. Discuss both views and give your own opinion.");
    await main.getByRole("button", { name: "Save", exact: true }).first().click();
    await teacher.waitForTimeout(1500);
    return "Task 2 essay prompt";
  });
  await step(teacher, "05-speaking-task", async () => {
    await teacher.getByRole("button", { name: /Add Task — Speaking/ }).click();
    await teacher.waitForTimeout(1500);
    const main = teacher.locator("main");
    await main.getByRole("button", { name: "Add Speaking Task" }).click();
    await teacher.waitForTimeout(1500);
    await main.getByPlaceholder(/^e\.g\. Describe a place you like/).fill("Describe a park you like to visit.");
    await main.getByRole("button", { name: "Save", exact: true }).first().click();
    await teacher.waitForTimeout(1500);
    return "speaking task";
  });
  await step(teacher, "06-publish", async () => {
    await saveDraft(teacher);
    // "Readiness reflects saved data — save your drafts, then refresh."
    await teacher.getByRole("button", { name: /^Review/ }).locator("visible=true").first().click();
    await teacher.getByText("Review exam").waitFor();
    await teacher.getByRole("button", { name: "Refresh", exact: true }).click({ timeout: 5000 }).catch(() => {});
    await teacher.waitForTimeout(2500);
    await teacher.getByRole("button", { name: "Publish", exact: true }).locator("visible=true").first().click();
    await teacher.waitForTimeout(1500);
    const issues = await teacher.getByText(/issues must be fixed/).count();
    if (issues) throw new Error((await teacher.locator("main").last().textContent()).replace(/\s+/g, " ").slice(0, 400));
    // Publish now re-checks readiness on fresh server data, then asks for confirmation.
    await teacher.getByRole("button", { name: "Publish now" }).click();
    const dialog = teacher.getByRole("dialog");
    await dialog.waitFor();
    const patch = teacher.waitForResponse((r) => r.request().method() === "PATCH" && /\/mock\/exams\/[^/]+$/.test(new URL(r.url()).pathname));
    await dialog.getByRole("button", { name: /publish/i }).last().click();
    const res = await patch;
    if (res.status() >= 300) throw new Error(`publish HTTP ${res.status()} ${(await res.text()).slice(0, 300)}`);
    await teacher.reload({ waitUntil: "networkidle" });
    await teacher.getByText("Published", { exact: true }).first().waitFor();
    return "published (warnings only: no section durations)";
  });
  const student = await session(STUDENT);
  await step(student, "07-student-finds-exam", async () => {
    await student.goto(`${WEB}/en/mock`, { waitUntil: "networkidle" });
    const ielts = student.getByTestId("exam-track-card-IELTS");
    const switchBtn = ielts.getByRole("button", { name: /Switch to/ });
    if (await switchBtn.count()) { await switchBtn.click(); await student.waitForTimeout(2500); }
    const card = student.locator('[data-testid^="mock-card-"]').filter({ hasText: EXAM }).first();
    await card.waitFor();
    await card.getByRole("button", { name: /^start$/i }).click();
    const dialog = student.getByRole("dialog");
    await dialog.waitFor();
    const resp = student.waitForResponse((r) => r.url().includes("/start") && r.request().method() === "POST");
    await dialog.getByRole("button", { name: /Barcha bo'limlarni boshlash/ }).click();
    const r = await resp;
    if (r.status() !== 201) throw new Error(`start HTTP ${r.status()} ${(await r.text()).slice(0, 200)}`);
    await student.waitForURL(/\/mock\/attempt\//);
    await student.waitForLoadState("networkidle");
    return `attempt ${student.url().split("/attempt/")[1]}`;
  });
  const ESSAY = "Synthetic essay for the browser test. Homework helps practice, but rest matters too. ".repeat(4).trim();
  await step(student, "08-answer-all-sections", async () => {
    await student.getByRole("radio", { name: "Coffee" }).check();
    await student.waitForTimeout(1500);
    await student.getByRole("button", { name: "Reading", exact: true }).click();
    await student.getByRole("radio", { name: "In 1890" }).check();
    await student.waitForTimeout(1500);
    await student.getByRole("button", { name: "Writing", exact: true }).click();
    await student.locator("textarea").first().fill(ESSAY);
    await student.waitForTimeout(2500);
    await student.getByRole("button", { name: "Speaking", exact: true }).click();
    await student.waitForTimeout(1500);
    const close = student.getByRole("button", { name: "Yopish" });
    if (await close.count()) await close.first().click();
    await student.getByRole("button", { name: "Record", exact: true }).click();
    await student.waitForTimeout(4000);
    const upload = student.waitForResponse((r) => /\/speaking\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 60000 });
    await student.getByRole("button", { name: "Stop", exact: true }).click();
    const up = await upload;
    if (up.status() >= 300) throw new Error(`speaking upload HTTP ${up.status()} ${(await up.text()).slice(0, 200)}`);
    await student.waitForTimeout(1500);
    return `listening + reading choices, essay, speaking upload HTTP ${up.status()}`;
  });
  await step(student, "09-reload-keeps-answers", async () => {
    await student.reload({ waitUntil: "networkidle" });
    await student.waitForTimeout(2000);
    const close = student.getByRole("button", { name: "Yopish" });
    if (await close.count()) await close.first().click();
    const listening = await student.getByRole("radio", { name: "Coffee" }).isChecked();
    await student.getByRole("button", { name: "Reading", exact: true }).click();
    const reading = await student.getByRole("radio", { name: "In 1890" }).isChecked();
    await student.getByRole("button", { name: "Writing", exact: true }).click();
    const writing = (await student.locator("textarea").first().inputValue()) === ESSAY;
    await student.getByRole("button", { name: "Speaking", exact: true }).click();
    await student.waitForTimeout(1000);
    const speaking = (await student.getByRole("button", { name: /Question 4.*not answered/ }).count()) === 0;
    if (!(listening && reading && writing && speaking)) throw new Error(JSON.stringify({ listening, reading, writing, speaking }));
    return "all four answers present after reload";
  });
  await step(student, "10-finish", async () => {
    const micCheck = student.getByRole("button", { name: "Yopish" });
    if (await micCheck.count()) await micCheck.first().click();
    await student.getByRole("button", { name: "Finish", exact: true }).click();
    const dialog = student.getByRole("dialog");
    await dialog.waitFor();
    const submit = student.waitForResponse((r) => r.url().endsWith("/submit") && r.request().method() === "POST", { timeout: 60000 });
    await dialog.getByRole("button", { name: /Ha, yakunlash/ }).click();
    const res = await submit;
    const data = (await res.json()).data ?? {};
    if (res.status() >= 300) throw new Error(`submit HTTP ${res.status()}`);
    await student.waitForTimeout(4000);
    await student.screenshot({ path: join(OUT, "10-result.png"), fullPage: true });
    const text = (await student.locator("main").last().textContent()).replace(/\s+/g, " ");
    // Honest outcome: a result, or a pending/teacher-review state; never an invented score.
    const state = /teacher|ustoz|review|tekshir|grading|baholan|kutil/i.test(text) ? "pending review" : /Completed|Yakunlangan/i.test(text) ? "completed" : "unknown";
    if (state === "unknown") throw new Error(`result page unclear: ${text.slice(0, 200)}`);
    attemptId = student.url().split("/attempt/")[1]?.split("?")[0];
    return `submit HTTP ${res.status()}, attempt status=${data.status}, page shows ${state}`;
  });
  await step(teacher, "11-teacher-sees-attempt", async () => {
    await teacher.goto(`${WEB}/en/mock/attempt/${attemptId}`, { waitUntil: "networkidle" });
    await teacher.waitForTimeout(2000);
    const text = (await teacher.locator("main").last().textContent()).replace(/\s+/g, " ");
    if (!text.includes(EXAM)) throw new Error(`teacher view lacks exam title: ${text.slice(0, 200)}`);
    const essay = text.includes("Synthetic essay for the browser test");
    await teacher.screenshot({ path: join(OUT, "11-teacher-view.png"), fullPage: true });
    return `teacher opens the attempt; essay visible=${essay}`;
  });
  await step(teacher, "12-teacher-creates-vocabulary", async () => {
    await teacher.goto(`${WEB}/en/vocabulary`, { waitUntil: "networkidle" });
    await teacher.getByRole("button", { name: "Yangi Lug'at Yaratish" }).click();
    await teacher.getByPlaceholder("Masalan: Unit 5: Environment & Global Warming").fill(VOCAB);
    for (const [en, uz] of [["harbour", "bandargoh"], ["bridge", "ko'prik"], ["ferry", "parom"]]) {
      await teacher.getByPlaceholder("English word (e.g. resilient)").fill(en);
      await teacher.getByPlaceholder("O'zbekcha tarjimasi (e.g. chidamli)").fill(uz);
      await teacher.getByRole("button", { name: "So'zni ro'yxatga qo'shish" }).click();
    }
    const created = teacher.waitForResponse((r) => r.url().includes("/vocabulary/sets") && r.request().method() === "POST" && !r.url().includes("parse"));
    await teacher.getByRole("button", { name: "Lug'at To'plamini E'lon Qilish" }).click();
    const res = await created;
    if (res.status() !== 201) throw new Error(`create HTTP ${res.status()}`);
    vocabSetId = (await res.json()).data.id;
    return `set created with 3 words (HTTP ${res.status()})`;
  });
  await step(student, "13-student-studies-vocabulary", async () => {
    await student.goto(`${WEB}/en/vocabulary`, { waitUntil: "networkidle" });
    const card = student.locator("div").filter({ hasText: VOCAB }).filter({ has: student.getByText("Mashqni Boshlash") }).last();
    await card.getByText("Mashqni Boshlash").click();
    await student.waitForURL(/\/vocabulary\/[0-9a-f-]+/);
    await student.waitForLoadState("networkidle");
    if (!student.url().includes(vocabSetId)) throw new Error(`opened ${student.url()}, expected set ${vocabSetId}`);
    await student.getByRole("button", { name: /Inglizcha → O'zbekcha/ }).click();
    await student.getByRole("button", { name: "Testni Boshlash" }).click();
    const words = { harbour: "bandargoh", bridge: "ko'prik", ferry: "parom" };
    const submit = student.waitForResponse((r) => /\/vocabulary\/sets\/[^/]+\/submit/.test(r.url()) && r.request().method() === "POST", { timeout: 60000 });
    const promptWord = () => student.getByRole("button", { name: "Talaffuzni tinglash" })
      .locator("xpath=preceding-sibling::*[1]").textContent().then((t) => (t ?? "").trim());
    let previous = "";
    let quizLoads = 0;
    student.on("response", (r) => { if (/\/vocabulary\/sets\/[^/]+\/quiz/.test(r.url())) quizLoads++; });
    // No artificial wait: a student may answer as soon as the first question shows.
    for (let i = 0; i < 3; i++) {
      let en = "";
      for (let tries = 0; tries < 30 && (!en || en === previous); tries++) {
        en = await promptWord().catch(() => "");
        if (!en || en === previous) await student.waitForTimeout(200);
      }
      if (!(en in words)) throw new Error(`question ${i + 1}: unexpected prompt "${en}"`);
      previous = en;
      await student.getByRole("button", { name: new RegExp(`^${words[en]}\\s*[A-D]?$`) }).click();
      await student.waitForTimeout(1500);
    }
    const res = await submit;
    const data = (await res.json()).data;
    if (res.status() !== 200 || data.percentage !== 100) throw new Error(`submit HTTP ${res.status()} ${data.percentage}% wrong=${JSON.stringify(data.wrongAnswers)}`);
    return `quiz submitted: ${data.score}/${data.totalWords} = ${data.percentage}%, server awarded +${data.pointsAwarded} points (quiz loads after start: ${quizLoads})`;
  });
} finally {
  writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 1));
  await browser.close();
}
