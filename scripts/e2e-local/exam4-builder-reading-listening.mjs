// Synthetic local scope only. Seed with seed-exam4-phase2.py and seed_local_dev.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const web = new URL(process.env.BW_WEB || "http://localhost:3300");
assert(["localhost", "127.0.0.1", "[::1]"].includes(web.hostname), "Loopback only");
const out = process.env.BW_PHASE2_SCREENSHOTS;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BW_CHROMIUM, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
context.setDefaultTimeout(30000);
const page = await context.newPage();
const exam = "/mock/exams/exam4-phase2-local";

async function login(context, phone) {
  const response = await context.request.post(new URL("/api/auth/login", web).href,
    { data: { phone, password: "LocalDev-2026!" } });
  assert(response.ok(), `Login failed: ${response.status()}`);
}

async function api(context, path, method = "GET", data) {
  const response = await context.request.fetch(new URL(`/api/backend${path}`, web).href, { method, data });
  const body = await response.json();
  assert(response.ok() && body.success, `${method} ${path}: ${response.status()} ${JSON.stringify(body.error)}`);
  return body.data;
}

function tabs(page) {
  return page.locator("[data-runner-bottom]").getByRole("tab");
}

async function openAttempt(skill) {
  const start = await api(context, `${exam}/start`, "POST", { mode: "timed", skills: [skill], retake: true });
  const url = new URL(`/en/mock/attempt/${start.attemptId}?skill=${skill}`, web).href;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await tabs(page).first().waitFor();
  const notice = page.getByTestId("fullscreen-notice");
  if (await notice.isVisible()) await notice.getByRole("button").click();
  return { id: start.attemptId, url };
}

async function confirmedEdit(page, path, questionId, edit) {
  const receipt = page.waitForResponse((response) => response.url().endsWith(`${path}/answers`) && response.status() === 201);
  await edit();
  const result = await (await receipt).json();
  assert.equal(result.data.receipts[questionId].status, "saved");
  return result.data.receipts[questionId].revision;
}

async function save(page, path, questionId, value) {
  const slot = page.locator(`[id="q-${questionId}"]`).getByRole("textbox");
  assert.equal(await slot.count(), 1);
  return confirmedEdit(page, path, questionId, () => slot.fill(value));
}

async function screenshot(page, name) {
  if (out) await page.screenshot({ path: join(out, `${name}.png`) });
}

try {
  await login(context, "+998900000010");
  const reading = await openAttempt("reading");
  const readingPath = `/mock/attempts/${reading.id}`;
  assert.equal(await tabs(page).count(), 3);
  const passageText = page.getByText(/Synthetic source about lamps/);
  await passageText.waitFor();
  assert.equal(await page.getByTestId("reading-task-groups").locator('[id*="-reading-q"]').count(), 13);
  const readId = (number) => `exam4-phase2-local-reading-q${number}`;
  const revision = await save(page, readingPath, readId(1), "alpha");
  assert(await passageText.isVisible());
  for (const [number, value] of [[6, "TRUE"], [11, "Alpha"]]) {
    const questionId = readId(number);
    const question = page.locator(`[id="q-${questionId}"]`);
    assert.equal(await question.count(), 1);
    await confirmedEdit(page, readingPath, questionId, () => question.getByRole("radio", { name: value, exact: true }).check());
    assert(await passageText.isVisible());
  }
  const detail = await api(context, readingPath);
  const questions = detail.sections.flatMap((section) => section.groups.flatMap((group) => group.questions));
  assert.deepEqual(questions.map((question) => question.displayNumber), Array.from({ length: 40 }, (_, index) => index + 1));
  assert(!questions.some((question) => Object.hasOwn(question, "correctAnswers")));
  assert.equal(questions.find((question) => question.id === readId(1)).answerRevision, revision);

  await tabs(page).nth(1).click();
  await page.getByText(/Synthetic source about gardens/).waitFor();
  assert.equal(await page.getByRole("region", { name: "Shared answer choices" }).count(), 1);
  assert.equal(await page.locator(`[id="q-${readId(14)}"]`).getByRole("combobox").count(), 1);
  await save(page, readingPath, readId(21), "alpha");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(/Synthetic source about gardens/).waitFor();
  assert.equal(await page.locator(`[id="q-${readId(21)}"] input`).inputValue(), "alpha");
  assert.equal(await page.locator(`button[data-qid="${readId(21)}"][aria-current="true"]`).count(), 1);
  await tabs(page).first().click();
  assert(await page.locator(`[id="q-${readId(6)}"]`).getByRole("radio", { name: "TRUE", exact: true }).isChecked());
  assert(await page.locator(`[id="q-${readId(11)}"]`).getByRole("radio", { name: "Alpha", exact: true }).isChecked());
  await tabs(page).nth(1).click();

  assert.equal((await api(context, readingPath)).deadlineAt, detail.deadlineAt);

  for (const width of [360, 390, 768, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await tabs(page).count(), 3);
    await screenshot(page, `reading-${width}`);
  }
  const result = await api(context, `${readingPath}/submit`, "POST", { confirm: true });
  assert.equal(result.rawScores.reading.max, 40);
  assert.equal(result.rawScores.reading.score, 4);
  console.log(`PASS Reading: three passages, 40 positions, four saved question types, reload and score (${reading.id})`);

  const listening = await openAttempt("listening");
  const listeningPath = `/mock/attempts/${listening.id}`;
  assert.equal(await tabs(page).count(), 4);
  const audioStart = await api(context, `${listeningPath}/listening/exam4-phase2-local-listening-g1/start`, "POST", {});
  const again = await api(context, `${listeningPath}/listening/exam4-phase2-local-listening-g1/start`, "POST", {});
  assert.equal(again.startedAt, audioStart.startedAt);
  const media = await context.request.get(new URL(`/api/backend/mock/groups/exam4-phase2-local-listening-g1/audio?attemptId=${listening.id}`, web).href);
  assert(media.ok(), `Listening audio returned ${media.status()}`);
  const listenId = (number) => `exam4-phase2-local-listening-q${number}`;
  await save(page, listeningPath, listenId(6), "alpha");
  await screenshot(page, "listening-1920");
  const resultListening = await api(context, `${listeningPath}/submit`, "POST", { confirm: true });
  assert.equal(resultListening.rawScores.listening.max, 40);
  assert.equal(resultListening.rawScores.listening.score, 1);
  console.log(`PASS Listening: four parts, shared part audio, persistent schedule and score (${listening.id})`);

  const teacher = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await login(teacher, "+998900000003");
  const draft = await api(teacher, "/mock/exams", "POST", { type: "ielts_academic", title: "Synthetic builder draft", profile: "practice" });
  const section = await api(teacher, `/mock/exams/${draft.id}/sections`, "POST", { skill: "reading", title: "Synthetic Reading" });
  const parent = await api(teacher, `/mock/sections/${section.id}/groups`, "POST", { title: "Synthetic source", passageText: "Original draft source text." });
  const child = await api(teacher, `/mock/sections/${section.id}/groups`, "POST", { title: "Synthetic continuation", parentGroupId: parent.id });
  await api(teacher, `/mock/groups/${child.id}/questions`, "POST", { questions: [
    { number: 1, type: "short_answer", prompt: "Write alpha.", correctAnswers: ["alpha"] },
  ] });
  assert(child.stimulusRef);
  const preview = await api(teacher, `/mock/exams/${draft.id}/preview`);
  assert.equal(preview.sections[0].groups[0].stimulusRef, child.stimulusRef);
  assert.equal(preview.sections[0].groups[1].stimulusRef, child.stimulusRef);
  assert(!preview.sections[0].groups[1].passageText);
  const builder = await teacher.newPage();
  await builder.goto(new URL(`/en/exam-builder/${draft.id}`, web).href, { waitUntil: "domcontentloaded" });
  await builder.getByText("Synthetic builder draft", { exact: true }).first().waitFor();
  await builder.setViewportSize({ width: 700, height: 900 });
  await builder.locator("#builder-outline").selectOption(`section:${section.id}`);
  await builder.setViewportSize({ width: 1366, height: 900 });
  await screenshot(builder, "builder-1366");
  const copied = builder.waitForResponse((response) => response.url().endsWith(`/sections/${section.id}/groups`) && response.status() === 201);
  await builder.getByRole("button", { name: "Duplicate question group Synthetic continuation" }).click();
  const duplicatedGroup = (await (await copied).json()).data;
  const reopened = await api(teacher, `/mock/exams/${draft.id}/preview`);
  const duplicated = reopened.sections[0].groups.find((group) => group.id === duplicatedGroup.id);
  assert.equal(duplicated.stimulusRef, child.stimulusRef);
  assert.equal(duplicated.questions[0].number, 2);
  assert(!Object.hasOwn(duplicated.questions[0], "correctAnswers"));
  console.log("PASS teacher creates and duplicates linked draft groups and reopens the candidate-safe preview model");
} finally {
  await browser.close();
}
