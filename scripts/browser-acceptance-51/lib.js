const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3300';
const OUT = process.env.OUT || '/home/user/bestway/docs/screenshots/bestway51-final';
require('fs').mkdirSync(OUT, { recursive: true });

async function browser() {
  return chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
}

async function session(b, { width = 1366, height = 768, theme = 'light', phone }) {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: theme, permissions: ['microphone'], deviceScaleFactor: 1 });
  await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  // Headless Chromium cannot enter real fullscreen: emulate an accepted request (test harness only).
  await ctx.addInitScript(() => {
    let fs = null;
    Element.prototype.requestFullscreen = function () { fs = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    Object.defineProperty(Document.prototype, 'fullscreenElement', { get() { return fs; }, configurable: true });
    Document.prototype.exitFullscreen = function () { fs = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
  const p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  await p.goto(`${BASE}/en/login`, { waitUntil: 'networkidle' });
  await p.fill('#phone', phone); await p.fill('#password', 'LocalDev-2026!');
  await p.click('button:has-text("Sign in")');
  await p.waitForURL(u => !u.pathname.endsWith('/login'), { timeout: 15000 });
  return { ctx, p };
}

/** Proof that the theme really applied: html class and the computed body background. */
async function theme(p) {
  return p.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), bg: getComputedStyle(document.body).backgroundColor }));
}

async function api(p, method, path, body) {
  return p.evaluate(async ([m, u, b]) => {
    const r = await fetch(`/api/backend${u}`, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }, [method, path, body]);
}

async function dismiss(p) {
  for (let i = 0; i < 4; i++) {
    let acted = false;
    for (const sel of ['[data-testid="exam-session-elsewhere"] button', '[data-testid="fullscreen-notice"] button']) {
      const d = p.locator(sel).last();
      if (await d.isVisible().catch(() => false)) { await d.click({ timeout: 3000 }).catch(() => {}); acted = true; await p.waitForTimeout(700); }
    }
    if (!acted) { await p.waitForTimeout(700); if (i > 0) break; }
  }
}

async function shot(p, name, full = false) { await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); return `${OUT}/${name}.png`; }

module.exports = { BASE, browser, session, theme, api, dismiss, shot };
