// CBT 2.0 deadline state: a synthetic single-section attempt whose server deadline is moved to +25 s in the
// local *_local database. Verifies the "Time is up" chip, locked inputs, no edits accepted, and hand-in.
const { execSync } = require('child_process');
const { browser, session, api, dismiss, shot, BASE } = require('./lib');
const log = (...a) => console.log(...a);
(async () => {
  const [themeName = 'light'] = process.argv.slice(2);
  const b = await browser();
  const { p } = await session(b, { theme: themeName, phone: process.env.PHONE || '+998900000010' });
  for (const a of ((await api(p, 'GET', '/mock/attempts/mine?limit=50')).body?.data ?? []).filter((x) => x.status === 'in_progress')) await api(p, 'POST', `/mock/attempts/${a.id}/submit`, { confirm: true });
  const id = (await api(p, 'POST', '/mock/exams/ielts-academic-mock-01/start', { mode: 'timed', skills: ['reading'] })).body.data.attemptId;
  const sql = `UPDATE "MockAttempt" SET "deadlineAt" = (now() at time zone 'utc') + interval '25 seconds', "overallDeadlineAt" = (now() at time zone 'utc') + interval '25 seconds', "sectionDeadlines" = jsonb_build_object('reading', to_char((now() at time zone 'utc') + interval '25 seconds', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE id = '${id}'`;
  execSync(`PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres bestway51_local -c "${sql.replace(/"/g, '\\"')}"`);
  await p.goto(`${BASE}/en/mock/attempt/${id}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await dismiss(p);
  log('timerBefore', await p.locator('[role="timer"]').first().getAttribute('aria-label').catch(() => null));
  const input = p.locator('[data-compact-answer], fieldset[data-answers-locked] input[type="text"]').first();
  // Type just before the deadline, then watch the transient locked state until the hand-in is confirmed.
  await p.waitForTimeout(15000);
  await input.click().catch(() => {}); await p.keyboard.type('before');
  let seen = null;
  for (let i = 0; i < 150 && !seen; i += 1) {
    if (await p.locator('[data-time-up]').isVisible().catch(() => false)) {
      seen = {
        chip: await p.locator('[data-runner-header]').innerText().then((t) => t.includes('Time is up')),
        banner: (await p.locator('[data-time-up]').innerText()).replace(/\n/g, ' | '),
        fieldsetDisabled: await p.locator('fieldset[data-answers-locked]').evaluate((f) => f.disabled).catch(() => 'n/a'),
        saveChip: await p.locator('[data-runner-header] [role="status"]').first().innerText().catch(() => '?'),
      };
      await shot(p, `deadline-locked-1366-${themeName}`);
      await input.click({ timeout: 1000 }).catch(() => {}); await p.keyboard.type('late').catch(() => {});
      seen.valueAfterLateTyping = await input.inputValue().catch(() => 'n/a');
    } else await p.waitForTimeout(200);
  }
  log('lockedState', JSON.stringify(seen));
  await p.waitForTimeout(8000);
  const state = (await api(p, 'GET', `/mock/attempts/${id}`)).body?.data?.status;
  log('statusAfterGrace', state, 'url', p.url().replace(BASE, ''));
  await shot(p, `deadline-after-1366-${themeName}`);
  await b.close();
})().catch((e) => { console.error('ERR', e.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
