// Multilevel Speaking, all eight positions: native MediaRecorder capture (fake microphone) and a server receipt
// for every task. Usage: node mlspeak8.js [theme]   (local synthetic account, MOCK-RECORD-01)
const { browser, session, api, dismiss, shot, BASE } = require('./lib');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
(async () => {
  const [themeName = 'light'] = process.argv.slice(2);
  const b = await browser(); const { p } = await session(b, { theme: themeName, phone: '+998900000011' });
  for (const a of ((await api(p, 'GET', '/mock/attempts/mine?limit=50')).body?.data ?? []).filter((x) => x.status === 'in_progress')) await api(p, 'POST', `/mock/attempts/${a.id}/submit`, { confirm: true });
  const st = await api(p, 'POST', '/mock/exams/MOCK-RECORD-01/start', { mode: 'timed', skills: ['speaking'] });
  const id = st.body?.data?.attemptId; log('attempt', st.status, id);
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  const test = p.locator('button:has-text("Start the test")');
  if (await test.isVisible().catch(() => false)) {
    await test.click(); await p.waitForTimeout(6500);
    await p.locator('[role="dialog"] button').filter({ hasText: /start Speaking/i }).last().click(); await p.waitForTimeout(1000);
  }
  const serverCount = async () => {
    const r = await api(p, 'GET', `/mock/attempts/${id}`);
    const qs = (r.body?.data?.sections ?? []).flatMap((s) => (s.groups ?? []).flatMap((g) => g.questions ?? []));
    return [qs.filter((q) => q.hasAudio).length, qs.length];
  };
  // The app sequences Speaking itself (a finished response starts the next question). The script only presses
  // what a student would press when the app waits for them, and moves to the next part when one is complete.
  const parts = ['1.1', '1.2', '2', '3'];
  let part = 0; let last = -1; let idleSince = Date.now();
  await p.locator('main button', { hasText: /^1\.1$/ }).first().click();
  while (Date.now() - idleSince < 6 * 60_000) {
    await p.waitForTimeout(3000);
    const [have, total] = await serverCount();
    if (have !== last) { log('serverRecordings', have, '/', total, 'part', parts[part]); last = have; idleSince = Date.now(); if (have === 1) await shot(p, `ml-speaking-recording-1366-${themeName}`); }
    if (have >= total && total > 0) break;
    const recording = await p.locator('main button:has-text("Stop recording")').isVisible().catch(() => false);
    if (recording) continue;
    const start = p.locator('main button:has-text("Start response"):enabled').first();
    if (await start.isVisible().catch(() => false)) { await start.click().catch(() => {}); continue; }
    const mic = p.locator('main button:has-text("Test microphone"):enabled').first();
    if (await mic.isVisible().catch(() => false)) { await mic.click().catch(() => {}); continue; }
    const texts = await p.locator('main [id^="q-"]').allInnerTexts();
    if (texts.length && texts.every((t) => /Uploaded/.test(t)) && part < parts.length - 1) {
      part += 1;
      await p.locator('main button', { hasText: new RegExp(`^${parts[part].replace('.', '\\.')}$`) }).first().click().catch(() => {});
    }
  }
  await shot(p, `ml-speaking-all-1366-${themeName}`);
  const final = await api(p, 'GET', `/mock/attempts/${id}`);
  const qs = (final.body?.data?.sections ?? []).flatMap((s) => (s.groups ?? []).flatMap((g) => g.questions ?? []));
  log('FINAL recordings with server receipt', qs.filter((q) => q.hasAudio).length, 'of', qs.length, JSON.stringify(qs.map((q) => q.audioDurationMs ?? null)));
  await b.close();
})().catch((e) => { console.error('ERR', e.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
