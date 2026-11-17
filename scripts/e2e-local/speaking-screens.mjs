// BESTWAY local screenshots of the Multilevel Speaking screen: ready (microphone tested), preparation
// and recording. Chromium's fake microphone plays a synthetic tone, so the input level is real input,
// never a person. Uses the synthetic Multilevel exam that multilevel-full.mjs builds; loopback only.
//   BW_WEB=http://localhost:3300 BW_CHROMIUM=... node speaking-screens.mjs OUT_DIR
// Prints per size/theme which Speaking elements are present (ring timer, level bars, read-aloud).
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = process.argv[2] || join(here, "..", "..", ".local", "e2e", "speaking");
mkdirSync(OUT, { recursive: true });
const state = JSON.parse(readFileSync(join(here, "..", "..", ".local", "e2e", "multilevel-full.json"), "utf8"));
const STUDENT = process.env.BW_STUDENT || "+998900000010";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const VIEWPORTS = [[1366, 768], [390, 844], [360, 640]];

const browser = await chromium.launch({
  ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
for (const theme of ["light", "dark"]) for (const [width, height] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript((t) => { try { sessionStorage.setItem("bw_fullscreen_notice_seen", "1"); localStorage.setItem("theme", t); } catch { /* ignore */ } }, theme);
  await page.goto(`${WEB}/en/login`);
  await page.locator('input[type="tel"], input[name="phone"]').first().fill(STUDENT);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
  const api = async (method, path, body) => {
    const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, ...(body ? { data: body } : {}) });
    return (await res.json().catch(() => ({}))).data;
  };
  const mine = await api("GET", "/mock/attempts/mine");
  for (const a of (Array.isArray(mine) ? mine : mine?.items ?? []).filter((x) => x.examId === state.examId && x.status === "in_progress"))
    await api("POST", `/mock/attempts/${a.id}/submit`, { confirm: true, confirmed: true, force: true });
  const started = await api("POST", `/mock/exams/${state.examId}/start`, { mode: "practice", flow: "single_skill", skills: ["speaking"] });
  await page.goto(`${WEB}/en/mock/attempt/${started.attemptId}`, { waitUntil: "networkidle" });
  for (const id of ["exam-session-elsewhere", "fullscreen-notice"]) {
    const dialog = page.getByTestId(id);
    if (await dialog.count()) await dialog.getByRole("button").first().click({ timeout: 3000 }).catch(() => {});
  }
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  const micCheck = page.getByRole("button", { name: "Start the test (5 seconds)" });
  if (await micCheck.count()) { await micCheck.click(); await page.getByRole("button", { name: /I can hear it/ }).click({ timeout: 20000 }); }
  const recorder = page.locator("div").filter({ has: page.getByRole("button", { name: "Test microphone" }) }).last();
  await page.getByRole("button", { name: "Test microphone" }).first().click();
  await page.locator("meter").first().waitFor();
  await page.waitForTimeout(600);
  await recorder.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: join(OUT, `speaking-ready-${width}x${height}-${theme}.png`) });
  const readAloud = await page.getByTestId("read-prompt").count();
  await page.getByRole("button", { name: "Start response" }).first().click();
  await page.waitForTimeout(1500);
  const prepRing = await page.getByTestId("countdown-ring").count();
  await page.screenshot({ path: join(OUT, `speaking-preparation-${width}x${height}-${theme}.png`) });
  // Recording starts when the server's preparation window ends.
  await page.getByText("Recording", { exact: true }).first().waitFor({ timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const bars = page.getByTestId("input-level-bars");
  const barHeights = (await bars.count()) ? await bars.locator("span").evaluateAll((spans) => spans.map((s) => s.style.height)) : [];
  await page.screenshot({ path: join(OUT, `speaking-recording-${width}x${height}-${theme}.png`) });
  const recRing = await page.getByTestId("countdown-ring").count();
  console.log(`${theme} ${width}x${height}: read-aloud ${readAloud ? "yes" : "no"}; preparation ring ${prepRing ? "yes" : "no"}; recording ring ${recRing ? "yes" : "no"}; level bars ${barHeights.length ? barHeights.join(" ") : "none"}`);
  await api("POST", `/mock/attempts/${started.attemptId}/submit`, { confirm: true, confirmed: true, force: true });
  await ctx.close();
}
await browser.close();
