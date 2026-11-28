// CBT 2.0 Uzbek pass (second synthetic student): readiness screen, runner header and a handed-in attempt's
// "Xatolarimni ko'rib chiqish" (personal mistake review). Usage: node cbt2-uz.js <theme>
const { browser, api, dismiss, shot, BASE } = require('./lib');
const log = (...a) => console.log(...a);
(async () => {
  const [themeName = 'light'] = process.argv.slice(2);
  const b = await browser();
  // Sign in through the Uzbek login page: the app keeps the locale chosen at sign-in.
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: themeName, deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, themeName);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('#phone', '+998900000011'); await p.fill('#password', 'LocalDev-2026!');
  await p.locator('form button[type="submit"]').first().click();
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 });
  for (const a of ((await api(p, 'GET', '/mock/attempts/mine?limit=50')).body?.data ?? []).filter((x) => x.status === 'in_progress')) await api(p, 'POST', `/mock/attempts/${a.id}/submit`, { confirm: true });
  await p.goto(`${BASE}/mock/ielts-academic-mock-01`, { waitUntil: 'networkidle' });
  await p.locator('button:has-text("Vaqtli (imtihon rejimi)")').last().click();
  const dialog = p.locator('[data-testid="exam-readiness"]');
  await dialog.waitFor({ timeout: 8000 });
  await dialog.locator('button:has-text("Qurilmani tekshirish")').click();
  await p.waitForTimeout(2500);
  log('uzReadiness', (await dialog.innerText()).replace(/\n/g, ' | ').slice(0, 300));
  await shot(p, `readiness-uz-1366-${themeName}`);
  await dialog.locator('[data-testid="readiness-start"]').click();
  await p.waitForURL(/\/mock\/attempt\//, { timeout: 20000 });
  const id = p.url().split('/attempt/')[1].split(/[?#]/)[0];
  await p.waitForTimeout(2500); await dismiss(p);
  await p.locator('[data-compact-answer]').first().click(); await p.keyboard.type('Thompson');
  await p.locator('[data-compact-answer]').nth(1).click(); await p.keyboard.type('wrong answer');
  await p.waitForTimeout(3500);
  log('uzHeader', (await p.locator('[data-runner-header]').innerText()).replace(/\n/g, ' | '));
  await shot(p, `runner-uz-1366-${themeName}`);
  log('submit', JSON.stringify((await api(p, 'POST', `/mock/attempts/${id}/submit`, { confirm: true })).body?.data?.status));
  await p.goto(`${BASE}/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  const mistakes = p.locator('[data-testid="mistake-review"]');
  log('mistakeSummary', await mistakes.innerText().catch(() => 'none'));
  if (await mistakes.isVisible().catch(() => false)) {
    await mistakes.locator('button').click(); await p.waitForTimeout(800);
    log('mistakeFilterPressed', await p.locator('button[aria-pressed="true"]').allInnerTexts());
    await mistakes.scrollIntoViewIfNeeded();
    await shot(p, `mistake-review-uz-1366-${themeName}`);
  }
  await b.close();
})().catch((e) => { console.error('ERR', e.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
