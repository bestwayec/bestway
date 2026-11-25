// Use the full IELTS journey's synthetic fixture and the seeded local classroom.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const web = new URL(process.env.BW_WEB ?? "http://localhost:3309");
assert(["localhost", "127.0.0.1", "[::1]"].includes(web.hostname), "Loopback only");
const out = new URL("../../.local/e2e/phase3/", import.meta.url);
await mkdir(out, { recursive: true });
const { examId, attemptId } = JSON.parse(await readFile(new URL("../ielts-full.json", out), "utf8"));
assert(examId && attemptId);
const groupId = process.env.BW_GROUP_ID ?? "d596e11e-0f54-40c0-ba7a-6869a4858ed2";
const reportPath = `/groups/${groupId}`;
const attemptPath = `/mock/attempts/${attemptId}`;
const browser = await chromium.launch({ executablePath: process.env.BW_CHROMIUM, args: ["--no-sandbox"] });

async function session(phone, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  context.setDefaultTimeout(25000);
  const login = await context.request.post(new URL("/api/auth/login", web).href, {
    data: { phone, password: process.env.BW_PASSWORD ?? "LocalDev-2026!" },
  });
  assert(login.ok(), `Login returned ${login.status()}`);
  return context;
}

async function request(context, path, method = "GET", data, status) {
  const result = await context.request.fetch(new URL(`/api/backend${path}`, web).href, { method, data });
  assert(status ? result.status() === status : result.ok(), `${method} ${path}: ${result.status()} ${await result.text()}`);
  return result;
}

async function api(context, path, method, data) {
  const result = await request(context, path, method, data);
  return (await result.json()).data;
}

async function download(page, panel, name, extension) {
  const pending = page.waitForEvent("download");
  await panel.getByRole("button", { name, exact: true }).click();
  const result = await pending;
  assert(result.suggestedFilename().endsWith(extension));
  const target = join(out.pathname, `group${extension}`);
  await result.saveAs(target);
  return readFile(target);
}

try {
  const teacher = await session("+998900000003", { viewport: { width: 1440, height: 900 } });
  const learner = await session("+998900000011", { viewport: { width: 360, height: 800 } });
  const other = await session("+998900000010");
  const ownerPage = await learner.newPage();
  const teacherPage = await teacher.newPage();

  const exam = await api(teacher, `/mock/exams/${examId}`);
  if (exam.lifecycle === "archived" || exam.archivedAt) {
    await api(teacher, `/mock/exams/${examId}/restore`, "POST");
    await api(teacher, `/mock/exams/${examId}`, "PATCH", { isPublished: true });
  }
  const before = await api(learner, attemptPath);
  assert.equal(before.status, "completed");
  assert.equal(before.overallBand, 8);
  await ownerPage.goto(new URL(`/en/mock/attempt/${attemptId}`, web).href);
  const reading = ownerPage.locator('section[aria-label="Reading"]');
  const readingQuestion = before.sections.find((section) => section.skill === "reading").groups[0].questions[0];
  await reading.locator(`[id="review-${readingQuestion.id}"]`).click();
  assert.equal(await reading.getByTestId("review-evidence").innerText(), "every statement is true");
  await reading.getByTestId("review-original-question").getByText("Synthetic reading item 1:", { exact: false }).waitFor();
  await reading.getByTestId("review-explanation").getByText("The statement follows directly from the passage.").waitFor();
  const listening = ownerPage.locator('section[aria-label="Listening"]');
  await listening.getByRole("button", { name: "Where is the answer to question 1?" }).click();
  await listening.getByRole("button", { name: "Play from 0:02" }).click();
  const audio = listening.locator("audio");
  await audio.waitFor();
  await ownerPage.waitForFunction(() => [...document.querySelectorAll("audio")].some((element) => element.currentTime >= 2));
  await ownerPage.screenshot({ path: join(out.pathname, "review-mobile-en-light.png") });
  const reviewGroup = before.sections.find((section) => section.skill === "listening").groups[0];
  const reviewPath = new URL(reviewGroup.reviewAudioUrl).pathname.replace(/^\/v1/, "");
  await request(other, reviewPath, "GET", undefined, 403);
  await request(other, attemptPath, "GET", undefined, 403);
  console.log("PASS mobile review, teacher explanation, authorized recording, cross-student HTTP 403");

  await ownerPage.goto(new URL("/en/profile", web).href);
  await ownerPage.getByText("Your progress", { exact: true }).waitFor();
  await ownerPage.getByRole("button", { name: "Change target" }).click();
  await ownerPage.locator("#prediction-target-band").selectOption("8.5");
  await ownerPage.locator("#prediction-target-score").fill("58");
  await ownerPage.locator("#prediction-target-cefr").selectOption("B2");
  await ownerPage.getByRole("button", { name: "Save target" }).click();
  await ownerPage.getByText("Target updated", { exact: true }).waitFor();
  await ownerPage.reload();
  await ownerPage.getByRole("button", { name: "Change target" }).click();
  assert.equal(await ownerPage.locator("#prediction-target-band").inputValue(), "8.5");
  assert.equal(await ownerPage.locator("#prediction-target-score").inputValue(), "58");
  assert.equal(await ownerPage.locator("#prediction-target-cefr").inputValue(), "B2");
  const target = await api(learner, "/mock/prediction/me");
  assert.equal(target.multilevel.targetCefr, "B2");
  const ieltsHistory = target.history.filter((item) => item.ieltsBand != null);
  assert(ieltsHistory.length > 0 && ieltsHistory.every((item) => item.multilevelScore === null));
  await ownerPage.locator("#prediction-target-band").scrollIntoViewIfNeeded();
  await ownerPage.screenshot({ path: join(out.pathname, "progress-target-en-light.png") });
  console.log("PASS student profile, independent scales and IELTS/Multilevel/CEFR targets after reload");

  const assignmentTitle = "Phase 3 browser assigned mock";
  const assignments = await api(teacher, `${reportPath}/assignments`);
  const assignment = assignments.find((item) => item.title === assignmentTitle && item.exam_id === examId)
    ?? await api(teacher, `${reportPath}/assignments`, "POST", {
    title: assignmentTitle,
    exam_id: examId,
    deadline: new Date(Date.now() + 86400_000).toISOString(),
  });
  const linked = await api(other, `/mock/exams/${examId}/start`, "POST", {
    mode: "timed", flow: "full_test", assignmentId: assignment.id,
  });
  assert(linked.attemptId !== attemptId);
  const assignmentStats = await api(teacher, `${reportPath}/analytics?assignmentId=${assignment.id}`);
  assert.equal(assignmentStats.assignedStudents, 2);
  assert.equal(assignmentStats.startedStudents, 1);
  assert.equal(assignmentStats.submittedStudents, 0);
  await request(learner, `${reportPath}/analytics?assignmentId=${assignment.id}`, "GET", undefined, 403);
  await request(learner, `${reportPath}/report/excel?assignmentId=${assignment.id}`, "GET", undefined, 403);
  const assignedPage = await other.newPage();
  await assignedPage.goto(new URL("/en/profile", web).href);
  await assignedPage.locator(`a[href="/en/mock/attempt/${linked.attemptId}"]`).first().click();
  await assignedPage.waitForURL(`**/mock/attempt/${linked.attemptId}`);
  await assignedPage.locator("[data-runner-bottom]").waitFor();
  await assignedPage.close();
  console.log("PASS explicit assignment launch, profile resume, participation and student report HTTP 403");

  await teacherPage.goto(new URL(`/en${reportPath}`, web).href);
  await teacherPage.locator("#group-tab-results").click();
  const analytics = teacherPage.getByTestId("group-exam-analytics");
  const examSelect = analytics.locator("select").nth(1);
  await examSelect.locator(`option[value="${examId}"]`).waitFor({ state: "attached" });
  await examSelect.selectOption(examId);
  await analytics.getByRole("link", { name: "Review", exact: true }).first().waitFor();
  const ranked = await api(teacher, `${reportPath}/analytics?examId=${examId}`);
  assert.equal(ranked.ranking[0].attemptId, attemptId);
  assert.equal(ranked.ranking[0].score, 8);
  await analytics.locator("table").first().screenshot({ path: join(out.pathname, "group-ranks-en.png") });
  const pdf = await download(teacherPage, analytics, "PDF", ".pdf");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const excel = await download(teacherPage, analytics, "Excel", ".xlsx");
  assert.equal(excel.subarray(0, 2).toString(), "PK");
  console.log("PASS browser ranking, filtered PDF and XLSX downloads");

  await api(teacher, `/mock/exams/${examId}/archive`, "POST");
  const reopened = await api(learner, attemptPath);
  assert.equal(reopened.overallBand, before.overallBand);
  assert.equal(reopened.sections.find((section) => section.skill === "reading").groups[0].questions[0].id,
    before.sections.find((section) => section.skill === "reading").groups[0].questions[0].id);
  await teacherPage.screenshot({ path: join(out.pathname, "group-desktop-en-light.png") });
  await learner.addInitScript(() => localStorage.setItem("theme", "dark"));
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.goto(new URL(`/uz/mock/attempt/${attemptId}`, web).href);
  await ownerPage.waitForFunction(() => document.documentElement.classList.contains("dark"));
  assert.equal(await ownerPage.locator("html").getAttribute("lang"), "uz");
  await ownerPage.locator("main").getByText("IELTS", { exact: false }).first().waitFor();
  await ownerPage.screenshot({ path: join(out.pathname, "review-archived-mobile-uz-dark.png") });
  console.log("PASS archive preserves graded results and question identity, Uzbek dark 390px");
} finally {
  await browser.close();
}
