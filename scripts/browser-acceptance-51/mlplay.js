const { browser, session, api, dismiss, shot, BASE } = require('./lib');
(async () => {
  const b = await browser(); const { p } = await session(b, { theme: 'dark', phone: process.argv[2] });
  const id = (await api(p, 'POST', '/mock/exams/MOCK-RECORD-01/start', { mode: 'timed', flow: 'full_test' })).body.data.attemptId;
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  await p.locator('button:has-text("Preview this part")').first().click();
  const play = p.locator('button:has-text("Play audio")').first();
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(2000); if (await play.isEnabled().catch(() => false)) break; }
  console.log('playEnabled', await play.isEnabled());
  await play.click(); await p.waitForTimeout(6000);
  console.log('audio', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('audio')].map(a => ({ t: +a.currentTime.toFixed(1), paused: a.paused, d: +(a.duration || 0).toFixed(1) })))));
  console.log('playAgainDisabled', await play.isDisabled().catch(() => 'gone'));
  await shot(p, 'multilevel-listening-playing-1366-dark');
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n')[0]); process.exit(1); });
