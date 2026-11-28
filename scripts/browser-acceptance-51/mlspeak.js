const { browser, session, dismiss, shot, BASE } = require('./lib');
const log = (...a) => console.log(...a);
(async () => {
  const [themeName, phone, id] = process.argv.slice(2);
  const b = await browser(); const { p } = await session(b, { theme: themeName, phone });
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  const test = p.locator('button:has-text("Start the test")');
  if (await test.isVisible().catch(() => false)) { await test.click(); await p.waitForTimeout(6500);
    await p.locator('[role="dialog"] button').filter({ hasText: /start Speaking/i }).last().click(); await p.waitForTimeout(1000); }
  log('buttons', (await p.locator('main button').allInnerTexts()).filter(x => x.trim()).slice(0, 14).join(' / '));
  await p.locator('main button:has-text("Test microphone")').first().click(); await p.waitForTimeout(3000);
  const begin = p.locator('main button').filter({ hasText: /Start (my )?response|Start answer|Begin response/i }).first();
  log('click', await begin.innerText({ timeout: 8000 })); await begin.click();
  for (let i = 0; i < 9; i++) { await p.waitForTimeout(5000); const s = await p.locator('main').innerText(); const m = s.match(/(Preparation|Recording|Speak|Uploading|uploaded|saved|accepted)[^\n]{0,60}/i); log('t+' + (i + 1) * 5, m ? m[0] : '-'); if (i === 2) await shot(p, `multilevel-speaking-recording-1366-${themeName}`); }
  await shot(p, `multilevel-speaking-after-1366-${themeName}`);
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
