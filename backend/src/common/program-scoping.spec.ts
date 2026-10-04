import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { TestsService } from '../tests/tests.service';
import { GradingService } from '../tests/grading.service';
import { MockAuthoringService } from '../mock/mock-authoring.service';
import { MockGradingService } from '../mock/mock-grading.service';
import { studentExamTitle } from '../mock/student-exam-title';

const student = {id:'own-student',role:'student'} as never;
const query = {page:1,limit:20,skip:0} as never;

describe('server program scoping across student catalogs and histories', () => {
  for (const program of ['IELTS','MULTILEVEL',null] as const) {
    it(`scopes catalogs and histories to saved ${program ?? 'no track'} regardless of omitted client filter`, async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(0);
      const prisma = {test:{findMany,count},testAttempt:{findMany,count},mockExam:{findMany},mockExamImport:{findMany},mockAttempt:{findMany,count}};
      const programs = {active:vi.fn().mockResolvedValue(program)};
      const tests = new TestsService(prisma as never,{} as never,programs as never);
      await tests.list(student,query);
      const expectedLegacy = program === 'IELTS' ? 'ielts' : program === 'MULTILEVEL' ? 'multilevel' : {in:[]};
      expect(findMany.mock.calls.at(-1)![0].where.AND).toEqual([{type:expectedLegacy}]);
      const grading = new GradingService(prisma as never,{} as never,{} as never,programs as never);
      await grading.myAttempts(student,query);
      expect(findMany.mock.calls.at(-1)![0].where).toMatchObject({studentId:'own-student',test:{type:expectedLegacy}});
      const access = {annotateAccess:vi.fn().mockResolvedValue(new Map())};
      const config = {get:vi.fn()};
      const authoring = new MockAuthoringService(prisma as never,{} as never,{} as never,access as never,config as never,programs as never);
      await authoring.listExams(student,{});
      const expectedMock = program === 'IELTS' ? {in:['ielts_academic','ielts_general']} : program === 'MULTILEVEL' ? 'multilevel' : {in:[]};
      expect(findMany.mock.calls.at(-2)![0].where.AND).toEqual([{type:expectedMock}]);
      const mocks = new MockGradingService(prisma as never,{} as never,{} as never,{} as never,{} as never,{} as never,config as never,programs as never);
      await mocks.myAttempts(student,query);
      expect(findMany.mock.calls.at(-1)![0].where).toMatchObject({studentId:'own-student',exam:{type:expectedMock}});
      expect(programs.active).toHaveBeenCalledTimes(4);
    });
  }
  it('keeps staff catalogs broad and normalized practice levels separate from full mocks', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const active = vi.fn();
    const service = new MockAuthoringService({mockExam:{findMany},mockExamImport:{findMany}} as never,{} as never,{} as never,{annotateAccess:vi.fn().mockResolvedValue(new Map())} as never,{get:vi.fn()} as never,{active} as never);
    await service.listExams({id:'admin',role:'admin'} as never,{practiceLevel:'A1'});
    expect(findMany.mock.calls[0][0].where).toEqual({practiceLevel:'A1',profile:'practice',AND:[{type:'multilevel'}]});
    expect(active).not.toHaveBeenCalled();
  });
  it('cleans only known built-in fixture exam titles and leaves author text intact', () => {
    expect(studentExamTitle('REPLACE — IELTS Academic Reading Practice Test')).toBe('IELTS Academic Reading Practice Test');
    expect(studentExamTitle('REPLACE — IELTS Academic Reading Passage 2')).toBe('IELTS Academic Reading Passage 2');
    expect(studentExamTitle('REPLACE — A legitimate teacher title')).toBe('REPLACE — A legitimate teacher title');
    expect(studentExamTitle('Original synthetic listening practice')).toBe('Original synthetic listening practice');
  });
});
