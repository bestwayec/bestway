import assert from "node:assert/strict";
import { chromium } from "playwright";

const web = process.env.BW_WEB || "http://localhost:3300";
const fullExam = process.env.BW_IELTS_EXAM || "ielts-academic-mock-01";
const practiceExam = process.env.BW_PRACTICE_EXAM || fullExam;
const student = process.env.BW_STUDENT || "+998900000011";
const password = process.env.BW_PASSWORD || "LocalDev-2026!";
assert(["localhost", "127.0.0.1"].includes(new URL(web).hostname), "Use the synthetic loopback stack");

const browser = await chromium.launch(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => sessionStorage.setItem("bw_fullscreen_notice_seen", "1"));
const page = await context.newPage();
page.setDefaultTimeout(30000);
const editor = page.locator("textarea[data-exam-writing]").first();
const notices = page.getByTestId("exam-session-elsewhere").or(page.getByTestId("fullscreen-notice")).first();
await page.addLocatorHandler(notices, async () => {
  await notices.getByRole("button").first().click();
}, { noWaitAfter: true });

async function api(path, data) {
  const response = await context.request.fetch(`${web}/api/backend${path}`, data ? { method: "POST", data } : {});
  const body = await response.json();
  assert(response.ok(), `${path} HTTP ${response.status()} ${JSON.stringify(body.error)}`);
  return body.data;
}

try {
  await page.goto(`${web}/en/login`);
  await page.locator("#phone").fill(student);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));

  const full = await api(`/mock/exams/${fullExam}/start`, { mode: "timed", flow: "full_test", retake: true });
  assert.equal(full.currentSkill, "listening");
  await page.goto(`${web}/en/mock/attempt/${full.attemptId}?skill=writing`);
  await page.getByRole("timer").first().waitFor();
  assert.equal(await editor.count(), 0);
  console.log("PASS stale Writing link respects the active Listening section");

  const practice = await api(`/mock/exams/${practiceExam}/start`, { mode: "practice", skills: ["writing"], retake: true });
  assert.equal(practice.mode, "practice");
  assert.notEqual(practice.attemptId, full.attemptId);
  const path = `/mock/attempts/${practice.attemptId}`;
  await page.goto(`${web}/en/mock/attempt/${practice.attemptId}?skill=writing`);
  await editor.waitFor();
  await editor.click();
  await editor.pressSequentially("A quickx brown fox.");
  await editor.press("Home");
  for (let i = 0; i < 7; i++) await editor.press("ArrowRight");
  await editor.press("Delete");
  await editor.pressSequentially("z");
  await editor.press("Backspace");
  await editor.press("End");
  await editor.press("Enter");
  await editor.pressSequentially("Second paragraph ");
  assert.equal(await editor.inputValue(), "A quick brown fox.\nSecond paragraph ");
  console.log("PASS IELTS practice keyboard, cursor movement, Delete, Backspace and paragraphs");

  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "漢字", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "漢字" });
  assert.equal(await editor.inputValue(), "A quick brown fox.\nSecond paragraph 漢字");
  console.log("PASS Chromium IME composition and Unicode commit");

  await context.setOffline(true);
  await editor.pressSequentially(" still editable offline.");
  assert.match(await editor.inputValue(), /still editable offline\.$/);
  const firstEssay = await editor.inputValue();
  await context.setOffline(false);
  await page.getByText(/server confirmed|all answers saved/i).first().waitFor().catch(() => {});
  const task = (number) => page.locator(`[aria-label^="Task ${number}"]`).first();
  await task(2).click();
  const secondEssay = "A separate response for the second task.";
  await editor.pressSequentially(secondEssay);
  assert.equal(await editor.inputValue(), secondEssay);
  await task(1).click();
  assert.equal(await editor.inputValue(), firstEssay);
  await page.reload();
  await editor.waitFor();
  await task(1).click();
  assert.equal(await editor.inputValue(), firstEssay);
  await task(2).click();
  assert.equal(await editor.inputValue(), secondEssay);
  console.log("PASS offline typing and reconnect, task switching and hard reload");

  await page.getByRole("button", { name: "Finish", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  const submitted = page.waitForResponse((response) => response.url().includes(`${path}/submit`) && response.request().method() === "POST");
  await dialog.getByRole("button").filter({ hasText: /Finish|Submit|Yes/ }).last().click();
  assert((await submitted).ok(), "Practice submission failed");
  let writing;
  for (let attempt = 0; attempt < 40 && !writing; attempt++) {
    const summary = await api(`/assessment/attempts/${practice.attemptId}`);
    writing = summary.assessments.find((job) => job.skill === "writing");
    if (!writing) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(writing, "The submission hand-off did not create a Writing snapshot");
  const answers = writing.submissions.map((response) => response.originalResponse);
  assert.deepEqual(answers, [firstEssay, secondEssay]);
  console.log(`PASS submitted essays match the stored snapshot, attempt ${practice.attemptId}`);
} finally {
  await browser.close();
}
