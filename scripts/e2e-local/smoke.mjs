// BESTWAY local browser smoke test (Playwright, real Chromium).
// Synthetic accounts only (created by `manage.py seed_local_dev`), loopback only.
//   node smoke.mjs            -> runs all steps, writes report + screenshots to ../../.local/e2e/
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", ".local", "e2e");
mkdirSync(OUT, { recursive: true });

const WEB = process.env.BW_WEB || "http://127.0.0.1:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const ADMIN = process.env.BW_ADMIN || "+998900000002";
const STUDENT_ONE = process.env.BW_STUDENT_ONE || "+998900000010";
const RECORD_MOCK = process.env.BW_RECORD_MOCK || "MOCK-RECORD-01";

const host = new URL(WEB).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  console.error(`Refusing to run against non-loopback host: ${host}`);
  process.exit(2);
}

function findChromium() {
  if (process.env.BW_CHROMIUM && existsSync(process.env.BW_CHROMIUM)) return process.env.BW_CHROMIUM;
  const root = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = join(root, d, "chrome-win64", "chrome.exe");
    if (existsSync(exe)) return exe;
    const old = join(root, d, "chrome-win", "chrome.exe");
    if (existsSync(old)) return old;
  }
  return undefined;
}

// The exam shows a one-time full-screen notice; accept it whenever it appears.
async function acceptFullscreenNotice(page) {
  await page.addLocatorHandler(page.getByTestId("fullscreen-notice"), async (notice) => {
    await notice.getByRole("button").click();
  });
}

const results = [];
const consoleErrors = [];
const failedRequests = [];
const badResponses = [];
const apiCalls = [];
// Third-party Google Sign-In widget: the frontend hardcodes a production client id, which
// rejects localhost origins. It is unrelated to the local app, so it is tracked separately.
const isGoogleNoise = (s) => /accounts\.google\.com|GSI_LOGGER|FedCM|identity provider|credentials\.get|Provider's accounts list/i.test(s);

let current = "setup";
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    consoleErrors.push({ label, step: current, text: text.slice(0, 300), thirdParty: isGoogleNoise(text) || isGoogleNoise(m.location()?.url || "") });
  });
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText || "";
    if (err.includes("ERR_ABORTED")) return; // navigations/cancellations
    failedRequests.push({ label, step: current, url: r.url().slice(0, 200), err });
  });
  page.on("response", (r) => {
    const url = r.url();
    if (url.startsWith(WEB) && url.includes("/api/")) {
      apiCalls.push({ method: r.request().method(), status: r.status(), path: url.replace(WEB, "").split("?")[0] });
    }
    if (r.status() >= 400) badResponses.push({ label, step: current, status: r.status(), url: url.slice(0, 200), thirdParty: isGoogleNoise(url) });
  });
}

async function step(page, name, fn) {
  current = name;
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, status: "PASS", ms: Date.now() - t0, note: note || "" });
    console.log(`PASS  ${name}${note ? "  - " + note : ""}`);
    return true;
  } catch (e) {
    const shot = join(OUT, `FAIL-${name.replace(/\W+/g, "_")}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    results.push({ name, status: "FAIL", ms: Date.now() - t0, error: String(e.message || e).split("\n")[0], screenshot: shot });
    console.log(`FAIL  ${name}  - ${String(e.message || e).split("\n")[0]}`);
    return false;
  }
}

async function login(page, phone) {
  await page.goto(`${WEB}/en/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#phone");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500); // let React hydrate before submitting
  await page.fill("#phone", phone);
  await page.fill("#password", PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login")),
    page.click('button[type="submit"]'),
  ]);
  if (resp.status() !== 200) throw new Error(`login HTTP ${resp.status()}`);
  await page.waitForURL(/dashboard|teacher|super-admin|students|groups/);
}

const exe = findChromium();
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-first-run"],
});
const started = new Date().toISOString();
console.log(`Chromium: ${exe || "(playwright default)"}  target: ${WEB}`);

// ---------------- Warm-up ----------------
// `next dev` compiles each route on first hit. On a 4 GB machine a cold compile can block the
// Node event loop for >8 s, which trips the proxy's 8 s upstream timeout (HTTP 502). Visiting the
// routes once, with generous timeouts, makes the real test deterministic. Not a test result.
{
  const warm = async (phone, pages) => {
    const ctx = await browser.newContext();
    const r = await ctx.request.post(`${WEB}/api/auth/login`, { data: { phone, password: PASSWORD }, timeout: 180000 });
    if (r.status() !== 200) console.log(`warm-up login ${phone} -> HTTP ${r.status()}`);
    for (const p of pages) {
      const t0 = Date.now();
      const resp = await ctx.request.get(`${WEB}${p}`, { timeout: 240000, failOnStatusCode: false }).catch(() => null);
      console.log(`warm  ${p} -> ${resp ? resp.status() : "ERR"} (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
    await ctx.close();
  };
  await warm(STUDENT, ["/en", "/en/login", "/en/dashboard", "/en/mock", "/en/notifications"]);
  await warm(TEACHER, ["/en/dashboard", "/en/mock", "/en/groups", "/en/students", "/en/payments"]);
}

// ---------------- Student session ----------------
const sCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const s = await sCtx.newPage();
await acceptFullscreenNotice(s);
s.setDefaultTimeout(90000);
watch(s, "student");

await step(s, "01-landing-page", async () => {
  const r = await s.goto(`${WEB}/en`, { waitUntil: "domcontentloaded" });
  if (!r || r.status() >= 400) throw new Error(`HTTP ${r && r.status()}`);
  await s.waitForSelector("body");
  const title = await s.title();
  const text = (await s.innerText("body")).trim();
  if (text.length < 50) throw new Error("landing page nearly empty");
  await s.screenshot({ path: join(OUT, "01-landing.png") });
  return `title="${title}"`;
});

await step(s, "02-login-page", async () => {
  await s.goto(`${WEB}/en/login`, { waitUntil: "domcontentloaded" });
  await s.waitForSelector("#phone");
  await s.waitForSelector("#password");
  await s.screenshot({ path: join(OUT, "02-login.png") });
});

await step(s, "03-student-login", async () => {
  await login(s, STUDENT);
  const cookies = (await sCtx.cookies()).map((c) => c.name);
  if (!cookies.includes("bw_at")) throw new Error("session cookie bw_at missing");
  return "httpOnly session cookie set";
});

await step(s, "04-student-dashboard", async () => {
  await s.goto(`${WEB}/en/dashboard`, { waitUntil: "domcontentloaded" });
  await s.getByText("Local Student Two").first().waitFor();
  await s.screenshot({ path: join(OUT, "04-student-dashboard.png") });
});

await step(s, "06-exam-catalogue", async () => {
  await s.goto(`${WEB}/en/mock`, { waitUntil: "domcontentloaded" });
  // The catalogue lists the student's active track only; other local runs may have left it on IELTS.
  const toCefr = s.getByRole("button", { name: /Switch to Multi-Level/i });
  await Promise.race([toCefr.first().waitFor().catch(() => {}), s.getByText("Multi-Level CEFR CBT Mock 1").first().waitFor().catch(() => {})]);
  if (await toCefr.count()) {
    await toCefr.first().click();
    await s.getByText(/Active track: Multi-Level/).first().waitFor();
    await s.reload({ waitUntil: "domcontentloaded" }); // persisted, not just optimistic
  }
  await s.getByText("Multi-Level CEFR CBT Mock 1").first().waitFor();
  await s.screenshot({ path: join(OUT, "06-exam-catalogue.png") });
});

await step(s, "07-practice-exam-start", async () => {
  // Re-runs: a single-section attempt may still be open -> card shows a Resume link (1 skill) or button.
  // Scope to the CBT mock card: other exams (e.g. the Record Mock) may have their own Resume.
  const card = s.locator('[data-testid^="mock-card-"]').filter({ hasText: "Multi-Level CEFR CBT Mock 1" }).first();
  await card.waitFor();
  const resumeLink = card.getByRole("link", { name: /^resume$/i });
  const resumeBtn = card.getByRole("button", { name: /^resume$/i });
  if (await resumeLink.count()) {
    await resumeLink.first().click();
  } else if (await resumeBtn.count()) {
    await resumeBtn.click();
    const d = s.getByRole("dialog");
    await d.waitFor();
    await d.getByRole("button").filter({ hasText: /reading/i }).first().click();
  } else {
    await card.getByRole("button", { name: /^start$/i }).click();
    const d = s.getByRole("dialog");
    await d.waitFor();
    await Promise.all([
      s.waitForResponse((r) => /\/mock\/(exams\/[^/]+\/start|attempts\/start)/.test(r.url()) && r.request().method() === "POST"),
      d.getByRole("button", { name: /Reading Boshlash/ }).click(),
    ]);
  }
  await s.waitForURL(/mock\/attempt\//);
  await s.getByText("Part 1 — Sentence Completion").first().waitFor();
  await s.screenshot({ path: join(OUT, "07-attempt-started.png") });
  return s.url().replace(WEB, "");
});

await step(s, "08-answer-saving", async () => {
  const inputs = s.locator('input[aria-label^="Answer for question"]');
  const n = await inputs.count();
  if (n < 3) throw new Error(`expected >=3 answer inputs, found ${n}`);
  const tag = Date.now().toString(36); // unique each run so a re-run on a resumed attempt still produces a save
  const answers = [`library-${tag}`, `wifi-${tag}`, `textbooks-${tag}`];
  const saveResp = s.waitForResponse((r) => r.url().includes("/answers") && r.request().method() === "POST", { timeout: 30000 });
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(answers[i]);
  const resp = await saveResp;
  if (resp.status() >= 400) throw new Error(`save HTTP ${resp.status()}`);
  await s.getByText("Saved", { exact: true }).first().waitFor();
  await s.waitForFunction(() => /[1-9]\d* \/ \d+ answered/.test(document.body.innerText));
  // reload: server must have persisted the answers
  await s.reload({ waitUntil: "domcontentloaded" });
  await s.getByText("Part 1 — Sentence Completion").first().waitFor();
  await s.waitForFunction(() => /3 \/ \d+ answered|[3-9]\d* \/ \d+ answered/.test(document.body.innerText), null, { timeout: 30000 });
  await s.screenshot({ path: join(OUT, "08-answers-saved.png") });
  return "3 answers saved and still present after reload";
});

await step(s, "09-section-navigation", async () => {
  await s.getByRole("tab", { name: /^Part 2/ }).click();
  await s.getByText("Part 2 — Short Texts Matching").first().waitFor();
  await s.getByRole("tab", { name: /^Part 3/ }).click();
  await s.waitForTimeout(500);
  await s.getByRole("tab", { name: /^Part 1/ }).click();
  await s.screenshot({ path: join(OUT, "09-navigation.png") });
  return "Part 1 -> 2 -> 3 -> 1";
});

await step(s, "10-exam-submission", async () => {
  // The server refuses an unfinished timed hand-in, so fill every Reading question with
  // synthetic placeholder answers through the same authenticated proxy the UI uses.
  const attemptId = new URL(s.url()).pathname.split("/").pop();
  const detail = await (await sCtx.request.get(`${WEB}/api/backend/mock/attempts/${attemptId}`)).json();
  const sec = (detail.data.sections || []).find((x) => x.skill === "reading");
  const qs = (sec.groups || sec.parts).flatMap((g) => g.questions || g.items || []);
  const bulk = await sCtx.request.post(`${WEB}/api/backend/mock/attempts/${attemptId}/answers`, {
    data: { answers: qs.map((q) => ({ questionId: q.id, response: q.type === "short_answer" ? "synthetic" : q.options?.[0]?.id ?? q.options?.[0]?.value ?? q.options?.[0] ?? "A" })) },
  });
  const saved = (await bulk.json()).data?.saved;
  if (bulk.status() >= 400 || saved !== qs.length) throw new Error(`bulk answers HTTP ${bulk.status()} saved=${saved}/${qs.length}`);
  await s.reload({ waitUntil: "domcontentloaded" });
  await s.waitForFunction(() => /35 \/ 35 answered/.test(document.body.innerText), null, { timeout: 60000 });
  await s.getByRole("button", { name: /^Finish$/ }).click();
  const d = s.getByRole("dialog");
  await d.waitFor();
  await s.screenshot({ path: join(OUT, "10-submit-confirm.png") });
  const submitResp = s.waitForResponse((r) => /\/submit/.test(r.url()) && r.request().method() === "POST", { timeout: 60000 });
  await d.getByRole("button", { name: /Submit exam|Ha, yakunlash/ }).click();
  const resp = await submitResp;
  if (resp.status() >= 400) throw new Error(`submit HTTP ${resp.status()}`);
  return `35/35 answered, submit HTTP ${resp.status()}`;
});

await step(s, "11-result-display", async () => {
  await s.waitForFunction(() => /band|score|result|natija|ball|CEFR|correct|to'g'ri|Grading|completed/i.test(document.body.innerText), null, { timeout: 60000 });
  await s.waitForTimeout(2500);
  await s.screenshot({ path: join(OUT, "11-result.png") });
  const text = (await s.innerText("body")).replace(/\s+/g, " ").slice(0, 160);
  return `url=${s.url().replace(WEB, "")} text="${text}"`;
});

await step(s, "12-logout", async () => {
  await s.goto(`${WEB}/en/dashboard`, { waitUntil: "domcontentloaded" });
  await s.getByText("Local Student Two").first().waitFor();
  await s.getByText("Local Student Two").first().click();
  const [resp] = await Promise.all([
    s.waitForResponse((r) => r.url().includes("/api/auth/logout")),
    s.getByRole("menuitem", { name: /log out/i }).click(),
  ]);
  await s.waitForURL(/login/);
  const cookies = (await sCtx.cookies()).map((c) => c.name);
  if (cookies.includes("bw_at")) throw new Error("bw_at cookie still present after logout");
  return `logout HTTP ${resp.status()}, redirected to /login`;
});

// ---------------- Teacher session ----------------
const tCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const t = await tCtx.newPage();
await acceptFullscreenNotice(t);
t.setDefaultTimeout(90000);
watch(t, "teacher");
await step(t, "05-teacher-login-dashboard", async () => {
  await login(t, TEACHER);
  await t.goto(`${WEB}/en/dashboard`, { waitUntil: "domcontentloaded" });
  await t.getByText("Local Teacher").first().waitFor();
  await t.screenshot({ path: join(OUT, "05-teacher-dashboard.png") });
});
await step(t, "05b-teacher-exam-catalogue", async () => {
  await t.goto(`${WEB}/en/mock`, { waitUntil: "domcontentloaded" });
  await t.getByText("Multi-Level CEFR CBT Mock 1").first().waitFor();
  await t.getByRole("link", { name: /manage/i }).first().waitFor();
  await t.screenshot({ path: join(OUT, "05b-teacher-catalogue.png") });
  return "staff sees Manage link";
});
await step(t, "05c-teacher-groups", async () => {
  await t.goto(`${WEB}/en/groups`, { waitUntil: "domcontentloaded" });
  await t.getByText(/^\d+ students$/).first().waitFor(); // group card (the name also sits in a hidden <option>)
  await t.screenshot({ path: join(OUT, "05c-teacher-groups.png") });
});

// ---------------- Access control (negative) ----------------
await step(t, "13-rbac-student-cannot-use-admin-api", async () => {
  const sc = await browser.newContext();
  const p = await sc.newPage();
  const r = await p.request.post(`${WEB}/api/auth/login`, { data: { phone: STUDENT, password: PASSWORD } });
  if (r.status() !== 200) throw new Error(`student API login ${r.status()}`);
  const forbidden = await p.request.get(`${WEB}/api/backend/users`);
  await sc.close();
  if (![401, 403, 404].includes(forbidden.status())) throw new Error(`student got HTTP ${forbidden.status()} on staff endpoint`);
  return `student -> /users = HTTP ${forbidden.status()}`;
});

// ---------------- K1: Record Mock Listening on a scope-less single_skill attempt ----------------
// Live PIN rooms and older attempts have flowMode "single_skill" without a frozen practice scope.
// Before the K1 fix the runner filtered every section away: "Failed to load questions (0 bo'lim)".
await step(t, "14-record-mock-listening-loads-and-persists", async () => {
  const py = process.env.BW_PYTHON || join(here, "..", "..", "backend-django", ".venv",
    process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const attemptId = execFileSync(py, ["manage.py", "seed_local_k1_attempt", "--phone", STUDENT_ONE, "--exam", RECORD_MOCK],
    { cwd: join(here, "..", "..", "backend-django"), encoding: "utf8" }).trim().split(/\s+/).pop();
  if (!/^[0-9a-f-]{36}$/.test(attemptId)) throw new Error(`fixture returned ${attemptId}`);

  const kc = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const k = await kc.newPage();
  await acceptFullscreenNotice(k);
  k.setDefaultTimeout(90000);
  watch(k, "student-k1");
  await login(k, STUDENT_ONE);
  await k.goto(`${WEB}/en/mock/attempt/${attemptId}?skill=listening`, { waitUntil: "domcontentloaded" });
  const answerable = k.locator('input[aria-label^="Answer for question"], input[type="radio"], [role="radio"]');
  await answerable.first().waitFor({ timeout: 120000 });
  const body = await k.innerText("body");
  if (/Failed to load questions|0 bo'lim|\(0\/0\)/.test(body)) throw new Error("runner reports 0 sections");
  await k.screenshot({ path: join(OUT, "14-record-listening.png") });

  const saveResp = k.waitForResponse((r) => /\/answers?$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 30000 });
  const first = answerable.first();
  const tag = `k1-${Date.now().toString(36)}`;
  if ((await first.getAttribute("type")) === "radio" || (await first.getAttribute("role")) === "radio") await first.click();
  else await first.fill(tag);
  const resp = await saveResp;
  if (resp.status() >= 400) throw new Error(`save HTTP ${resp.status()}`);

  await k.reload({ waitUntil: "domcontentloaded" });
  await answerable.first().waitFor({ timeout: 120000 });
  const detail = await (await kc.request.get(`${WEB}/api/backend/mock/attempts/${attemptId}`)).json();
  const listening = (detail.data.sections || []).find((x) => x.skill === "listening");
  if (!listening) throw new Error("attempt detail has no listening section");
  const saved = listening.groups.flatMap((g) => g.questions).filter((q) => q.response != null && String(q.response).trim());
  if (saved.length < 1) throw new Error("answer not persisted after reload");
  await k.screenshot({ path: join(OUT, "14-record-listening-after-reload.png") });
  await kc.close();
  return `attempt ${attemptId}: ${listening.groups.length} listening parts visible, ${saved.length} answer(s) persisted after reload`;
});

await browser.close();

// ---------------- Report ----------------
const appConsole = consoleErrors.filter((c) => !c.thirdParty);
const thirdParty = consoleErrors.filter((c) => c.thirdParty);
const appBad = badResponses.filter((b) => !b.thirdParty);
const nonGet4xx = apiCalls.filter((c) => c.status >= 400);
const summary = {
  startedAt: started,
  target: WEB,
  browser: exe,
  steps: results,
  counts: { pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length },
  appConsoleErrors: appConsole,
  thirdPartyConsoleErrorCount: thirdParty.length,
  failedRequests: failedRequests.filter((f) => !isGoogleNoise(f.url)),
  badResponses: appBad,
  apiCallsWithErrors: nonGet4xx,
  apiCallCount: apiCalls.length,
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(summary, null, 2));
console.log("\n==== SUMMARY ====");
console.log(`PASS ${summary.counts.pass} / FAIL ${summary.counts.fail}`);
console.log(`app console errors: ${appConsole.length}; third-party (Google GSI) console errors: ${thirdParty.length}`);
console.log(`failed requests (non-Google): ${summary.failedRequests.length}; HTTP>=400 (non-Google): ${appBad.length}; API calls observed: ${apiCalls.length}`);
for (const b of appBad) console.log(`  HTTP ${b.status} [${b.label}/${b.step}] ${b.url}`);
for (const c of appConsole.slice(0, 10)) console.log(`  console [${c.label}/${c.step}] ${c.text}`);
console.log(`report: ${join(OUT, "report.json")}`);
process.exit(summary.counts.fail ? 1 : 0);
