// BESTWAY Exam Builder 2.0 — real-browser journeys for JSON import / export (Playwright, real Chromium,
// real Next.js + Django + PostgreSQL). Synthetic local accounts (seed_local_dev) and original synthetic
// content only; loopback hosts only.
//
//   BW_WEB=http://localhost:3300 node exam-builder-2.mjs
//
// A  Templates: every template loads, checks and imports from the dialog (IELTS full mock + Multilevel full mock)
// B  Reopen + export: the imported draft reopens in the editor; Export JSON round-trips through the validator
// C  Invalid import: syntax error with line/column; semantic error with a readable path; nothing is created
// D  Draft merge: Import JSON from the editor pre-selects the draft; incompatible drafts are disabled;
//    existing questions and keys are untouched; D2 replaces one skill only after an explicit opt-in
// E  Answer security: a student cannot export, validate or import, and the student exam payload has no keys
// F  Candidate journey + recovery: publish a clean imported exam, student starts, answers, the answer survives a
//    reload, submits once (duplicate submit is idempotent), objective score matches the key
// G  Layout: at 1366x768 and 390x844 the primary action is on screen without scrolling the page, no sideways scroll
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT_IELTS || "+998900000011";
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(WEB).hostname)) { console.error(`Refusing non-loopback host: ${WEB}`); process.exit(2); }
const OUT = process.env.BW_OUT || join(here, "..", "..", ".local", "e2e", "exam-builder-2");
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (c, m) => { results.push(!!c); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
const pageErrors = [];
const shot = (page, name) => page.screenshot({ path: join(OUT, name), fullPage: false }).catch(() => {});

async function login(phone, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "en-US" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) pageErrors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.fill("#phone", phone); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/, { timeout: 60000 }).catch(() => {});
  return { ctx, page };
}

/** The frontend's own proxy with the page's session cookie (exactly what the UI calls). */
async function api(page, method, path, body) {
  const res = await page.request.fetch(`${WEB}/api/backend${path}`, { method, ...(body !== undefined ? { data: body } : {}) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status(), data: json.data, error: json.error };
}

const dialog = (page) => page.getByTestId("json-import-dialog");
async function openImport(page) {
  await page.goto(`${WEB}/en/exam-builder`);
  await page.getByRole("button", { name: "Import JSON" }).first().click({ timeout: 60000 });
  await dialog(page).waitFor();
}
async function pickTemplate(page, family, tab, label) {
  const d = dialog(page);
  await d.getByRole("radiogroup", { name: "Exam family" }).getByRole("radio", { name: family }).click();
  await d.getByRole("radiogroup", { name: "Template skill" }).getByRole("radio", { name: tab }).click();
  await d.getByRole("combobox", { name: "Select JSON template" }).click();
  await page.getByRole("option", { name: label }).click();
  await d.getByRole("button", { name: "Load template" }).click();
}
async function checkImport(page) {
  const d = dialog(page);
  const validated = page.waitForResponse((r) => r.url().includes("/mock/exam-imports/validate"), { timeout: 60000 }).catch(() => null);
  await d.getByRole("button", { name: "Check import" }).click();
  return validated;
}
async function createDraft(page) {
  const d = dialog(page);
  const committed = page.waitForResponse((r) => /\/mock\/exam-imports$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 60000 });
  await d.getByRole("button", { name: /^(Create draft|Add to selected exam|Replace sections in selected exam)$/ }).click();
  const res = await committed;
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}
/** Is the element fully inside the viewport (so no page scroll is needed to reach it)? */
const onScreen = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth; });

const { ctx: tctx, page: t } = await login(TEACHER);
const examCount = async () => ((await api(t, "GET", "/mock/exams")).data ?? []).length;

// ── A: templates import from the dialog ────────────────────────────────────────────────────────
const created = {};
for (const [family, tab, label, key, expected] of [
  ["IELTS", "Full mock", "IELTS Academic · Full mock · 4 skills", "ieltsFull", { listening: 40, reading: 40, writing: 2, speaking: 3 }],
  ["CEFR Multilevel", "Full mock", "CEFR Multilevel · Full mock · 4 sections (195 min)", "mlFull", { listening: 35, reading: 35, writing: 3, speaking: 8 }],
  ["IELTS", "Listening", "Listening Part 1 · Questions 1–10", "listening1", { listening: 10 }],
]) {
  await openImport(t);
  await pickTemplate(t, family, tab, label);
  const text = await dialog(t).locator("#json-input").inputValue();
  ok(text.includes('"schemaVersion": "1.0"'), `A ${label}: Load template fills the editor`);
  const validated = await checkImport(t);
  ok(validated && validated.status() === 200, `A ${label}: server validation answered 200`);
  await dialog(t).getByText("Ready to import").waitFor({ timeout: 30000 });
  const preview = dialog(t).getByRole("region", { name: "Package preview" });
  const rows = await preview.locator("tbody tr").count();
  ok(rows === Object.keys(expected).length, `A ${label}: preview lists ${rows} section(s)`);
  for (const [skill, count] of Object.entries(expected)) {
    const row = preview.locator("tbody tr").filter({ hasText: skill });
    ok((await row.innerText()).includes(`\t${count}\t`) || (await row.locator("td").nth(3).innerText()).trim() === String(count), `A ${label}: preview shows ${skill} = ${count} questions`);
  }
  ok(await dialog(t).getByText("Imports as a draft — publishing is blocked until fixed").isVisible(), `A ${label}: template is clearly marked as not publishable`);
  if (key === "ieltsFull") await shot(t, "A1-ielts-full-report-1440.png");
  const res = await createDraft(t);
  ok(res.status === 201, `A ${label}: Create draft → HTTP ${res.status}`);
  created[key] = res.body.data.examId;
  await dialog(t).getByRole("button", { name: "Open in Exam Builder" }).click();
  await t.waitForURL(new RegExp(`/exam-builder/${created[key]}`), { timeout: 60000 });
}

// ── B: reopen and export ───────────────────────────────────────────────────────────────────────
await t.goto(`${WEB}/en/exam-builder/${created.ieltsFull}`);
await t.getByRole("button", { name: "Export JSON" }).first().waitFor({ timeout: 60000 });
const detail = (await api(t, "GET", `/mock/exams/${created.ieltsFull}`)).data;
ok(detail.sections.map((s) => s.skill).join() === "listening,reading,writing,speaking", "B reopened draft has all four sections in order");
ok(detail.questionCount === 85, `B reopened draft has 85 questions (${detail.questionCount})`);
await t.getByRole("button", { name: "Export JSON" }).first().click();
const exportDialog = t.getByRole("dialog").filter({ hasText: "Whole exam" });
await exportDialog.waitFor();
const [download] = await Promise.all([t.waitForEvent("download", { timeout: 30000 }), exportDialog.getByRole("button", { name: "Whole exam" }).click()]);
const downloadedPath = join(OUT, download.suggestedFilename());
await download.saveAs(downloadedPath);
ok(/\.bestway\.json$/.test(download.suggestedFilename()), `B export downloads ${download.suggestedFilename()}`);
const { readFileSync } = await import("node:fs");
const exported = JSON.parse(readFileSync(downloadedPath, "utf8"));
const revalidated = await api(t, "POST", "/mock/exam-imports/validate", { package: exported });
ok(revalidated.status === 200 && revalidated.data.canImport, "B exported package validates as importable again");
ok(revalidated.data.counts.questions === 85, "B exported package keeps all 85 questions");
const readingOnly = await api(t, "GET", `/mock/exams/${created.ieltsFull}/export?skill=reading`);
ok(readingOnly.status === 200 && readingOnly.data.exam.sections.length === 1, "B single-skill export returns only Reading");

// ── C: invalid imports ─────────────────────────────────────────────────────────────────────────
const before = await examCount();
await openImport(t);
await dialog(t).locator("#json-input").fill('{\n  "schemaVersion": "1.0",\n  "packageId": "broken"\n  "revision": 1\n}');
await dialog(t).getByRole("button", { name: "Check import" }).click();
const syntax = dialog(t).getByRole("alert").filter({ hasText: "JSON syntax error" });
await syntax.waitFor();
ok(/line 4, column 3/.test(await syntax.innerText()), `C syntax error is located: "${(await syntax.innerText()).split("\n")[0]}"`);
await shot(t, "C1-syntax-error-1440.png");
const badPkg = JSON.parse(readFileSync(downloadedPath, "utf8"));
badPkg.packageId = `bad-${Date.now()}`;
badPkg.exam.sections[1].groups[0].questions[0].correctAnswers = ["Z"];
badPkg.exam.sections[1].groups[0].questions[0].type = "multiple_choice";
badPkg.exam.sections[1].groups[0].questions[0].options = ["First", "Second"];
await dialog(t).locator("#json-input").fill(JSON.stringify(badPkg, null, 2));
await checkImport(t);
await dialog(t).getByText("Needs corrections").waitFor({ timeout: 30000 });
const blockers = await dialog(t).locator("section").filter({ hasText: "Must fix before import" }).innerText();
ok(/Reading › group 1 .*› Q1 › correctAnswers/.test(blockers), "C semantic error names Reading › group › Q1 › correctAnswers");
ok(await dialog(t).getByRole("button", { name: "Create draft" }).count() === 0, "C Create draft is not offered for an invalid package");
await shot(t, "C2-semantic-error-1440.png");
ok(await examCount() === before, "C no exam was created by invalid input");

// ── D: merge into an existing draft from the editor ───────────────────────────────────────────
const listeningBefore = (await api(t, "GET", `/mock/exams/${created.listening1}`)).data;
const keyBefore = JSON.stringify(listeningBefore.sections[0].groups.flatMap((g) => g.questions.map((q) => [q.id, q.number, q.correctAnswers])));
await t.goto(`${WEB}/en/exam-builder/${created.listening1}`);
await t.getByRole("button", { name: "Import JSON" }).first().click({ timeout: 60000 });
await dialog(t).waitFor();
await pickTemplate(t, "CEFR Multilevel", "Reading", "Multilevel Reading · 5 parts / 35 questions");
await checkImport(t);
await dialog(t).getByText("Ready to import").waitFor({ timeout: 30000 });
const mismatch = dialog(t).getByRole("alert").filter({ hasText: "This package is CEFR Multilevel" });
await mismatch.waitFor({ timeout: 30000 }).catch(() => {});
ok(await mismatch.isVisible(), "D pre-selected IELTS draft is refused for a Multilevel package, with the reason");
ok(await dialog(t).getByRole("button", { name: "Add to selected exam" }).isDisabled(), "D import button is disabled for the incompatible draft");
await dialog(t).getByRole("button", { name: "Edit JSON" }).click();
await pickTemplate(t, "IELTS", "Reading", "Reading Passage 1 · Questions 1–13");
await checkImport(t);
await dialog(t).getByText("New sections will be added; existing sections are not changed.").waitFor({ timeout: 30000 });
await shot(t, "D1-merge-destination-1440.png");
const merged = await createDraft(t);
ok(merged.status === 201 && merged.body.data.addedToExisting, "D package was added to the existing draft");
const listeningAfter = (await api(t, "GET", `/mock/exams/${created.listening1}`)).data;
ok(listeningAfter.sections.map((s) => s.skill).join() === "listening,reading", "D draft now has Listening + Reading");
const keyAfter = JSON.stringify(listeningAfter.sections[0].groups.flatMap((g) => g.questions.map((q) => [q.id, q.number, q.correctAnswers])));
ok(keyAfter === keyBefore, "D existing Listening question ids, numbers and keys are unchanged");

// ── D2: controlled replacement of a skill the draft already has ─────────────────────────────
await t.goto(`${WEB}/en/exam-builder/${created.listening1}`);
await t.getByRole("button", { name: "Import JSON" }).first().click({ timeout: 60000 });
await dialog(t).waitFor();
await pickTemplate(t, "IELTS", "Reading", "Academic Reading · Full test · 3 passages / 40 questions");
await checkImport(t);
await dialog(t).getByText("Ready to import").waitFor({ timeout: 30000 });
const appendButton = dialog(t).getByRole("button", { name: "Add to selected exam" });
await t.waitForFunction(() => { const b = [...document.querySelectorAll('[data-testid="json-import-dialog"] button')].find((x) => x.textContent?.trim() === "Add to selected exam"); return b && !b.disabled; }, null, { timeout: 30000 });
ok(await appendButton.isEnabled(), "D2 default for an existing skill is append, not replace (enabled once the draft resolves)");
await dialog(t).getByTestId("import-replace-existing").check();
ok(await dialog(t).getByRole("button", { name: "Replace sections in selected exam" }).isVisible(), "D2 replacing is an explicit opt-in with its own button label");
await shot(t, "D2-replace-confirm-1440.png");
const replaced = await createDraft(t);
ok(replaced.status === 201, `D2 replacement committed (HTTP ${replaced.status})`);
const afterReplace = (await api(t, "GET", `/mock/exams/${created.listening1}`)).data;
const readingQs = afterReplace.sections.find((x) => x.skill === "reading").groups.flatMap((g) => g.questions);
ok(readingQs.length === 40, `D2 Reading now has the package's 40 questions (${readingQs.length})`);
ok(JSON.stringify(afterReplace.sections[0].groups.flatMap((g) => g.questions.map((q) => [q.id, q.number, q.correctAnswers]))) === keyBefore, "D2 Listening untouched by the Reading replacement");

// ── D3: a pre-selected draft that has not loaded yet never falls back to "create a new exam" ──
let releaseList;
const listGate = new Promise((resolve) => { releaseList = resolve; });
// Installed before the page loads, in a fresh page, so no cached drafts list exists.
await t.route(/\/api\/backend\/mock\/exams(\?.*)?$/, async (route) => { await listGate; await route.continue().catch(() => {}); });
await t.goto("about:blank");
await t.goto(`${WEB}/en/exam-builder/${created.listening1}`);
await t.getByRole("button", { name: "Import JSON" }).first().waitFor({ timeout: 60000 });
await t.getByRole("button", { name: "Import JSON" }).first().click();
await dialog(t).waitFor();
await pickTemplate(t, "IELTS", "Speaking", "IELTS Speaking · Parts 1–3");
await checkImport(t);
await dialog(t).getByText("Ready to import").waitFor({ timeout: 30000 });
ok(await dialog(t).getByText("Loading the selected draft…").isVisible(), "D3 while the draft list loads, the dialog says so");
ok(await dialog(t).getByRole("button", { name: "Create draft" }).count() === 0, "D3 no 'Create draft' fallback while the pre-selected draft is unresolved");
ok(await dialog(t).getByRole("button", { name: "Add to selected exam" }).isDisabled(), "D3 import is disabled until the draft resolves");
releaseList();
await t.unroute(/\/api\/backend\/mock\/exams(\?.*)?$/, { behavior: "ignoreErrors" });
await t.waitForFunction(() => { const b = [...document.querySelectorAll('[data-testid="json-import-dialog"] button')].find((x) => x.textContent?.trim() === "Add to selected exam"); return b && !b.disabled; }, null, { timeout: 30000 });
ok(true, "D3 import is enabled once the draft has loaded");
await dialog(t).getByRole("button", { name: "Close" }).last().click();

// ── F (author part): a clean, publishable original exam imported through the dialog ───────────
const stamp = Date.now();
const clean = {
  schemaVersion: "1.0", packageId: `e2e-clean-${stamp}`, revision: 1, profile: "practice",
  source: { kind: "original_practice", label: "BestWay E2E synthetic passage" },
  exam: { type: "ielts_academic", title: `E2E Reading ${stamp}`, description: "Synthetic", level: "IELTS Academic", isDemo: false, price: 0, isFreeForApproved: true,
    sections: [{ key: "reading", skill: "reading", title: "Reading", instructions: "Answer the questions.", durationMinutes: 20, groups: [{
      key: "passage-1", title: "Rooftop gardens", instructions: "Choose TRUE, FALSE or NOT GIVEN.", contentHtml: "", contentLayout: "document", audioScript: "",
      passageText: "Rooftop gardens cool the buildings below them. In the town of Lindale, forty roofs were planted in one year. Volunteers water the plants every morning.",
      questions: [
        { key: "q1", sourceRef: "synthetic", number: 1, type: "true_false_notgiven", prompt: "Rooftop gardens cool buildings.", options: ["TRUE", "FALSE", "NOT GIVEN"], correctAnswers: ["TRUE"], acceptedVariants: [], points: 1 },
        { key: "q2", sourceRef: "synthetic", number: 2, type: "true_false_notgiven", prompt: "Lindale planted a hundred roofs.", options: ["TRUE", "FALSE", "NOT GIVEN"], correctAnswers: ["FALSE"], acceptedVariants: [], points: 1 },
        { key: "q3", sourceRef: "synthetic", number: 3, type: "true_false_notgiven", prompt: "The volunteers are paid.", options: ["TRUE", "FALSE", "NOT GIVEN"], correctAnswers: ["NOT_GIVEN"], acceptedVariants: [], points: 1 },
      ] }] }] },
  media: [], reviewIssues: [],
};
await openImport(t);
await dialog(t).locator("#json-input").fill(JSON.stringify(clean));
await checkImport(t);
await dialog(t).getByText("Ready to import").waitFor({ timeout: 30000 });
const cleanRes = await createDraft(t);
ok(cleanRes.status === 201, "F clean original package imported");
const cleanId = cleanRes.body.data.examId;
const published = await api(t, "PATCH", `/mock/exams/${cleanId}`, { isPublished: true });
ok(published.status === 200, `F teacher publishes the clean exam (HTTP ${published.status} ${published.error?.code ?? ""})`);
const templPublish = await api(t, "PATCH", `/mock/exams/${created.ieltsFull}`, { isPublished: true });
ok(templPublish.status === 400, `F an unfinished template draft cannot be published (HTTP ${templPublish.status} ${templPublish.error?.code ?? ""})`);

// ── E + F: student ────────────────────────────────────────────────────────────────────────────
const { ctx: sctx, page: s } = await login(STUDENT);
for (const [method, path, body] of [
  ["GET", `/mock/exams/${cleanId}/export`],
  ["POST", "/mock/exam-imports/validate", { package: clean }],
  ["POST", "/mock/exam-imports", { package: clean, validatedChecksum: "0".repeat(64) }],
]) {
  const r = await api(s, method, path, body);
  ok(r.status === 403, `E student ${method} ${path.split("?")[0]} → ${r.status}`);
}
const studentView = await api(s, "GET", `/mock/exams/${cleanId}`);
const studentJson = JSON.stringify(studentView.data ?? {});
ok(studentView.status === 200 && !/correctAnswers|acceptedVariants|"NOT_GIVEN"/.test(studentJson), "E student exam payload carries no answer keys");
const started = await api(s, "POST", `/mock/exams/${cleanId}/start`, { mode: "practice" });
ok([200, 201].includes(started.status), `F student starts the exam (HTTP ${started.status} ${started.error?.code ?? ""})`);
const attemptId = started.data?.attemptId ?? started.data?.id;
const attempt = (await api(s, "GET", `/mock/attempts/${attemptId}`)).data;
const qs = attempt.exam?.sections?.[0]?.groups?.[0]?.questions ?? attempt.sections?.[0]?.groups?.[0]?.questions ?? [];
ok(qs.length === 3 && !JSON.stringify(qs).includes("correctAnswers"), "F attempt payload has 3 questions and no keys");
await s.goto(`${WEB}/en/mock/attempt/${attemptId}`);
await s.getByText("Rooftop gardens cool the buildings below them.").first().waitFor({ timeout: 60000 }).catch(() => {});
ok(await s.getByText("Rooftop gardens cool the buildings below them.").first().isVisible().catch(() => false), "F reading passage renders in the candidate runner");
await shot(s, "F1-candidate-reading-1440.png");
const byNumber = Object.fromEntries(qs.map((q) => [q.number, q.id]));
const save1 = await api(s, "POST", `/mock/attempts/${attemptId}/answer`, { questionId: byNumber[1], response: "TRUE" });
ok([200, 201].includes(save1.status), "F answer 1 autosaved");
await s.reload();
const resumed = (await api(s, "GET", `/mock/attempts/${attemptId}`)).data;
const savedAnswers = JSON.stringify(resumed.answers ?? resumed);
ok(savedAnswers.includes(byNumber[1]) && savedAnswers.includes("TRUE"), "F after a reload the saved answer is restored");
await api(s, "POST", `/mock/attempts/${attemptId}/answer`, { questionId: byNumber[2], response: "TRUE" });   // wrong on purpose
await api(s, "POST", `/mock/attempts/${attemptId}/answer`, { questionId: byNumber[3], response: "NOT GIVEN" });
const sub1 = await api(s, "POST", `/mock/attempts/${attemptId}/submit`, { confirm: true });
const sub2 = await api(s, "POST", `/mock/attempts/${attemptId}/submit`, { confirm: true });
ok([200, 201].includes(sub1.status), `F submit → ${sub1.status}`);
ok(sub2.status < 500, `F duplicate submit is handled without a server error (${sub2.status})`);
const result = (await api(s, "GET", `/mock/attempts/${attemptId}`)).data;
const raw = result.rawScores?.reading ?? result.rawScores;
ok(JSON.stringify(raw ?? "").includes("2"), `F objective score is 2/3 (rawScores ${JSON.stringify(result.rawScores)})`);
const late = await api(s, "POST", `/mock/attempts/${attemptId}/answer`, { questionId: byNumber[2], response: "FALSE" });
ok(late.status >= 400 && late.status < 500, `F a save after submission is refused (${late.status})`);

// ── G: layout at laptop and phone sizes ───────────────────────────────────────────────────────
for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const { ctx, page } = await login(TEACHER, viewport);
  await openImport(page);
  await pickTemplate(page, "IELTS", "Reading", "Academic Reading · Full test · 3 passages / 40 questions");
  ok(await onScreen(dialog(page).getByRole("button", { name: "Check import" })), `G ${viewport.width}x${viewport.height}: Check import visible without scrolling`);
  await checkImport(page);
  await dialog(page).getByText("Ready to import").waitFor({ timeout: 30000 });
  ok(await onScreen(dialog(page).getByRole("button", { name: "Create draft" })), `G ${viewport.width}x${viewport.height}: Create draft stays on screen with a long report`);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!sideways, `G ${viewport.width}x${viewport.height}: no horizontal page scroll`);
  const scrollers = await dialog(page).evaluate((root) => [...root.querySelectorAll("*")].filter((el) => { const st = getComputedStyle(el); return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1; }).length);
  ok(scrollers <= 1, `G ${viewport.width}x${viewport.height}: one vertical scroll region in the dialog (${scrollers})`);
  await shot(page, `G-report-${viewport.width}x${viewport.height}.png`);
  await ctx.close();
}

ok(pageErrors.length === 0, `no uncaught page errors (${pageErrors.slice(0, 3).join(" | ")})`);
await sctx.close(); await tctx.close(); await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
