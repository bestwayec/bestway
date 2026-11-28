const { browser, session, api, dismiss, shot, theme, BASE } = require('./lib');
const log = (...a) => console.log(...a);
async function next(p) {
  await p.locator('[data-runner-header] button:has-text("Next section")').click(); await p.waitForTimeout(800);
  const dlg = p.locator('[role="dialog"]').last();
  log('dialog', (await dlg.innerText().catch(() => '')).replace(/\n/g, ' | ').slice(0, 160));
  await dlg.locator('button').filter({ hasText: /Yes|next section|Continue anyway|Move on/i }).last().click({ timeout: 5000 });
  await p.waitForTimeout(1500);
  const go = p.locator('button', { hasText: /^Start .* now/ }).first(); if (await go.isVisible().catch(() => false)) await go.click();
  await p.waitForTimeout(2000); await dismiss(p);
}
(async () => {
  const [themeName, phone] = process.argv.slice(2);
  const b = await browser(); const { p } = await session(b, { theme: themeName, phone });
  const st = await api(p, 'POST', '/mock/exams/MOCK-RECORD-01/start', { mode: 'timed', flow: 'full_test' });
  log('start', st.status, st.body.data && st.body.data.durationMinutes, JSON.stringify(st.body.data && st.body.data.sectionDeadlines));
  const id = st.body.data.attemptId; require('fs').writeFileSync('./ml.txt', id);
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  log('theme', JSON.stringify(await theme(p)));
  log('header', (await p.locator('[data-runner-header]').innerText()).replace(/\n/g, ' | ').slice(0, 200));
  log('rows', await p.locator('[data-compact-question]').count(), 'radios', await p.locator('input[type=radio]').count(), 'gapped', await p.locator('[data-compact-answer], .gapped-content input').count());
  await shot(p, `multilevel-listening-1366-${themeName}`);
  const play = p.locator('button').filter({ hasText: /Play|Prepare|Start listening|Begin/i }).first();
  log('playBtn', await play.innerText().catch(() => 'none'));
  await play.click().catch(() => {}); await p.waitForTimeout(25000);
  log('audio', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('audio')].map(a => ({ t: +a.currentTime.toFixed(1), paused: a.paused, d: +(a.duration || 0).toFixed(1) })))));
  const radio = p.locator('input[type=radio]').first(); if (await radio.count()) await radio.check().catch(() => {});
  await p.waitForTimeout(2500);
  for (const s of ['reading', 'writing', 'speaking']) {
    await next(p);
    log('now', s, (await p.locator('[data-runner-header]').innerText()).replace(/\n/g, ' | ').slice(0, 160));
    await shot(p, `multilevel-${s}-1366-${themeName}`);
    if (s === 'writing') { await p.locator('textarea').first().click(); await p.keyboard.type('Dear manager, I am writing to complain about the gym schedule. ', { delay: 4 }); await p.waitForTimeout(2500); }
  }
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
