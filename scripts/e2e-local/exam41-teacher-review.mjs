import assert from "node:assert/strict";
import { chromium } from "playwright";

const web = process.env.BW_WEB || "http://localhost:3300";
const attempt = process.env.BW_PENDING_ATTEMPT;
assert(["localhost", "127.0.0.1"].includes(new URL(web).hostname), "Use the synthetic loopback stack");
assert(attempt, "Set BW_PENDING_ATTEMPT to an ungraded synthetic Writing attempt");
const password = process.env.BW_PASSWORD || "LocalDev-2026!";
const browser = await chromium.launch(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {});

async function login(phone) {
  const context = await browser.newContext();
  const result = await context.request.post(`${web}/api/auth/login`, { data: { phone, password } });
  assert(result.ok());
  return context;
}

async function assessment(context) {
  const result = await context.request.get(`${web}/api/backend/assessment/attempts/${attempt}`);
  assert(result.ok(), `Assessment HTTP ${result.status()}`);
  const data = (await result.json()).data;
  return data.assessments.find((job) => job.skill === "writing");
}

try {
  const student = await login(process.env.BW_STUDENT || "+998900000011");
  const teacher = await login(process.env.BW_TEACHER || "+998900000003");
  const initial = await assessment(teacher);
  assert.equal(initial.failureCode, "PROVIDER_NOT_CONFIGURED");
  assert(initial.submissions.every((answer) => answer.originalResponse));
  assert.equal((await assessment(student)).finalScore, null);
  console.log("PASS missing provider key leaves both original essays saved and no official grade");

  const page = await teacher.newPage();
  await page.goto(`${web}/en/mock/attempt/${attempt}`);
  const form = page.getByRole("form", { name: "Teacher assessment review" }).first();
  await form.waitFor({ timeout: 30000 });
  const reason = form.getByLabel("Review reason");
  const score = form.locator('input[type="number"]');
  const comment = form.getByLabel("Teacher comment");
  const save = async (label) => {
    const response = page.waitForResponse((res) => res.url().includes(`/assessment/jobs/${initial.id}/review`) && res.request().method() === "POST");
    await form.getByRole("button", { name: label }).click();
    assert((await response).ok(), `Review action ${label} failed`);
  };
  await form.getByRole("radio", { name: "Save draft", exact: true }).click();
  await score.first().pressSequentially("6");
  await reason.pressSequentially("Initial rubric review");
  await comment.pressSequentially("Review paragraph structure.");
  await save("Save draft");
  assert.equal((await assessment(teacher)).teacherDraft.parts[0].criteria.ta, 6);
  assert.equal((await assessment(student)).teacherDraft, undefined);
  await page.reload();
  await form.waitFor({ timeout: 30000 });
  assert.equal(await score.first().inputValue(), "6");
  assert.equal(await comment.inputValue(), "Review paragraph structure.");
  console.log("PASS teacher draft survives reload and remains private");

  for (const field of await score.all()) {
    await field.press("Control+A");
    await field.pressSequentially("7");
  }
  await save("Finalize grade");
  const finalized = await assessment(student);
  assert.equal(finalized.finalScore, 7);
  assert.equal(finalized.finalScoreSource, "TEACHER");
  assert.equal(finalized.teacherComment, "Review paragraph structure.");
  assert.equal(finalized.aiScore, null);
  assert.deepEqual(finalized.submissions.map((answer) => answer.originalResponse), initial.submissions.map((answer) => answer.originalResponse));
  console.log("PASS authorized teacher releases the final score from original essays with every AI provider unavailable");
} finally {
  await browser.close();
}
