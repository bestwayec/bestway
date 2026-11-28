const { browser, session, shot, BASE } = require('./lib');
(async () => {
  const [themeName, id] = process.argv.slice(2);
  const b = await browser(); const { p } = await session(b, { theme: themeName, phone: '+998900000003' });
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(3500);
  const forms = p.locator('form').filter({ has: p.locator('[role="radiogroup"]') });
  const n = await forms.count(); console.log('forms', n);
  for (let i = 0; i < n; i++) {
    const f = forms.nth(i);
    await f.locator('[role="radio"]', { hasText: 'Override score' }).click(); await p.waitForTimeout(300);
    const nums = f.locator('input[type="number"]'); const k = await nums.count();
    for (let j = 0; j < k; j++) await nums.nth(j).fill(i === 0 ? '6' : '6.5');
    const tas = f.locator('textarea'); for (let j = 0; j < await tas.count(); j++) await tas.nth(j).fill('Teacher-confirmed grade (synthetic test).');
    const reason = f.locator('input[type="text"]'); for (let j = 0; j < await reason.count(); j++) await reason.nth(j).fill('Teacher review');
    await f.locator('button[type="submit"]').click(); await p.waitForTimeout(3000);
    console.log('form', i, 'inputs', k, 'msg', (await f.innerText().catch(() => 'closed')).replace(/\n/g, ' | ').slice(-200));
  }
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(3000);
  console.log('after', (await p.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 600));
  await shot(p, `teacher-assessment-finalized-1366-${themeName}`);
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n')[0]); process.exit(1); });
