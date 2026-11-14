// BESTWAY local browser check of the exam window tools (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 BW_AUDIO=<short synthetic WAV> node exam-tools.mjs
// Reading: Settings (text size, colours), Help (types of this section), Hide (time keeps running).
// Listening (recordings replaced by the synthetic WAV): an earlier part ends without the
// 2-minute check and the section stays open; the last part starts the 2:00 check.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const EXAM = process.env.BW_IELTS_EXAM || "ielts-academic-mock-01";
const AUDIO = process.env.BW_AUDIO;
if (!AUDIO) { console.error("Set BW_AUDIO to a short synthetic WAV fixture"); process.exit(2); }
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) { console.error(`Refusing non-loopback host: ${WEB}`); process.exit(2); }
const OUT = join(here, "..", "..", ".local", "e2e", "exam-tools");
mkdirSync(OUT, { recursive: true });
const M = Object.fromEntries(["en", "uz"].map((l) => [l, JSON.parse(readFileSync(join(here, "..", "..", "frontend", "messages", `${l}.json`), "utf8")).mock]));
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
const wav = readFileSync(AUDIO);

async function session({ locale, dark, width, height }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((d) => { try { localStorage.setItem("theme", d ? "dark" : "light"); if (!sessionStorage.getItem("bw_e2e_reset")) { localStorage.removeItem("bw_exam_settings"); sessionStorage.setItem("bw_e2e_reset", "1"); } } catch {} }, dark);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", STUDENT); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/); await page.waitForLoadState("networkidle").catch(() => {});
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
  const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(`/api/backend${p}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
  const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  async function fresh(skill) {
    for (let i = 0; i < 4; i++) {
      const data = (await api(`/mock/exams/${EXAM}/start`, json({ mode: "timed", skills: [skill] }))).body?.data;
      if (data?.resumed || data?.isResumed) { await api(`/mock/attempts/${data.attemptId}/submit`, json({ confirm: true, confirmed: true, force: true })); continue; }
      return data?.attemptId;
    }
  }
  async function open(id, skill) {
    // Requests still in flight from the dashboard can set the cookie back; set it right before opening.
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
    await page.goto(`${WEB}${locale === "en" ? "/en" : ""}/mock/attempt/${id}?skill=${skill}`, { waitUntil: "domcontentloaded" });
    const notice = page.getByTestId("fullscreen-notice");
    await notice.waitFor({ timeout: 15000 }).then(() => notice.getByRole("button").click()).catch(() => {});
    await page.getByRole("timer").waitFor({ timeout: 30000 });
  }
  return { ctx, page, errors, api, json, fresh, open };
}

async function tools(name, opts) {
  const { ctx, page, errors, api, json, fresh, open } = await session(opts);
  const T = M[opts.locale].examTools;
  const id = await fresh("reading");
  await open(id, "reading");
  await page.getByRole("button", { name: T.settings }).click();
  await page.getByRole("radio", { name: T.textSize_xlarge }).click();
  await page.getByRole("radio", { name: T.colours_yellow_on_black }).click();
  await page.keyboard.press("Escape");
  const root = page.locator("[data-exam-text-size]");
  ok(await root.getAttribute("data-exam-text-size") === "xlarge", `${name}: text size Extra large applies`);
  ok(/exam-theme-yellow-on-black/.test(await root.getAttribute("class")), `${name}: colours Yellow on black apply to the exam area`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `${name}: ${opts.width}px no horizontal overflow at Extra large (${overflow})`);
  await page.screenshot({ path: join(OUT, `settings-${name}-${opts.locale}-${opts.dark ? "dark" : "light"}-${opts.width}.png`) });
  await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("timer").waitFor({ timeout: 30000 });
  ok(await page.locator("[data-exam-text-size]").getAttribute("data-exam-text-size") === "xlarge", `${name}: settings are remembered on this device`);
  await page.getByRole("button", { name: T.help }).click();
  const help = await page.getByRole("dialog").innerText();
  const types = new Set(((await api(`/mock/attempts/${id}`)).body?.data?.sections ?? []).flatMap((s) => s.groups ?? []).flatMap((g) => g.questions ?? []).map((q) => q.type));
  const expectTfng = types.has("true_false_notgiven");
  ok(help.includes(T.helpNavigationTitle) && help.includes(T.helpTitle_completion) && help.includes(T.helpTitle_true_false_notgiven) === expectTfng,
     `${name}: Help explains exactly this section's question types (${[...types].join(", ")})`);
  ok(!help.includes(T.helpTitle_essay), `${name}: Help does not list types the section does not have`);
  await page.keyboard.press("Escape");
  const before = await page.getByRole("timer").innerText();
  await page.getByRole("button", { name: T.hide }).click();
  const hidden = page.getByTestId("exam-hidden");
  ok(await hidden.isVisible(), `${name}: Hide covers the questions`);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: T.resume }).click();
  const after = await page.getByRole("timer").innerText();
  ok(before !== after, `${name}: the clock kept running while hidden (${before} -> ${after})`);
  ok(errors.length === 0, `${name}: no page errors ${errors.slice(0, 2).join(" | ")}`);
  await api(`/mock/attempts/${id}/submit`, json({ confirm: true, confirmed: true, force: true }));
  await ctx.close();
}

async function listening(name, opts) {
  const { ctx, page, errors, api, json, fresh, open } = await session(opts);
  const T = M[opts.locale].examTools;
  await page.route("**/mock/groups/*/audio*", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: wav }));
  const id = await fresh("listening");
  await open(id, "listening");
  await page.getByRole("button", { name: T.listeningPlayOnce }).first().click();
  await page.getByText(T.listeningNextPart).waitFor({ timeout: 30000 });
  ok(true, `${name}: part 1 ends with "go on to the next part"`);
  ok(!(await page.locator("body").innerText()).includes(T.listeningReview.split(":")[0]), `${name}: no 2-minute check after part 1`);
  await page.waitForTimeout(3000);
  ok((await api(`/mock/attempts/${id}`)).body?.data?.status === "in_progress", `${name}: the section stays open after part 1`);
  const next = page.getByRole("button", { name: new RegExp(`^${M[opts.locale].stepper?.nextPart ?? "Next part"}`) });
  for (let i = 0; i < 6; i++) { if (await next.isVisible().catch(() => false)) await next.click(); else break; await page.waitForTimeout(500); }
  await page.getByRole("button", { name: T.listeningPlayOnce }).first().click();
  await page.getByText(T.listeningReview.replace("{time}", "02:00")).or(page.getByText(T.listeningReview.replace("{time}", "01:59"))).waitFor({ timeout: 30000 });
  ok(true, `${name}: the last part starts the 2:00 check`);
  await page.screenshot({ path: join(OUT, `listening-${name}-${opts.locale}-${opts.dark ? "dark" : "light"}-${opts.width}.png`) });
  ok(errors.length === 0, `${name}: no page errors ${errors.slice(0, 2).join(" | ")}`);
  await api(`/mock/attempts/${id}/submit`, json({ confirm: true, confirmed: true, force: true }));
  await ctx.close();
}

await tools("A", { locale: "en", dark: false, width: 1440, height: 900 });
await tools("B", { locale: "uz", dark: true, width: 390, height: 844 });
await listening("C", { locale: "en", dark: true, width: 1440, height: 900 });
await listening("D", { locale: "uz", dark: false, width: 390, height: 844 });
await browser.close();
const failed = results.filter(([c]) => !c).length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
