// 5.1 stabilization: Uzbek (default-locale, unprefixed) routing on the production startup (`npm start`,
// HOSTNAME=0.0.0.0) — login per role, dashboards, language switch, readiness screen, runner, Result Center,
// logout, open-redirect attempt. Synthetic local accounts only.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3300';
const OUT = process.env.OUT || '/home/user/bestway/docs/screenshots/bestway51-cbt-final';
const log = (...a) => console.log(...a);
const PASS = 'LocalDev-2026!';

async function login(b, phone, next) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const hops = [];
  p.on('response', (r) => { if (r.status() >= 300 && r.status() < 400 && r.request().isNavigationRequest()) hops.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const errors = [];
  p.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
  await p.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`, { waitUntil: 'networkidle' });
  await p.fill('#phone', phone); await p.fill('#password', PASS);
  await p.locator('form button[type="submit"]').first().click();
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 });
  await p.waitForLoadState('networkidle');
  return { ctx, p, hops, errors };
}
const lang = (p) => p.evaluate(() => document.documentElement.lang);
const where = (p) => new URL(p.url()).pathname + new URL(p.url()).search;

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  // Anonymous Uzbek pages.
  const anon = await b.newPage();
  for (const path of ['/', '/login']) {
    const r = await anon.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    log('anon', path, '→', r.status(), where(anon), 'lang', await lang(anon));
  }
  await anon.screenshot({ path: `${OUT}/uz-login-1366-light.png` });

  // Open redirect: an external `next` must not leave the site after sign-in.
  const evil = await login(b, '+998900000010', 'https://evil.example/steal');
  log('openRedirect', 'landed', new URL(evil.p.url()).host, where(evil.p));
  await evil.ctx.close();

  for (const [role, phone] of [['student', '+998900000010'], ['teacher', '+998900000003'], ['admin', '+998900000002']]) {
    const s = await login(b, phone);
    log(role, 'home', where(s.p), 'lang', await lang(s.p), 'hops', JSON.stringify(s.hops.slice(0, 4)), '5xx', JSON.stringify(s.errors));
    await s.p.screenshot({ path: `${OUT}/uz-${role}-home-1366-light.png` });
    if (role === 'student') {
      // Readiness screen and the active runner, in Uzbek.
      for (const a of ((await s.p.evaluate(async () => (await (await fetch('/api/backend/mock/attempts/mine?limit=50')).json()).data)) ?? []).filter((x) => x.status === 'in_progress')) {
        await s.p.evaluate(async (id) => fetch(`/api/backend/mock/attempts/${id}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"confirm":true}' }), a.id);
      }
      await s.p.goto(`${BASE}/mock/ielts-academic-mock-01`, { waitUntil: 'networkidle' });
      log('student mock page', where(s.p), 'lang', await lang(s.p));
      await s.p.locator('button:has-text("Vaqtli (imtihon rejimi)")').last().click();
      const d = s.p.locator('[data-testid="exam-readiness"]');
      await d.waitFor({ timeout: 10000 });
      log('readiness uz', (await d.innerText()).split('\n').slice(0, 6).join(' | '));
      await s.p.screenshot({ path: `${OUT}/uz-readiness-1366-light.png` });
      await d.locator('[data-testid="readiness-start"]').click();
      await s.p.waitForURL(/\/mock\/attempt\//, { timeout: 20000 });
      await s.p.waitForTimeout(3000);
      const notice = s.p.locator('[data-testid="fullscreen-notice"] button').last();
      if (await notice.isVisible().catch(() => false)) await notice.click().catch(() => {});
      log('runner', where(s.p), 'lang', await lang(s.p), 'header', (await s.p.locator('[data-runner-header]').innerText().catch(() => '')).replace(/\n/g, ' | ').slice(0, 160));
      await s.p.screenshot({ path: `${OUT}/uz-runner-1366-light.png` });
      const id = where(s.p).split('/attempt/')[1];
      await s.p.evaluate(async (aid) => fetch(`/api/backend/mock/attempts/${aid}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"confirm":true}' }), id);
      await s.p.goto(`${BASE}/mock/attempt/${id}`, { waitUntil: 'networkidle' });
      log('result page', where(s.p), 'lang', await lang(s.p), (await s.p.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 120));
      // Language switch through the header switcher: English, then back to Uzbek (cookie follows the choice).
      await s.p.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      const pick = async (name) => {
        await s.p.locator('header button:has(svg.lucide-globe)').first().click();
        await s.p.locator(`[role="menuitemcheckbox"]:has-text("${name}")`).click();
        await s.p.waitForTimeout(2500);
      };
      await pick('English');
      log('switch en', where(s.p), 'lang', await lang(s.p), 'cookie', (await s.ctx.cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value);
      await pick("O'zbekcha");
      log('switch uz', where(s.p), 'lang', await lang(s.p), 'cookie', (await s.ctx.cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value);
      // Role guard: a student cannot open the teacher area.
      await s.p.goto(`${BASE}/teacher`, { waitUntil: 'networkidle' });
      log('student→/teacher', where(s.p));
    }
    if (role === 'teacher') {
      const first = { id: process.env.ASSIGNMENT };
      if (first.id) {
        await s.p.goto(`${BASE}/teacher/results/exam/${first.id}`, { waitUntil: 'networkidle' });
        log('result center', where(s.p), 'lang', await lang(s.p), (await s.p.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 140));
        await s.p.screenshot({ path: `${OUT}/uz-result-center-1366-light.png` });
      } else log('result center', 'no exam assignment listed', JSON.stringify(list).slice(0, 120));
    }
    // Logout through the UI, then a protected page must send back to login.
    // Logout from the user menu (last dropdown trigger in the top bar).
    await s.p.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await s.p.locator('header [aria-haspopup="menu"]').last().click();
    await s.p.locator('[role="menuitem"]:has-text("Chiqish")').first().click({ timeout: 5000 }).catch((e) => log(role, 'logout click failed', e.message.slice(0, 60)));
    await s.p.waitForTimeout(2500);
    await s.p.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    log(role, 'after logout /dashboard →', where(s.p));
    await s.ctx.close();
  }
  await b.close();
})().catch((e) => { console.error('ERR', e.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
