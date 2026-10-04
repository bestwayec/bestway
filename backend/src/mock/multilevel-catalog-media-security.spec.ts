import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ExamProgram } from '@prisma/client';
import { Request, Response } from 'express';
import { ExamProgramService } from '../common/exam-program.service';
import { AuthUser } from '../common/types';
import { ListExamsQueryDto } from './dto/mock.dto';
import { MockAccessService } from './mock-access.service';
import { MockAuthoringService } from './mock-authoring.service';

function setup(programs: ExamProgram[] = [], type = 'multilevel') {
  const exam = (id: string, examType: string) => ({
    id, type: examType, title: id, profile: 'practice', isDemo: true,
    isPublished: true, price: 0, isFreeForApproved: true, createdById: 'teacher',
    sections: [{ skill: 'reading', durationMinutes: 60,
      groups: [{ audioDurationSec: null, _count: { questions: 1 } }] }],
  });
  const exams = [exam('academic', 'ielts_academic'), exam('general', 'ielts_general'), exam('multilevel', 'multilevel')];
  const prisma = {
    studentProfile: { findUnique: vi.fn().mockResolvedValue({ availablePrograms: programs, activeProgram: programs[0] ?? null }) },
    mockPurchase: { findMany: vi.fn().mockResolvedValue([]) },
    mockExam: { findMany: vi.fn().mockResolvedValue(exams) },
    mockExamImport: { findMany: vi.fn().mockResolvedValue([]) },
    mockAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
    mockQuestionGroup: { findUnique: vi.fn().mockResolvedValue({
      id: 'group', audioKey: 'mock/audio.wav', imageKey: 'mock/image.png',
      section: { exam: exam('media-exam', type) },
    }) },
  };
  const stream = { pipe: vi.fn() };
  const storage = {
    exists: vi.fn().mockReturnValue(true), stat: vi.fn().mockReturnValue({ size: 64 }),
    createReadStream: vi.fn().mockReturnValue(stream),
  };
  // Exercise catalog/media through the real enrollment and access services:
  // only persistence and filesystem transport are mocked.
  const programService = new ExamProgramService(prisma as never);
  const access = new MockAccessService(prisma as never, {} as never, {} as never, programService);
  const service = new MockAuthoringService(prisma as never, {} as never, storage as never, access, { get: () => undefined } as never);
  const student = { id: 'student', role: 'student' } as AuthUser;
  const req = { headers: {}, query: {} } as Request;
  const res = { status: vi.fn(), set: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res); res.set.mockReturnValue(res);
  return { service, student, prisma, storage, stream, req, res: res as unknown as Response };
}

describe('program-aware catalog access', () => {
  it.each([
    { programs: ['IELTS'] as ExamProgram[], expected: ['granted', 'granted', 'locked'] },
    { programs: ['MULTILEVEL'] as ExamProgram[], expected: ['locked', 'locked', 'granted'] },
    { programs: ['IELTS', 'MULTILEVEL'] as ExamProgram[], expected: ['granted', 'granted', 'granted'] },
  ])('uses each exam type for $programs enrollment', async ({ programs, expected }) => {
    const { service, student } = setup(programs);
    const rows = await service.listExams(student, {} as ListExamsQueryDto);
    expect(rows.map((row) => [row.id, row.access])).toEqual([
      ['academic', expected[0]], ['general', expected[1]], ['multilevel', expected[2]],
    ]);
  });

  it('retains anonymous IELTS demos while locking anonymous Multilevel demos', async () => {
    const { service, prisma } = setup();
    const rows = await service.listExams(undefined, {} as ListExamsQueryDto);
    expect(rows.map((row) => row.access)).toEqual(['granted', 'granted', 'locked']);
    expect(prisma.studentProfile.findUnique).not.toHaveBeenCalled();
  });

  it('retains staff catalog access independently of student enrollment', async () => {
    const { service, prisma } = setup();
    const rows = await service.listExams({ id: 'admin', role: 'admin' } as AuthUser, {} as ListExamsQueryDto);
    expect(rows.map((row) => row.access)).toEqual(['granted', 'granted', 'granted']);
    expect(prisma.studentProfile.findUnique).not.toHaveBeenCalled();
  });
});

describe.each(['audio', 'image'] as const)('Multilevel demo %s authorization', (kind) => {
  it('rejects anonymous access without opening a file stream', async () => {
    const { service, storage, req, res } = setup();
    await expect(service.streamMedia(undefined, 'group', kind, req, res)).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('rejects an IELTS-only student even when the media is a free demo', async () => {
    const { service, student, storage, req, res } = setup(['IELTS']);
    await expect(service.streamMedia(student, 'group', kind, req, res)).rejects.toMatchObject({ code: 'MOCK_PAYMENT_REQUIRED', status: 402 });
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('streams media for a Multilevel-enrolled student', async () => {
    const { service, student, storage, stream, req, res } = setup(['MULTILEVEL']);
    await service.streamMedia(student, 'group', kind, req, res);
    expect(storage.createReadStream).toHaveBeenCalledWith(kind === 'audio' ? 'mock/audio.wav' : 'mock/image.png');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('preserves anonymous IELTS demo media access', async () => {
    const { service, storage, stream, req, res } = setup([], 'ielts_academic');
    await service.streamMedia(undefined, 'group', kind, req, res);
    expect(storage.createReadStream).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });
});
