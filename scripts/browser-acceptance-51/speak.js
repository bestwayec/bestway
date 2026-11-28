const { browser, session, dismiss, shot, BASE } = require('./lib');
const log = (...a) => console.log(...a);
(async () => {
  const [themeName, phone, id] = process.argv.slice(2);
  const b = await browser(); const { p } = await session(b, { theme: themeName, phone });
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  const test = p.locator('button:has-text("Start the test")');
  if (await test.isVisible().catch(() => false)) {
    await test.click(); await p.waitForTimeout(6500);
    log('micModal', (await p.locator('[role="dialog"]').last().innerText()).replace(/\n/g, ' | ').slice(0, 200));
    const cont = p.locator('[role="dialog"] button').filter({ hasText: /continue|start|ready|davom/i }).last();
    await cont.click().catch(() => {}); await p.waitForTimeout(1200);
  }
  log('speakingText', (await p.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 400));
  const rec = p.locator('button', { hasText: /^Record$|Prepare|Start speaking|Begin/ }).first();
  log('recordButton', await rec.innerText().catch(() => 'none'));
  await rec.click(); await p.waitForTimeout(4000);
  await shot(p, `speaking-recording-1366-${themeName}`);
  const stop = p.locator('button:has-text("Stop")').first();
  if (await stop.isVisible().catch(() => false)) { await stop.click(); }
  await p.waitForTimeout(5000);
  log('afterUpload', (await p.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 400));
  await shot(p, `speaking-recorder-1366-${themeName}`);
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
