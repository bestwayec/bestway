const { browser, session, theme, api, dismiss, shot, BASE } = require('./lib');
const log = (...a) => console.log(...a);
(async () => {
  const b = await browser();
  const themeName = process.argv[2] || 'light', phone = process.argv[3];
  const { p } = await session(b, { theme: themeName, phone });
  const st = await api(p, 'POST', '/mock/exams/ielts-academic-mock-01/start', { mode: 'timed', flow: 'full_test' });
  const id = st.body.data.attemptId; log('attempt', id);
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  log('theme', JSON.stringify(await theme(p)));
  const rows = await p.locator('[data-compact-question]').count(); log('compactRows', rows);
  await shot(p, `listening-form-1366-${themeName}`);
  // Real audio: press the once-only Play, then read the media element.
  await p.locator('button:has-text("Play audio")').first().click();
  await p.waitForTimeout(9000);
  const audio = await p.evaluate(() => { const a = document.querySelector('audio'); return a && { t: a.currentTime, paused: a.paused, ready: a.readyState, err: a.error && a.error.code }; });
  log('audio', JSON.stringify(audio));
  await shot(p, `listening-audio-panel-1366-${themeName}`);
  // Type answers with the keyboard into inline fields.
  const inputs = p.locator('[data-compact-answer]');
  await inputs.nth(0).click(); await p.keyboard.type('Thompson');
  await inputs.nth(1).click(); await p.keyboard.type('551234');
  await p.waitForTimeout(3500);
  log('header', (await p.locator('[data-runner-header]').innerText()).replace(/\n/g, ' | ').slice(0, 160));
  // Last question of part 1 via navigator.
  await p.locator('button', { hasText: /^10$/ }).last().click(); await p.waitForTimeout(800);
  const geo = await p.evaluate(() => {
    const audio = document.querySelector('[data-testid="listening-sticky-audio"]').getBoundingClientRect();
    const rows = [...document.querySelectorAll('[data-q-row]')]; const last = rows.at(-1).getBoundingClientRect();
    const nav = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '10').getBoundingClientRect();
    return { audioBottom: audio.bottom, lastTop: last.top, lastBottom: last.bottom, navTop: nav.top };
  });
  log('geometry', JSON.stringify(geo));
  await shot(p, `listening-last-question-1366-${themeName}`);
  require('fs').writeFileSync('./attempt.txt', id);
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n')[0]); process.exit(1); });
