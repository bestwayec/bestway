import { Injectable, Optional } from '@nestjs/common';
import { ExamProgram, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from './app.exception';
import { AuthUser } from './types';
import { SettingsService } from '../settings/settings.service';

export type ExamProgramAccessPolicy = 'SELF_SELECT' | 'STAFF_ASSIGNED';

export function programForType(type: string): ExamProgram {
  return type === 'multilevel' ? 'MULTILEVEL' : 'IELTS';
}
@Injectable()
export class ExamProgramService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly settings?: SettingsService) {}

  async accessPolicy(): Promise<ExamProgramAccessPolicy> {
    const configured = await this.settings?.getJson<string>('examProgramAccessPolicy', 'SELF_SELECT');
    return configured === 'STAFF_ASSIGNED' ? 'STAFF_ASSIGNED' : 'SELF_SELECT';
  }

  async state(studentId: string) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId: studentId },
      select: { availablePrograms: true, activeProgram: true } });
    if (!profile) throw new AppException('STUDENT_NOT_FOUND', 'Student not found', 404);
    return { ...profile, accessPolicy: await this.accessPolicy() };
  }
  /** Lists use the saved program, never a caller-selected scope. Explicit attempt routes retain ownership checks. */
  async active(studentId: string, requested?: ExamProgram): Promise<ExamProgram | null> {
    const { activeProgram, availablePrograms } = await this.state(studentId);
    if (requested && requested !== activeProgram) throw new AppException('PROGRAM_CHANGED', 'Your exam track changed. Refresh and try again.', 409);
    return activeProgram && availablePrograms.includes(activeProgram) ? activeProgram : null;
  }
  async canAccess(studentId: string, type: string): Promise<boolean> {
    return (await this.state(studentId)).availablePrograms.includes(programForType(type));
  }
  async assertAccess(studentId: string, type: string) {
    if (!await this.canAccess(studentId, type)) throw new AppException('PROGRAM_NOT_ENROLLED', 'Not enrolled in this exam track', 403);
  }
  async select(studentId: string, program: ExamProgram) {
    if (!Object.values(ExamProgram).includes(program)) throw new AppException('INVALID_PROGRAM', 'Invalid exam track', 400);
    const accessPolicy = await this.accessPolicy();
    for (let retry = 0; ; retry++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const before = await tx.studentProfile.findUnique({ where: { userId: studentId }, select: { availablePrograms: true, activeProgram: true } });
          if (!before) throw new AppException('STUDENT_NOT_FOUND', 'Student not found', 404);
          if (accessPolicy === 'STAFF_ASSIGNED' && !before.availablePrograms.includes(program)) throw new AppException('PROGRAM_NOT_ENROLLED', 'Not enrolled in this exam track', 403);
          const availablePrograms = [...new Set([...before.availablePrograms, program])];
          const after = await tx.studentProfile.update({ where: { userId: studentId }, data: { availablePrograms, activeProgram: program }, select: { availablePrograms: true, activeProgram: true } });
          return { ...after, accessPolicy };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (retry < 2 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') continue;
        throw error;
      }
    }
  }
  async managedState(actor: AuthUser, studentId: string) {
    const profile = await this.prisma.studentProfile.findFirst({ where: this.staffScope(actor, studentId),
      select: { availablePrograms: true, activeProgram: true } });
    if (!profile) throw new AppException('FORBIDDEN', 'Student is outside your scope', 403);
    return { ...profile, accessPolicy: await this.accessPolicy() };
  }
  async enroll(actor: AuthUser, studentId: string, programs: ExamProgram[], activeProgram?: ExamProgram) {
    const availablePrograms = [...new Set(programs)];
    if (activeProgram && !availablePrograms.includes(activeProgram)) throw new AppException('PROGRAM_NOT_ENROLLED', 'Default track must be enrolled', 400);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.studentProfile.findFirst({ where: this.staffScope(actor, studentId) });
      if (!before) throw new AppException('FORBIDDEN', 'Student is outside your scope', 403);
      const selected = activeProgram ?? (before.activeProgram && availablePrograms.includes(before.activeProgram) ? before.activeProgram : availablePrograms[0] ?? null);
      const after = await tx.studentProfile.update({ where: { userId: studentId }, data: { availablePrograms, activeProgram: selected },
        select: { availablePrograms: true, activeProgram: true } });
      await tx.auditLog.create({ data: { userId: actor.id, action: 'student.programs.update', entity: 'StudentProfile', entityId: studentId,
        oldValue: { availablePrograms: before.availablePrograms, activeProgram: before.activeProgram }, newValue: after } });
      return { ...after, accessPolicy: await this.accessPolicy() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  private staffScope(actor: AuthUser, userId: string): Prisma.StudentProfileWhereInput {
    if (actor.role === 'admin' || actor.role === 'super_admin') return { userId };
    if (actor.role === 'teacher') return { userId, group: { teacherId: actor.id } };
    throw new AppException('FORBIDDEN', 'Staff access required', 403);
  }
}
