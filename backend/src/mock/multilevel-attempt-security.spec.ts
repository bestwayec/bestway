import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MockAttemptService } from './mock-attempt.service';
import { MULTILEVEL_VERSION } from './multilevel-specification';

function setup() {
  const attempt={id:'attempt',studentId:'student',examId:'exam',specificationVersion:MULTILEVEL_VERSION,status:'in_progress',mode:'timed',flowMode:'full_test',currentSkill:'reading',deadlineAt:new Date(Date.now()+60000),overallDeadlineAt:new Date(Date.now()+60000),sectionDeadlines:{reading:new Date(Date.now()+60000).toISOString()}};
  const question={id:'q',group:{section:{skill:'reading'}}};
  const tx={$queryRaw:vi.fn().mockResolvedValue([]),mockAttempt:{findUnique:vi.fn().mockResolvedValue(attempt)},studentProfile:{findUnique:vi.fn().mockResolvedValue({availablePrograms:['MULTILEVEL']})},mockQuestion:{findMany:vi.fn().mockResolvedValue([question])},mockAnswer:{upsert:vi.fn().mockResolvedValue({})}};
  const prisma={mockAttempt:{findUnique:vi.fn().mockResolvedValue(attempt)},mockQuestion:{findFirst:vi.fn().mockResolvedValue(question)},$transaction:vi.fn().mockImplementation(async (fn)=>fn(tx))};
  const service=new MockAttemptService(prisma as never,{} as never,{} as never,{get:()=>undefined} as never);
  return {service,prisma,tx,attempt,question,student:{id:'student'} as never};
}
describe('Multilevel answer authorization and serialized writes',()=>{
  it('locks and rechecks enrollment before answer upsert',async()=>{
    const {service,tx,student}=setup();
    await expect(service.saveAnswer(student,'attempt',{questionId:'q',response:'library'})).resolves.toEqual({saved:true});
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.studentProfile.findUnique).toHaveBeenCalledWith({where:{userId:'student'}});
    expect(tx.mockAnswer.upsert).toHaveBeenCalledOnce();
  });
  it('rejects revoked enrollment even when the outer attempt snapshot was authorized',async()=>{
    const {service,tx,student}=setup(); tx.studentProfile.findUnique.mockResolvedValue({availablePrograms:[]});
    await expect(service.saveAnswer(student,'attempt',{questionId:'q',response:'library'})).rejects.toMatchObject({code:'PROGRAM_NOT_ENROLLED',status:403});
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled();
  });
  it('rejects a concurrent finalization discovered after acquiring the lock',async()=>{
    const {service,tx,student,attempt}=setup(); tx.mockAttempt.findUnique.mockResolvedValue({...attempt,status:'grading'});
    await expect(service.saveAnswer(student,'attempt',{questionId:'q',response:'library'})).rejects.toMatchObject({code:'MOCK_ATTEMPT_FINISHED'});
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled();
  });
  it('rejects question substitution inside the locked transaction',async()=>{
    const {service,tx,student}=setup(); tx.mockQuestion.findMany.mockResolvedValue([]);
    await expect(service.saveAnswer(student,'attempt',{questionId:'q',response:'library'})).rejects.toMatchObject({status:403});
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled();
  });
  it('rejects expired writes and another student before opening a transaction',async()=>{
    const {service,prisma,attempt,student}=setup(); attempt.overallDeadlineAt=new Date(Date.now()-1000);
    await expect(service.saveAnswer(student,'attempt',{questionId:'q',response:'library'})).rejects.toMatchObject({code:'MOCK_TIME_UP'});
    await expect(service.saveAnswer({id:'outside'} as never,'attempt',{questionId:'q',response:'library'})).rejects.toMatchObject({status:404});
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('an authorized media fetch consumes no transition or additional playback',async()=>{
    const {service,prisma,attempt,student}=setup();
    Object.assign(attempt,{currentSkill:'listening',mediaState:{group:{plays:1,expiresAt:new Date(Date.now()+30000).toISOString()}}});
    Object.assign(prisma,{mockQuestionGroup:{findUnique:vi.fn().mockResolvedValue({id:'group',audioKey:'mock/audio.wav',section:{examId:'exam',skill:'listening'}})}});
    await expect(service.recordAudioPlay(student,'attempt','group')).resolves.toEqual({allowed:true,plays:1,limited:true});
    expect(attempt.currentSkill).toBe('listening'); expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
