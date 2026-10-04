import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MockGradingService } from './mock-grading.service';
import { multilevelFixture } from './multilevel.fixture';
import { MULTILEVEL_VERSION } from './multilevel-specification';

function setup(ungraded = false) {
  const sections = multilevelFixture().map((s) => ({ ...s, groups:s.groups.map((g,gi) => ({ ...g, questions:g.questions.map((q,qi) => ({...q,id:`${s.skill}-${gi}-${qi}`,correctAnswers:['library'],acceptedVariants:[]})) })) }));
  const answers = sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => ({id:`a-${q.id}`,questionId:q.id,response:'library',isGraded:!ungraded,score:q.points}))));
  const attempt = {id:'attempt',studentId:'student',status:'in_progress',specificationVersion:MULTILEVEL_VERSION,exam:{type:'multilevel',sections},answers};
  const update = vi.fn().mockImplementation(async ({data}) => Object.assign(attempt,data));
  const updateMany = vi.fn().mockImplementation(async ({where,data}) => { if (where.status !== attempt.status) return {count:0}; Object.assign(attempt,data); return {count:1}; });
  const prisma = {mockAttempt:{findUnique:vi.fn().mockResolvedValue(attempt),findUniqueOrThrow:vi.fn().mockResolvedValue(attempt),update,updateMany},mockAnswer:{update:vi.fn().mockResolvedValue({})},studentProfile:{findUnique:vi.fn().mockResolvedValue({availablePrograms:['MULTILEVEL']})},$transaction:vi.fn().mockImplementation(async (ops) => Promise.all(ops))};
  const service = new MockGradingService(prisma as never,{} as never,{} as never,{} as never,{} as never,{} as never,{get:()=>undefined} as never);
  // Notification transport is outside scoring; avoid requiring a live account.
  const notifications = service as unknown as { notifyResult(id: string): Promise<void>; notifyTeacherPending(id: string): Promise<void> };
  vi.spyOn(notifications,'notifyResult').mockResolvedValue(undefined);
  vi.spyOn(notifications,'notifyTeacherPending').mockResolvedValue(undefined);
  return {service,prisma,attempt};
}
describe('Multilevel submission through the real scoring service', () => {
  it('grades all 70 objective answers, sums writing /16 and speaking parts /21',async () => {
    const {service,prisma} = setup();
    const result = await service.submit({id:'student'} as never,'attempt');
    expect(result).toMatchObject({status:'completed',overallBand:null,overallScore:75,cefrLevel:'C1',scoreMethod:'ESTIMATED',isOfficial:false,rawScores:{listening:{score:35,max:35},reading:{score:35,max:35},writing:{score:16,max:16},speaking:{score:21,max:21}}});
    expect(prisma.mockAnswer.update).toHaveBeenCalledTimes(70);
  });
  it('does not fabricate manual scores and returns the stored result on duplicate submit',async () => {
    const {service,prisma} = setup(true);
    const first = await service.submit({id:'student'} as never,'attempt');
    expect(first).toMatchObject({status:'grading',overallScore:null,cefrLevel:null});
    const second = await service.submit({id:'student'} as never,'attempt');
    expect(second).toMatchObject({status:'grading',overallScore:null});
    expect(prisma.mockAttempt.updateMany).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-student submission before any status mutation',async () => {
    const {service,prisma} = setup();
    await expect(service.submit({id:'outside'} as never,'attempt')).rejects.toMatchObject({status:404});
    expect(prisma.mockAttempt.updateMany).not.toHaveBeenCalled();
  });
});
