const { browser, session, shot, theme, BASE } = require('./lib');
(async () => {
  const [themeName, tag, width = '1366', height = '768'] = process.argv.slice(2);
  const b = await browser(); const { p } = await session(b, { theme: themeName, phone: '+998900000003', width: +width, height: +height });
  await p.goto(`${BASE}/en/teacher/results/exam/${process.env.ASSIGNMENT}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000);
  console.log(JSON.stringify(await theme(p)), 'hOverflow', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('stage', await p.locator('[data-testid="report-stage"]').innerText());
  console.log('rows', (await p.locator('[data-testid="result-row"]').allInnerTexts()).map(r => r.replace(/\s+/g, ' ')).join(' || '));
  const mon = p.locator('[data-testid="live-monitor"]');
  if (await mon.count()) { console.log('monitor', (await mon.innerText()).replace(/\s+/g, ' ').slice(0, 300)); }
  await shot(p, `result-center-${tag}-${width}-${themeName}`, true);
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n')[0]); process.exit(1); });
