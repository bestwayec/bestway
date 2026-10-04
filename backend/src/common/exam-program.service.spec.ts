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
  it('retains staff-assigned enrollment restrictions', async () => {
    const findUnique = vi.fn().mockResolvedValue({availablePrograms:['IELTS'],activeProgram:'IELTS'});
    const update = vi.fn();
    const tx = {studentProfile:{findUnique,update}};
    const service = new ExamProgramService({$transaction:vi.fn((fn)=>fn(tx))} as never, {getJson:vi.fn().mockResolvedValue('STAFF_ASSIGNED')} as never);
    await expect(service.select('student','MULTILEVEL')).rejects.toMatchObject({status:403});
    expect(update).not.toHaveBeenCalled();
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
  it('self-selects, persists across new sessions and switches without duplicate enrollment or unrelated writes', async () => {
    let profile = {availablePrograms:['IELTS'],activeProgram:'IELTS'};
    const findUnique = vi.fn(async () => ({...profile}));
    const update = vi.fn(async ({where,data}) => {
      expect(where).toEqual({userId:'student'});
      expect(Object.keys(data).sort()).toEqual(['activeProgram','availablePrograms']);
      profile = {...data}; return {...profile};
    });
    const prisma = {studentProfile:{findUnique,update},$transaction:vi.fn((fn)=>fn({studentProfile:{findUnique,update}}))};
    const first = new ExamProgramService(prisma as never);
    await expect(first.select('student','MULTILEVEL')).resolves.toEqual({availablePrograms:['IELTS','MULTILEVEL'],activeProgram:'MULTILEVEL',accessPolicy:'SELF_SELECT'});
    await first.select('student','MULTILEVEL');
    expect(profile.availablePrograms).toEqual(['IELTS','MULTILEVEL']);
    const nextSession = new ExamProgramService(prisma as never);
    expect((await nextSession.state('student')).activeProgram).toBe('MULTILEVEL');
    await nextSession.select('student','IELTS');
    expect(profile).toEqual({availablePrograms:['IELTS','MULTILEVEL'],activeProgram:'IELTS'});
    await expect(nextSession.assertAccess('student','multilevel')).resolves.toBeUndefined();
  });
  it('rejects invalid program values before any write', async () => {
    const transaction = vi.fn();
    const service = new ExamProgramService({$transaction:transaction} as never);
    for (const invalid of ['admin','multilevel','IELTS Academic',null]) {
      await expect(service.select('student',invalid as never)).rejects.toMatchObject({code:'INVALID_PROGRAM',status:400});
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  it('uses active saved program and rejects stale or spoofed list scopes', async () => {
    const service = new ExamProgramService({studentProfile:{findUnique:vi.fn().mockResolvedValue({availablePrograms:['IELTS','MULTILEVEL'],activeProgram:'MULTILEVEL'})}} as never);
    expect(await service.active('student')).toBe('MULTILEVEL');
    await expect(service.active('student','IELTS')).rejects.toMatchObject({status:409,code:'PROGRAM_CHANGED'});
  });
  it('returns no active program when assigned access is empty or inconsistent', async () => {
    const service = new ExamProgramService({studentProfile:{findUnique:vi.fn().mockResolvedValue({availablePrograms:[],activeProgram:'IELTS'})}} as never);
    expect(await service.active('student')).toBeNull();
  });
});
