import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = new URL(process.env.BW_WEB || "http://127.0.0.1:3300").origin;
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) {
  throw new Error("Use a loopback URL with synthetic accounts.");
}
const fixturePassword = process.env.BW_PASSWORD || "LocalDev-2026!";
const marker = Date.now().toString(36);
const browser = await chromium.launch({ executablePath: process.env.BW_CHROMIUM });

async function signIn(phone) {
  const page = await browser.newPage();
  await page.goto(origin + "/en/login");
  const response = await page.request.post(origin + "/api/auth/login", { data: { phone, password: fixturePassword } });
  assert.equal(response.status(), 200);
  return page;
}

function request(page, method, route, data) {
  return page.request.fetch(origin + "/api/backend" + route, { method, data });
}

async function api(page, method, route, data, expected = 200) {
  const response = await request(page, method, route, data);
  assert.equal(response.status(), expected, method + " " + route);
  return (await response.json()).data;
}

const office = await signIn("+998900000001");
const teacher = await signIn("+998900000003");
const learner = await signIn("+998900000011");
const anotherLearner = await signIn("+998900000010");
const groups = [];
const members = [];
const original = await api(learner, "GET", "/groups/");
const joinPath = "/classroom-invitations/join";

try {
  const group = await api(teacher, "POST", "/groups", { name: "Invitation automatic " + marker }, 201);
  groups.push(group.id);
  await teacher.goto(origin + "/en/groups/" + group.id + "?tab=students");
  await teacher.getByRole("button", { name: "Generate code" }).click();
  const code = (await teacher.locator("code").filter({ hasText: "BW5-" }).textContent()).trim();

  await learner.goto(origin + "/en/dashboard#join=" + code);
  const dialog = learner.getByRole("dialog", { name: "Join a study group" });
  await dialog.getByRole("button", { name: "Preview group" }).click();
  await dialog.getByText(group.name, { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Confirm enrollment" }).click();
  await dialog.waitFor({ state: "hidden" });
  const current = await api(learner, "GET", "/groups/");
  assert(current.some((row) => row.id === group.id));
  assert(original.every((row) => current.some((active) => active.id === row.id)));
  const learnerId = (await api(learner, "GET", "/auth/me")).user.id;
  members.push([group.id, learnerId]);
  assert.equal((await api(learner, "POST", joinPath, { code, preview: false })).status, "active");
  assert.equal((await api(teacher, "GET", "/groups/" + group.id + "/invitation")).invitation.uses, 1);
  console.log("PASS automatic enrollment, preview, repeat redemption and previous memberships");

  const approvedGroup = await api(office, "POST", "/groups", { name: "Invitation approval " + marker }, 201);
  groups.push(approvedGroup.id);
  const approvalPath = "/groups/" + approvedGroup.id + "/invitation";
  const approval = await api(office, "POST", approvalPath, { requiresApproval: true, maxUses: 1 }, 201);
  assert.equal((await api(learner, "POST", joinPath, { code: approval.code, preview: false })).status, "pending");
  const pending = (await api(office, "GET", approvalPath)).requests[0];
  const decisionPath = approvalPath + "/requests/" + pending.id;
  await api(teacher, "POST", decisionPath, { approve: true }, 403);
  await office.goto(origin + "/en/groups/" + approvedGroup.id + "?tab=students");
  await office.getByRole("button", { name: "Approve", exact: true }).click();
  await office.getByRole("button", { name: "Approve", exact: true }).waitFor({ state: "hidden" });
  assert.equal((await api(office, "POST", decisionPath, { approve: true })).status, "approved");
  const after = await api(learner, "GET", "/groups/");
  assert(after.some((row) => row.id === group.id) && after.some((row) => row.id === approvedGroup.id));
  members.push([approvedGroup.id, learnerId]);
  await api(anotherLearner, "POST", joinPath, { code: approval.code, preview: false }, 409);
  console.log("PASS approval, role checks and capacity");

  await learner.request.post(origin + "/api/auth/logout");
  const signedBackIn = await signIn("+998900000011");
  const fresh = await api(signedBackIn, "GET", "/groups/");
  assert.equal(fresh.length, after.length);
  await api(office, "DELETE", approvalPath, undefined);
  await api(signedBackIn, "POST", joinPath, { code: approval.code, preview: true }, 404);
  console.log("PASS re-login and revocation");

  const concurrencyGroup = await api(office, "POST", "/groups", { name: "Invitation concurrency " + marker }, 201);
  groups.push(concurrencyGroup.id);
  const concurrencyPath = "/groups/" + concurrencyGroup.id + "/invitation";
  const limited = await api(office, "POST", concurrencyPath, { maxUses: 1 }, 201);
  const attempts = await Promise.all([signedBackIn, anotherLearner].map(
    (page) => request(page, "POST", joinPath, { code: limited.code, preview: false }),
  ));
  assert.deepEqual(attempts.map((response) => response.status()).sort(), [200, 409]);
  assert.equal((await api(office, "GET", concurrencyPath)).invitation.uses, 1);
  const roster = (await api(office, "GET", "/groups/" + concurrencyGroup.id)).students;
  assert.equal(roster.length, 1);
  members.push([concurrencyGroup.id, roster[0].studentId]);
  console.log("PASS concurrent redemption, database capacity and one roster entry");
} finally {
  for (const [groupId, studentId] of members) {
    await request(office, "DELETE", `/groups/${groupId}/students/${studentId}`);
  }
  for (const groupId of groups) {
    await request(office, "PUT", `/groups/${groupId}/archive`, { archived: true });
  }
  await browser.close();
}
