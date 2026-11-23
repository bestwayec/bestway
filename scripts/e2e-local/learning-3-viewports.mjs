// BESTWAY Learning 3.0 — layout sweep of the pages this release changed, at 360/390/768/1024/1366/1920,
// light and dark, Uzbek and English (Playwright, Chromium, local production build, synthetic accounts).
//
//   BW_WEB=http://localhost:3300 node learning-3-viewports.mjs
//
// Per page × size × theme × locale: the page renders its key element, has no horizontal page scroll,
// raises no page error, and the <html> carries the requested theme. Screenshots go to .local/e2e/.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT || "+998900000011";
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = join(here, "..", "..", ".local", "e2e", "learning-3-viewports");
mkdirSync(OUT, { recursive: true });
const SIZES = [[360, 780], [390, 844], [768, 1024], [1024, 768], [1366, 900], [1920, 1080]];
const THEMES = ["light", "dark"];
const LOCALES = ["uz", "en"];

const results = [];
const ok = (c, m) => { results.push(!!c); if (!c) console.log("FAIL " + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

async function session(phone) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.fill("#phone", phone); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/, { timeout: 60000 }).catch(() => {});
  const state = await ctx.storageState();
  return { ctx, page, state };
}
async function api(page, method, path, body) {
  const res = await page.request.fetch(`${WEB}/api/backend${path}`, { method, ...(body !== undefined ? { data: body } : {}) });
  return (await res.json().catch(() => ({}))).data;
}

const teacher = await session(TEACHER);
const student = await session(STUDENT);
const stamp = Date.now();
const set = await api(teacher.page, "POST", "/v1/vocabulary/sets", {
  title: `Viewport set ${stamp}`, level: "B1", isPublic: true,
  words: [
    { english: "harbour", uzbek: "port", contextSentence: "The ship stayed in the harbour.", synonyms: ["port"] },
    { english: "voyage", uzbek: "dengiz sayohati", contextSentence: "Their voyage lasted a month." },
    { english: "anchor", uzbek: "langar" },
  ],
});
const deck = await api(teacher.page, "POST", "/v1/quiz-decks/create", {
  title: `Viewport deck ${stamp}`, category: "Vocabulary",
  cards: [{ card_type: "question", points: 10, question_text: "Pick 'quick'.", options: ["quick", "slow"], correct_answer: "quick" }, { card_type: "swap", question_text: "SWAP" }],
});
ok(set?.id && deck?.id, "setup: set and deck created");

const PAGES = [
  { name: "vocab-set", who: student, path: () => `/vocabulary/${set.id}`, ready: '[role="radio"]' },
  { name: "bamboozle", who: student, path: () => "/bamboozle", ready: '[data-testid="bamboozle-1v1"]' },
  { name: "exam-builder", who: teacher, path: () => "/exam-builder", ready: "main" },
  { name: "assign", who: teacher, path: () => "/teacher/assign", ready: "main" },
];

let checked = 0;
for (const pg of PAGES) {
  for (const theme of THEMES) {
    for (const locale of LOCALES) {
      const ctx = await browser.newContext({ storageState: pg.who.state, viewport: { width: 1366, height: 900 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        const label = `${pg.name} ${w}px ${theme} ${locale}`;
        if (w === SIZES[0][0]) {
          await page.goto(`${WEB}/${locale}${pg.path()}`);
          await page.waitForSelector(pg.ready, { timeout: 60000 }).catch(() => ok(false, `${label}: key element rendered`));
          await page.waitForLoadState("networkidle").catch(() => {});
        } else {
          await page.waitForTimeout(250);
        }
        const m = await page.evaluate(() => ({
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          dark: document.documentElement.classList.contains("dark"),
          lang: document.documentElement.lang,
        }));
        ok(m.over <= 1, `${label}: no horizontal page scroll (overflow ${m.over}px)`);
        ok(m.dark === (theme === "dark"), `${label}: theme applied`);
        ok(m.lang.startsWith(locale), `${label}: locale ${m.lang}`);
        if (w === 360 || w === 1920) await page.screenshot({ path: join(OUT, `${pg.name}-${w}-${theme}-${locale}.png`), fullPage: false });
        checked++;
      }
      ok(errors.length === 0, `${pg.name} ${theme} ${locale}: no page errors (${errors.slice(0, 2).join(" | ")})`);
      await ctx.close();
    }
  }
}
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${checked} page/size/theme/locale combinations; ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
