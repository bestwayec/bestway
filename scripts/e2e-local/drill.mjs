// BESTWAY local browser check of the weak-points targeted drill (Playwright, real Chromium).
// Synthetic accounts only (manage.py seed_local_dev), loopback only. Student on /profile and
// admin on /students/<id>, each in two viewport / theme / language combinations:
//   BW_WEB=http://localhost:3300 BW_API=http://127.0.0.1:8100/v1 node drill.mjs
// Checks: the drill start response carries no answer key or explanation, the key arrives only
// with the answer check, the result shows exactly the points the server added (none for staff).
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const API = process.env.BW_API || "http://127.0.0.1:8100/v1";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!"; // synthetic local-only password (seed_local_dev.py)
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const ADMIN = process.env.BW_ADMIN || "+998900000002";
for (const url of [WEB, API]) {
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname)) {
    console.error(`Refusing to run against non-loopback host: ${url}`);
    process.exit(2);
  }
}
const messages = (locale) => JSON.parse(readFileSync(join(here, "..", "..", "frontend", "messages", `${locale}.json`), "utf8"));
const M = { en: messages("en"), uz: messages("uz") };
const OUT = join(here, "..", "..", ".local", "e2e", "drill");
mkdirSync(OUT, { recursive: true });
const results = []; const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
const apiLogin = async (phone) => { const d = (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: PASSWORD }) })).json()).data; return { token: d.accessToken, id: d.user.id }; };
const pts = async (s) => (await (await fetch(`${API}/points/${s.id}`, { headers: { authorization: `Bearer ${s.token}` } })).json()).data.current;

async function run(name, { phone, role, locale, dark, width, height, path, expectPoints }) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
  const c = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await c.addInitScript((d) => { try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  const p = await c.newPage(); const errors = []; const startBodies = [];
  p.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  p.on("response", async (r) => {
    if (r.status() >= 400 && r.url().includes("/api/") && !/google/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`);
    if (/targeted-practice\?/.test(r.url())) startBodies.push(await r.text().catch(() => ""));
  });
  await p.goto(`${WEB}/en/login`); await p.waitForSelector("#phone"); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(1500);
  await p.fill("#phone", phone); await p.fill("#password", PASSWORD);
  await Promise.all([p.waitForResponse((r) => r.url().includes("/api/auth/login")), p.click('button[type="submit"]')]);
  await p.waitForURL(/dashboard|teacher|students|groups/);
  await c.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
  const student = await apiLogin(STUDENT);
  const before = await pts(student);
  await p.goto(`${WEB}${locale === "en" ? "/en" : ""}${path.replace(":id", student.id)}`, { waitUntil: "domcontentloaded" });
  const T = M[locale];
  const launch = p.getByRole("button", { name: T.insights?.workOnMistakes ?? "x" }).first();
  await launch.waitFor({ timeout: 30000 }); await launch.click();
  const dialog = p.getByRole("dialog");
  await dialog.getByRole("button", { name: "Tekshirish" }).waitFor({ timeout: 20000 });
  ok(startBodies.length > 0 && startBodies.every((b) => !/correctAnswer|explanation/.test(b)), `${name}: drill start response carries no key or explanation`);
  if (name === "A") { await p.screenshot({ path: `${OUT}/drill-${name}-question-${locale}-${dark ? "dark" : "light"}-${width}.png` }); }
  for (let i = 0; i < 10; i++) {
    await dialog.locator("div.space-y-2\\.5 > button").first().click();
    const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes("targeted-practice/answer")), dialog.getByRole("button", { name: "Tekshirish" }).click()]);
    const body = (await resp.json()); const data = body.data ?? body;
    if (i === 0) {
      ok(typeof data.correctAnswer === "string" && data.explanation, `${name}: key and explanation arrive only with the answer check`);
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${OUT}/drill-${name}-checked-${locale}-${dark ? "dark" : "light"}-${width}.png` });
    }
    await dialog.getByRole("button", { name: i < 9 ? "Keyingi Savol" : "Natijani Ko'rish" }).click();
  }
  await dialog.getByText("Aniqlik").waitFor({ timeout: 15000 }); await p.waitForTimeout(1200);
  const text = await dialog.innerText();
  const after = await pts(student);
  if (expectPoints) {
    ok(/\+\d+ XP/.test(text) && after - before > 0 && text.includes(`+${after - before} XP`), `${name}: shows exactly the points the server added (+${after - before})`);
  } else {
    ok(!/\+\d+ XP/.test(text) && after === before, `${name}: ${role} run shows and adds no points (${before} -> ${after})`);
  }
  ok(/\d+%/.test(text), `${name}: accuracy comes back from the server`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `${name}: ${width}px no horizontal overflow`);
  await p.screenshot({ path: `${OUT}/drill-${name}-result-${locale}-${dark ? "dark" : "light"}-${width}.png` });
  ok(errors.length === 0, `${name}: no page or API errors ${errors.slice(0, 2).join(" | ")}`);
  await browser.close();
}
(async () => {
  await run("A", { phone: STUDENT, role: "student", locale: "uz", dark: true, width: 390, height: 844, path: "/profile", expectPoints: true });
  await run("B", { phone: STUDENT, role: "student", locale: "en", dark: false, width: 1440, height: 900, path: "/profile", expectPoints: true });
  await run("C", { phone: ADMIN, role: "admin", locale: "en", dark: true, width: 1440, height: 900, path: "/students/:id", expectPoints: false });
  await run("D", { phone: ADMIN, role: "admin", locale: "uz", dark: false, width: 390, height: 844, path: "/students/:id", expectPoints: false });
  const failed = results.filter(([c]) => !c).length; console.log(`${results.length - failed}/${results.length} PASS`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 600)); process.exit(1); });
