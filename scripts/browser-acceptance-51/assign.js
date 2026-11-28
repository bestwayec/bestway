const { browser, session, api } = require('./lib');
(async () => {
  const b = await browser(); const { p } = await session(b, { phone: '+998900000003' });
  const r = await api(p, 'POST', `/groups/${process.env.GROUP_ID}/assignments`, { title: 'IELTS Mock 07 (synthetic)', exam_id: process.argv[2] || 'ielts-academic-mock-01', timing_policy: 'fixed_close', deadline: new Date(Date.now() + 40 * 60e3).toISOString() });
  console.log(r.status, r.body.data && r.body.data.id, r.body.data && r.body.data.timing_policy);
  await b.close();
})();
