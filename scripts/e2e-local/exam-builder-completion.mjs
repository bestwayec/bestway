// BESTWAY Exam Builder 2.0 completion — real browser (Playwright, Chromium, Next production build + Django
// + PostgreSQL). Synthetic accounts (seed_local_dev) and original synthetic content; loopback only.
//
//   BW_WEB=http://localhost:3300 node exam-builder-completion.mjs
//
// U  Undo/redo: edits in the Reading passage editor undo and redo (buttons and Ctrl+Z / Ctrl+Shift+Z outside
//    text fields); Save is a version boundary (history cleared)
// Q  Question bank: search, preview, select, add to the draft — numbering continues, source unchanged
// L  Lifecycle: Draft → Validate → Validated → Publish → Archive (hidden from students, results kept) → Restore
// T  Template export: the downloaded template has no answer keys and re-validates as importable but not publishable
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT_IELTS || "+998900000011";
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(WEB).hostname)) { console.error(`Refusing non-loopback host: ${WEB}`); process.exit(2); }
const OUT = process.env.BW_OUT || join(here, "..", "..", ".local", "e2e", "exam-builder-completion");
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (c, m) => { results.push(!!c); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const pageErrors = [];
const shot = (page, name) => page.screenshot({ path: join(OUT, name) }).catch(() => {});

async function login(phone, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "en-US", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) pageErrors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.fill("#phone", phone); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/, { timeout: 60000 }).catch(() => {});
  return { ctx, page };
}
async function api(page, method, path, body) {
  const res = await page.request.fetch(`${WEB}/api/backend${path}`, { method, ...(body !== undefined ? { data: body } : {}) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status(), data: json.data, error: json.error };
}
async function importPackage(page, pkg) {
  const report = await api(page, "POST", "/mock/exam-imports/validate", { package: pkg });
  const commit = await api(page, "POST", "/mock/exam-imports", { package: pkg, validatedChecksum: report.data.checksum });
  return commit.data.examId;
}

const stamp = Date.now();
const passage = (title, text, n0, keys) => ({
  key: `p-${n0}`, title, instructions: "Choose TRUE, FALSE or NOT GIVEN.", contentHtml: "", contentLayout: "document", audioScript: "", passageText: text,
  questions: keys.map((k, i) => ({ key: `q${n0 + i}`, sourceRef: "synthetic", number: n0 + i, type: "true_false_notgiven", prompt: `${title} statement ${i + 1}.`,
    options: ["TRUE", "FALSE", "NOT GIVEN"], correctAnswers: [k], acceptedVariants: [], points: 1 })),
});
const pkg = (id, title, groups) => ({
  schemaVersion: "1.0", packageId: `${id}-${stamp}`, revision: 1, profile: "practice", source: { kind: "original_practice", label: "E2E synthetic" },
  exam: { type: "ielts_academic", title, description: "", level: "", isDemo: false, price: 0, isFreeForApproved: true,
    sections: [{ key: "reading", skill: "reading", title: "Reading", instructions: "", durationMinutes: 20, groups }] },
  media: [], reviewIssues: [],
});

const { ctx: tctx, page: t } = await login(TEACHER);
const targetId = await importPackage(t, pkg("e2e-target", `E2E Builder ${stamp}`, [passage("Rooftop gardens", "Rooftop gardens cool the buildings below them.", 1, ["TRUE", "FALSE", "NOT_GIVEN"])]));
const sourceId = await importPackage(t, pkg("e2e-source", `E2E Bank source ${stamp}`, [passage(`Desert bees ${stamp}`, "Desert bees collect water at dawn.", 1, ["TRUE", "FALSE"])]));
ok(!!targetId && !!sourceId, "setup: two original drafts imported");

// ── U: undo / redo ─────────────────────────────────────────────────────────────────────────────
await t.goto(`${WEB}/en/exam-builder/${targetId}`);
await t.getByRole("navigation", { name: "Exam outline" }).getByText("Rooftop gardens").first().click({ timeout: 60000 });
const title = t.locator("#rp-title");
await title.waitFor({ timeout: 30000 });
const undo = t.getByTestId("editor-undo");
const redo = t.getByTestId("editor-redo");
ok(await undo.isDisabled() && await redo.isDisabled(), "U a freshly opened panel has nothing to undo");
await title.fill("Rooftop gardens — revised");
await t.waitForTimeout(800); // a separate step from the next edit
await t.locator("#rp-instr").fill("New instructions");
await t.waitForTimeout(800);
await undo.click();
ok(await t.locator("#rp-instr").inputValue() === "Choose TRUE, FALSE or NOT GIVEN.", "U Undo restores the instructions");
ok(await title.inputValue() === "Rooftop gardens — revised", "U the earlier title edit is still there");
await t.locator("body").click({ position: { x: 5, y: 5 } });
await t.keyboard.press("Control+z");
ok(await title.inputValue() === "Rooftop gardens", "U Ctrl+Z outside a text field undoes the title edit");
await t.keyboard.press("Control+Shift+z");
ok(await title.inputValue() === "Rooftop gardens — revised", "U Ctrl+Shift+Z redoes it");
// Inside a text field the editor must not intercept Ctrl+Z (the browser's own text undo applies).
const intercepted = await title.evaluate((el) => {
  const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event.defaultPrevented;
});
ok(!intercepted, "U Ctrl+Z inside a text field is left to the browser's own text undo");
await shot(t, "U-undo-redo-1440.png");
await t.getByRole("button", { name: "Save Draft" }).first().click();
await t.waitForResponse((r) => /\/mock\/groups\/[^/]+\/content$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT", { timeout: 30000 });
await t.waitForTimeout(500);
ok(await undo.isDisabled(), "U saving clears the history (version boundary)");
const saved = (await api(t, "GET", `/mock/exams/${targetId}`)).data;
ok(saved.sections[0].groups[0].title.startsWith("Rooftop gardens"), "U the saved title persisted");

// ── Q: question bank ───────────────────────────────────────────────────────────────────────────
await t.getByRole("button", { name: "Question bank" }).first().click();
const bank = t.getByTestId("question-bank-dialog");
await bank.waitFor();
await bank.getByRole("searchbox").fill(`Desert bees ${stamp}`);
const row = bank.locator("li").filter({ hasText: `Desert bees ${stamp}` }).first();
await row.waitFor({ timeout: 30000 });
await t.waitForResponse((r) => r.url().includes("/question-bank/groups") && r.url().includes("search="), { timeout: 30000 }).catch(() => {});
await row.getByRole("button", { name: /Preview/ }).click();
await row.getByText("Desert bees collect water at dawn.").waitFor({ timeout: 15000 }).catch(() => {});
ok(await row.getByText("Desert bees collect water at dawn.").isVisible(), "Q preview shows the passage and questions");
ok(!(await bank.innerText()).includes("correctAnswers"), "Q the bank shows no answer keys");
await row.getByRole("checkbox").check();
await shot(t, "Q-bank-1440.png");
const inserted = t.waitForResponse((r) => r.url().includes("/bank-insert"), { timeout: 30000 });
await bank.getByRole("button", { name: /Add 1 group/ }).click();
ok((await inserted).status() === 201, "Q Add → HTTP 201");
const after = (await api(t, "GET", `/mock/exams/${targetId}`)).data;
const numbers = after.sections[0].groups.flatMap((g) => g.questions.map((q) => q.number));
ok(JSON.stringify(numbers) === JSON.stringify([1, 2, 3, 4, 5]), `Q numbering continues after the section (${numbers})`);
const source = (await api(t, "GET", `/mock/exams/${sourceId}`)).data;
ok(source.sections[0].groups[0].questions.length === 2, "Q the source exam is unchanged");

// ── L: lifecycle ───────────────────────────────────────────────────────────────────────────────
await t.reload();
const badge = t.getByTestId("editor-lifecycle");
await badge.waitFor({ timeout: 60000 });
ok((await badge.innerText()).trim() === "Draft", "L new content is a Draft");
await t.getByRole("button", { name: "Validate", exact: true }).click();
await t.waitForFunction(() => document.querySelector('[data-testid="editor-lifecycle"]')?.textContent?.trim() === "Validated", null, { timeout: 30000 });
ok(true, "L Validate → Validated");
const published = await api(t, "PATCH", `/mock/exams/${targetId}`, { isPublished: true });
ok(published.status === 200, "L publish");
await t.goto(`${WEB}/en/exam-builder`);
const card = t.locator("tr").filter({ hasText: `E2E Builder ${stamp}` }).first();
await card.waitFor({ timeout: 60000 });
ok((await card.getByTestId("exam-lifecycle").first().innerText()).trim() === "Published", "L list shows Published");
await card.getByRole("button", { name: new RegExp(`^Archive — E2E Builder ${stamp}`) }).first().click();
await t.getByRole("alertdialog").or(t.getByRole("dialog")).getByRole("button", { name: "Archive" }).last().click();
await t.getByText("Exam archived — results are kept.").waitFor({ timeout: 30000 });
await t.getByRole("tab", { name: /^Archived/ }).click();
await t.locator("tr").filter({ hasText: `E2E Builder ${stamp}` }).first().waitFor({ timeout: 30000 }).catch(() => {});
ok(await t.locator("tr").filter({ hasText: `E2E Builder ${stamp}` }).first().isVisible(), "L the exam moved to the Archived tab");
await shot(t, "L-archived-1440.png");
const { ctx: sctx, page: s } = await login(STUDENT);
const catalogue = (await api(s, "GET", "/mock/exams")).data ?? [];
ok(!catalogue.some((e) => e.id === targetId), "L students no longer see the archived exam");
ok((await api(s, "POST", `/mock/exams/${targetId}/start`, { mode: "practice" })).status >= 400, "L students cannot start it");
ok((await api(s, "POST", `/mock/exams/${targetId}/archive`)).status === 403, "L students cannot change the lifecycle");
await sctx.close();
const relisted = t.locator("tr").filter({ hasText: `E2E Builder ${stamp}` }).first();
await relisted.getByRole("button", { name: new RegExp(`^Restore — E2E Builder ${stamp}`) }).first().click();
await t.getByText("Exam restored as a draft.").waitFor({ timeout: 30000 });
const restored = (await api(t, "GET", `/mock/exams/${targetId}`)).data;
ok(restored.lifecycle !== "archived" && !restored.isPublished, `L Restore returns it unpublished (${restored.lifecycle})`);

// ── T: template export ─────────────────────────────────────────────────────────────────────────
await t.goto(`${WEB}/en/exam-builder/${targetId}`);
await t.getByRole("button", { name: "Export JSON" }).first().click({ timeout: 60000 });
const exp = t.getByRole("dialog").filter({ hasText: "Whole exam" });
await exp.getByRole("radio", { name: "Template (no keys)" }).click();
const [download] = await Promise.all([t.waitForEvent("download", { timeout: 30000 }), exp.getByRole("button", { name: "Whole exam" }).click()]);
const file = join(OUT, download.suggestedFilename());
await download.saveAs(file);
const template = JSON.parse(readFileSync(file, "utf8"));
const qs = template.exam.sections.flatMap((x) => x.groups.flatMap((g) => g.questions));
ok(template.template === true && qs.length === 5, `T template downloaded (${download.suggestedFilename()})`);
ok(qs.every((q) => q.correctAnswers.length === 0 && q.acceptedVariants.length === 0), "T no answer keys in the template");
const check = await api(t, "POST", "/mock/exam-imports/validate", { package: template });
ok(check.data.canImport && !check.data.canPublish, "T it re-validates as importable but not publishable");

ok(pageErrors.length === 0, `no uncaught page errors (${pageErrors.slice(0, 3).join(" | ")})`);
await tctx.close(); await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
