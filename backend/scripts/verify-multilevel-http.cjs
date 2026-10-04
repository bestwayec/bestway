/* Integration verification ONLY against the isolated migration fixture database. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
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
  async function mediaRequest(route, actor, expected, form) {
    const res = await fetch(origin + '/v1' + route, { method: form ? 'POST' : 'GET', headers: actor ? { Authorization: 'Bearer ' + token(actor) } : {}, ...(form ? { body: form } : {}) });
    assert.equal(res.status, expected, route); await res.arrayBuffer(); checks++;
  }
  async function upload(attempt, question, actor, content, expected = 201) {
    const form = new FormData(); form.append('audio', new Blob([content], {type:'audio/wav'}), 'synthetic.wav');
    await mediaRequest(`/mock/attempts/${attempt}/speaking/${question}`, actor, expected, form);
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

    const ieltsDraft=await request('POST','/mock/exams','migration-admin',{type:'ielts_academic',title:'IELTS authoring regression fixture',starterStructure:true},201);
    const ieltsDraftDetail=await request('GET',`/mock/exams/${ieltsDraft.id}`,'migration-admin');
    assert.deepEqual(ieltsDraftDetail.sections.map((s)=>s.groups.length),[4,3,2,3]);
    const draftListening=ieltsDraftDetail.sections[0];
    await request('POST',`/mock/sections/${draftListening.id}/groups`,'migration-admin',{partNumber:5},400);
    await request('PATCH',`/mock/groups/${draftListening.groups[0].id}`,'migration-admin',{partNumber:5},400);
    const ieltsFull=await prisma.mockExam.create({data:{type:'ielts_academic',title:'IELTS four-skill regression fixture',profile:'full_mock',isPublished:true,sections:{create:[
      {skill:'listening',sortOrder:0,groups:{create:{partNumber:1,audioDurationSec:60,audioKey:fixture[0].groups[0].audioKey,questions:{create:{number:1,type:'short_answer',prompt:'Name the facility.',points:1,correctAnswers:['library']}}}}},
      {skill:'reading',sortOrder:1,groups:{create:{questions:{create:{number:2,type:'short_answer',prompt:'Name the facility.',points:1,correctAnswers:['library']}}}}},
      {skill:'writing',sortOrder:2,groups:{create:{questions:{create:[{number:3,type:'essay_task1',prompt:'Describe the fictional graph.',points:9},{number:4,type:'essay_task2',prompt:'Discuss community reading.',points:9}]}}}},
      {skill:'speaking',sortOrder:3,groups:{create:{questions:{create:{number:5,type:'speaking_task',prompt:'Describe your reading habits.',points:9}}}}},
    ]}}});
    const ieltsFullStart=await request('POST',`/mock/exams/${ieltsFull.id}/start`,'migration-student',{flow:'full_test'},201);
    assert.equal(ieltsFullStart.overallDeadlineAt,null);assert.equal(ieltsFullStart.sectionDeadlines.speaking,undefined);
    assert.ok(Math.abs(Date.parse(ieltsFullStart.sectionDeadlines.listening)-Date.parse(ieltsFullStart.startedAt)-180000)<1000);
    for(const skill of ['listening','reading','writing']) {
      const qs=ieltsFullStart.exam.sections.find((s)=>s.skill===skill).groups.flatMap((g)=>g.questions);
      await request('POST',`/mock/attempts/${ieltsFullStart.attemptId}/answers`,'migration-student',{answers:qs.map((q)=>({questionId:q.id,response:skill==='writing'?'Original synthetic IELTS response.':'library'}))},201);
      await request('POST',`/mock/attempts/${ieltsFullStart.attemptId}/advance`,'migration-student',{},201);
    }
    const ieltsSpeaking=ieltsFullStart.exam.sections.find((s)=>s.skill==='speaking').groups[0].questions[0];
    await upload(ieltsFullStart.attemptId,ieltsSpeaking.id,'migration-student',fs.readFileSync(path.join(process.env.STORAGE_DIR,fixture[0].groups[0].audioKey)));
    await request('POST',`/mock/attempts/${ieltsFullStart.attemptId}/submit`,'migration-student',{},201);
    const ieltsWriting=ieltsFullStart.exam.sections.find((s)=>s.skill==='writing').groups[0].questions;
    for(const [q,score] of [[ieltsWriting[0],6],[ieltsWriting[1],9],[ieltsSpeaking,7]]) await request('POST',`/mock/attempts/${ieltsFullStart.attemptId}/grade`,'migration-admin',{questionId:q.id,score},201);
    const ieltsFullResult=await request('GET',`/mock/attempts/${ieltsFullStart.attemptId}`,'migration-student');
    assert.equal(ieltsFullResult.status,'completed');assert.deepEqual(ieltsFullResult.sectionBands,{listening:9,reading:9,writing:8,speaking:7});assert.equal(ieltsFullResult.overallBand,8.5);assert.equal(ieltsFullResult.specificationVersion,undefined);

    // Independent hardening checks: real guards/controllers/storage/transactions.
    await prisma.user.upsert({where:{id:'http-other'},update:{},create:{id:'http-other',name:'Other fixture student',phone:'http-other',role:'student',passwordHash:'not-a-login-hash',studentProfile:{create:{linkCode:'http-other',isApproved:true,availablePrograms:['MULTILEVEL'],activeProgram:'MULTILEVEL'}}}});
    await request('POST',`/mock/exams/${ielts.id}/start`,'http-other',{mode:'practice'},403);
    await request('PATCH','/exam-programs/mine','http-other',{program:'IELTS'},403);
    await request('PATCH','/exam-programs/mine','migration-student',{program:'IELTS'});
    await request('PATCH','/exam-programs/mine','migration-student',{program:'MULTILEVEL'});
    const full = await request('POST',`/mock/exams/${exam.id}/start`,'migration-student',{flow:'full_test'},201);
    const section = (skill) => full.exam.sections.find((s)=>s.skill===skill);
    const questions = (skill) => section(skill).groups.flatMap((g)=>g.questions);
    await request('GET',`/mock/attempts/${full.attemptId}`,'http-other',null,403);
    await request('POST',`/mock/attempts/${full.attemptId}/answer`,'http-other',{questionId:qid,response:'A'},404);
    await request('POST',`/mock/attempts/${full.attemptId}/submit`,'http-other',{},404);
    await request('POST',`/mock/attempts/${full.attemptId}/answer`,'migration-student',{questionId:qid,response:'A',score:75},400);
    await request('POST',`/mock/attempts/${full.attemptId}/grade`,'migration-student',{questionId:writingQuestion,score:5},403);
    await mediaRequest(`/mock/groups/${groupId}/audio`,null,401);
    await mediaRequest(`/mock/groups/${groupId}/audio`,'migration-student',403);
    await mediaRequest(`/mock/groups/${groupId}/audio?attemptId=${full.attemptId}`,'http-other',404);
    await mediaRequest(`/mock/groups/${groupId}/audio?attemptId=${ieltsStart.attemptId}`,'migration-student',403);
    const originalDeadlines = full.sectionDeadlines;
    await prisma.mockAttempt.update({where:{id:full.attemptId},data:{sectionDeadlines:{...originalDeadlines,listening:new Date(Date.now()-1000).toISOString()}}});
    await request('POST',`/mock/attempts/${full.attemptId}/answer`,'migration-student',{questionId:qid,response:'A'},400);
    await prisma.mockAttempt.update({where:{id:full.attemptId},data:{sectionDeadlines:originalDeadlines}});
    for (const skill of ['listening','reading','writing']) {
      const answers=questions(skill).map((q)=>({questionId:q.id,response:skill==='writing' ? 'Original synthetic submission about a fictional community library.' : q.type==='true_false_notgiven' ? 'TRUE' : ['multiple_choice','matching','matching_headings'].includes(q.type) ? 'A' : 'library'}));
      await request('POST',`/mock/attempts/${full.attemptId}/answers`,'migration-student',{answers},201);
      await request('POST',`/mock/attempts/${full.attemptId}/advance`,'migration-student',{},201);
      const resumed=await request('POST',`/mock/exams/${exam.id}/start`,'migration-student',{flow:'full_test'},201);
      assert.equal(resumed.resumed,true); assert.equal(resumed.attemptId,full.attemptId);
      assert.equal(resumed.currentSkill,skill==='listening'?'reading':skill==='reading'?'writing':'speaking');
      assert.equal(resumed.savedAnswers[answers[0].questionId],answers[0].response);
    }
    const wav = fs.readFileSync(path.join(process.env.STORAGE_DIR,fixture[0].groups[0].audioKey));
    for (const [index,q] of questions('speaking').entries()) {
      const phase=await request('POST',`/mock/attempts/${full.attemptId}/speaking/${q.id}/start`,'migration-student',{},201);
      assert.equal(Date.parse(phase.prepEndsAt)-Date.parse(phase.startedAt),q.guidance.prepSeconds*1000);
      assert.equal(Date.parse(phase.expiresAt)-Date.parse(phase.prepEndsAt),q.guidance.responseSeconds*1000);
      if(index===0) {
        await request('POST',`/mock/attempts/${full.attemptId}/speaking/${questions('speaking')[1].id}/start`,'migration-student',{},403);
        await upload(full.attemptId,q.id,'migration-student',Buffer.alloc(0),400);
        await upload(full.attemptId,q.id,'migration-student',Buffer.from('plain text pretending to be an audio recording'),400);
        await upload(full.attemptId,q.id,'http-other',wav,404);
      }
      const attempt=await prisma.mockAttempt.findUniqueOrThrow({where:{id:full.attemptId}});
      await prisma.mockAttempt.update({where:{id:full.attemptId},data:{mediaState:{...attempt.mediaState,[q.id]:{...phase,prepEndsAt:new Date(Date.now()-2000).toISOString(),expiresAt:new Date(Date.now()-1000).toISOString()}}}});
      await upload(full.attemptId,q.id,'migration-student',wav);
      if(index===0) {
        const before=await prisma.mockAnswer.findUniqueOrThrow({where:{attemptId_questionId:{attemptId:full.attemptId,questionId:q.id}}});
        await upload(full.attemptId,q.id,'migration-student',wav);
        const after=await prisma.mockAnswer.findUniqueOrThrow({where:{attemptId_questionId:{attemptId:full.attemptId,questionId:q.id}}});
        assert.equal(after.audioKey,before.audioKey); assert.ok(fs.existsSync(path.join(process.env.STORAGE_DIR,after.audioKey)));
        await mediaRequest(`/mock/attempts/${full.attemptId}/answers/${q.id}/audio`,'http-other',403);
        await mediaRequest(`/mock/attempts/${full.attemptId}/answers/${q.id}/audio`,'http-teacher',403);
        await mediaRequest(`/mock/attempts/${full.attemptId}/answers/${q.id}/audio`,'migration-student',200);
        await mediaRequest(`/mock/attempts/${full.attemptId}/answers/${q.id}/audio`,'migration-admin',200);
      }
    }
    const pending=await request('POST',`/mock/attempts/${full.attemptId}/submit`,'migration-student',{},201);
    assert.equal(pending.status,'grading'); assert.equal(pending.overallScore,null);
    assert.deepEqual(pending.rawScores.listening,{score:35,max:35}); assert.deepEqual(pending.rawScores.reading,{score:35,max:35});
    const pendingDetail=await request('GET',`/mock/attempts/${full.attemptId}`,'migration-student');
    assert.equal('correctAnswers' in pendingDetail.sections[0].groups[0].questions[0],false);
    await request('POST',`/mock/attempts/${full.attemptId}/answers`,'migration-student',{answers:[{questionId:writingQuestion,response:'late edit'}]},400);
    await prisma.user.upsert({where:{id:'http-scoped-teacher'},update:{},create:{id:'http-scoped-teacher',name:'Scoped fixture teacher',phone:'http-scoped-teacher',role:'teacher',passwordHash:'not-a-login-hash'}});
    const group=await prisma.group.create({data:{name:'Isolated fixture group',teacherId:'http-scoped-teacher'}});
    await prisma.studentProfile.update({where:{userId:'migration-student'},data:{groupId:group.id}});
    await request('GET','/exam-programs/students/migration-student','http-scoped-teacher');
    await request('PUT','/exam-programs/students/http-other','http-scoped-teacher',{availablePrograms:['IELTS']},403);
    await mediaRequest(`/mock/attempts/${full.attemptId}/answers/${questions('speaking')[0].id}/audio`,'http-scoped-teacher',200);
    for(const q of [...questions('writing'),...questions('speaking')]) await request('POST',`/mock/attempts/${full.attemptId}/grade`,'http-scoped-teacher',{questionId:q.id,score:q.points,feedback:'Synthetic manual review'},201);
    const final=await request('GET',`/mock/attempts/${full.attemptId}`,'migration-student');
    assert.equal(final.status,'completed');assert.equal(final.overallScore,75);assert.equal(final.cefrLevel,'C1');assert.equal(final.scoreMethod,'ESTIMATED');assert.equal(final.overallBand,null);
    assert.deepEqual(final.rawScores.writing,{score:16,max:16});assert.deepEqual(final.rawScores.speaking,{score:21,max:21});
    await request('POST',`/mock/attempts/${full.attemptId}/submit`,'migration-student',{},201);
    for(const q of questions('speaking')) assert.ok(fs.existsSync(path.join(process.env.STORAGE_DIR,(await prisma.mockAnswer.findUniqueOrThrow({where:{attemptId_questionId:{attemptId:full.attemptId,questionId:q.id}}})).audioKey)));
    const legacy=await prisma.mockExam.create({data:{type:'multilevel',title:'Legacy resume fixture',isPublished:true,specificationVersion:'UZBMB_MULTILEVEL_EN_2026_V1',sections:{create:{skill:'reading',groups:{create:{questions:{create:{type:'short_answer',number:1,prompt:'Legacy prompt',correctAnswers:['library']}}}}}}}});
    const legacyAttempt=await prisma.mockAttempt.create({data:{examId:legacy.id,studentId:'migration-student',mode:'practice',specificationVersion:null}});
    const legacyResume=await request('POST',`/mock/exams/${legacy.id}/start`,'migration-student',{},201);
    assert.equal(legacyResume.attemptId,legacyAttempt.id);assert.equal(legacyResume.exam.specificationVersion,undefined);assert.equal(legacyResume.exam.sections[0].groups[0].questions[0].guidance,undefined);

    const history = await request('GET','/mock/attempts/mine?program=MULTILEVEL','migration-student');
    assert.ok(history.every((a)=>a.examType==='multilevel'));
    console.log(`PASS: ${checks} authenticated HTTP checks; enrollment, roles, publication, sanitized payloads, deadlines, media preview, immutable attempted content, duplicate submit and track history`);
  } finally { await app.close(); await prisma.$disconnect(); }
})().catch((e) => { console.error(e); process.exitCode=1; });
