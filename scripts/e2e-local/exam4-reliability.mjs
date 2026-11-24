// Run against a disposable local stack seeded with seed_local_dev and seed_ielts_mock1_academic.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const web = new URL(process.env.BW_WEB || "http://127.0.0.1:3300");
assert(["127.0.0.1", "localhost", "[::1]"].includes(web.hostname), "Loopback only");
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  executablePath: process.env.BW_CHROMIUM,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
context.setDefaultTimeout(45_000);
const page = await context.newPage();
page.setDefaultTimeout(45_000);
const credentials = { phone: "+998900000010", password: "LocalDev-2026!" }; // repository's synthetic account
const examId = process.env.BW_EXAM4_EXAM || "ielts-academic-mock-01";

async function api(path, payload) {
  const url = new URL(`/api/backend${path}`, web).href;
  const response = payload === undefined ? await context.request.get(url) : await context.request.post(url, { data: payload });
  const body = await response.json();
  assert(response.ok() && body.success, `${path}: ${response.status()} ${JSON.stringify(body.error)}`);
  return body.data;
}

async function enterExam(url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const input = page.locator('input[aria-label^="Answer for question"]:visible').first();
  await input.waitFor();
  const fullscreen = page.getByTestId("fullscreen-notice");
  if (await fullscreen.isVisible()) await fullscreen.getByRole("button").click();
  return input;
}

async function checkRecording(exam) {
  const speaking = await api(`${exam}/start`, { mode: "practice", skills: ["speaking"], retake: true });
  const path = `/mock/attempts/${speaking.attemptId}`;
  const detail = await api(path);
  const question = detail.sections.find((section) => section.skill === "speaking").groups[0].questions[0];
  const wave = Buffer.alloc(16_044);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(16000, 40);
  const upload = await context.request.post(new URL(`/api/backend${path}/speaking/${question.id}`, web).href, {
    multipart: { audio: { name: "synthetic-take.wav", mimeType: "audio/wav", buffer: wave } },
  });
  const uploadBody = await upload.json();
  assert(upload.ok() && uploadBody.data?.saved, `Recording receipt ${upload.status()} ${JSON.stringify(uploadBody.error)}`);
  assert.equal(uploadBody.data.audioDurationMs, 1000);
  const media = `/api/backend${path}/answers/${question.id}/audio`;
  const ranged = await context.request.get(new URL(media, web).href, { headers: { Range: "bytes=-64" } });
  assert.equal(ranged.status(), 206);
  assert.equal((await ranged.body()).length, 64);
  const duration = await page.evaluate((src) => new Promise((resolve, reject) => {
    const audio = new Audio();
    const timeout = setTimeout(() => reject(new Error("Audio metadata timed out")), 12_000);
    audio.addEventListener("loadedmetadata", () => { clearTimeout(timeout); resolve(audio.duration); }, { once: true });
    audio.addEventListener("error", () => { clearTimeout(timeout); reject(new Error(`Audio error ${audio.error?.code}`)); }, { once: true });
    audio.src = src;
  }), media);
  assert(duration > 0, `Chromium reported the recording duration as ${duration}`);
  console.log("PASS real speaking upload receipt, authorized range and Chromium duration");
}

try {
  const login = await context.request.post(new URL("/api/auth/login", web).href, { data: credentials });
  assert(login.ok(), `Synthetic account login failed: ${login.status()}`);
  const exam = `/mock/exams/${examId}`;
  const start = await api(`${exam}/start`, { mode: "timed", skills: ["reading"], retake: true });
  const attempt = `/mock/attempts/${start.attemptId}`;
  const runner = new URL(`/en/mock/attempt/${start.attemptId}?skill=reading`, web).href;
  const allQuestions = (data) => data.sections.flatMap((section) => section.groups.flatMap((group) => group.questions));
  const saveUrl = `**/api/backend${attempt}/answers`;
  const detailUrl = `**/api/backend${attempt}`;
  let firstSave;
  const failSave = async (route) => {
    firstSave ??= route.request().postDataJSON().answers[0];
    await route.fulfill({ status: 503, json: { success: false, error: { code: "TEMP_UNAVAILABLE" } } });
  };
  await page.route(saveUrl, failSave);
  let input = await enterExam(runner);
  const answer = `exam4 recovery ${crypto.randomUUID().slice(0, 8)}`;
  await input.fill(answer);
  await page.getByTestId("answer-queue-banner").waitFor();
  assert(firstSave, "The edit reached the network interceptor");
  assert.notEqual(allQuestions(await api(attempt)).find((q) => q.id === firstSave.questionId).response, answer);

  input = await enterExam(runner);
  assert.equal(await input.inputValue(), answer, "The local edit survives reload");
  await page.unroute(saveUrl, failSave);
  const ack = page.waitForResponse((response) => response.url().endsWith(`${attempt}/answers`) && response.status() === 201);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const receipts = (await (await ack).json()).data.receipts;
  assert.equal(receipts[firstSave.questionId].status, "saved");
  const saved = allQuestions(await api(attempt)).find((q) => q.id === firstSave.questionId);
  assert.equal(saved.response, answer);
  assert.equal(saved.answerRevision, receipts[firstSave.questionId].revision);
  console.log("PASS failed save, local reload recovery, retry receipt and persisted answer");

  const second = await context.newPage();
  await second.goto(runner, { waitUntil: "domcontentloaded" });
  await second.getByTestId("exam-session-elsewhere").waitFor();
  await second.close();
  console.log("PASS second tab is gated while the first holds the attempt");

  const restored = await enterExam(runner);
  assert.equal(await restored.inputValue(), answer, "The server-confirmed answer survives another reload");
  const blockLookup = (route) => route.abort("failed");
  let lost = false;
  await page.route(detailUrl, blockLookup);
  await page.route(`**/api/backend${attempt}/submit`, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    lost = true;
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByRole("button", { name: /^(Yes, finish|Submit exam)$/ }).click();
  await page.getByTestId("submit-unconfirmed").waitFor();
  assert(lost);
  const submitted = await api(attempt);
  assert.notEqual(submitted.status, "in_progress");
  assert.equal(allQuestions(submitted).find((q) => q.id === firstSave.questionId).response, answer);
  await page.unroute(detailUrl, blockLookup);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("submit-unconfirmed").waitFor({ state: "hidden" });
  assert.equal((await api(`${attempt}/submit`, { confirm: true })).status, submitted.status);
  console.log(`PASS lost submit response, recovery from server state, idempotent retry (attempt ${start.attemptId})`);
  if (examId === "ielts-academic-mock-01") await checkRecording(exam);
} finally {
  await browser.close();
}
