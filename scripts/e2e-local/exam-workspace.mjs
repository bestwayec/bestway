// BESTWAY local browser check: highlights, notes and review flags are kept with the attempt.
// Synthetic accounts only (manage.py seed_local_dev + seed_ielts_mock1_academic), loopback only:
//   BW_WEB=http://localhost:3300 node exam-workspace.mjs
// Reading: select text -> highlight + note, flag a question -> reload -> restored; then the
// device cache is cleared (another device) -> restored from the server; a note is deleted
// after confirming and stays deleted after a reload. Runs in en (1440 light) and uz (390 dark).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const EXAM = process.env.BW_IELTS_EXAM || "ielts-academic-mock-01";
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) {
  console.error(`Refusing to run against non-loopback host: ${WEB}`);
  process.exit(2);
}
const OUT = join(here, "..", "..", ".local", "e2e", "exam-workspace");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });

async function run(name, { locale, dark, width, height }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((d) => { try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  await page.fill("#phone", STUDENT); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/);
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
  const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(`/api/backend${p}`, i); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
  let attemptId;
  for (let i = 0; i < 4 && !attemptId; i++) {
    const started = await api(`/mock/exams/${EXAM}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "timed", skills: ["reading"] }) });
    const data = started.body?.data;
    if (data?.resumed || data?.isResumed) await api(`/mock/attempts/${data.attemptId}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, confirmed: true, force: true }) });
    else attemptId = data?.attemptId;
  }
  const url = `${WEB}${locale === "en" ? "/en" : ""}/mock/attempt/${attemptId}?skill=reading`;
  const passage = page.locator(".select-text").first();
  async function open() {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const notice = page.getByTestId("fullscreen-notice");
    await notice.waitFor({ timeout: 15000 }).then(() => notice.getByRole("button").click()).catch(() => {});
    if (width < 700) await page.getByRole("button", { name: /^(Passage|Matn)$/i }).first().click().catch(() => {});
    await passage.waitFor({ timeout: 30000 });
  }
  await open();
  const word = (await passage.innerText()).split(/\s+/).find((w) => /^[A-Za-z]{7,}$/.test(w));
  async function selectWord() {
    await passage.evaluate((el, target) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.textContent.indexOf(target);
        if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + target.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); break; }
      }
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, word);
    await page.getByRole("toolbar").waitFor({ timeout: 5000 });
  }
  const T = locale === "en" ? { hl: "Highlight in yellow (Alt+H)", note: "Add a note", save: "Save", notes: /^Notes \(/, del: "Delete", yes: "Yes, delete", ph: "Write your note…" }
                            : { hl: "Sariq bo'yash (Alt+H)", note: "Eslatma qo'shish", save: "Saqlash", notes: /^Eslatmalar \(/, del: "O'chirish", yes: "Ha, o'chirish", ph: "Eslatma matnini yozing…" };
  await selectWord();
  await page.getByRole("button", { name: T.hl }).click();
  await selectWord();
  await page.getByTitle(T.note).click();
  await page.getByPlaceholder(T.ph).fill(`note ${name}`);
  await page.getByRole("button", { name: T.save, exact: true }).click();
  const flag = page.getByRole("button", { name: /^(Flag question|Savolni belgilash)$/i }).last();
  await flag.click().catch(() => {});
  await page.waitForTimeout(2500);   // one-second debounce + request
  const saved = (await api(`/mock/attempts/${attemptId}`)).body?.data?.annotations ?? [];
  ok(saved.some((i) => i.kind === "marks" && i.highlights?.includes(word)), `${name}: the highlight is saved with the attempt`);
  ok(saved.some((i) => i.kind === "marks" && i.notes?.some((n) => n.text === `note ${name}`)), `${name}: the note is saved with the attempt`);
  ok(saved.some((i) => i.kind === "flag"), `${name}: the review flag is saved with the attempt`);
  await page.screenshot({ path: join(OUT, `marked-${name}-${locale}-${dark ? "dark" : "light"}-${width}.png` ) });

  await open();
  const marked = () => passage.evaluate((el, w) => [...el.querySelectorAll("mark, span")].some((m) => m.textContent === w && getComputedStyle(m).backgroundColor !== "rgba(0, 0, 0, 0)"), word);
  ok(await marked(), `${name}: after a reload the highlight is shown again`);
  ok(await page.getByRole("button", { name: T.notes }).innerText().then((t) => /\(1\)/.test(t)), `${name}: after a reload the note count is 1`);

  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("bestway.cbt_annotations.") || k.startsWith("bw_workspace_")) localStorage.removeItem(k); });
  await open();
  ok(await marked(), `${name}: on a cleared device the highlight comes back from the server`);
  await page.getByRole("button", { name: T.notes }).click();
  const panel = page.getByTestId("exam-notes-panel");
  ok((await panel.innerText()).includes(`note ${name}`), `${name}: on a cleared device the note comes back from the server`);
  await panel.getByRole("button", { name: T.del }).click();
  await panel.getByRole("button", { name: T.yes }).click();
  await page.waitForTimeout(2500);
  await open();
  await page.getByRole("button", { name: T.notes }).click();
  ok(!(await page.getByTestId("exam-notes-panel").innerText()).includes(`note ${name}`), `${name}: a deleted note stays deleted after a reload`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `${name}: ${width}px no horizontal overflow`);
  await page.screenshot({ path: join(OUT, `notes-${name}-${locale}-${dark ? "dark" : "light"}-${width}.png`) });
  ok(errors.length === 0, `${name}: no page errors ${errors.slice(0, 2).join(" | ")}`);
  await api(`/mock/attempts/${attemptId}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, confirmed: true, force: true }) });
  await ctx.close();
}
await run("A", { locale: "en", dark: false, width: 1440, height: 900 });
await run("B", { locale: "uz", dark: true, width: 390, height: 844 });
await browser.close();
const failed = results.filter(([c]) => !c).length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
