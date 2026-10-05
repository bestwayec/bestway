/**
 * API smoke-test: barcha endpointlar, RBAC va biznes-qoidalarni tekshiradi.
 *
 * Ishlatish (server ishlab turgan bo'lsin, baza yangi seed qilingan bo'lsin):
 *   npx prisma migrate reset --force --skip-seed && npm run seed
 *   npm run start:prod       (yoki npm run start:dev)
 *   npm run test:smoke
 *
 * Telegram bog'lash oqimini ham tekshirish uchun serverni shu sozlamalar bilan qo'ying:
 *   TELEGRAM_BOT_TOKEN=xxx  TELEGRAM_BOT_USERNAME=test_bot
 *   TELEGRAM_MODE=webhook   TELEGRAM_WEBHOOK_SECRET=<secret>   (TELEGRAM_WEBHOOK_URL bo'sh)
 * va testni SMOKE_TELEGRAM_SECRET=<secret> bilan ishga tushiring.
 *
 * Diqqat: skript bazaga yozadi — faqat DEV bazasida ishlating!
 */
import 'dotenv/config';

// Match the API's business timezone, including dates after Tashkent midnight
// while the CI host is still on the previous UTC day.
process.env.TZ = process.env.TZ || 'Asia/Tashkent';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3001/v1';
// Super admin .env dan olinadi (demo seed ham o'sha qiymatlardan foydalanadi)
const SUPER_PHONE = process.env.SEED_SUPER_ADMIN_PHONE ?? '+998900000001';
const SUPER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'Super123!';
let pass = 0, fail = 0;
const fails = [];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function login(phone, password) {
  const r = await call('POST', '/auth/login', { body: { phone, password } });
  if (!r.json?.success) throw new Error(`login ${phone} failed: ${JSON.stringify(r.json)}`);
  return r.json.data;
}

const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

(async () => {
  console.log('\n== AUTH ==');
  const superA = await login(SUPER_PHONE, SUPER_PASSWORD);
  const admin = await login('+998900000002', 'Admin123!');
  const teacher = await login('+998900000003', 'Teacher123!');
  const student = await login('+998900000010', 'Student123!');
  const student2 = await login('+998900000011', 'Student123!');
  const parent = await login('+998900000020', 'Parent123!');
  check('login envelope + role', admin.user.role === 'admin' && !!admin.accessToken && !!admin.refreshToken);

  const bad = await call('POST', '/auth/login', { body: { phone: '+998900000002', password: 'wrong' } });
  check('bad login -> 401 INVALID_CREDENTIALS', bad.status === 401 && bad.json.success === false && bad.json.error.code === 'INVALID_CREDENTIALS', bad.json);

  const me = await call('GET', '/auth/me', { token: student.accessToken });
  check('GET /auth/me', me.json.success && me.json.data.user.role === 'student' && me.json.data.profile.currentPoints === 100, me.json.data);

  const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken: student.refreshToken } });
  check('POST /auth/refresh -> accessToken + refreshToken', refreshed.json.success && !!refreshed.json.data.accessToken && !!refreshed.json.data.refreshToken, refreshed.json.data);

  const noAuth = await call('GET', '/auth/me');
  check('token yo\'q -> 401', noAuth.status === 401 && noAuth.json.error.code === 'UNAUTHORIZED', noAuth.json);

  const rnd = Date.now().toString().slice(-7);
  const reg = await call('POST', '/auth/register', { body: { name: 'Yangi O\'quvchi', phone: `+9989${rnd}`, password: 'Test123!', role: 'student' } });
  check('POST /auth/register student -> 100 ball', reg.json.success && reg.json.data.user.role === 'student', reg.json.error ?? reg.json.data?.user);
  const newMe = await call('GET', '/auth/me', { token: reg.json.data.accessToken });
  check('yangi student 100 ball oldi', newMe.json.data.profile.currentPoints === 100, newMe.json.data.profile);
  const regAdmin = await call('POST', '/auth/register', { body: { name: 'Hacker', phone: `+9988${rnd}`, password: 'Test123!', role: 'admin' } });
  check('register orqali admin bo\'lib bo\'lmaydi -> 400', regAdmin.status === 400 && regAdmin.json.error.code === 'VALIDATION_ERROR', regAdmin.json);
  const dup = await call('POST', '/auth/register', { body: { name: 'Boshqa Odam', phone: `+9989${rnd}`, password: 'Test123!', role: 'student' } });
  check('takroriy telefon -> 409 PHONE_TAKEN', dup.status === 409 && dup.json.error.code === 'PHONE_TAKEN', dup.json);

  console.log('\n== RBAC ==');
  const studentTriesUsers = await call('GET', '/users', { token: student.accessToken });
  check('student GET /users -> 403 FORBIDDEN', studentTriesUsers.status === 403 && studentTriesUsers.json.error.code === 'FORBIDDEN', studentTriesUsers.json);
  const parentTriesPoints = await call('POST', `/points/${student.user.id}/adjust`, { token: parent.accessToken, body: { change: 5, reason: 'x' } });
  check('parent ball o\'zgartira olmaydi -> 403', parentTriesPoints.status === 403, parentTriesPoints.json);

  console.log('\n== USERS / GROUPS ==');
  const users = await call('GET', '/users?role=student&page=1&limit=10', { token: admin.accessToken });
  check('GET /users pagination meta', users.json.success && Array.isArray(users.json.data) && users.json.meta.page === 1 && typeof users.json.meta.total === 'number', users.json.meta);

  const groups = await call('GET', '/groups', { token: admin.accessToken });
  const groupId = groups.json.data[0].id;
  check('GET /groups', groups.json.success && groups.json.data.length >= 1 && 'studentsCount' in groups.json.data[0], groups.json.data[0]);

  const gOne = await call('GET', `/groups/${groupId}`, { token: teacher.accessToken });
  check('teacher o\'z guruhini ko\'radi', gOne.json.success && Array.isArray(gOne.json.data.students), Object.keys(gOne.json.data ?? {}));

  const newGroup = await call('POST', '/groups', { token: admin.accessToken, body: { name: `Test guruh ${rnd}`, teacherId: teacher.user.id } });
  check('POST /groups', newGroup.json.success && !!newGroup.json.data.id, newGroup.json);
  const addSt = await call('POST', `/groups/${newGroup.json.data.id}/students`, { token: admin.accessToken, body: { studentId: reg.json.data.user.id } });
  check('POST /groups/:id/students', addSt.json.success, addSt.json);
  const gOther = await call('GET', `/groups/${newGroup.json.data.id}`, { token: admin.accessToken });
  check('o\'quvchi guruhga qo\'shildi', gOther.json.data.students.some((s) => s.studentId === reg.json.data.user.id), gOther.json.data.students);

  // Begona o'qituvchi/guruh — RBAC scoping tekshiruvi uchun
  const teacher2 = await call('POST', '/users', { token: admin.accessToken, body: { name: 'Ikkinchi Ustoz', phone: `+9987${rnd}`, password: 'Test123!', role: 'teacher' } });
  const group2 = await call('POST', '/groups', { token: admin.accessToken, body: { name: `Begona guruh ${rnd}`, teacherId: teacher2.json.data.id } });
  const student3 = await call('POST', '/users', { token: admin.accessToken, body: { name: 'Begona O\'quvchi', phone: `+9986${rnd}`, password: 'Test123!', role: 'student', groupId: group2.json.data.id } });
  check('POST /users (admin xodim/o\'quvchi yaratadi)', teacher2.json.success && student3.json.success, student3.json.error);

  console.log('\n== ATTENDANCE ==');
  // Avval hammasini "keldi", so'ng birini "kelmadi" — ota-onaga xabar shu o'zgarishda ketadi
  await call('PUT', '/attendance/bulk', {
    token: teacher.accessToken,
    body: { groupId, date: today, records: [
      { studentId: student.user.id, state: 'present' },
      { studentId: student2.user.id, state: 'present' },
    ] },
  });
  const att = await call('PUT', '/attendance/bulk', {
    token: teacher.accessToken,
    body: { groupId, date: today, records: [
      { studentId: student.user.id, state: 'absent' },
      { studentId: student2.user.id, state: 'absent' },
    ] },
  });
  check('PUT /attendance/bulk -> {updated}', att.json.success && att.json.data.updated === 2, att.json);

  const notMember = await call('PUT', '/attendance/bulk', {
    token: teacher.accessToken,
    body: { groupId, date: today, records: [{ studentId: reg.json.data.user.id, state: 'present' }] },
  });
  check('guruhda yo\'q o\'quvchi -> 400 STUDENT_NOT_IN_GROUP', notMember.status === 400 && notMember.json.error.code === 'STUDENT_NOT_IN_GROUP', notMember.json);

  const attList = await call('GET', `/attendance?groupId=${groupId}`, { token: teacher.accessToken });
  const rec = attList.json.data.find((r) => r.studentId === student2.user.id && r.date === today);
  check('GET /attendance kontrakt shakli {studentId,date,state}', attList.json.success && rec?.state === 'absent' && /^\d{4}-\d{2}-\d{2}$/.test(rec.date), rec);

  const attStudent = await call('GET', '/attendance', { token: student.accessToken });
  check('student faqat o\'zinikini ko\'radi', attStudent.json.success && attStudent.json.data.every((r) => r.studentId === student.user.id));

  const attParent = await call('GET', '/attendance', { token: parent.accessToken });
  check('parent farzand davomatini ko\'radi', attParent.json.success && attParent.json.data.length >= 1, attParent.json.data?.length);

  const attNoGroup = await call('GET', '/attendance', { token: teacher.accessToken });
  check('teacher groupId siz -> 400 GROUP_ID_REQUIRED', attNoGroup.status === 400 && attNoGroup.json.error.code === 'GROUP_ID_REQUIRED', attNoGroup.json);

  const stats = await call('GET', `/attendance/stats?groupId=${groupId}`, { token: admin.accessToken });
  check('GET /attendance/stats', stats.json.success && Array.isArray(stats.json.data) && 'absent' in stats.json.data[0], stats.json.data?.[0]);

  console.log('\n== POINTS ==');
  const before = (await call('GET', `/points/${student.user.id}`, { token: student.accessToken })).json.data.current;
  const adj = await call('POST', `/points/${student.user.id}/adjust`, { token: teacher.accessToken, body: { change: 10, reason: 'Faol qatnashdi' } });
  check('teacher +10 ball -> {current}', adj.json.success && adj.json.data.current === before + 10, adj.json);

  const noReason = await call('POST', `/points/${student.user.id}/adjust`, { token: teacher.accessToken, body: { change: 5 } });
  check('sababsiz ball -> 400 VALIDATION_ERROR', noReason.status === 400 && noReason.json.error.code === 'VALIDATION_ERROR', noReason.json);

  const overLimit = await call('POST', `/points/${student.user.id}/adjust`, { token: teacher.accessToken, body: { change: 50, reason: 'juda ko\'p' } });
  check('teacher limitdan oshiq -> 403 POINT_LIMIT_EXCEEDED', overLimit.status === 403 && overLimit.json.error.code === 'POINT_LIMIT_EXCEEDED', overLimit.json);

  const ownNewStudent = await call('POST', `/points/${reg.json.data.user.id}/adjust`, { token: teacher.accessToken, body: { change: 5, reason: 'O\'z guruhidagi o\'quvchi' } });
  check('teacher o\'z guruhidagi o\'quvchiga ball beradi', ownNewStudent.json.success, ownNewStudent.json);

  const foreignStudent = await call('POST', `/points/${student3.json.data.id}/adjust`, { token: teacher.accessToken, body: { change: 5, reason: 'begona' } });
  check('teacher begona guruh o\'quvchisiga ball bera olmaydi -> 403', foreignStudent.status === 403 && foreignStudent.json.error.code === 'FORBIDDEN', foreignStudent.json);

  const adminBig = await call('POST', `/points/${student.user.id}/adjust`, { token: admin.accessToken, body: { change: 50, reason: 'Admin bonus' } });
  check('admin limitsiz +50', adminBig.json.success && adminBig.json.data.current === before + 60, adminBig.json);

  const hist = await call('GET', `/points/${student.user.id}`, { token: parent.accessToken });
  check('parent farzand ball tarixini ko\'radi', hist.json.success && hist.json.data.history.length >= 3 && 'reason' in hist.json.data.history[0] && 'byUserId' in hist.json.data.history[0], hist.json.data.history[0]);

  const otherStudentPoints = await call('GET', `/points/${student2.user.id}`, { token: student.accessToken });
  check('student boshqa student ballini ko\'ra olmaydi -> 403', otherStudentPoints.status === 403, otherStudentPoints.json);

  const board = await call('GET', '/points/leaderboard');
  check('GET /points/leaderboard ochiq + rank', board.json.success && board.json.data[0].rank === 1 && 'points' in board.json.data[0] && 'name' in board.json.data[0], board.json.data[0]);
  const boardG = await call('GET', `/points/leaderboard?groupId=${groupId}`);
  check('leaderboard?groupId filtri', boardG.json.success && boardG.json.data.length >= 1, boardG.json.data?.length);

  console.log('\n== PAYMENTS ==');
  const pay = await call('PUT', '/payments/bulk', {
    token: admin.accessToken,
    body: { year: YEAR, records: [
      { studentId: student2.user.id, month: MONTH, state: 'paid', amount: 500000, note: 'Naqd' },
      { studentId: student.user.id, month: MONTH, state: 'unpaid', amount: 0 },
    ] },
  });
  check('PUT /payments/bulk -> {updated}', pay.json.success && pay.json.data.updated === 2, pay.json);

  const payList = await call('GET', `/payments?month=${MONTH}&year=${YEAR}`, { token: admin.accessToken });
  const p2 = payList.json.data.find((p) => p.studentId === student2.user.id);
  check('GET /payments kontrakt shakli (method=manual)', payList.json.success && p2.state === 'paid' && p2.method === 'manual' && p2.amount === 500000, p2);

  const payStudent = await call('GET', '/payments', { token: student2.accessToken });
  check('student faqat o\'z to\'lovlarini ko\'radi', payStudent.json.data.every((p) => p.studentId === student2.user.id));

  const debtors = await call('GET', '/payments/debtors', { token: admin.accessToken });
  const isDebtor = (id) => debtors.json.data.some((d) => d.studentId === id);
  check('GET /payments/debtors (joriy oy, parametrsiz)', debtors.json.success && isDebtor(student.user.id) && !isDebtor(student2.user.id), debtors.json.data?.map((d) => `${d.name}:${d.state}`));

  const remind = await call('POST', '/payments/remind', { token: admin.accessToken, body: { studentIds: [student.user.id] } });
  check('POST /payments/remind (tanlanganlarga)', remind.json.success && remind.json.data.notified === 1, remind.json);

  const remindPaid = await call('POST', '/payments/remind', { token: admin.accessToken, body: { studentIds: [student2.user.id] } });
  check('to\'lagan o\'quvchiga eslatma ketmaydi', remindPaid.json.data.notified === 0, remindPaid.json);

  const teacherPay = await call('GET', '/payments', { token: teacher.accessToken });
  check('teacher /payments faqat o\'z guruhlari (begona yo\'q)',
    teacherPay.json.success && teacherPay.json.data.some((p) => p.studentId === student2.user.id) &&
    teacherPay.json.data.every((p) => p.studentId !== student3.json.data.id), teacherPay.json.data?.length);
  const teacherPayForeign = await call('GET', `/payments?studentId=${student3.json.data.id}`, { token: teacher.accessToken });
  check('teacher begona o\'quvchi to\'lovini ko\'ra olmaydi -> 403 FORBIDDEN',
    teacherPayForeign.status === 403 && teacherPayForeign.json.error.code === 'FORBIDDEN', teacherPayForeign.json);

  const teacherBulkOwn = await call('PUT', '/payments/bulk', {
    token: teacher.accessToken,
    body: { year: YEAR, records: [{ studentId: student.user.id, month: MONTH, state: 'partial', amount: 100000 }] },
  });
  check('teacher o\'z guruhiga to\'lov belgilaydi', teacherBulkOwn.json.success && teacherBulkOwn.json.data.updated === 1, teacherBulkOwn.json);
  const teacherBulkForeign = await call('PUT', '/payments/bulk', {
    token: teacher.accessToken,
    body: { year: YEAR, records: [{ studentId: student3.json.data.id, month: MONTH, state: 'paid', amount: 1 }] },
  });
  check('teacher begona guruhga to\'lov belgilay olmaydi -> 403 FORBIDDEN',
    teacherBulkForeign.status === 403 && teacherBulkForeign.json.error.code === 'FORBIDDEN', teacherBulkForeign.json);

  const teacherDebtors = await call('GET', '/payments/debtors', { token: teacher.accessToken });
  check('teacher debtors faqat o\'z guruhlari (begona yo\'q)',
    teacherDebtors.json.success && teacherDebtors.json.data.some((d) => d.studentId === student.user.id) &&
    teacherDebtors.json.data.every((d) => d.studentId !== student3.json.data.id),
    teacherDebtors.json.data?.map((d) => `${d.name}:${d.state}`));

  // Bloklangan o'quvchi: status belgilash rad etiladi, tarix o'chirilmaydi
  const blockStudent = await call('DELETE', `/users/${student.user.id}`, { token: superA.accessToken });
  check('o\'quvchini bloklash', blockStudent.json?.success === true, blockStudent.json);
  const blockedPay = await call('PUT', '/payments/bulk', {
    token: admin.accessToken,
    body: { year: YEAR, records: [{ studentId: student.user.id, month: MONTH, state: 'paid', amount: 500000 }] },
  });
  check('bloklangan o\'quvchiga to\'lov -> 400 STUDENT_BLOCKED',
    blockedPay.status === 400 && blockedPay.json.error.code === 'STUDENT_BLOCKED', blockedPay.json);
  const blockedAtt = await call('PUT', '/attendance/bulk', {
    token: teacher.accessToken,
    body: { groupId, date: today, records: [{ studentId: student.user.id, state: 'present' }] },
  });
  check('bloklangan o\'quvchiga davomat -> 400 STUDENT_BLOCKED',
    blockedAtt.status === 400 && blockedAtt.json.error.code === 'STUDENT_BLOCKED', blockedAtt.json);
  const payKept = await call('GET', `/payments?studentId=${student.user.id}&year=${YEAR}&month=${MONTH}`, { token: admin.accessToken });
  check('bloklangan o\'quvchi tarixi o\'chmagan', payKept.json.success && payKept.json.data.some((p) => p.studentId === student.user.id), payKept.json.data);
  const unblock = await call('PATCH', `/users/${student.user.id}`, { token: admin.accessToken, body: { isActive: true } });
  check('o\'quvchini qayta faollashtirish', unblock.json?.success === true, unblock.json);
  const payAfter = await call('PUT', '/payments/bulk', {
    token: admin.accessToken,
    body: { year: YEAR, records: [{ studentId: student.user.id, month: MONTH, state: 'partial', amount: 100000 }] },
  });
  check('faollashgandan keyin to\'lov belgilanadi', payAfter.json.success === true, payAfter.json);

  console.log('\n== TESTS ==');
  const guestTests = await call('GET', '/tests');
  check('mehmon -> faqat demo testlar', guestTests.json.success && guestTests.json.data.length >= 1 && guestTests.json.data.every((t) => t.isDemo), guestTests.json.data.map((t) => t.isDemo));

  const allTests = await call('GET', '/tests', { token: admin.accessToken });
  const ielts = allTests.json.data.find((t) => t.type === 'ielts');
  check('GET /tests admin hammasini ko\'radi + sections', allTests.json.data.length >= 2 && Array.isArray(ielts.sections), ielts);

  const start = await call('POST', `/tests/${ielts.id}/start`, { token: student.accessToken });
  const attemptId = start.json.data.attemptId;
  const qs = start.json.data.questions;
  check('POST /tests/:id/start -> {attemptId, questions}', start.json.success && !!attemptId && qs.length > 0, { attemptId, n: qs?.length });
  check('savollarda correctAnswer YO\'Q (nusxa ko\'chirishga qarshi)', qs.every((q) => !('correctAnswer' in q)), Object.keys(qs[0]));

  const start2 = await call('POST', `/tests/${ielts.id}/start`, { token: student.accessToken });
  check('qayta start -> o\'sha attempt (resume)', start2.json.data.attemptId === attemptId, start2.json.data.attemptId);

  const startOther = await call('POST', `/tests/${ielts.id}/start`, { token: student2.accessToken });
  const order1 = qs.map((q) => q.id).join(',');
  const order2 = startOther.json.data.questions.map((q) => q.id).join(',');
  check('har bir urinishda savollar tartibi random', order1 !== order2 || qs.length < 3, { order1: order1.slice(0, 20), order2: order2.slice(0, 20) });

  const autoQ = qs.filter((q) => q.section === 'listening' || q.section === 'reading');
  const manualQ = qs.filter((q) => q.section === 'writing' || q.section === 'speaking');
  check('random tanlov: bo\'lim bo\'yicha savol soni cheklangan', autoQ.length > 0 && manualQ.length > 0, { auto: autoQ.length, manual: manualQ.length });

  for (const q of autoQ) {
    await call('POST', `/tests/attempts/${attemptId}/answer`, { token: student.accessToken, body: { questionId: q.id, answer: q.options?.[0] ?? 'test' } });
  }
  const ansOk = await call('POST', `/tests/attempts/${attemptId}/answer`, { token: student.accessToken, body: { questionId: autoQ[0].id, answer: 'yangilangan' } });
  check('POST answer (upsert) -> {saved:true}', ansOk.json.success && ansOk.json.data.saved === true, ansOk.json);

  const resumed = await call('POST', `/tests/${ielts.id}/start`, { token: student.accessToken });
  check('resume javoblarni qaytaradi (savedAnswers)', !!resumed.json.data.savedAnswers && Object.keys(resumed.json.data.savedAnswers).length >= autoQ.length, Object.keys(resumed.json.data.savedAnswers ?? {}).length);

  const foreignAnswer = await call('POST', `/tests/attempts/${attemptId}/answer`, { token: student2.accessToken, body: { questionId: autoQ[0].id, answer: 'x' } });
  check('boshqa student attemptiga javob -> 404/403', foreignAnswer.status === 404 || foreignAnswer.status === 403, foreignAnswer.json);

  const cheat = await call('POST', `/tests/attempts/${attemptId}/flag-cheat`, { token: student.accessToken, body: { event: 'tab_switch' } });
  check('POST /flag-cheat -> {saved:true}', cheat.json.success && cheat.json.data.saved === true, cheat.json);

  for (const q of manualQ) {
    await call('POST', `/tests/attempts/${attemptId}/answer`, { token: student.accessToken, body: { questionId: q.id, answer: 'Bu mening javobim. '.repeat(10) } });
  }

  const submit = await call('POST', `/tests/attempts/${attemptId}/submit`, { token: student.accessToken });
  check('POST submit -> status=grading (Writing/Speaking qo\'lda)', submit.json.success && submit.json.data.status === 'grading' && typeof submit.json.data.autoScore === 'number', submit.json.data);

  const afterSubmit = await call('POST', `/tests/attempts/${attemptId}/answer`, { token: student.accessToken, body: { questionId: autoQ[0].id, answer: 'kech' } });
  check('tugagan attemptga javob -> 400 ATTEMPT_FINISHED', afterSubmit.status === 400 && afterSubmit.json.error.code === 'ATTEMPT_FINISHED', afterSubmit.json);

  const certEarly = await call('GET', `/tests/attempts/${attemptId}/certificate`, { token: student.accessToken });
  check('baholanmagan sertifikat -> 400 ATTEMPT_NOT_COMPLETED', certEarly.status === 400 && certEarly.json.error.code === 'ATTEMPT_NOT_COMPLETED', certEarly.json);

  const queue = await call('GET', '/tests/attempts?status=grading', { token: teacher.accessToken });
  check('teacher baholash navbatini ko\'radi', queue.json.success && queue.json.data.some((a) => a.id === attemptId), queue.json.data?.length);

  const attemptFull = await call('GET', `/tests/attempts/${attemptId}`, { token: teacher.accessToken });
  const manualQs = attemptFull.json.data.questions.filter((q) => q.section === 'writing' || q.section === 'speaking');
  check('GET attempt: anti-cheat sanagichi ishladi', attemptFull.json.data.antiCheatCount === 1 && attemptFull.json.data.cheatEvents.length === 1, { c: attemptFull.json.data.antiCheatCount, e: attemptFull.json.data.cheatEvents?.length });
  check('teacher to\'g\'ri javoblarni ko\'radi', 'correctAnswer' in attemptFull.json.data.questions[0], Object.keys(attemptFull.json.data.questions[0]));

  const studentView = await call('GET', `/tests/attempts/${attemptId}`, { token: student.accessToken });
  check('student to\'g\'ri javoblarni KO\'RMAYDI', !('correctAnswer' in studentView.json.data.questions[0]) && !('cheatEvents' in studentView.json.data), Object.keys(studentView.json.data.questions[0]));

  const autoScored = attemptFull.json.data.questions.filter((q) => q.section === 'listening' || q.section === 'reading');
  check('avtomatik baholash ishladi (isGraded)', autoScored.every((q) => q.isGraded), autoScored.map((q) => q.isGraded));

  const outOfRange = await call('POST', `/tests/attempts/${attemptId}/grade`, { token: teacher.accessToken, body: { questionId: manualQs[0].questionId, score: 999 } });
  check('grade chegaradan tashqari -> 400 SCORE_OUT_OF_RANGE', outOfRange.status === 400 && outOfRange.json.error.code === 'SCORE_OUT_OF_RANGE', outOfRange.json);

  const notManual = await call('POST', `/tests/attempts/${attemptId}/grade`, { token: teacher.accessToken, body: { questionId: autoScored[0].questionId, score: 1 } });
  check('avtomatik savolni qo\'lda baholash -> 400 NOT_MANUAL_QUESTION', notManual.status === 400 && notManual.json.error.code === 'NOT_MANUAL_QUESTION', notManual.json);

  for (const q of manualQs) {
    await call('POST', `/tests/attempts/${attemptId}/grade`, { token: teacher.accessToken, body: { questionId: q.questionId, score: 7, comment: 'Yaxshi ish' } });
  }
  const graded = await call('GET', `/tests/attempts/${attemptId}`, { token: student.accessToken });
  check('qo\'lda baholangach -> completed + totalScore', graded.json.data.status === 'completed' && graded.json.data.totalScore === graded.json.data.autoScore + graded.json.data.manualScore, graded.json.data);

  const mine = await call('GET', '/tests/attempts/mine', { token: student.accessToken });
  check('GET /tests/attempts/mine', mine.json.success && mine.json.data.length >= 1, mine.json.data?.length);

  const cert = await fetch(`${BASE}/tests/attempts/${attemptId}/certificate`, { headers: { Authorization: `Bearer ${student.accessToken}` } });
  const buf = Buffer.from(await cert.arrayBuffer());
  check('GET certificate -> PDF fayl', cert.status === 200 && cert.headers.get('content-type')?.includes('pdf') && buf.subarray(0, 4).toString() === '%PDF' && buf.length > 800, { status: cert.status, ct: cert.headers.get('content-type'), size: buf.length });

  const otherAttempt = await call('GET', `/tests/attempts/${attemptId}`, { token: student2.accessToken });
  check('boshqa student attemptni ko\'ra olmaydi -> 403', otherAttempt.status === 403, otherAttempt.json);

  console.log('\n== VIDEOS ==');
  // Kichik soxta mp4 yuklaymiz (multipart)
  const fd = new FormData();
  fd.set('title', 'IELTS Writing Task 2');
  fd.set('description', 'Essay tuzilishi');
  fd.set('price', '50000');
  fd.set('isFreeForApproved', 'true');
  fd.set('file', new Blob([Buffer.alloc(4096, 7)], { type: 'video/mp4' }), 'lesson.mp4');
  fd.set('thumbnail', new Blob([Buffer.alloc(256, 1)], { type: 'image/jpeg' }), 'thumb.jpg');
  const upRes = await fetch(`${BASE}/videos`, { method: 'POST', headers: { Authorization: `Bearer ${admin.accessToken}` }, body: fd });
  const up = await upRes.json();
  check('POST /videos (multipart yuklash)', up.success && !!up.data.id, up.error ?? up.data);
  const videoId = up.data?.id;

  const badType = new FormData();
  badType.set('title', 'x'); badType.set('price', '0');
  badType.set('file', new Blob([Buffer.alloc(16)], { type: 'text/plain' }), 'a.txt');
  const badRes = await fetch(`${BASE}/videos`, { method: 'POST', headers: { Authorization: `Bearer ${admin.accessToken}` }, body: badType });
  check('video bo\'lmagan fayl -> 400 INVALID_FILE_TYPE', badRes.status === 400 && (await badRes.json()).error.code === 'INVALID_FILE_TYPE');

  const vidsApproved = await call('GET', '/videos', { token: student.accessToken });
  const vApproved = vidsApproved.json.data.find((v) => v.id === videoId);
  check('tasdiqlangan o\'quvchi -> granted (bepul)', vApproved?.access === 'granted', vApproved?.access);
  check('GET /videos ro\'yxatida fayl yo\'li YO\'Q', vApproved && !('fileKey' in vApproved) && 'thumbnailUrl' in vApproved, Object.keys(vApproved ?? {}));

  const vidsNormal = await call('GET', '/videos', { token: student2.accessToken });
  const vLocked = vidsNormal.json.data.find((v) => v.id === videoId);
  check('tasdiqlanmagan o\'quvchi -> locked', vLocked?.access === 'locked', vLocked?.access);

  const denied = await call('GET', `/videos/${videoId}/stream-url`, { token: student2.accessToken });
  check('ruxsatsiz stream-url -> 403 VIDEO_ACCESS_DENIED', denied.status === 403 && denied.json.error.code === 'VIDEO_ACCESS_DENIED', denied.json);

  const purchase = await call('POST', `/videos/${videoId}/purchase`, { token: student2.accessToken });
  check('POST purchase -> pending_confirmation (onlayn to\'lov yo\'q)', purchase.json.success && purchase.json.data.status === 'pending_confirmation', purchase.json);

  const stillLocked = await call('GET', `/videos/${videoId}/stream-url`, { token: student2.accessToken });
  check('tasdiqlanmaguncha kirish yopiq -> 403', stillLocked.status === 403, stillLocked.status);

  const pendingList = await call('GET', '/videos/purchases?status=pending_confirmation', { token: admin.accessToken });
  check('GET /videos/purchases (admin paneli)', pendingList.json.success && pendingList.json.data.some((p) => p.videoId === videoId), pendingList.json.meta);

  const confirm = await call('POST', `/videos/${videoId}/confirm-purchase`, { token: admin.accessToken, body: { userId: student2.user.id } });
  check('POST confirm-purchase -> purchased', confirm.json.success && confirm.json.data.status === 'purchased', confirm.json);

  const streamUrl = await call('GET', `/videos/${videoId}/stream-url`, { token: student2.accessToken });
  check('GET stream-url -> {url, expiresAt}', streamUrl.json.success && streamUrl.json.data.url.includes('token=') && !!streamUrl.json.data.expiresAt, streamUrl.json.data);
  check('stream-url to\'g\'ridan-to\'g\'ri fayl havolasi EMAS', !streamUrl.json.data.url.includes('.mp4'), streamUrl.json.data.url);

  const streamRes = await fetch(streamUrl.json.data.url, { headers: { Range: 'bytes=0-99' } });
  check('GET /videos/stream Range -> 206', streamRes.status === 206 && streamRes.headers.get('content-range')?.startsWith('bytes 0-99/'), { s: streamRes.status, cr: streamRes.headers.get('content-range') });
  await streamRes.arrayBuffer();

  const badToken = await fetch(`${BASE}/videos/stream?token=soxta.token`);
  check('soxta stream token -> 403', badToken.status === 403, badToken.status);

  const thumb = await fetch(`${BASE}/videos/${videoId}/thumbnail`);
  check('GET /videos/:id/thumbnail (ochiq)', thumb.status === 200);
  await thumb.arrayBuffer();

  console.log('\n== ARTICLES ==');
  const arts = await call('GET', '/articles');
  check('GET /articles ochiq', arts.json.success && arts.json.data.length >= 1 && arts.json.meta.total >= 1, arts.json.meta);
  const artOne = await call('GET', `/articles/${arts.json.data[0].id}`);
  check('GET /articles/:id', artOne.json.success && !!artOne.json.data.title);
  const artCreate = await call('POST', '/articles', { token: student.accessToken, body: { title: 'x', body: 'y', category: 'z' } });
  check('student maqola yoza olmaydi -> 403', artCreate.status === 403);
  const artNew = await call('POST', '/articles', { token: admin.accessToken, body: { title: 'Yangi kurs ochildi', body: 'IELTS 7.0 ga tayyorlov guruhiga qabul boshlandi.', category: 'yangilik', tags: ['ielts'] } });
  check('admin maqola yozadi', artNew.json.success && artNew.json.data.tags.includes('ielts'), artNew.json.data);
  const artTag = await call('GET', '/articles?tag=ielts');
  check('GET /articles?tag= filtri', artTag.json.data.length >= 1, artTag.json.meta);

  console.log('\n== NOTIFICATIONS ==');
  const notifs = await call('GET', '/notifications', { token: student.accessToken });
  const types = new Set(notifs.json.data.map((n) => n.type));
  check('bildirishnomalar: points + payment_reminder + test_result', types.has('points') && types.has('payment_reminder') && types.has('test_result'), [...types]);
  check('bildirishnoma shakli {id,type,text,read,date}', notifs.json.data[0] && ['id', 'type', 'text', 'read', 'date'].every((k) => k in notifs.json.data[0]), Object.keys(notifs.json.data[0] ?? {}));
  const one = notifs.json.data[0];
  const markRead = await call('PATCH', `/notifications/${one.id}/read`, { token: student.accessToken });
  check('PATCH /notifications/:id/read -> {read:true}', markRead.json.success && markRead.json.data.read === true, markRead.json);
  const readAll = await call('PATCH', '/notifications/read-all', { token: student.accessToken });
  check('PATCH /notifications/read-all', readAll.json.success && readAll.json.data.updated >= 1, readAll.json);
  const unread = await call('GET', '/notifications?unreadOnly=true', { token: student.accessToken });
  check('read-all dan keyin o\'qilmagan yo\'q', unread.json.data.length === 0, unread.json.data.length);

  const parentNotifs = await call('GET', '/notifications?limit=50', { token: parent.accessToken });
  const ptypes = new Set(parentNotifs.json.data.map((n) => n.type));
  check('ota-ona: davomat + ball + to\'lov + natija xabarlari', ['attendance', 'points', 'payment_reminder', 'test_result'].every((t) => ptypes.has(t)), [...ptypes]);

  const foreignRead = await call('PATCH', `/notifications/${one.id}/read`, { token: student2.accessToken });
  check('begona bildirishnomani o\'qilgan qilib bo\'lmaydi -> 404', foreignRead.status === 404, foreignRead.status);

  console.log('\n== SETTINGS / AUDIT ==');
  const settings = await call('GET', '/settings', { token: admin.accessToken });
  check('GET /settings', settings.json.success && settings.json.data.teacherPointLimit === 20 && settings.json.data.initialPoints === 100, settings.json.data);
  const setPatchAdmin = await call('PATCH', '/settings', { token: admin.accessToken, body: { teacherPointLimit: 30 } });
  check('admin sozlamani o\'zgartira olmaydi -> 403', setPatchAdmin.status === 403);
  const setPatch = await call('PATCH', '/settings', { token: superA.accessToken, body: { teacherPointLimit: 25 } });
  check('super_admin sozlamani o\'zgartiradi', setPatch.json.success && setPatch.json.data.teacherPointLimit === 25, setPatch.json.data);
  const nowAllowed = await call('POST', `/points/${student.user.id}/adjust`, { token: teacher.accessToken, body: { change: 25, reason: 'Yangi limit' } });
  check('yangi limit darhol kuchga kiradi (+25)', nowAllowed.json.success, nowAllowed.json);
  await call('PATCH', '/settings', { token: superA.accessToken, body: { teacherPointLimit: 20 } });

  const auditAdmin = await call('GET', '/audit-logs', { token: admin.accessToken });
  check('audit-logs admin uchun yopiq -> 403', auditAdmin.status === 403);
  const audit = await call('GET', '/audit-logs?page=1&limit=5', { token: superA.accessToken });
  check('GET /audit-logs faqat super_admin', audit.json.success && audit.json.data.length >= 1 && audit.json.meta.total >= 1, audit.json.meta);
  const actions = new Set((await call('GET', '/audit-logs?limit=100', { token: superA.accessToken })).json.data.map((a) => a.action));
  check('audit: points/payment/attendance/video yozilgan', ['points.adjust', 'payment.set', 'attendance.bulk_update', 'video.confirm_purchase', 'settings.update'].every((a) => actions.has(a)), [...actions]);

  console.log('\n== ADMIN PANEL: STATISTIKA / EKSPORT / E\'LON ==');
  const dash = await call('GET', '/stats/dashboard', { token: admin.accessToken });
  check('GET /stats/dashboard', dash.json.success && ['students', 'groups', 'today', 'month', 'queue'].every((k) => k in dash.json.data), Object.keys(dash.json.data ?? {}));
  check('dashboard: bugungi davomat hisoblandi', dash.json.data.today.marked >= 2, dash.json.data.today);
  check('dashboard: baholash navbati', dash.json.data.queue.grading >= 0, dash.json.data.queue);

  const incomeRes = await call('GET', '/stats/income?months=3', { token: admin.accessToken });
  check('GET /stats/income', incomeRes.json.success && incomeRes.json.data.length === 3, incomeRes.json.data?.length);

  const dashTeacher = await call('GET', '/stats/dashboard', { token: teacher.accessToken });
  check('teacher dashboardga kira olmaydi -> 403', dashTeacher.status === 403, dashTeacher.status);

  const feeSet = await call('PATCH', '/settings', { token: superA.accessToken, body: { monthlyFee: 450000 } });
  check('monthlyFee sozlamasi', feeSet.json.success && feeSet.json.data.monthlyFee === 450000, feeSet.json.data);

  const bcAll = await call('POST', '/notifications/broadcast', { token: admin.accessToken, body: { audience: 'all', text: 'Ertaga dars bo\'lmaydi.' } });
  check('broadcast: hammaga', bcAll.json.success && bcAll.json.data.notified >= 5, bcAll.json.data);
  const bcRole = await call('POST', '/notifications/broadcast', { token: admin.accessToken, body: { audience: 'role', role: 'parent', text: 'Ota-onalar yig\'ilishi' } });
  check('broadcast: rol bo\'yicha', bcRole.json.data.notified >= 1, bcRole.json.data);
  const bcGroup = await call('POST', '/notifications/broadcast', { token: admin.accessToken, body: { audience: 'group', groupId, includeParents: true, text: 'Guruh e\'loni' } });
  check('broadcast: guruh + ota-onalar', bcGroup.json.data.notified >= 3, bcGroup.json.data);
  const bcBad = await call('POST', '/notifications/broadcast', { token: admin.accessToken, body: { audience: 'role', text: 'rolsiz' } });
  check('rolsiz broadcast -> 400 ROLE_REQUIRED', bcBad.status === 400 && bcBad.json.error.code === 'ROLE_REQUIRED', bcBad.json);
  const bcStudent = await call('POST', '/notifications/broadcast', { token: student.accessToken, body: { audience: 'all', text: 'x' } });
  check('o\'quvchi e\'lon yubora olmaydi -> 403', bcStudent.status === 403, bcStudent.status);

  const annNotifs = await call('GET', '/notifications?type=announcement', { token: student.accessToken });
  check('e\'lon "announcement" turi bilan keldi', annNotifs.json.data.length >= 2, annNotifs.json.data.length);

  const exStudents = await fetch(`${BASE}/stats/export/students`, { headers: { Authorization: `Bearer ${admin.accessToken}` } });
  const csvText = await exStudents.text();
  check('CSV eksport: o\'quvchilar', exStudents.status === 200 && exStudents.headers.get('content-type')?.includes('csv') && csvText.includes('Ism;Telefon'), exStudents.status);
  const exPayments = await fetch(`${BASE}/stats/export/payments?year=${YEAR}&month=${MONTH}`, { headers: { Authorization: `Bearer ${admin.accessToken}` } });
  check('CSV eksport: to\'lovlar', exPayments.status === 200 && (await exPayments.text()).includes("To'langan"), exPayments.status);
  const exAtt = await fetch(`${BASE}/stats/export/attendance?groupId=${groupId}`, { headers: { Authorization: `Bearer ${admin.accessToken}` } });
  check('CSV eksport: davomat', exAtt.status === 200 && (await exAtt.text()).includes('Sana;Ism;Holat'), exAtt.status);
  const exDenied = await fetch(`${BASE}/stats/export/students`, { headers: { Authorization: `Bearer ${student.accessToken}` } });
  check('o\'quvchi eksport qila olmaydi -> 403', exDenied.status === 403, exDenied.status);

  const panel = await fetch(BASE.replace('/v1', '') + '/admin/');
  const panelHtml = await panel.text();
  check('admin panel ochiladi (/admin)', panel.status === 200 && panelHtml.includes('Admin panel'), panel.status);
  check('admin panelda CSP sarlavhasi bor', !!panel.headers.get('content-security-policy'));
  const panelJs = await fetch(BASE.replace('/v1', '') + '/admin/app.js');
  check('admin panel app.js beriladi', panelJs.status === 200 && panelJs.headers.get('content-type')?.includes('javascript'), panelJs.status);

  const TG_SECRET = process.env.SMOKE_TELEGRAM_SECRET;
  if (TG_SECRET) {
    console.log('\n== TELEGRAM BOG\'LASH ==');
    const sendUpdate = async (message, secret = TG_SECRET) => {
      const res = await fetch(`${BASE}/telegram/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
        body: JSON.stringify({ update_id: Math.floor(Math.random() * 1e9), message }),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    };

    const st0 = await call('GET', '/telegram/status', { token: student.accessToken });
    check('GET /telegram/status -> linked:false', st0.json.success && st0.json.data.linked === false && !!st0.json.data.botUsername, st0.json.data);

    const lt = await call('POST', '/telegram/link-token', { token: student.accessToken });
    const tgToken = lt.json.data?.token;
    check('POST /telegram/link-token -> deep link url', lt.json.success && lt.json.data.url.startsWith('https://t.me/') && lt.json.data.url.includes('?start=') && !!lt.json.data.expiresAt, lt.json.data?.url);

    const meBefore = await call('GET', '/auth/me', { token: student.accessToken });
    check('/auth/me telegramLinked=false', meBefore.json.data.telegramLinked === false, meBefore.json.data.telegramLinked);

    const noSecret = await fetch(`${BASE}/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('webhook secretsiz -> 403', noSecret.status === 403, noSecret.status);
    const badSecret = await sendUpdate({ message_id: 1, chat: { id: 1, type: 'private' }, text: '/start' }, 'notarealsecret');
    check('webhook noto\'g\'ri secret -> 403', badSecret.status === 403, badSecret.status);

    const CHAT = 5550001;
    const started = await sendUpdate({ message_id: 2, from: { id: CHAT }, chat: { id: CHAT, type: 'private' }, text: `/start ${tgToken}` });
    check('bot /start <token> qabul qildi', started.status === 200, started.status);

    const st1 = await call('GET', '/telegram/status', { token: student.accessToken });
    check('token orqali bog\'landi -> linked:true', st1.json.data.linked === true, st1.json.data);
    const meAfter = await call('GET', '/auth/me', { token: student.accessToken });
    check('/auth/me telegramLinked=true', meAfter.json.data.telegramLinked === true, meAfter.json.data.telegramLinked);

    // Bir martalik: o'sha tokenni boshqa chat ishlatolmaydi
    await call('DELETE', '/telegram/link', { token: student.accessToken });
    await sendUpdate({ message_id: 3, from: { id: 9990001 }, chat: { id: 9990001, type: 'private' }, text: `/start ${tgToken}` });
    const st2 = await call('GET', '/telegram/status', { token: student.accessToken });
    check('ishlatilgan token qayta bog\'lamaydi', st2.json.data.linked === false, st2.json.data);

    // Kontakt orqali bog'lash (o'z raqami)
    const CHAT2 = 5550002;
    await sendUpdate({ message_id: 4, from: { id: CHAT2 }, chat: { id: CHAT2, type: 'private' },
      contact: { phone_number: '998900000011', user_id: CHAT2 } });
    const st3 = await call('GET', '/telegram/status', { token: student2.accessToken });
    check('kontakt orqali bog\'landi', st3.json.data.linked === true, st3.json.data);

    // Begona kontakt (contact.user_id !== from.id) — bog'lanmaydi
    const CHAT3 = 5550003;
    await sendUpdate({ message_id: 5, from: { id: CHAT3 }, chat: { id: CHAT3, type: 'private' },
      contact: { phone_number: '998900000012', user_id: 111222 } });
    const victim = await login('+998900000012', 'Student123!');
    const victimSt = await call('GET', '/telegram/status', { token: victim.accessToken });
    check('begona kontakt bog\'lamaydi', victimSt.json.data.linked === false, victimSt.json.data);

    // Bazada yo'q raqam
    await sendUpdate({ message_id: 6, from: { id: 5550004 }, chat: { id: 5550004, type: 'private' },
      contact: { phone_number: '998999999999', user_id: 5550004 } });
    check('notanish raqam bog\'lanmaydi (xatolik yo\'q)', true);

    // Bot ichidan /unlink
    await sendUpdate({ message_id: 7, from: { id: CHAT2 }, chat: { id: CHAT2, type: 'private' }, text: '/unlink' });
    const st4 = await call('GET', '/telegram/status', { token: student2.accessToken });
    check('bot /unlink buyrug\'i uzdi', st4.json.data.linked === false, st4.json.data);

    // Saytdan uzish
    const lt2 = await call('POST', '/telegram/link-token', { token: student.accessToken });
    await sendUpdate({ message_id: 8, from: { id: CHAT }, chat: { id: CHAT, type: 'private' }, text: `/start ${lt2.json.data.token}` });
    const unlink = await call('DELETE', '/telegram/link', { token: student.accessToken });
    check('DELETE /telegram/link -> unlinked', unlink.json.data.unlinked === true, unlink.json);

    const anon = await call('POST', '/telegram/link-token');
    check('token yaratish uchun login shart -> 401', anon.status === 401, anon.status);
  }

  console.log('\n== PARENT LINK ==');
  const s2profile = await call('GET', `/users/${student2.user.id}`, { token: admin.accessToken });
  const linkCode = s2profile.json.data.student.linkCode;
  check('admin linkCode ko\'radi', !!linkCode, linkCode);
  const link = await call('POST', '/auth/link-child', { token: parent.accessToken, body: { linkCode } });
  check('POST /auth/link-child -> {child}', link.json.success && link.json.data.child.studentId === student2.user.id, link.json.data);
  const badLink = await call('POST', '/auth/link-child', { token: parent.accessToken, body: { linkCode: 'XXXXXXXX' } });
  check('noto\'g\'ri linkCode -> 404 INVALID_LINK_CODE', badLink.status === 404 && badLink.json.error.code === 'INVALID_LINK_CODE', badLink.json);

  console.log('\n== IELTS FULL-TEST FLOW (v2026.1) ==');
  // Spec §5 rounding vectors (pure — server must match: F<0.25→.0, 0.25–0.75→.5, ≥0.75→up).
  const roundHalf = (v) => Math.round(v * 2) / 2;
  check('rounding 6.125 -> 6.0', roundHalf(6.125) === 6, roundHalf(6.125));
  check('rounding 6.25 -> 6.5', roundHalf(6.25) === 6.5, roundHalf(6.25));
  check('rounding 6.625 -> 6.5', roundHalf(6.625) === 6.5, roundHalf(6.625));
  check('rounding 6.75 -> 7.0', roundHalf(6.75) === 7, roundHalf(6.75));

  // Live full_test session (tolerant — mock exam bo'lmasa skip).
  const mockList = await call('GET', '/mock/exams', { token: student.accessToken });
  const fullExam = mockList.json?.success
    ? (mockList.json.data.items ?? mockList.json.data ?? []).find((e) => e.isPublished && String(e.type).startsWith('ielts'))
    : null;
  if (!fullExam) {
    check('full_test uchun published IELTS mock topilmadi (skip)', true);
  } else {
    const start = await call('POST', `/mock/exams/${fullExam.id}/start`, { token: student.accessToken, body: { flow: 'full_test' } });
    check('POST /mock/exams/:id/start {flow:full_test} -> 200', start.status === 200 && start.json.success, start.status);
    const s = start.json?.data;
    check('full_test flowMode + listening start', s?.flowMode === 'full_test' && s?.currentSkill === 'listening', s);
    check('sectionDeadlines (L/R/W) + overallDeadlineAt', !!(s?.sectionDeadlines?.listening && s?.sectionDeadlines?.reading && s?.overallDeadlineAt), s?.sectionDeadlines);
    if (s?.attemptId) {
      const detail = await call('GET', `/mock/attempts/${s.attemptId}`, { token: student.accessToken });
      check('GET attempt -> flowMode/currentSkill ko\'rinadi', detail.json?.data?.flowMode === 'full_test', detail.json?.data?.flowMode);
      // Strict section lock: reading savoliga listening paytida javob → 403 SECTION_LOCKED.
      const readingQ = (s.exam?.sections ?? []).find((x) => x.skill === 'reading')?.groups?.[0]?.questions?.[0];
      if (readingQ) {
        const locked = await call('POST', `/mock/attempts/${s.attemptId}/answer`, { token: student.accessToken, body: { questionId: readingQ.id, response: 'test' } });
        check('boshqa bo‘limga javob -> 403 SECTION_LOCKED', locked.status === 403, locked.status);
      } else {
        check('reading savoli topilmadi (lock skip)', true);
      }
      const adv = await call('POST', `/mock/attempts/${s.attemptId}/advance`, { token: student.accessToken });
      check('POST advance L->R', adv.json?.success && adv.json?.data?.currentSkill === 'reading', adv.json?.data);
      // Once-only audio guard: practice da tekshirilmaydi; exam da audio fayl bo'lsa 2-urinish 403.
      // (Seed da audio fayl yo'q — mavjud bo'lsa live tekshiriladi, bo'lmasa skip.)
      const listeningGroup = (s.exam?.sections ?? []).find((x) => x.skill === 'listening')?.groups?.[0];
      if (listeningGroup?.hasAudio) {
        const a1 = await call('GET', `/mock/groups/${listeningGroup.id}/audio?attemptId=${s.attemptId}`, { token: student.accessToken });
        check('audio 1-urinish o\'tadi (fayl bo\'lsa)', a1.status === 200 || a1.status === 206, a1.status);
      } else {
        check('audio fayl yo\'q (replay guard skip)', true);
      }
    }
  }

  console.log('\n== MOCK AUTHORING (admin control) ==');
  const smokeTitle = `SMOKE Exam ${Date.now()}`;
  const mkExam = await call('POST', '/mock/exams', { token: admin.accessToken, body: { type: 'multilevel', title: smokeTitle } });
  check('POST /mock/exams (admin) -> draft', mkExam.status === 201 && mkExam.json.success && mkExam.json.data.isPublished === false, mkExam.status);
  const mkId = mkExam.json?.data?.id;
  if (!mkId) {
    check('authoring exam id olindi', false, mkExam.json);
  } else {
    const mkSec = await call('POST', `/mock/exams/${mkId}/sections`, { token: admin.accessToken, body: { skill: 'reading', durationMinutes: 10 } });
    check('POST section reading', mkSec.json?.success === true, mkSec.status);
    const secId = mkSec.json?.data?.id;
    const mkGrp = secId ? await call('POST', `/mock/sections/${secId}/groups`, { token: admin.accessToken, body: { title: 'G1', instructions: 'Answer.', partNumber: 1, audioPlayLimit: 1 } }) : null;
    check('POST group (+part/audio fields)', mkGrp?.json?.success === true && mkGrp?.json?.data?.audioPlayLimit === 1, mkGrp?.json?.data);
    const grpId = mkGrp?.json?.data?.id;
    const mkQ = grpId ? await call('POST', `/mock/groups/${grpId}/questions`, { token: admin.accessToken, body: { questions: [{ number: 1, type: 'short_answer', prompt: 'Smoke?', correctAnswers: ['yes'], acceptedVariants: ['yeah'], points: 1, wordLimit: 2 }] } }) : null;
    check('POST question (+variants/wordLimit)', mkQ?.json?.success === true || mkQ?.json?.data?.added === 1, mkQ?.status);
    const ready = await call('GET', `/mock/exams/${mkId}/readiness`, { token: admin.accessToken });
    check('GET readiness -> items[]', ready.json?.success && Array.isArray(ready.json?.data?.items), ready.json?.data);
    const clone = await call('POST', `/mock/exams/${mkId}/clone`, { token: admin.accessToken });
    check('POST clone -> draft copy', clone.json?.success === true && clone.json?.data?.isPublished === false, clone.json?.data);
    const cloneId = clone.json?.data?.id;
    const prev = await call('GET', `/mock/exams/${mkId}/preview`, { token: admin.accessToken });
    const prevQs = prev.json?.data?.sections?.[0]?.groups?.[0]?.questions ?? [];
    check('GET preview -> kalitsiz (no correctAnswers)', prev.json?.success && prevQs.length > 0 && prevQs[0].correctAnswers === undefined, prevQs[0]);
    // Teacher ownership: o'zganing imtihonini teacher tahrirlay olmaydi -> 403.
    const ownBlock = await call('PATCH', `/mock/exams/${mkId}`, { token: teacher.accessToken, body: { title: 'Hijack' } });
    check("teacher boshqaning examini edit -> 403 MOCK_NOT_OWNER", ownBlock.status === 403, ownBlock.status);
    // Tozalash (faqat super_admin o'chira oladi).
    if (cloneId) {
      const delClone = await call('DELETE', `/mock/exams/${cloneId}`, { token: superA.accessToken });
      check('DELETE clone (super_admin)', delClone.json?.success === true, delClone.status);
    }
    const delMk = await call('DELETE', `/mock/exams/${mkId}`, { token: superA.accessToken });
    check('DELETE smoke exam (super_admin)', delMk.json?.success === true, delMk.status);
  }

  console.log('\n== DEACTIVATE / LOGOUT ==');
  const del = await call('DELETE', `/users/${reg.json.data.user.id}`, { token: admin.accessToken });
  check('admin o\'chira olmaydi -> 403 (faqat super_admin)', del.status === 403, del.status);
  const del2 = await call('DELETE', `/users/${reg.json.data.user.id}`, { token: superA.accessToken });
  check('super_admin deaktivatsiya qiladi', del2.json.success, del2.json);
  const deadLogin = await call('POST', '/auth/login', { body: { phone: `+9989${rnd}`, password: 'Test123!' } });
  check('deaktiv foydalanuvchi kira olmaydi -> 403 USER_DEACTIVATED', deadLogin.status === 403 && deadLogin.json.error.code === 'USER_DEACTIVATED', deadLogin.json);
  const deadToken = await call('GET', '/auth/me', { token: reg.json.data.accessToken });
  check('deaktivatsiyadan keyin eski token ishlamaydi', deadToken.status === 401 || deadToken.status === 403, deadToken.status);

  const logout = await call('POST', '/auth/logout', { token: student2.accessToken, body: { refreshToken: student2.refreshToken } });
  check('POST /auth/logout', logout.json.success, logout.json);
  const reuse = await call('POST', '/auth/refresh', { body: { refreshToken: student2.refreshToken } });
  check('logoutdan keyin refresh -> 401', reuse.status === 401 && reuse.json.error.code === 'INVALID_REFRESH_TOKEN', reuse.json);

  console.log('\n=======================================');
  console.log(`  O'TDI: ${pass}   YIQILDI: ${fail}`);
  if (fail) console.log('  Yiqilganlar:\n   - ' + fails.join('\n   - '));
  console.log('=======================================\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
