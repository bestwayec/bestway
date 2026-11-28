const { browser, session, dismiss, shot, theme, BASE } = require('./lib');
(async () => {
  const [themeName, phone, id] = process.argv.slice(2);
  const b = await browser(); const { p } = await session(b, { theme: themeName, phone });
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000); await dismiss(p);
  const test = p.locator('button:has-text("Start the test")');
  if (await test.isVisible().catch(() => false)) { await test.click(); await p.waitForTimeout(6500);
    await p.locator('[role="dialog"] button').filter({ hasText: /start Speaking/i }).last().click(); await p.waitForTimeout(1000); }
  console.log('btns', await p.locator('[data-runner-header] button').allInnerTexts());
  await p.locator('[data-runner-header] button').filter({ hasText: 'Finish' }).first().click({ timeout: 8000 }); await p.waitForTimeout(1000);
  const dlg = p.locator('[role="dialog"],[role="alertdialog"]').last();
  console.log('dialog', (await dlg.innerText()).replace(/\n/g, ' | ').slice(0, 220));
  await dlg.locator('button').filter({ hasText: /submit|finish|yakunla|topshir/i }).last().click();
  await p.waitForTimeout(6000);
  console.log('url', p.url(), JSON.stringify(await theme(p)));
  console.log('result', (await p.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 500));
  await shot(p, `student-result-pending-1366-${themeName}`);
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
