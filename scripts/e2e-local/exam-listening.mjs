// BESTWAY local browser check of the timed IELTS Listening schedule (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 BW_PYTHON=... BW_LONG_AUDIO=/tmp/e2e-60s.wav node exam-listening.mjs
// Play gives reading time first; a reload in the middle of the recording resumes it at the point
// the server clock has reached (after a click, as browsers require); the question text can be
// highlighted and the mark comes back after a reload. The seeded parts' recorded lengths are set
// to 40 s for the run and restored afterwards.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const EXAM = process.env.BW_IELTS_EXAM || "ielts-academic-mock-01";
const AUDIO = process.env.BW_LONG_AUDIO || "/tmp/e2e-60s.wav";
const PY = process.env.BW_PYTHON || "python";
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) {
  console.error(`Refusing to run against non-loopback host: ${WEB}`);
  process.exit(2);
}
const OUT = join(here, "..", "..", ".local", "e2e", "exam-listening");
mkdirSync(OUT, { recursive: true });
const M = Object.fromEntries(["en", "uz"].map((l) => [l, JSON.parse(readFileSync(join(here, "..", "..", "frontend", "messages", `${l}.json`), "utf8")).mock]));
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const wav = readFileSync(AUDIO);

function shell(code) {
  return execFileSync(PY, ["manage.py", "shell", "-c", code], { cwd: join(here, "..", "..", "backend-django"), encoding: "utf8" }).trim().split("\n").pop();
}
const lengths = JSON.parse(shell(`import json
from apps.legacy_schema.models import MockQuestionGroup as G
print(json.dumps({g.id: g.audio_duration_sec for g in G.objects.filter(section__exam_id='${EXAM}', section__skill='listening')}))`));
shell(`from apps.legacy_schema.models import MockQuestionGroup as G
G.objects.filter(id__in=${JSON.stringify(Object.keys(lengths))}).update(audio_duration_sec=40)`);

// No --autoplay-policy flag: like a real browser, sound after a reload needs a click.
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });

async function run(name, { locale, width, height, dark }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((d) => { window.confirm = () => true; try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  await page.route("**/mock/groups/*/audio*", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: wav }));
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", STUDENT); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/); await page.waitForLoadState("networkidle").catch(() => {});
  const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(`/api/backend${p}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
  const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let id;
  for (let i = 0; i < 4 && !id; i++) {
    const data = (await api(`/mock/exams/${EXAM}/start`, json({ mode: "timed", skills: ["listening"] }))).body?.data;
    if (data?.resumed || data?.isResumed) { await api(`/mock/attempts/${data.attemptId}/submit`, json({ confirm: true, confirmed: true, force: true })); continue; }
    id = data?.attemptId;
  }
  const open = async () => {
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
    await page.goto(`${WEB}${locale === "en" ? "/en" : ""}/mock/attempt/${id}?skill=listening`, { waitUntil: "domcontentloaded" });
    const notice = page.getByTestId("fullscreen-notice");
    await notice.waitFor({ timeout: 15000 }).then(() => notice.getByRole("button").click()).catch(() => {});
    await page.getByTestId("listening-scheduled").first().waitFor({ timeout: 30000 });
  };
  const T = M[locale].examTools;
  const player = () => page.getByTestId("listening-scheduled").first();
  const audioTime = () => page.evaluate(() => document.querySelector('[data-testid="listening-scheduled"] audio')?.currentTime ?? -1);

  await open();
  await page.locator("button", { hasText: "Part 3" }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  if (width < 700) await page.getByRole("button", { name: /^(Questions|Savollar)/ }).first().click().catch(() => {});
  // Highlight a word of a question's text (Part 3 has full-sentence questions).
  const word = await page.evaluate(() => {
    for (const box of document.querySelectorAll('[id^="q-"]')) {
      if (!box.getClientRects().length) continue;            // only a question that is on screen
      const found = (box.textContent ?? "").split(/\s+/).find((w) => /^[A-Za-z]{6,}$/.test(w));
      if (found) { box.scrollIntoView({ block: "center" }); return found; }
    }
    return null;
  });
  if (word) {
    await page.evaluate((target) => {
      for (const box of document.querySelectorAll('[id^="q-"]')) {
        if (!box.getClientRects().length) continue;
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = n.textContent.indexOf(target);
          if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + target.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); n.parentElement.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return; }
        }
      }
    }, word);
    const hl = locale === "en" ? "Highlight in yellow (Alt+H)" : "Sariq bo'yash (Alt+H)";
    await page.getByRole("button", { name: hl }).click({ timeout: 5000 }).catch(async (e) => { if (process.env.BW_DEBUG) { console.log("HL-FAIL", String(e).split("\n").slice(0, 12).join(" | ")); await page.screenshot({ path: join(OUT, `hl-debug-${name}.png`) }); } });
  }
  ok(Boolean(word), `${name}: a question's text is selectable for highlighting (${word})`);
  await page.locator("button", { hasText: "Part 1" }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  if (width < 700) await page.getByRole("button", { name: /^(Questions|Savollar)/ }).first().click().catch(() => {});
  await player().getByRole("button", { name: T.listeningPlayOnce }).click();
  await player().getByText(T.listeningReading.replace("{time}", "")).first().waitFor({ timeout: 10000 }).catch(() => {});
  const readingText = await player().getByRole("status").first().innerText();
  ok(/0?0:(2\d|30)/.test(readingText), `${name}: Play first gives time to read the questions ("${readingText}")`);
  const schedule = (await api(`/mock/attempts/${id}`)).body?.data?.listeningSchedule ?? {};
  ok(Object.values(schedule).some((s) => s.readingSeconds === 30), `${name}: the start is recorded on the server with the reading time`);
  await page.waitForTimeout(31_000);
  const playingAt = await audioTime();
  ok(playingAt >= 0 && playingAt < 3, `${name}: after the reading time the recording plays from its start (${playingAt.toFixed(1)} s)`);
  await page.waitForTimeout(8_000);


  // Reload in the middle of the recording.
  await open();
  // Browsers that need a click before sound show "Continue listening"; others continue by themselves.
  const resume = player().getByRole("button", { name: T.listeningResume });
  await Promise.race([resume.waitFor({ timeout: 10000 }), page.waitForFunction(() => { const a = document.querySelector('[data-testid="listening-scheduled"] audio'); return a && !a.paused; }, null, { timeout: 10000 })]).catch(() => {});
  if (await resume.isVisible().catch(() => false)) {
    ok((await player().innerText()).includes(T.listeningInterrupted), `${name}: after a reload the player says the recording was interrupted and offers "${T.listeningResume}"`);
    await resume.click();
  } else {
    ok(true, `${name}: after a reload the browser continued the recording by itself`);
  }
  await page.screenshot({ path: join(OUT, `resume-${name}-${locale}-${dark ? "dark" : "light"}-${width}.png`) });
  await page.waitForTimeout(500);
  const resumedAt = await audioTime();
  const readingEnds = Math.min(...Object.values(schedule).map((item) => Date.parse(item.readingEndsAt)));
  const expected = (Date.now() - readingEnds) / 1000;   // position on the server clock (same machine)
  ok(resumedAt > 5 && Math.abs(resumedAt - expected) < 4, `${name}: after the reload the recording continues at the server clock (${resumedAt.toFixed(1)} s, expected ≈ ${expected.toFixed(1)} s), not from the start`);
  await page.locator("button", { hasText: "Part 3" }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  if (width < 700) await page.getByRole("button", { name: /^(Questions|Savollar)/ }).first().click().catch(() => {});
  const marked = word ? await page.evaluate((w) => [...document.querySelectorAll('[id^="q-"] mark, [id^="q-"] span')].some((m) => m.textContent === w && getComputedStyle(m).backgroundColor !== "rgba(0, 0, 0, 0)"), word) : false;
  ok(marked, `${name}: the highlight on the question text is shown again after the reload`);
  ok(errors.length === 0, `${name}: no page errors ${errors.slice(0, 2).join(" | ")}`);
  await api(`/mock/attempts/${id}/submit`, json({ confirm: true, confirmed: true, force: true }));
  await ctx.close();
}

try {
  if (!process.env.BW_ONLY_B) await run("A", { locale: "en", width: 1440, height: 900, dark: false });
  await run("B", { locale: "uz", width: 390, height: 844, dark: true });
} finally {
  shell(`from apps.legacy_schema.models import MockQuestionGroup as G
for gid, sec in ${JSON.stringify(lengths).replace(/null/g, "None")}.items():
    G.objects.filter(id=gid).update(audio_duration_sec=sec)`);
  await browser.close();
}
const failed = results.filter(([pass]) => !pass);
console.log(`${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
