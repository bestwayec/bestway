// Continue the IELTS attempt from ielts.js: Reading -> Writing -> Speaking -> Finish, real UI events.
const { browser, session, api, dismiss, shot, BASE } = require('./lib');
const log = (...a) => console.log(...a);
async function next(p) {
  await p.locator('[data-runner-header] button:has-text("Next section")').click();
  await p.waitForTimeout(600);
  await p.locator('[role="dialog"] button:has-text("Yes, next section")').click({ timeout: 5000 });
  await p.waitForTimeout(1500);
  const go = p.locator('button', { hasText: /^Start .* now/ }).first();
  if (await go.isVisible().catch(() => false)) await go.click();
  await p.waitForTimeout(2000); await dismiss(p);
}
(async () => {
  const [themeName, phone] = process.argv.slice(2);
  const b = await browser();
  const { p } = await session(b, { theme: themeName, phone });
  const attemptId = (await api(p, 'POST', '/mock/exams/ielts-academic-mock-01/start', { mode: 'timed', flow: 'full_test', ...(process.env.ASSIGNMENT ? { assignmentId: process.env.ASSIGNMENT } : {}) })).body.data.attemptId;
  log('attempt', attemptId); require('fs').writeFileSync('./attempt.txt', attemptId);
  await p.goto(`${BASE}/en/mock/attempt/${attemptId}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  await p.locator('[data-compact-answer]').nth(0).click(); await p.keyboard.type('Thompson');
  await p.locator('button:has-text("Play audio")').first().click();
  await p.waitForTimeout(32000);   // server reading phase, then playback
  log('audio', JSON.stringify(await p.evaluate(() => { const a = document.querySelector('audio'); return a && { t: +a.currentTime.toFixed(2), paused: a.paused, ready: a.readyState, dur: +a.duration.toFixed(1) }; })));
  await next(p);
  log('skill', await p.evaluate(() => document.querySelector('[data-runner-header]').innerText.split('\n').slice(0, 6).join(' | ')));
  await shot(p, `reading-split-1366-${themeName}`);
  const split = await p.evaluate(() => {
    const panes = [...document.querySelectorAll('.lg\\:overflow-y-auto')].filter(e => e.getBoundingClientRect().width > 200);
    return panes.map(e => ({ w: Math.round(e.getBoundingClientRect().width), scroll: e.scrollHeight > e.clientHeight }));
  });
  log('readingPanes', JSON.stringify(split));
  const divider = p.locator('[role="separator"]').first();
  if (await divider.isVisible().catch(() => false)) {
    const bb = await divider.boundingBox();
    await p.mouse.move(bb.x + bb.width / 2, bb.y + 200); await p.mouse.down(); await p.mouse.move(bb.x - 150, bb.y + 200, { steps: 8 }); await p.mouse.up();
    log('afterDrag', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.lg\\:overflow-y-auto')].filter(e => e.getBoundingClientRect().width > 200).map(e => Math.round(e.getBoundingClientRect().width)))));
  }
  const rInput = p.locator('[data-compact-answer]').first();
  if (await rInput.count()) { await rInput.click(); await p.keyboard.type('solar'); }
  else { await p.locator('input[type="radio"]').first().check().catch(() => {}); }
  await p.waitForTimeout(2500);
  await next(p);
  // Writing: real keyboard input, task switch, word count.
  const editor = p.locator('textarea').first();
  await editor.click();
  const essay = 'The chart shows how renewable energy use changed between 2010 and 2020. Solar power grew fastest, while wind power rose steadily. ';
  await p.keyboard.type(essay, { delay: 5 });
  await p.waitForTimeout(2500);
  const wc = await p.locator('text=/\\d+\\s*(words|so‘z|so\'z)/i').first().innerText().catch(() => '?');
  log('wordCount', wc);
  await shot(p, `writing-workspace-1366-${themeName}`);
  const task2 = p.locator('button:has-text("Task 2")').first();
  if (await task2.isVisible().catch(() => false)) {
    await task2.click(); await p.waitForTimeout(800);
    await p.locator('textarea').first().click(); await p.keyboard.type('Some people believe cities should invest in public transport. ');
    await p.locator('button:has-text("Task 1")').first().click(); await p.waitForTimeout(800);
    log('task1Kept', (await p.locator('textarea').first().inputValue()).startsWith('The chart shows'));
  }
  await p.waitForTimeout(3000);
  log('header', (await p.locator('[data-runner-header]').innerText()).replace(/\n/g, ' | ').slice(0, 200));
  await next(p);
  await shot(p, `speaking-recorder-1366-${themeName}`);
  require('fs').writeFileSync('./speaking.html', await p.content());
  await b.close();
})().catch(e => { console.error('ERR', e.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
