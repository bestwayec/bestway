// BESTWAY Teacher Workspace 2.0 — real browser journeys (Playwright, real Chromium, real Django + PostgreSQL).
// Synthetic local accounts only (seed_local_dev + seed_teacher_workspace_local), loopback only, no Telegram token.
//   BW_WEB=http://localhost:3300 node teacher-workspace.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT || "+998900101000";       // B1 Kechki, synthetic
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(WEB).hostname)) { console.error(`Refusing non-loopback host: ${WEB}`); process.exit(2); }
const OUT = process.env.BW_OUT || join(here, "..", "..", ".local", "e2e", "teacher-workspace");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push(!!c); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
const errors = [];
const shot = (page, name) => page.screenshot({ path: join(OUT, name), fullPage: true });

async function login(phone, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "uz-UZ" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  await page.goto(`${WEB}/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {});
  await page.fill("#phone", phone); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/, { timeout: 60000 }).catch(() => {});
  return { ctx, page };
}
const checkedCount = (page, label) => page.locator(`[data-testid="att-row"] [role="radio"][aria-checked="true"]`).filter({ hasText: label }).count();

// ================================================================== TEACHER: dashboard -> attendance -> homework -> results
const { ctx: tctx, page: t } = await login(TEACHER, { width: 1440, height: 900 });
await t.goto(`${WEB}/dashboard`);
await t.getByTestId("tw-action-attendance").waitFor({ timeout: 60000 });
ok(await t.getByTestId("tw-action-attendance").isVisible() && await t.getByTestId("tw-action-assign").isVisible()
   && await t.getByTestId("tw-action-groups").isVisible() && await t.getByTestId("tw-action-results").isVisible(), "dashboard: the four primary actions are the first thing on screen");
await t.getByTestId("tw-overview-stats").waitFor();
ok((await t.getByTestId("tw-overview-stats").innerText()).includes("Bugungi guruhlar"), "dashboard: Uzbek-first overview (today's groups, present, active homework, review)");
await shot(t, "1-teacher-dashboard-1440.png");
const overview = await t.evaluate(async () => { const r = await fetch("/api/backend/teacher/workspace/overview"); const j = await r.json(); return j.data ?? j; });
const g1 = overview.groups.find((g) => g.name === "B1 Kechki")?.id;      // the synthetic student's group (seed_teacher_workspace_local)
ok(!!g1 && overview.groups.length >= 3, "dashboard: the teacher's groups come from the server overview");

await t.getByTestId("tw-action-attendance").click();
await t.waitForURL(/teacher\/attendance/);
await t.goto(`${WEB}/teacher/attendance?group=${g1}`);
await t.getByTestId("att-list").waitFor({ timeout: 60000 });
const rows = await t.getByTestId("att-row").count();
ok(rows === 20, `attendance: the group's 20 students are listed (${rows})`);
ok(await t.locator('[data-testid="att-row"] [role="radio"][aria-checked="true"]').count() === 0, "attendance: opening the page marks NOBODY");
ok(await t.getByTestId("att-save").isDisabled(), "attendance: Save is disabled until something is marked");
await t.getByTestId("att-mark-all").click();
ok(await checkedCount(t, "Keldi") === 20, "attendance: 'Hammasi keldi' is an explicit action that marks all 20");
const row = (i) => t.getByTestId("att-row").nth(i);
await row(1).getByRole("radio", { name: "Kelmadi" }).click();
await row(2).getByRole("radio", { name: "Kelmadi" }).click();
await row(3).getByRole("radio", { name: "Kechikdi" }).click();
await shot(t, "2-attendance-marking-1440.png");
await t.getByTestId("att-save").click();
await t.getByTestId("att-summary").waitFor({ timeout: 30000 });
const summary = await t.getByTestId("att-summary").innerText();
ok(/Keldi\s*17/.test(summary) && /Kelmadi\s*2/.test(summary) && /Kechikdi\s*1/.test(summary), `attendance: one save shows Keldi 17 / Kelmadi 2 / Kechikdi 1`);
await shot(t, "3-attendance-saved-1440.png");
await t.reload();
await t.getByTestId("att-list").waitFor();
await t.waitForFunction(() => document.querySelectorAll('[data-testid="att-row"] [role="radio"][aria-checked="true"]').length === 20, null, { timeout: 30000 });
ok(await checkedCount(t, "Keldi") === 17 && await checkedCount(t, "Kelmadi") === 2 && await checkedCount(t, "Kechikdi") === 1, "attendance: after a reload the saved marks load (nothing overwritten)");
ok(await t.getByTestId("att-save").isDisabled(), "attendance: a reload does not create unsaved changes");

// ---- homework: three steps, double click
await t.goto(`${WEB}/teacher/assign?group=${g1}`);
await t.getByTestId("hw-type-quiz").click({ timeout: 60000 });
const questions = Array.from({ length: 10 }, (_, i) => `${i + 1}. The letter ___ yesterday.\nA) was written\nB) writes\nC) is write`).join("\n");
await t.getByTestId("hw-questions").fill(questions);
await t.getByTestId("hw-key").fill(Array.from({ length: 10 }, (_, i) => `${i + 1} A`).join("\n"));
const title = `Passive Voice E2E ${Date.now() % 100000}`;
await t.getByTestId("hw-title").fill(title);
await t.getByTestId("hw-preview").getByText("10 ta savol").waitFor({ timeout: 30000 });
ok(await t.getByTestId("hw-preview").getByText("20 ta o'quvchi").isVisible(), "homework: the live preview shows 10 questions for 20 students before assigning");
await shot(t, "4-homework-create-1440.png");
await t.getByTestId("hw-assign").dblclick();
await t.getByTestId("hw-success").waitFor({ timeout: 30000 });
await shot(t, "5-homework-assigned-1440.png");
await t.goto(`${WEB}/teacher/results?group=${g1}`);
await t.getByTestId("hw-list").waitFor({ timeout: 60000 });
const sameTitle = await t.getByTestId("hw-list").getByText(title).count();
ok(sameTitle === 1, `homework: a double click on 'Guruhga biriktirish' created ONE assignment (${sameTitle})`);
await t.getByTestId("hw-list").getByText(title).click();
await t.getByTestId("res-counts").waitFor({ timeout: 60000 });
const counts0 = await t.getByTestId("res-counts").innerText();
ok(/Biriktirilgan\s*20/.test(counts0) && /Topshirgan\s*0/.test(counts0), "results: Assigned 20 / Submitted 0 before anyone starts");
const resultsUrl = t.url();

// ================================================================== STUDENT (phone 390): My homework -> quiz -> result
const { ctx: sctx, page: s } = await login(STUDENT, { width: 390, height: 844 });
await s.goto(`${WEB}/homework`);
await s.getByTestId("my-homework").first().waitFor({ timeout: 60000 });
const card = s.getByTestId("hw-card").filter({ hasText: title });
ok(await card.count() === 1 && (await card.innerText()).includes("Boshlanmagan"), "student: 'Mening vazifalarim' lists the new quiz as NOT STARTED");
await shot(s, "6-student-homework-390.png");
await card.getByRole("link", { name: /Boshlash/ }).click();
await s.getByTestId("quiz-start").click({ timeout: 60000 });
await s.getByTestId("quiz-prompt").waitFor({ timeout: 30000 });
ok(!(await s.content()).includes("correctAnswers"), "runner: no answer key in the page");
for (let i = 0; i < 10; i++) {
  if (i === 4) await sctx.setOffline(true);                      // network interruption on question 5
  await s.getByTestId("quiz-option").nth(i < 8 ? 0 : 1).click();
  if (i === 4) {
    await s.getByText(/javob saqlanmadi/).waitFor({ timeout: 20000 });
    ok(true, "runner: a lost connection is shown ('javob saqlanmadi') instead of failing silently");
    await sctx.setOffline(false);
    await s.getByRole("button", { name: "Qayta urinish" }).click();
    await s.getByText("Saqlandi ✓").waitFor({ timeout: 20000 });
    ok(true, "runner: retry after reconnect saves the answer");
  } else {
    await s.getByText("Saqlandi ✓").waitFor({ timeout: 20000 });
  }
  if (i === 2) await shot(s, "7-student-quiz-390.png");
  if (i < 9) await s.getByTestId("quiz-next").click();
}
ok(/\d\d:\d\d/.test(await s.getByTestId("quiz-timer").innerText()), "runner: the server countdown is visible");
await s.reload();                                                  // resume after a reload
await s.getByTestId("quiz-prompt").waitFor({ timeout: 60000 });
ok((await s.getByText("Javob: 10/10").count()) === 1, "runner: after a reload the attempt resumes with 10/10 answers saved");
await s.getByTestId("quiz-finish").click().catch(async () => {
  for (let i = 0; i < 10; i++) { if (await s.getByTestId("quiz-finish").count()) break; await s.getByTestId("quiz-next").click(); }
  await s.getByTestId("quiz-finish").click();
});
await s.getByTestId("quiz-confirm-finish").dblclick();
await s.getByTestId("quiz-result").waitFor({ timeout: 30000 });
const res = await s.getByTestId("quiz-result").innerText();
ok(res.includes("80%") && res.includes("8/10"), "student: server result 8/10 = 80%");
ok(res.includes("IELTS ball emas"), "student: the result is a classroom percentage, never an IELTS band");
await shot(s, "8-student-result-390.png");
await s.goto(`${WEB}/homework`);
await s.getByTestId("hw-card").filter({ hasText: title }).getByText("Baholandi").waitFor({ timeout: 30000 });
ok((await s.getByTestId("hw-card").filter({ hasText: title }).innerText()).includes("80%"), "student: My homework now shows GRADED 80%");

// ================================================================== TEACHER again: live results
await t.goto(resultsUrl);
await t.getByTestId("res-counts").waitFor({ timeout: 60000 });
await t.waitForFunction(() => /Topshirgan\s*1/.test(document.querySelector('[data-testid="res-counts"]')?.innerText ?? ""), null, { timeout: 40000 });
ok(true, "results: the teacher sees Submitted 1 without any manual action");
const done = t.getByTestId("res-row").filter({ hasText: "Baholandi" });
ok(await done.count() === 1 && (await done.innerText()).includes("80%"), "results: the completed student is GRADED 80%");
await done.getByRole("button", { name: /Ko'rish/ }).click();
await t.getByText("Xatolar (2)").waitFor({ timeout: 30000 });
ok(true, "results: the teacher inspects the submission and its 2 mistakes");
await shot(t, "9-teacher-results-1440.png");
await t.keyboard.press("Escape");

// ================================================================== NEGATIVE
await t.goto(`${WEB}/teacher/results?kind=quiz&id=00000000-0000-4000-8000-000000000000`);
ok(await t.getByText("Vazifa topilmadi").first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false), "negative: an unknown / foreign assignment shows 'not found' (no data)");
await t.goto(`${WEB}/homework`);
await t.waitForLoadState("networkidle").catch(() => {});
ok(!/\/homework$/.test(new URL(t.url()).pathname) || (await t.getByTestId("my-homework").count()) === 0, "negative: a teacher cannot use the student homework page");
await s.goto(`${WEB}/teacher/attendance`);
await s.waitForLoadState("networkidle").catch(() => {});
ok(!new URL(s.url()).pathname.startsWith("/teacher"), "negative: a student is redirected away from the teacher workspace");
await s.goto(`${WEB}/homework/quiz/00000000-0000-4000-8000-000000000000`);
ok(await s.getByText(/topilmadi/).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false), "negative: a student cannot open an assignment that is not theirs");

// ================================================================== responsive screenshots
// Page-level scrollWidth is not enough (an ancestor can clip): report any visible element in <main> whose box
// extends past the viewport, unless it sits inside a deliberate horizontal scroller (overflow-x auto/scroll).
const clipped = () => {
  const vw = window.innerWidth;
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= vw + 1) continue;
    let scroller = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (["auto", "scroll"].includes(getComputedStyle(a).overflowX)) { scroller = true; break; }
    }
    if (!scroller) return `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`;
  }
  return "";
};
for (const width of [360, 768, 1024]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, storageState: await tctx.storageState() });
  const p = await ctx.newPage();
  await p.goto(`${WEB}/dashboard`); await p.getByTestId("tw-action-attendance").waitFor({ timeout: 60000 });
  const overflow = await p.evaluate(clipped);
  ok(!overflow, `responsive: nothing overflows or is clipped on the dashboard at ${width}px (${overflow || ""})`);
  await shot(p, `10-dashboard-${width}.png`);
  await p.goto(`${WEB}/teacher/attendance?group=${g1}`); await p.getByTestId("att-list").waitFor({ timeout: 60000 });
  ok(!(await p.evaluate(clipped)), `responsive: nothing overflows or is clipped on attendance at ${width}px`);
  if (width === 360) await p.screenshot({ path: join(OUT, "11-attendance-360.png") });   // viewport: sticky bars stay in place
  for (const [path, testid] of [[`/teacher/assign?group=${g1}`, "hw-type-quiz"], [`/teacher/results?group=${g1}`, "hw-list"]]) {
    await p.goto(`${WEB}${path}`); await p.getByTestId(testid).first().waitFor({ timeout: 60000 });
    const bad = await p.evaluate(clipped);
    ok(!bad, `responsive: nothing clipped on ${path.split("?")[0]} at ${width}px ${bad}`);
  }
  await ctx.close();
  const sc = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, storageState: await sctx.storageState() });
  const sp = await sc.newPage();
  await sp.goto(`${WEB}/homework`); await sp.getByTestId("hw-card").first().waitFor({ timeout: 60000 });
  const bad = await sp.evaluate(clipped);
  ok(!bad, `responsive: nothing clipped on the student homework page at ${width}px ${bad}`);
  await sc.close();
}

ok(errors.length === 0, `no uncaught page errors (${errors.slice(0, 3).join(" | ")})`);
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
