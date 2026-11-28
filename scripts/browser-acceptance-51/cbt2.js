// CBT Exam Experience 2.0 acceptance: readiness screen (no attempt before Start), settings 2.0,
// navigator filters + O key, submission review jump, offline save status, deadline-free reload,
// Speaking microphone-check reuse (same browser) vs a fresh browser. Synthetic local accounts only.
// Usage: node cbt2.js <light|dark> <width> <height> <tag>
const { browser, session, api, dismiss, shot, theme, BASE } = require('./lib');
const log = (...a) => console.log(...a);
const PHONE = process.env.PHONE || '+998900000010';
const EXAM = 'ielts-academic-mock-01';

async function overflow(p) {
  return p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
async function inProgress(p) {
  const r = await api(p, 'GET', '/mock/attempts/mine?limit=50');
  return (r.body?.data ?? []).filter((a) => a.status === 'in_progress').length;
}

(async () => {
  const [themeName = 'light', w = '1366', h = '768', tag = '1366'] = process.argv.slice(2);
  const width = Number(w), height = Number(h);
  const b = await browser();
  const { ctx, p } = await session(b, { width, height, theme: themeName, phone: PHONE });
  // Start from a clean state: hand in any attempt left open by an earlier run.
  for (const a of ((await api(p, 'GET', '/mock/attempts/mine?limit=50')).body?.data ?? []).filter((x) => x.status === 'in_progress')) {
    await api(p, 'POST', `/mock/attempts/${a.id}/submit`, { confirm: true });
  }

  // 1. Readiness screen: opening and running it creates no attempt.
  await p.goto(`${BASE}/en/mock/${EXAM}`, { waitUntil: 'networkidle' });
  const before = await inProgress(p);
  await p.locator('button:has-text("Timed (exam mode)")').last().click();
  const dialog = p.locator('[data-testid="exam-readiness"]');
  await dialog.waitFor({ timeout: 8000 });
  await dialog.locator('button:has-text("Check my device")').click();
  await p.waitForTimeout(2500);
  const rows = await dialog.locator('[data-check]').evaluateAll((els) => els.map((e) => `${e.dataset.check}=${e.dataset.checkState}`));
  log('readinessRows', rows.join(' '));
  log('readinessText', (await dialog.innerText()).replace(/\n/g, ' | ').slice(0, 420));
  log('attemptsBeforeStart', before, '→', await inProgress(p), '(must be equal)');
  log('overflow', await overflow(p), 'theme', JSON.stringify(await theme(p)));
  await shot(p, `readiness-${tag}-${themeName}`);
  await dialog.locator('[data-testid="readiness-start"]').click();
  await p.waitForURL(/\/mock\/attempt\//, { timeout: 20000 });
  const attemptId = p.url().split('/attempt/')[1].split(/[?#]/)[0];
  log('attempt', attemptId, 'inProgressAfterStart', await inProgress(p));
  await p.waitForTimeout(2500); await dismiss(p);

  // 2. Typed answer, calm save chip, then offline: kept on this device, never "saved".
  const first = p.locator('[data-compact-answer]').first();
  await first.click(); await p.keyboard.type('Thompson');
  await p.waitForTimeout(3500);
  const chip = () => p.locator('[data-runner-header] [role="status"]').first().innerText().catch(() => '?');
  log('saveChipOnline', await chip());
  await ctx.setOffline(true);
  await p.locator('[data-compact-answer]').nth(1).click(); await p.keyboard.type('library');
  await p.waitForTimeout(2500);
  log('saveChipOffline', await chip());
  await shot(p, `offline-save-${tag}-${themeName}`);
  await ctx.setOffline(false);
  await p.waitForTimeout(12000);
  log('saveChipReconnected', await chip());

  // 3. Navigator overview with filters (O key) and the submission review jump.
  await p.locator('body').click({ position: { x: 5, y: height - 5 } }).catch(() => {});
  await p.keyboard.press('Escape');
  await p.locator('[data-runner-header]').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await p.keyboard.press('o');
  await p.waitForTimeout(600);
  const filters = p.locator('[data-testid="navigator-filters"]');
  log('overviewOpen', await filters.isVisible().catch(() => false));
  if (await filters.isVisible().catch(() => false)) {
    await filters.locator('[data-filter="unanswered"]').click();
    log('filters', (await filters.innerText()).replace(/\n/g, ' '));
    log('unansweredShown', await p.locator('[data-testid="question-palette"] button[data-qid]').count());
    await shot(p, `navigator-filter-${tag}-${themeName}`);
    await p.keyboard.press('Escape');
  }
  await p.locator('[data-runner-header] button[aria-label="Finish"]').click();
  await p.waitForTimeout(900);
  const review = p.locator('[role="dialog"]').last();
  log('reviewText', (await review.innerText()).replace(/\n/g, ' | ').slice(0, 300));
  await shot(p, `submit-review-${tag}-${themeName}`);
  const jump = review.locator('button', { hasText: /^5$/ }).first();
  if (await jump.isVisible().catch(() => false)) {
    await jump.click(); await p.waitForTimeout(900);
    const focused = await p.evaluate(() => { const el = document.activeElement?.closest('[id^="q-"]'); const r = el?.getBoundingClientRect(); const head = document.querySelector('[data-runner-header]')?.getBoundingClientRect(); return el ? { id: el.id, top: Math.round(r.top), headerBottom: Math.round(head?.bottom ?? 0), visible: r.top >= (head?.bottom ?? 0) && r.bottom <= innerHeight } : null; });
    log('jumpTarget', JSON.stringify(focused));
  }

  // 4. Settings 2.0: dark theme + comfortable spacing applied in place; answer text survives.
  const headerSettings = p.locator('[data-runner-header] button[aria-label="Settings"]').first();
  if (await headerSettings.isVisible().catch(() => false)) await headerSettings.click();
  else {
    // Below 2xl the exam tools live in the Info panel.
    await p.locator('[data-runner-header] button[aria-controls="runner-info"]').click();
    await p.locator('#runner-info button:has-text("Settings")').click();
  }
  await p.waitForTimeout(600);
  const settings = p.locator('[role="dialog"]').last();
  if (await settings.locator('text=Line spacing').isVisible().catch(() => false)) {
    await settings.locator('[role="radio"]:has-text("Comfortable")').click();
    await settings.locator('[role="radio"]:has-text("Dark")').click();
    await p.waitForTimeout(500);
    await shot(p, `settings2-${tag}-${themeName}`);
    log('afterSettings', JSON.stringify(await theme(p)), 'relaxed', await p.locator('.exam-line-relaxed').count(), 'firstAnswerKept', await p.locator('[data-compact-answer]').first().inputValue());
    await settings.locator('button:has-text("Restore defaults")').click();
    await p.waitForTimeout(300);
    log('afterRestore relaxed', await p.locator('.exam-line-relaxed').count());
    await p.keyboard.press('Escape');
  } else log('settingsDialog', 'not opened from header at this width');

  // 5. Reload: the server deadline is kept (timer does not reset).
  const timer = async () => p.locator('[role="timer"]').first().getAttribute('aria-label').catch(() => null);
  const t1 = await timer();
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  log('timerBeforeReload', t1, 'after', await timer());
  log('overflowRunner', await overflow(p));
  await shot(p, `runner-${tag}-${themeName}`);
  await api(p, 'POST', `/mock/attempts/${attemptId}/submit`, { confirm: true });

  // 6. Speaking: the microphone check passes once; a new tab of the same browser does not ask again,
  //    a fresh browser profile does.
  const speak = (await api(p, 'POST', `/mock/exams/${EXAM}/start`, { mode: 'timed', skills: ['speaking'] })).body?.data?.attemptId;
  log('speakingAttempt', speak);
  if (speak) {
    await p.goto(`${BASE}/en/mock/attempt/${speak}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
    const startTest = p.locator('button:has-text("Start the test")');
    log('micModalFirstVisit', await startTest.isVisible().catch(() => false));
    if (await startTest.isVisible().catch(() => false)) {
      await startTest.click(); await p.waitForTimeout(6500);
      await p.locator('[role="dialog"] button:has-text("I can hear it")').click({ timeout: 5000 }).catch((e) => log('confirmErr', e.message.slice(0, 80)));
      await p.waitForTimeout(800);
    }
    const tab = await ctx.newPage();
    await tab.goto(`${BASE}/en/mock/attempt/${speak}`, { waitUntil: 'networkidle' }); await tab.waitForTimeout(3000);
    log('micModalNewTabSameBrowser', await tab.locator('button:has-text("Start the test")').isVisible().catch(() => false), '(expected false)');
    await tab.close();
    const fresh = await session(b, { width, height, theme: themeName, phone: PHONE });
    await fresh.p.goto(`${BASE}/en/mock/attempt/${speak}`, { waitUntil: 'networkidle' }); await fresh.p.waitForTimeout(3000); await dismiss(fresh.p);
    log('micModalFreshBrowser', await fresh.p.locator('button:has-text("Start the test")').isVisible().catch(() => false), '(expected true)');
    await fresh.ctx.close();
    await api(p, 'POST', `/mock/attempts/${speak}/submit`, { confirm: true });
  }
  await b.close();
})().catch((e) => { console.error('ERR', e.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
