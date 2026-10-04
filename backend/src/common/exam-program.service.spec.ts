import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ExamProgramService, programForType } from './exam-program.service';

describe('authoritative exam program access', () => {
  it('maps both IELTS variants to the same enrolled track', () => {
    expect(programForType('ielts_academic')).toBe('IELTS');
    expect(programForType('ielts_general')).toBe('IELTS');
    expect(programForType('multilevel')).toBe('MULTILEVEL');
  });
  it('rejects direct Multilevel access for an IELTS-only account', async () => {
    const service = new ExamProgramService({studentProfile:{findUnique:vi.fn().mockResolvedValue({availablePrograms:['IELTS'],activeProgram:'IELTS'})}} as never);
    await expect(service.assertAccess('student','multilevel')).rejects.toMatchObject({code:'PROGRAM_NOT_ENROLLED',status:403});
    await expect(service.assertAccess('student','ielts_academic')).resolves.toBeUndefined();
  });
  it('cannot select a removed track during a concurrent enrollment change', async () => {
    const updateMany = vi.fn().mockResolvedValue({count:0});
    const service = new ExamProgramService({studentProfile:{updateMany}} as never);
    await expect(service.select('student','MULTILEVEL')).rejects.toMatchObject({status:403});
    expect(updateMany).toHaveBeenCalledWith({where:{userId:'student',availablePrograms:{has:'MULTILEVEL'}},data:{activeProgram:'MULTILEVEL'}});
  });
  it('restricts teachers to their own group and denies out-of-scope reads', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ExamProgramService({studentProfile:{findFirst}} as never);
    await expect(service.managedState({id:'teacher',role:'teacher'} as never,'outside')).rejects.toMatchObject({status:403});
    expect(findFirst.mock.calls[0][0].where).toEqual({userId:'outside',group:{teacherId:'teacher'}});
  });
  it('rejects a staff enrollment default outside assigned tracks before writing', async () => {
    const transaction = vi.fn();
    const service = new ExamProgramService({$transaction:transaction} as never);
    await expect(service.enroll({id:'admin',role:'admin'} as never,'student',['IELTS'],'MULTILEVEL')).rejects.toMatchObject({status:400});
    expect(transaction).not.toHaveBeenCalled();
  });
});
