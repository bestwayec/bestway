// BESTWAY local browser check of the Mock 27 Listening-audio interface (Playwright, real Chromium, real backend).
// Synthetic local accounts only (seed_local_dev + import_mock27), loopback only. No exam audio is created:
// the fixture files below are tiny test tones used only to exercise the validator, never imported as exam content.
//   BW_WEB=http://localhost:3300 BW_AUDIO_DIR=/tmp/m27_audio node mock27-audio.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const ADMIN = process.env.BW_ADMIN || "+998900000002";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const EXAM = process.env.BW_MOCK27 || "bestway-ielts-academic-full-mock-27";
const AUDIO = process.env.BW_AUDIO_DIR || "/tmp/m27_audio";
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(WEB).hostname)) { console.error(`Refusing non-loopback host: ${WEB}`); process.exit(2); }
const OUT = join(here, "..", "..", ".local", "e2e", "mock27");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push(!!c); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
const errors = [];

async function login(phone, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {});
  await page.fill("#phone", phone); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard|exam|mock/, { timeout: 60000 }).catch(() => {});
  return { ctx, page };
}
async function openListening(page) {
  await page.goto(`${WEB}/en/exam-builder/${EXAM}`, { waitUntil: "domcontentloaded" });
  const narrow = (page.viewportSize()?.width ?? 1440) < 768;
  if (narrow) {  // phones use a section <select> instead of the outline
    const select = page.locator("select").filter({ has: page.locator("option", { hasText: /Listening/ }) }).first();
    await select.waitFor({ timeout: 60000 });
    await select.selectOption({ label: (await select.locator("option", { hasText: /^Listening/ }).first().innerText()).trim() });
  } else {
    await page.getByRole("button", { name: /^Listening\b/ }).first().click({ timeout: 60000 });
  }
  await page.getByLabel("Listening audio status").waitFor({ timeout: 30000 });
}
const row = (page, n) => page.getByTestId(`audio-part-${n}`);
const status = async (page, n) => (await row(page, n).getByTestId("audio-status").innerText()).trim();
const setFile = async (page, n, name) => { await page.getByLabel(new RegExp(`Upload audio ${n}`)).setInputFiles(join(AUDIO, name)); };
const toast = (page, re) => page.getByText(re).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);

// --- administrator ---
const { ctx: actx, page } = await login(ADMIN);
await openListening(page);
ok([await status(page, 1), await status(page, 2), await status(page, 3), await status(page, 4)].join() === "MISSING,MISSING,MISSING,MISSING", "all four parts show MISSING");
ok(await page.getByText(/stays in DRAFT/).isVisible(), "the DRAFT notice is shown");
ok(await page.getByLabel("Content rights").getByText("unverified").isVisible(), "content rights show unverified");
ok(await page.getByText("Blocking publication").isVisible(), "publication blockers are listed");
await page.screenshot({ path: join(OUT, "1-all-missing-1440.png") });

await setFile(page, 1, "fake.mp3");
ok(await toast(page, /not a valid MP3|content is not/i), "a renamed non-audio file is rejected with a clear message");
await setFile(page, 1, "clip.wav");
ok(await toast(page, /Only MP3 or M4A/i), "a WAV file is refused client-side");
ok(await status(page, 1) === "MISSING", "rejected files leave the part MISSING");

await setFile(page, 1, "part1.mp3");
ok(await toast(page, /uploaded/i), "a valid MP3 uploads");
await page.waitForFunction(() => document.querySelector('[data-testid="audio-part-1"] [data-testid="audio-status"]')?.textContent?.includes("UPLOADED"), null, { timeout: 20000 });
ok(await status(page, 1) === "UPLOADED", "Part 1 -> UPLOADED");
await setFile(page, 2, "part2.m4a");
await page.waitForFunction(() => document.querySelector('[data-testid="audio-part-2"] [data-testid="audio-status"]')?.textContent?.includes("UPLOADED"), null, { timeout: 20000 });
ok(await status(page, 2) === "UPLOADED", "Part 2 (M4A) -> UPLOADED");
ok(await row(page, 1).locator("audio").count() === 1, "the stored recording has a player");
await page.screenshot({ path: join(OUT, "2-uploaded-1440.png") });

// playback really works (metadata loads from the secure stream)
const duration = await row(page, 1).locator("audio").evaluate((a) => new Promise((res) => { a.preload = "metadata"; a.addEventListener("loadedmetadata", () => res(a.duration)); a.addEventListener("error", () => res(-1)); a.load(); setTimeout(() => res(-2), 15000); }));
ok(duration > 80 && duration < 100, `staff playback streams the recording (duration ${Math.round(duration)}s)`);

// verification dialog
await row(page, 1).getByRole("button", { name: "Verify" }).click();
const dialog = page.getByRole("dialog");
await dialog.waitFor();
const confirm = dialog.getByRole("button", { name: "Confirm verification" });
ok(await confirm.isDisabled(), "verification cannot be confirmed before attesting");
await page.screenshot({ path: join(OUT, "3-verify-dialog-1440.png") });
await dialog.getByRole("button", { name: /Tick all/ }).click();
ok(await confirm.isDisabled(), "ticking every question is not enough without the full-listen attestation");
await dialog.getByLabel("I listened to the whole recording").check();
ok(await confirm.isEnabled(), "confirm is enabled only with every question ticked and the attestation");
await confirm.click();
await page.waitForFunction(() => document.querySelector('[data-testid="audio-part-1"] [data-testid="audio-status"]')?.textContent?.includes("VERIFIED"), null, { timeout: 20000 });
ok(await status(page, 1) === "VERIFIED", "Part 1 -> VERIFIED");

// safe replacement resets the verification
await setFile(page, 1, "part1-v2.mp3");
await page.waitForFunction(() => document.querySelector('[data-testid="audio-part-1"] [data-testid="audio-status"]')?.textContent?.includes("UPLOADED"), null, { timeout: 20000 });
ok(await status(page, 1) === "UPLOADED", "replacing the recording resets VERIFIED -> UPLOADED");
ok(/r2/.test(await row(page, 1).innerText()), "the revision number increments");
ok(await page.getByText(/1\/4 verified|0\/4 verified/).first().isVisible(), "the header summary reflects verified parts");

// Publish button must not publish
await page.getByRole("button", { name: /^Publish$/ }).first().click().catch(() => {});
await page.waitForTimeout(2500);
const draft = await page.evaluate(async (id) => (await (await fetch(`/api/backend/mock/exams/${id}`)).json()).data?.isPublished, EXAM);
ok(draft === false, "clicking Publish leaves the exam a draft while gates fail");
await page.screenshot({ path: join(OUT, "4-after-publish-attempt-1440.png") });

// responsive layouts
for (const [w, h] of [[390, 844], [1024, 768], [1366, 768], [1920, 1080]]) {
  await page.setViewportSize({ width: w, height: h });
  await openListening(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal page scroll at ${w}px (overflow ${overflow}px)`);
  await page.getByLabel("Listening audio status").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, `5-panel-${w}.png`) });
}
await actx.close();

// --- teacher (not the owner of this exam, so no access; and teachers can never verify) ---
const { ctx: tctx, page: tp } = await login(TEACHER);
const t = await tp.evaluate(async (id) => { const r = await fetch(`/api/backend/mock/exams/${id}/listening-audio`); return r.status; }, EXAM);
ok(t === 403, `a teacher who does not own the exam gets 403 on the audio status (${t})`);
const v = await tp.evaluate(async () => { const r = await fetch(`/api/backend/mock/groups/x/listening-audio/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return r.status; });
ok(v === 403, `a teacher cannot call verify (${v})`);
await tctx.close();

ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
