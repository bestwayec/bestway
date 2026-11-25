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

async function openAttempt(skill, examPath = exam) {
  const start = await api(context, `${examPath}/start`, "POST", { mode: "timed", skills: [skill], retake: true });
  const url = new URL(`/en/mock/attempt/${start.attemptId}?skill=${skill}`, web).href;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("[data-runner-bottom]").waitFor();
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
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Reading overflows at ${width}px`);
    await screenshot(page, `reading-${width}`);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: /All questions/ }).click();
  await page.getByTestId("question-palette").locator(`button[data-qid="${readId(21)}"]`).press("Enter");
  const mobileAnswer = page.locator(`[id="q-${readId(21)}"] input`);
  await mobileAnswer.waitFor();
  assert.equal(await mobileAnswer.inputValue(), "alpha");
  await page.setViewportSize({ width: 1920, height: 900 });
  await tabs(page).first().click();
  await save(page, readingPath, readId(2), "omega");
  const result = await api(context, `${readingPath}/submit`, "POST", { confirm: true });
  assert.equal(result.rawScores.reading.max, 40);
  assert.equal(result.rawScores.reading.score, 4);
  await page.goto(reading.url, { waitUntil: "domcontentloaded" });
  const review = page.locator('section[aria-label="Reading"]');
  for (const [name, state, count] of [["Correct (4)", "correct", 4], ["Wrong (1)", "wrong", 1], ["Unanswered (35)", "unanswered", 35]]) {
    await review.getByRole("button", { name, exact: true }).click();
    assert.equal(await review.locator("[data-review-state]").count(), count);
    assert.equal(await review.locator(`[data-review-state="${state}"]`).count(), count);
  }
  await review.getByRole("button", { name: "Pending (0)", exact: true }).click();
  await review.getByText("No pending positions.", { exact: true }).waitFor();
  await screenshot(page, "reading-result-categories");
  console.log(`PASS Reading: three passages, 40 positions, reload, score and exclusive review categories 4/1/35/0 (${reading.id})`);

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
  const { questions: [readingContinuation] } = await api(teacher, `/mock/groups/${child.id}/questions`, "POST", { questions: [
    { number: 1, type: "short_answer", prompt: "Write alpha.", correctAnswers: ["alpha"],
      evidenceText: "draft source text", reviewExplanation: "Review the source passage." },
  ] });
  assert.equal(readingContinuation.evidenceText, "draft source text");
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
  await builder.getByText("1 passage · 1 question", { exact: true }).waitFor();
  const reorder = builder.waitForResponse((response) => response.url().endsWith(`/groups/${child.id}`) &&
    response.request().method() === "PATCH" && response.status() === 200);
  await builder.getByRole("button", { name: "Move Synthetic continuation up" }).click();
  await reorder;
  await screenshot(builder, "builder-1366");
  const copied = builder.waitForResponse((response) => response.url().endsWith(`/sections/${section.id}/groups`) && response.status() === 201);
  await builder.getByRole("button", { name: "Duplicate question group Synthetic continuation" }).click();
  const duplicatedGroup = (await (await copied).json()).data;
  const reopened = await api(teacher, `/mock/exams/${draft.id}/preview`);
  const duplicated = reopened.sections[0].groups.find((group) => group.id === duplicatedGroup.id);
  assert.equal(reopened.sections[0].groups[0].id, child.id);
  assert.equal(duplicated.stimulusRef, child.stimulusRef);
  assert.equal(duplicated.questions[0].number, 2);
  assert(!Object.hasOwn(duplicated.questions[0], "correctAnswers"));

  const draftPath = `/mock/exams/${draft.id}`;
  const listeningSection = await api(teacher, `${draftPath}/sections`, "POST", { skill: "listening", title: "Synthetic Listening" });
  const listeningGroups = `/mock/sections/${listeningSection.id}/groups`;
  const audioOwner = await api(teacher, listeningGroups, "POST", { title: "Part 1", partNumber: 1,
    audioScript: "The second answer is alpha." });
  const audioTask = await api(teacher, listeningGroups, "POST", { title: "Part 1 continuation", parentGroupId: audioOwner.id });
  const addListeningQuestion = (group, number, prompt, review = {}) => api(teacher, `/mock/groups/${group.id}/questions`, "POST", { questions: [
    { number, type: "short_answer", prompt, correctAnswers: ["alpha"], ...review },
  ] });
  await addListeningQuestion(audioOwner, 1, "Listen and write alpha.");
  const { questions: [continuationQuestion] } = await addListeningQuestion(audioTask, 2, "Listen for the second word.", { evidenceText: "answer is alpha", audioStartSec: 1 });
  const upload = await teacher.request.post(new URL(`/api/backend${draftPath}/audio-timestamps`, web).href, {
    multipart: {
      audio: { name: "synthetic-tone.wav", mimeType: "audio/wav", buffer: await media.body() },
      timestamps: JSON.stringify([{ partNumber: 1, groupId: audioOwner.id, startSec: 0.25, endSec: 1.75 }]),
    },
  });
  assert(upload.ok(), `Draft audio upload returned ${upload.status()}`);
  assert.equal((await upload.json()).data.timestamps[0].groupId, audioOwner.id);
  await builder.reload({ waitUntil: "domcontentloaded" });
  await builder.getByRole("button", { name: "Preview", exact: true }).first().click();
  const previewDialog = builder.getByRole("dialog");
  await previewDialog.getByRole("tab", { name: "Synthetic Reading", exact: true }).click();
  await previewDialog.getByText("Original draft source text.").waitFor();
  await previewDialog.getByRole("tab", { name: "Synthetic Listening", exact: true }).click();
  await previewDialog.getByText("Listen for the second word.").waitFor();
  assert.equal(await previewDialog.getByRole("tab", { name: "Part 1", exact: true }).count(), 1);
  await previewDialog.getByRole("button", { name: "Back to editing" }).click();

  const readiness = await api(teacher, `${draftPath}/readiness`);
  assert(readiness.ready, JSON.stringify(readiness.items.filter((item) => !item.ok)));
  await builder.getByRole("button", { name: "Publish", exact: true }).first().click();
  await builder.getByRole("button", { name: "Publish now" }).click();
  const publication = builder.waitForResponse((response) => response.url().endsWith(draftPath) &&
    response.request().method() === "PATCH" && response.status() === 200);
  await builder.getByRole("dialog").getByRole("button", { name: /publish/i }).last().click();
  assert((await (await publication).json()).data.isPublished);
  const publishedAttempt = await openAttempt("listening", draftPath);
  assert.equal(await tabs(page).count(), 0);
  await page.getByText("Listen for the second word.").waitFor();
  const publishedPath = `/mock/attempts/${publishedAttempt.id}`;
  const sharedStart = await api(context, `${publishedPath}/listening/${audioTask.id}/start`, "POST", {});
  const ownerStart = await api(context, `${publishedPath}/listening/${audioOwner.id}/start`, "POST", {});
  assert.equal(sharedStart.startedAt, ownerStart.startedAt);
  assert.equal(ownerStart.durationSec, 2);
  assert.deepEqual(Object.keys((await api(context, publishedPath)).listeningSchedule), [audioOwner.id]);
  await page.reload({ waitUntil: "domcontentloaded" });
  const player = page.getByTestId("listening-scheduled");
  await player.getByRole("status").waitFor();
  assert.equal(await player.count(), 1);
  await save(page, publishedPath, continuationQuestion.id, "alpha");
  const publishedResult = await api(context, `${publishedPath}/submit`, "POST", { confirm: true });
  assert.equal(publishedResult.rawScores.listening.score, 1);
  const listeningReview = await api(context, publishedPath);
  const reviewedGroup = listeningReview.sections[0].groups.find((group) => group.id === audioTask.id);
  assert.equal(reviewedGroup.questions[0].id, continuationQuestion.id);
  assert.equal(reviewedGroup.questions[0].evidence.text, "answer is alpha");
  assert.equal(reviewedGroup.questions[0].audioStartSec, 1);
  assert(reviewedGroup.reviewAudioUrl.endsWith(audioOwner.id));
  await page.goto(new URL(`/en/mock/attempt/${publishedAttempt.id}`, web).href, { waitUntil: "domcontentloaded" });
  await page.locator(`[id="review-${continuationQuestion.id}"]`).click();
  assert.equal(await page.getByTestId("review-evidence").innerText(), "answer is alpha");
  console.log("PASS released Listening continuation retains the question ID and inherits review audio and evidence");
  console.log("PASS builder creates, reorders and duplicates linked groups, previews shared sources, publishes, and opens the same part for a student");
} finally {
  await browser.close();
}
