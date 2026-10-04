/* Integration verification ONLY against the isolated migration fixture database. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const database = new URL(process.env.DATABASE_URL || '');
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.pathname, '/multilevel_verification');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.STREAM_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
process.env.TELEGRAM_MODE = 'off';
process.env.STORAGE_DIR = path.resolve(__dirname, '../../../.multilevel-fixture-storage');
require('./multilevel-fixture-assets.cjs')(process.env.STORAGE_DIR);
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('../dist/app.module');
const { multilevelFixture } = require('../dist/mock/multilevel.fixture');

(async () => {
  const prisma = new PrismaClient();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], abortOnError: false });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const token = (sub) => jwt.sign({ sub }, { expiresIn: '10m' });
  let checks = 0;
  async function request(method, route, actor, body, expected = 200) {
    const res = await fetch(origin + '/v1' + route, { method, headers: { ...(actor ? { Authorization: 'Bearer ' + token(actor) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    assert.equal(res.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    checks++;
    return data.data;
  }
  try {
    await prisma.studentProfile.update({where:{userId:'migration-student'},data:{availablePrograms:['IELTS'],activeProgram:'IELTS'}});
    await request('GET', '/exam-programs/mine', null, null, 401);
    const state = await request('GET', '/exam-programs/mine', 'migration-student');
    assert.deepEqual(state.availablePrograms, ['IELTS']);
    await request('PATCH', '/exam-programs/mine', 'migration-student', { program: 'MULTILEVEL' }, 403);
    await request('PUT', '/exam-programs/students/migration-student', 'migration-student', { availablePrograms: ['MULTILEVEL'] }, 403);
    await request('PUT', '/exam-programs/students/migration-student', 'migration-admin', { availablePrograms: ['invented'] }, 400);
    await prisma.user.upsert({ where:{id:'http-teacher'},update:{},create: { id: 'http-teacher', name: 'Fixture teacher', phone: 'fixture-teacher', role: 'teacher', passwordHash: 'not-a-login-hash' } });
    await request('GET', '/exam-programs/students/migration-student', 'http-teacher', null, 403);
    const fixture = multilevelFixture();
    const exam = await prisma.mockExam.create({ data: {
      type: 'multilevel', title: 'Original Multilevel HTTP fixture', profile: 'full_mock', specificationVersion: 'UZBMB_MULTILEVEL_EN_2026_V1', createdById: 'migration-admin',
      sections: { create: fixture.map((s, si) => {
        let number = 0;
        return { skill: s.skill, sortOrder: si, groups: { create: s.groups.map((g) => ({
          sortOrder: g.sortOrder, partNumber: g.partNumber, passageText: s.skill === 'reading' ? 'The fictional community library has a reading room and a garden. Volunteers organize a weekly book exchange.' : g.passageText,
          audioKey: g.audioKey, audioDurationSec: g.audioDurationSec, imageKey: g.imageKey,
          questions: { create: g.questions.map((q, qi) => ({ type: q.type, number: ++number, sortOrder: qi, prompt: q.prompt, points: q.points, options: q.options, wordLimit: q.wordLimit,
            correctAnswers: s.skill === 'writing' || s.skill === 'speaking' ? [] : q.type === 'true_false_notgiven' ? ['TRUE'] : ['multiple_choice','matching','matching_headings'].includes(q.type) ? ['A'] : ['library'] })) },
        })) } };
      }) },
    } });
    await request('PATCH', `/mock/exams/${exam.id}`, 'migration-admin', { isPublished: true });
    await request('POST', `/mock/exams/${exam.id}/start`, 'migration-student', { flow: 'full_test' }, 403);
    await request('PUT', '/exam-programs/students/migration-student', 'migration-admin', { availablePrograms: ['IELTS','MULTILEVEL'], activeProgram: 'MULTILEVEL' });
    const selected = await request('GET', '/exam-programs/mine', 'migration-student');
    assert.equal(selected.activeProgram, 'MULTILEVEL');
    const started = await request('POST', `/mock/exams/${exam.id}/start`, 'migration-student', { flow: 'full_test' }, 201);
    assert.equal(started.currentSkill, 'listening');
    assert.equal(started.exam.specificationVersion, 'UZBMB_MULTILEVEL_EN_2026_V1');
    assert.ok(Math.abs(Date.parse(started.sectionDeadlines.listening) - Date.parse(started.startedAt) - 2700000) < 1000);
    const reading = started.exam.sections.find((s) => s.skill === 'reading');
    const listening = started.exam.sections.find((s) => s.skill === 'listening');
    const qid = listening.groups[0].questions[0].id;
    assert.equal('correctAnswers' in listening.groups[0].questions[0], false);
    assert.equal('audioScript' in listening.groups[0], false);
    await request('POST', `/mock/attempts/${started.attemptId}/answer`, 'migration-student', { questionId: reading.groups[0].questions[0].id, response: 'library' }, 403);
    await request('POST', `/mock/attempts/${started.attemptId}/answer`, 'migration-student', { questionId: qid, response: 'A' }, 201);
    await request('PUT', '/exam-programs/students/migration-student', 'migration-admin', { availablePrograms: ['IELTS'] });
    await request('POST', `/mock/attempts/${started.attemptId}/answer`, 'migration-student', { questionId: qid, response: 'B' }, 403);
    await request('PUT', '/exam-programs/students/migration-student', 'migration-admin', { availablePrograms: ['IELTS','MULTILEVEL'], activeProgram: 'MULTILEVEL' });
    const phase = await request('POST', `/mock/attempts/${started.attemptId}/listening/${listening.groups[0].id}/prepare`, 'migration-student', {}, 201);
    assert.equal(phase.playLimit, 2);
    assert.equal(Date.parse(phase.prepEndsAt)-Date.parse(phase.startedAt),20000);
    await request('POST', `/mock/attempts/${started.attemptId}/listening/${listening.groups[0].id}/play`, 'migration-student', {}, 403);
    const groupId=listening.groups[0].id;
    const expiredPhase={...phase,prepEndsAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()-1000).toISOString()};
    await prisma.mockAttempt.update({where:{id:started.attemptId},data:{mediaState:{[groupId]:expiredPhase}}});
    const played=await request('POST',`/mock/attempts/${started.attemptId}/listening/${groupId}/play`,'migration-student',{},201);
    assert.equal(played.plays,1);
    const media=await fetch(origin+`/v1/mock/groups/${groupId}/audio?attemptId=${started.attemptId}`,{headers:{Authorization:'Bearer '+token('migration-student'),Range:'bytes=0-43'}});
    assert.equal(media.status,206);assert.equal(Buffer.from(await media.arrayBuffer()).subarray(0,4).toString(),'RIFF');checks++;
    const secondPhase={...played,expiresAt:new Date(Date.now()-1000).toISOString()};
    await prisma.mockAttempt.update({where:{id:started.attemptId},data:{mediaState:{[groupId]:secondPhase}}});
    const secondPlay=await request('POST',`/mock/attempts/${started.attemptId}/listening/${groupId}/play`,'migration-student',{},201);
    assert.equal(secondPlay.plays,2);
    await prisma.mockAttempt.update({where:{id:started.attemptId},data:{mediaState:{[groupId]:{...secondPlay,expiresAt:new Date(Date.now()-1000).toISOString()}}}});
    await request('POST',`/mock/attempts/${started.attemptId}/listening/${groupId}/play`,'migration-student',{},403);
    await request('POST', `/mock/attempts/${started.attemptId}/advance`, 'migration-student', {}, 201);
    const advanced = await prisma.mockAttempt.findUniqueOrThrow({where:{id:started.attemptId}});
    assert.equal(advanced.currentSkill,'reading');
    const readingSeconds=(Date.parse(advanced.sectionDeadlines.reading)-Date.now())/1000;
    assert.ok(readingSeconds <= 3600 && readingSeconds > 3590, 'Early advance must not add unused Listening time');
    await request('POST', `/mock/attempts/${started.attemptId}/answer`, 'migration-student', {questionId:qid,response:'B'},403);
    await request('PATCH', `/mock/exams/${exam.id}`, 'migration-admin', { title: 'Cannot rewrite used content' }, 409);
    const submitted = await request('POST', `/mock/attempts/${started.attemptId}/submit`, 'migration-student', {}, 201);
    assert.equal(submitted.status,'grading'); assert.equal(submitted.overallScore,null);
    const duplicate = await request('POST', `/mock/attempts/${started.attemptId}/submit`, 'migration-student', {}, 201);
    assert.equal(duplicate.status,'grading'); assert.equal(duplicate.overallScore,null);
    const writingQuestion=started.exam.sections.find((s)=>s.skill==='writing').groups[0].questions[0].id;
    await request('POST',`/mock/attempts/${started.attemptId}/grade`,'http-teacher',{questionId:writingQuestion,score:5},403);
    await request('POST',`/mock/attempts/${started.attemptId}/grade`,'migration-admin',{questionId:writingQuestion,score:6},400);
    await request('POST',`/mock/attempts/${started.attemptId}/grade`,'migration-admin',{questionId:writingQuestion,score:4.25},400);
    await request('POST',`/mock/attempts/${started.attemptId}/grade`,'migration-admin',{questionId:writingQuestion,score:5,feedback:'Original fixture review'},201);
    const ielts=await prisma.mockExam.create({data:{type:'ielts_academic',title:'IELTS regression fixture',isPublished:true,sections:{create:[{skill:'reading',groups:{create:[{passageText:'The original fictional community has a library.',questions:{create:[{number:1,type:'short_answer',prompt:'Which facility does the community have?',correctAnswers:['library'],points:1,wordLimit:1}]}}]}}]}}});
    const ieltsStart=await request('POST',`/mock/exams/${ielts.id}/start`,'migration-student',{mode:'practice'},201);
    assert.equal(ieltsStart.exam.specificationVersion,undefined);
    await request('POST',`/mock/attempts/${ieltsStart.attemptId}/answer`,'migration-student',{questionId:ieltsStart.exam.sections[0].groups[0].questions[0].id,response:'library'},201);
    const ieltsResult=await request('POST',`/mock/attempts/${ieltsStart.attemptId}/submit`,'migration-student',{},201);
    assert.equal(ieltsResult.status,'completed');assert.equal(ieltsResult.sectionBands.reading,9);assert.equal(ieltsResult.overallBand,9);
    const history = await request('GET','/mock/attempts/mine?program=MULTILEVEL','migration-student');
    assert.ok(history.every((a)=>a.examType==='multilevel'));
    console.log(`PASS: ${checks} authenticated HTTP checks; enrollment, roles, publication, sanitized payloads, deadlines, media preview, immutable attempted content, duplicate submit and track history`);
  } finally { await app.close(); await prisma.$disconnect(); }
})().catch((e) => { console.error(e); process.exitCode=1; });
