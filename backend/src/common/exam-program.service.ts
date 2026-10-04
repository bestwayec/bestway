import { Injectable } from '@nestjs/common';
import { ExamProgram, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from './app.exception';
import { AuthUser } from './types';

export function programForType(type: string): ExamProgram {
  return type === 'multilevel' ? 'MULTILEVEL' : 'IELTS';
}
@Injectable()
export class ExamProgramService {
  constructor(private readonly prisma: PrismaService) {}

  async state(studentId: string) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId: studentId },
      select: { availablePrograms: true, activeProgram: true } });
    if (!profile) throw new AppException('STUDENT_NOT_FOUND', 'Student not found', 404);
    return profile;
  }
  async canAccess(studentId: string, type: string): Promise<boolean> {
    return (await this.state(studentId)).availablePrograms.includes(programForType(type));
  }
  async assertAccess(studentId: string, type: string) {
    if (!await this.canAccess(studentId, type)) throw new AppException('PROGRAM_NOT_ENROLLED', 'Not enrolled in this exam track', 403);
  }
  async select(studentId: string, program: ExamProgram) {
    // Conditional update also prevents a concurrent enrollment removal from
    // restoring a default outside the student's enrolled tracks.
    const saved = await this.prisma.studentProfile.updateMany({
      where: { userId: studentId, availablePrograms: { has: program } }, data: { activeProgram: program },
    });
    if (saved.count !== 1) throw new AppException('PROGRAM_NOT_ENROLLED', 'Not enrolled in this exam track', 403);
    return this.state(studentId);
  }
  async managedState(actor: AuthUser, studentId: string) {
    const profile = await this.prisma.studentProfile.findFirst({ where: this.staffScope(actor, studentId),
      select: { availablePrograms: true, activeProgram: true } });
    if (!profile) throw new AppException('FORBIDDEN', 'Student is outside your scope', 403);
    return profile;
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
      return after;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  private staffScope(actor: AuthUser, userId: string): Prisma.StudentProfileWhereInput {
    if (actor.role === 'admin' || actor.role === 'super_admin') return { userId };
    if (actor.role === 'teacher') return { userId, group: { teacherId: actor.id } };
    throw new AppException('FORBIDDEN', 'Staff access required', 403);
  }
}
