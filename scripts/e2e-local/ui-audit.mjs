// BESTWAY UI colour audit (real Chromium). Local synthetic accounts, loopback only.
//   node ui-audit.mjs <phase>      e.g. "before" / "after"
// For each page: screenshot + WCAG contrast of every visible text node against its effective
// background (translucent layers are composited; gradient/image backgrounds are skipped).
// Also records which colour families the page actually renders (lime brand vs emerald vs blue-grey).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const phase = process.argv[2] || "run";
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", ".local", "ui", phase);
mkdirSync(OUT, { recursive: true });
const WEB = process.env.BW_WEB || "http://127.0.0.1:3300";
if (!["127.0.0.1", "localhost"].includes(new URL(WEB).hostname)) { console.error("loopback only"); process.exit(2); }
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";

function findChromium() {
  const root = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.split("-")[1] - a.split("-")[1]) : [];
  for (const d of dirs) { const e = join(root, d, "chrome-win64", "chrome.exe"); if (existsSync(e)) return e; }
}

// Runs inside the page.
function analyse() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const parse = (css) => {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; // premultiplied for a<255 -> un-premultiply
    return a === 0 ? [0, 0, 0, 0] : [Math.min(255, Math.round((r * 255) / a)), Math.min(255, Math.round((g * 255) / a)), Math.min(255, Math.round((b * 255) / a)), a / 255];
  };
  const over = (top, bottom) => { const a = top[3] + bottom[3] * (1 - top[3]); if (!a) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a); };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const effectiveBg = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null; // gradient/image: cannot resolve reliably
      const c = parse(cs.backgroundColor);
      if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
    }
    let base = [11, 13, 8, 1]; // page background fallback (--bg)
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const fails = new Map(); let checked = 0, skipped = 0;
  const families = { lime: 0, emerald: 0, slate: 0, navy: 0 };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let t; (t = walker.nextNode()); ) {
    const text = t.nodeValue.trim(); const el = t.parentElement;
    if (!text || !el || seen.has(el)) continue; seen.add(el);
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0 || r.width < 2 || r.height < 2) continue;
    const bg = effectiveBg(el); if (!bg) { skipped++; continue; }
    let fg = parse(cs.color); fg = over([fg[0], fg[1], fg[2], fg[3] * (+cs.opacity || 1)], bg);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5; const cr = ratio(fg, bg); checked++;
    if (cr < need) {
      const key = `${hex(fg)} on ${hex(bg)}`;
      const e = fails.get(key) || { key, ratio: +cr.toFixed(2), need, count: 0, sample: text.slice(0, 40), cls: String(el.className || "").toString().slice(0, 90), tag: el.tagName.toLowerCase() };
      e.count++; fails.set(key, e);
    }
    const f = hex(fg) + hex(bg);
    if (/#(8[0-9a-f]|9[0-9a-f])f[0-9a-f]3[0-9a-f]/i.test(f)) families.lime++;
  }
  // colour-family census over every element's computed colours
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    for (const prop of ["color", "backgroundColor", "borderTopColor"]) {
      const c = parse(cs[prop]); if (c[3] < 0.5) continue; const [r, g, b] = c;
      const h = hex(c).toLowerCase();
      if (Math.abs(r - 0x89) < 40 && g > 200 && b < 110) families.lime++;
      else if (g > r + 40 && b > 80 && b < 190 && r < 60) families.emerald++;           // #10b981 / #34d399 family
      else if (b > r + 18 && b > g + 6 && Math.max(r, g, b) < 140 && Math.max(r, g, b) > 14) families.slate++; // cool blue-grey (slate/navy)
      if (h === "#0b0f17" || h === "#111827" || h === "#0f172a") families.navy++;
    }
  }
  return { checked, skipped, fails: [...fails.values()].sort((a, b) => b.count - a.count).slice(0, 25), families };
}

const exe = findChromium();
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-first-run"] });
const results = [];

async function audit(ctx, name, path, { wait = 4000, action } = {}) {
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  try {
    await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(wait);
    if (action) await action(page);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    const r = await page.evaluate(analyse);
    const total = r.fails.reduce((s, f) => s + f.count, 0);
    results.push({ name, path, ...r, failCount: total });
    console.log(`${name.padEnd(22)} checked ${String(r.checked).padStart(4)}  contrast-fails ${String(total).padStart(3)}  lime ${r.families.lime} emerald ${r.families.emerald} blue-grey ${r.families.slate} navy-literals ${r.families.navy}`);
  } catch (e) { console.log(`${name.padEnd(22)} ERROR ${String(e.message).split("\n")[0]}`); results.push({ name, path, error: String(e.message).split("\n")[0] }); }
  await page.close();
}

async function login(phone) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await ctx.request.post(`${WEB}/api/auth/login`, { data: { phone, password: PASSWORD }, timeout: 120000 });
  if (r.status() !== 200) throw new Error(`login ${phone} -> ${r.status()}`);
  return ctx;
}

// public
const pub = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await audit(pub, "landing", "/en", { wait: 6000 });
await audit(pub, "login", "/en/login");
await audit(pub, "register", "/en/register");
await pub.close();
// student
const st = await login("+998900000010");
for (const [n, p] of [["dashboard", "/en/dashboard"], ["mock-catalogue", "/en/mock"], ["leaderboard", "/en/leaderboard"], ["vocabulary", "/en/vocabulary"], ["profile", "/en/profile"], ["exam-track", "/en/exam-track"], ["videos", "/en/videos"]]) await audit(st, n, p, { wait: 5000 });
await audit(st, "exam-attempt", "/en/mock/attempt/52506c73-485e-4589-ba7b-46f03c40d659?skill=reading", { wait: 8000 });
await audit(st, "exam-dialog", "/en/mock", { wait: 5000, action: async (p) => { await p.getByRole("button", { name: /resume/i }).first().click().catch(() => {}); await p.waitForTimeout(800); } });
await st.close();
// teacher
const te = await login("+998900000003");
for (const [n, p] of [["t-groups", "/en/groups"], ["t-students", "/en/students"], ["t-payments", "/en/payments"], ["t-attendance", "/en/attendance"], ["t-exam-builder", "/en/exam-builder"]]) await audit(te, n, p, { wait: 5000 });
await te.close();
await browser.close();

const ok = results.filter((r) => !r.error);
const sum = (k) => ok.reduce((s, r) => s + (r[k] || 0), 0);
const fam = (k) => ok.reduce((s, r) => s + r.families[k], 0);
const summary = { phase, pages: ok.length, errors: results.length - ok.length, textChecked: sum("checked"), contrastFails: sum("failCount"), families: { lime: fam("lime"), emerald: fam("emerald"), blueGrey: fam("slate"), navyLiterals: fam("navy") } };
writeFileSync(join(OUT, "audit.json"), JSON.stringify({ summary, results }, null, 2));
console.log("\nSUMMARY", JSON.stringify(summary));
