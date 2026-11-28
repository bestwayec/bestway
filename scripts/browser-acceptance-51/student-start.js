const { browser, session, api, dismiss, BASE } = require('./lib');
(async () => {
  const [phone, answers] = process.argv.slice(2);
  const b = await browser(); const { p } = await session(b, { phone });
  const r = await api(p, 'POST', '/mock/exams/ielts-academic-mock-01/start', { mode: 'timed', flow: 'full_test', assignmentId: process.env.ASSIGNMENT });
  const id = r.body.data.attemptId; console.log(phone, id);
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000); await dismiss(p);
  for (const [i, v] of (answers || '').split(',').filter(Boolean).entries()) { await p.locator('[data-compact-answer]').nth(i).click(); await p.keyboard.type(v); }
  await p.waitForTimeout(3500);   // autosave, then the browser closes without Finish
  await b.close();
})();
