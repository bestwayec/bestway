import { Injectable } from '@nestjs/common';
import { BESTWAY_MULTILEVEL_SPEAKING_2026_V2 } from './multilevel-speaking-profile';
import { ConfigService } from '@nestjs/config';
import { MockExamType, MockQuestionType, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { ExamProgramService } from '../common/exam-program.service';
import { studentExamTitle } from './student-exam-title';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../videos/storage.service';
import {
  AddQuestionsDto,
  SaveGroupContentDto,
  CreateGroupDto,
  CreateMockExamDto,
  CreateSectionDto,
  ImportQuestionsDto,
  ListExamsQueryDto,
  UpdateGroupDto,
  UpdateMockExamDto,
  UpdateQuestionDto,
  UpdateSectionDto,
} from './dto/mock.dto';
import { MockAccessService } from './mock-access.service';
import { assertDraftGapNumbers, assertGappedDocumentQuestions, gapNumbersFromHtml, sanitizeMockContent } from './mock-content';
import { buildCorrectAnswers, parseQuestions } from './mock-parse';
import { audioContentType } from './mock-storage';
import { AUTO_SKILLS } from './mock-scoring';
import { ExamRow, shapeExam, shapeExamMeta, totalDuration } from './mock-shape';
import { starterSections } from './mock-starter';
import { MULTILEVEL_SPECIFICATION, MULTILEVEL_VERSION, multilevelBlueprintIssues } from './multilevel-specification';
import { objectiveGroupIssues, objectiveQuestionIssues } from './question-engine';

/** Variantlar (options) majburiy bo'lgan savol turlari */
const OPTION_TYPES = new Set<MockQuestionType>([
  'multiple_choice',
  'multi_select',
  'matching',
  'matching_headings',
]);

const IELTS_MANUAL_POINTS = 9;

const EXAM_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      groups: {
        orderBy: { sortOrder: 'asc' as const },
        include: { questions: { orderBy: { sortOrder: 'asc' as const } } },
      },
    },
  },
} satisfies Prisma.MockExamInclude;

function isStaff(viewer?: AuthUser): boolean {
  return (
    !!viewer &&
    (viewer.role === 'admin' || viewer.role === 'super_admin' || viewer.role === 'teacher')
  );
}

@Injectable()
export class MockAuthoringService {
  private readonly base: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly accessSvc: MockAccessService,
    config: ConfigService,
    private readonly programs: ExamProgramService = new ExamProgramService(prisma),
  ) {
    this.base = `${config.get<string>('PUBLIC_URL') ?? 'http://localhost:3001'}/v1`;
  }

  // ─────────────────────────── Exam ───────────────────────────

  async createExam(actor: AuthUser, dto: CreateMockExamDto) {
    const profile = dto.profile ?? 'practice';
    this.assertPracticeLevel(dto.type, profile, dto.practiceLevel);
    const exam = await this.prisma.mockExam.create({
      data: {
        type: dto.type,
        assessmentPolicy: dto.assessmentPolicy,
        ...(dto.type === 'multilevel' ? { specificationVersion: MULTILEVEL_VERSION, speakingProfileVersion: BESTWAY_MULTILEVEL_SPEAKING_2026_V2 } : {}),
        title: dto.title,
        description: dto.description,
        level: dto.level,
        practiceLevel: dto.practiceLevel,
        isDemo: dto.isDemo ?? false,
        price: dto.price ?? 0,
        isFreeForApproved: dto.isFreeForApproved ?? true,
        createdById: actor.id,
        profile,
        ...(dto.starterStructure ? { sections: { create: starterSections(dto.type, dto.skills) } } : {}),
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'mock.exam.create',
      entity: 'mockExam',
      entityId: exam.id,
      newValue: { title: exam.title, type: exam.type },
    });
    return exam;
  }

  async updateExam(actor: AuthUser, id: string, dto: UpdateMockExamDto) {
    const existing = await this.examOrThrow(id);
    await this.assertCanAuthor(actor, id, false);
    const profileChanges = dto.profile !== undefined && dto.profile !== existing.profile;
    if (profileChanges &&
        await this.prisma.mockAttempt.count({ where: { examId: id } }) > 0) {
      throw new AppException('EXAM_VERSION_IN_USE', 'Clone this exam before changing the profile used by attempts', 409);
    }
    this.assertPracticeLevel(existing.type, dto.profile ?? existing.profile, dto.practiceLevel !== undefined ? dto.practiceLevel : existing.practiceLevel);
    const requiresReadiness = dto.isPublished === true || (existing.isPublished && dto.isPublished !== false && profileChanges);
    if (requiresReadiness) {
      const ready = await this.readiness(actor, id, dto.profile ?? existing.profile);
      if (!ready.ready) {
        const bad = ready.items.filter((i) => !i.ok).map((i) => i.detail || i.key).join('; ');
        throw new AppException('MOCK_NOT_READY', `Exam not ready to publish: ${bad}`, 400);
      }
    }
    const update: Prisma.MockExamUpdateArgs = {
      where: { id, ...((requiresReadiness || profileChanges) ? { contentVersion: existing.contentVersion } : {}), ...(profileChanges ? { attempts: { none: {} } } : {}) },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.assessmentPolicy !== undefined ? { assessmentPolicy: dto.assessmentPolicy } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.level !== undefined ? { level: dto.level } : {}),
        ...(dto.practiceLevel !== undefined ? { practiceLevel: dto.practiceLevel } : {}),
        ...(dto.profile !== undefined ? { profile: dto.profile } : {}),
        ...(profileChanges ? { contentVersion: { increment: 1 } } : {}),
        ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
        ...(dto.isDemo !== undefined ? { isDemo: dto.isDemo } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.isFreeForApproved !== undefined
          ? { isFreeForApproved: dto.isFreeForApproved }
          : {}),
      },
    };
    const write = requiresReadiness || profileChanges
      ? this.prisma.$transaction((tx) => tx.mockExam.update(update), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000,
      })
      : this.prisma.mockExam.update(update);
    const updated = await write.catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2025', 'P2034'].includes(error.code)) {
        throw new AppException('MOCK_CONTENT_CONFLICT', 'Exam content changed. Reload and validate again before publishing', 409);
      }
      throw error;
    });
    await this.audit.log({
      userId: actor.id,
      action: 'mock.exam.update',
      entity: 'mockExam',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async deleteExam(actor: AuthUser, id: string) {
    const exam = await this.prisma.mockExam.findUnique({
      where: { id },
      include: { sections: { include: { groups: true } } },
    });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    await this.assertCanAuthor(actor, id);
    await this.mutateContent(id, (tx) => tx.mockExam.delete({ where: { id } }));
    // Media fayllarni tozalash
    for (const s of exam.sections) {
      for (const g of s.groups) {
        if (g.audioKey) this.storage.delete(g.audioKey);
        if (g.imageKey) this.storage.delete(g.imageKey);
      }
    }
    await this.audit.log({
      userId: actor.id,
      action: 'mock.exam.delete',
      entity: 'mockExam',
      entityId: id,
      oldValue: { title: exam.title },
    });
    return { deleted: true };
  }

  async listExams(viewer: AuthUser | undefined, q: ListExamsQueryDto) {
    const staff = isStaff(viewer);
    const where: Prisma.MockExamWhereInput = {
      ...(q.type ? { type: q.type } : {}),
    };
    if (!staff) {
      if (viewer?.role === 'student') {
        const active = await this.programs.active(viewer.id, q.program);
        where.AND = [{ type: active === 'MULTILEVEL' ? 'multilevel' : active === 'IELTS' ? { in: ['ielts_academic', 'ielts_general'] } : { in: [] } }];
        where.OR = [{ isPublished: true }, { isDemo: true }];
      } else {
        where.isDemo = true; // mehmon / ota-ona
      }
    }
    if (q.practiceLevel) {
      where.practiceLevel = q.practiceLevel;
      where.profile = 'practice';
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { type: 'multilevel' }];
    }
    const exams = await this.prisma.mockExam.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          select: {
            skill: true,
            durationMinutes: true,
            groups: {
              select: {
                sortOrder: true, partNumber: true, passageText: true, audioKey: true, audioDurationSec: true, imageKey: true,
                maxScore: true, stimulusRef: true,
                questions: { select: { type: true, points: true, options: true, wordLimit: true } },
                _count: { select: { questions: true } },
              },
            },
          },
        },
      },
    });
    const accessMap = await this.accessSvc.annotateAccess(
      viewer,
      exams.map((e) => ({
        id: e.id,
        type: e.type,
        isDemo: e.isDemo,
        isPublished: e.isPublished,
        price: e.price,
        isFreeForApproved: e.isFreeForApproved,
      })),
    );
    // AI import provenance (latest revision per exam) — list badge uchun.
    const importRows = await this.prisma.mockExamImport.findMany({
      where: { examId: { in: exams.map((e) => e.id) } },
      select: { examId: true, packageId: true, revision: true, createdAt: true },
      orderBy: { revision: 'desc' },
    });
    const importByExam = new Map<string, { packageId: string; revision: number; importedAt: Date }>();
    for (const r of importRows) {
      if (!importByExam.has(r.examId)) {
        importByExam.set(r.examId, { packageId: r.packageId, revision: r.revision, importedAt: r.createdAt });
      }
    }
    return exams.map((e) => {
      const questionCount = e.sections.reduce(
        (sum, s) => sum + s.groups.reduce((gs, g) => gs + g._count.questions, 0),
        0,
      );
      const duration = totalDuration(e);
      return {
        id: e.id,
        type: e.type,
        profile: e.profile,
        title: staff ? e.title : studentExamTitle(e.title),
        description: e.description,
        level: e.level,
        practiceLevel: e.practiceLevel,
        isDemo: e.isDemo,
        isPublished: e.isPublished,
        ready: this.isReadyForStart(e),
        canEdit:
          viewer?.role === 'admin' ||
          viewer?.role === 'super_admin' ||
          (viewer?.role === 'teacher' && e.createdById === viewer.id),
        skills: e.sections.map((s) => s.skill),
        questionCount,
        durationMinutes: duration,
        price: e.price,
        access: accessMap.get(e.id) ?? 'locked',
        imported: importByExam.get(e.id) ?? null,
      };
    });
  }

  async getExam(viewer: AuthUser | undefined, id: string) {
    const exam = await this.prisma.mockExam.findUnique({ where: { id }, include: EXAM_INCLUDE });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    const staff = isStaff(viewer);
    if (!staff && !exam.isPublished && !exam.isDemo) {
      throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    }
    const access = await this.accessSvc.accessFor(viewer, exam);
    const row = exam as unknown as ExamRow;
    if (!staff && access !== 'granted') {
      return {
        ...shapeExamMeta(row),
        ready: this.isReadyForStart(exam),
        title: studentExamTitle(exam.title),
        price: exam.price,
        isFreeForApproved: exam.isFreeForApproved,
        access,
      };
    }
    return {
      ...shapeExam(row, staff, this.base),
      ready: this.isReadyForStart(exam),
      price: exam.price,
      isFreeForApproved: exam.isFreeForApproved,
      access,
    };
  }

  // ─────────────────────────── Section ───────────────────────────

  async createSection(actor: AuthUser, examId: string, dto: CreateSectionDto) {
    await this.examOrThrow(examId);
    await this.assertCanAuthor(actor, examId);
    const exists = await this.prisma.mockSection.findUnique({
      where: { examId_skill: { examId, skill: dto.skill } },
    });
    if (exists) {
      throw new AppException('MOCK_SECTION_EXISTS', 'Bu bo\'lim allaqachon mavjud', 409);
    }
    const section = await this.mutateContent(examId, (tx) => tx.mockSection.create({
      data: {
        examId,
        skill: dto.skill,
        title: dto.title,
        sortOrder: dto.sortOrder ?? this.defaultSectionOrder(dto.skill),
        durationMinutes: dto.durationMinutes,
        instructions: dto.instructions,
      },
    }));
    await this.audit.log({
      userId: actor.id,
      action: 'mock.section.create',
      entity: 'mockSection',
      entityId: section.id,
      newValue: { examId, skill: dto.skill },
    });
    return section;
  }

  async updateSection(actor: AuthUser, sectionId: string, dto: UpdateSectionDto) {
    const section = await this.sectionOrThrow(sectionId);
    await this.assertCanAuthor(actor, section.examId);
    const updated = await this.mutateContent(section.examId, (tx) => tx.mockSection.update({
      where: { id: sectionId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
      },
    }));
    await this.audit.log({
      userId: actor.id,
      action: 'mock.section.update',
      entity: 'mockSection',
      entityId: sectionId,
    });
    return updated;
  }

  async deleteSection(actor: AuthUser, sectionId: string) {
    const section = await this.prisma.mockSection.findUnique({
      where: { id: sectionId },
      include: { groups: true },
    });
    if (!section) throw new AppException('MOCK_SECTION_NOT_FOUND', 'Bo\'lim topilmadi', 404);
    await this.assertCanAuthor(actor, section.examId);
    await this.mutateContent(section.examId, (tx) => tx.mockSection.delete({ where: { id: sectionId } }));
    for (const g of section.groups) {
      if (g.audioKey) this.storage.delete(g.audioKey);
      if (g.imageKey) this.storage.delete(g.imageKey);
    }
    await this.audit.log({
      userId: actor.id,
      action: 'mock.section.delete',
      entity: 'mockSection',
      entityId: sectionId,
    });
    return { deleted: true };
  }

  // ─────────────────────────── Group ───────────────────────────

  async createGroup(actor: AuthUser, sectionId: string, dto: CreateGroupDto) {
    const section = await this.sectionOrThrow(sectionId);
    await this.assertCanAuthor(actor, section.examId);
    await this.assertProgramPartNumber(section.examId, dto.partNumber);
    const count = await this.prisma.mockQuestionGroup.count({ where: { sectionId } });
    const contentHtml = sanitizeMockContent(dto.contentHtml);
    const audioScript = sanitizeMockContent(dto.audioScript);
    assertDraftGapNumbers(contentHtml);
    const group = await this.mutateContent(section.examId, (tx) => tx.mockQuestionGroup.create({
      data: {
        sectionId,
        sortOrder: dto.sortOrder ?? count,
        title: dto.title,
        instructions: dto.instructions,
        passageText: dto.passageText,
        maxScore: dto.maxScore,
        stimulusRef: dto.stimulusRef,
        contentHtml,
        audioScript,
        contentLayout: dto.contentLayout,
        optionsReusable: dto.optionsReusable,
        partNumber: dto.partNumber,
        audioDurationSec: dto.audioDurationSec,
        audioPlayLimit: dto.audioPlayLimit ?? 1,
      },
    }));
    await this.audit.log({
      userId: actor.id,
      action: 'mock.group.create',
      entity: 'mockQuestionGroup',
      entityId: group.id,
      newValue: { sectionId },
    });
    return group;
  }

  async updateGroup(actor: AuthUser, groupId: string, dto: UpdateGroupDto) {
    const group = await this.prisma.mockQuestionGroup.findUnique({
      where: { id: groupId },
      include: { questions: { select: { number: true } } },
    });
    if (!group) throw new AppException('MOCK_GROUP_NOT_FOUND', 'Blok topilmadi', 404);
    const examId = await this.assertCanAuthorForGroup(actor, groupId);
    if (dto.partNumber !== undefined) {
      const section = await this.sectionOrThrow(group.sectionId);
      await this.assertProgramPartNumber(section.examId, dto.partNumber);
    }
    const contentHtml = dto.contentHtml !== undefined
      ? sanitizeMockContent(dto.contentHtml)
      : group.contentHtml;
    const audioScript = dto.audioScript !== undefined
      ? sanitizeMockContent(dto.audioScript)
      : group.audioScript;
    assertDraftGapNumbers(contentHtml);
    const updated = await this.mutateContent(examId, (tx) => tx.mockQuestionGroup.update({
      where: { id: groupId },
      data: {
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
        ...(dto.passageText !== undefined ? { passageText: dto.passageText } : {}),
        ...(dto.maxScore !== undefined ? { maxScore: dto.maxScore } : {}),
        ...(dto.stimulusRef !== undefined ? { stimulusRef: dto.stimulusRef } : {}),
        ...(dto.contentHtml !== undefined ? { contentHtml } : {}),
        ...(dto.audioScript !== undefined ? { audioScript } : {}),
        ...(dto.contentLayout !== undefined ? { contentLayout: dto.contentLayout } : {}),
        ...(dto.optionsReusable !== undefined ? { optionsReusable: dto.optionsReusable } : {}),
        ...(dto.partNumber !== undefined ? { partNumber: dto.partNumber } : {}),
        ...(dto.audioDurationSec !== undefined ? { audioDurationSec: dto.audioDurationSec } : {}),
        ...(dto.audioPlayLimit !== undefined ? { audioPlayLimit: dto.audioPlayLimit } : {}),
      },
    }));
    await this.audit.log({
      userId: actor.id,
      action: 'mock.group.update',
      entity: 'mockQuestionGroup',
      entityId: groupId,
    });
    return updated;
  }

  private async assertProgramPartNumber(examId: string, partNumber?: number) {
    if (partNumber === undefined || partNumber <= 4) return;
    const exam = await this.prisma.mockExam.findUnique({ where: { id: examId }, select: { type: true } });
    if (exam?.type !== 'multilevel') throw new AppException('VALIDATION_ERROR', 'IELTS listening parts must be 1–4', 400);
  }

  async deleteGroup(actor: AuthUser, groupId: string) {
    const group = await this.groupOrThrow(groupId);
    const examId = await this.assertCanAuthorForGroup(actor, groupId);
    await this.mutateContent(examId, (tx) => tx.mockQuestionGroup.delete({ where: { id: groupId } }));
    if (group.audioKey) this.storage.delete(group.audioKey);
    if (group.imageKey) this.storage.delete(group.imageKey);
    await this.audit.log({
      userId: actor.id,
      action: 'mock.group.delete',
      entity: 'mockQuestionGroup',
      entityId: groupId,
    });
    return { deleted: true };
  }

  /** Listening audio / labelling rasm yuklash (multipart: audio?, image?) */
  async setGroupMedia(
    actor: AuthUser,
    groupId: string,
    files: { audio?: Express.Multer.File[]; image?: Express.Multer.File[] },
  ) {
    const group = await this.groupOrThrow(groupId);
    const examId = await this.assertCanAuthorForGroup(actor, groupId);
    const data: Prisma.MockQuestionGroupUpdateInput = {};
    const audio = files.audio?.[0];
    const image = files.image?.[0];
    if (!audio && !image) {
      throw new AppException('NO_FILE', 'Fayl yuklanmadi (audio yoki image)', 400);
    }
    if (audio) {
      data.audioKey = `mock/${audio.filename}`;
    }
    if (image) {
      data.imageKey = `mock/${image.filename}`;
    }
    const { updated, version } = await this.mutateContent(examId, async (tx) => {
      const updated = await tx.mockQuestionGroup.update({ where: { id: groupId }, data });
      const exam = await tx.mockExam.findUnique({ where: { id: examId }, select: { contentVersion: true } });
      if (!exam) throw new AppException('MOCK_CONTENT_CONFLICT', 'Exam changed while saving media', 409);
      return { updated, version: exam.contentVersion };
    });
    if (audio && group.audioKey) this.storage.delete(group.audioKey);
    if (image && group.imageKey) this.storage.delete(group.imageKey);
    await this.audit.log({
      userId: actor.id,
      action: 'mock.group.media',
      entity: 'mockQuestionGroup',
      entityId: groupId,
    });
    return {
      id: updated.id,
      hasAudio: !!updated.audioKey,
      audioUrl: updated.audioKey ? `${this.base}/mock/groups/${groupId}/audio` : null,
      imageUrl: updated.imageKey ? `${this.base}/mock/groups/${groupId}/image` : null,
      version,
    };
  }

  /** Audio oqimi (Range qo'llab-quvvatlanadi). Demo bo'lmasa — auth talab qilinadi. */
  async streamMedia(
    viewer: AuthUser | undefined,
    groupId: string,
    kind: 'audio' | 'image',
    req: Request,
    res: Response,
  ) {
    const group = await this.prisma.mockQuestionGroup.findUnique({
      where: { id: groupId },
      include: {
        section: {
          include: {
            exam: {
              select: { id: true, type: true, isDemo: true, isPublished: true, price: true, isFreeForApproved: true },
            },
          },
        },
      },
    });
    if (!group) throw new AppException('MOCK_GROUP_NOT_FOUND', 'Blok topilmadi', 404);
    if (!isStaff(viewer) && !group.section.exam.isPublished && !group.section.exam.isDemo) {
      throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    }
    const key = kind === 'audio' ? group.audioKey : group.imageKey;
    if (kind === 'audio' && group.section.exam.type === 'multilevel' && viewer?.role === 'student') {
      const timed = await this.prisma.mockAttempt.findFirst({ where: { studentId: viewer.id, examId: group.section.exam.id, mode: 'timed', status: 'in_progress' } });
      if (timed && req.query.attemptId !== timed.id) throw new AppException('AUDIO_REPLAY_BLOCKED', 'Timed playback requires its active attempt', 403);
    }
    if (!key || !this.storage.exists(key)) {
      throw new AppException('FILE_NOT_FOUND', 'Fayl topilmadi', 404);
    }
    if (!viewer && (group.section.exam.type === 'multilevel' || !group.section.exam.isDemo)) {
      throw new AppException('UNAUTHORIZED', 'Avval tizimga kiring', 401);
    }
    if (viewer && !isStaff(viewer)) {
      const access = await this.accessSvc.accessFor(viewer, group.section.exam);
      if (access === 'pending') {
        throw new AppException('MOCK_PURCHASE_PENDING', 'Xaridingiz tasdiqlanishini kuting', 402);
      }
      if (access !== 'granted') {
        throw new AppException('MOCK_PAYMENT_REQUIRED', "Bu imtihon uchun to'lov talab qilinadi", 402);
      }
    }

    const stat = this.storage.stat(key);
    const contentType = kind === 'audio' ? audioContentType(key) : 'image/*';
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size) {
        res.status(416).set({ 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
      });
      this.storage.createReadStream(key, { start, end }).pipe(res);
    } else {
      res.status(200).set({
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      this.storage.createReadStream(key).pipe(res);
    }
  }

  // ─────────────────────────── Question ───────────────────────────

  // ─────────────────────────── Paste → parse → import ───────────────────────────

  /** Yopishtirilgan matnni parse qiladi (preview — bazaga yozmaydi) */
  parsePreview(text: string) {
    const result = parseQuestions(text);
    return {
      instructions: result.instructions,
      count: result.questions.length,
      questions: result.questions,
    };
  }

  /** Matndan savollarni parse qilib, javob kaliti (raqam bo'yicha) bilan blokka qo'shadi */
  async importQuestions(actor: AuthUser, groupId: string, dto: ImportQuestionsDto) {
    const group = await this.prisma.mockQuestionGroup.findUnique({
      where: { id: groupId },
      include: { section: { select: { skill: true, exam: { select: { type: true } } } } },
    });
    if (!group) throw new AppException('MOCK_GROUP_NOT_FOUND', 'Blok topilmadi', 404);
    const examId = await this.assertCanAuthorForGroup(actor, groupId);

    const parsed = parseQuestions(dto.text);
    if (parsed.questions.length === 0) {
      throw new AppException('NO_QUESTIONS_PARSED', 'Matndan savol topilmadi', 400);
    }
    // Validate numbers 1..200 and duplicates within paste
    const nums = parsed.questions.map((q) => q.number);
    const invalid = nums.filter((n) => !Number.isInteger(n) || n < 1 || n > 200);
    if (invalid.length) throw new AppException('VALIDATION_ERROR', `Invalid question numbers: ${[...new Set(invalid)].join(', ')} (must be 1-200)`, 400);
    const dupInPaste = nums.filter((n, i) => nums.indexOf(n) !== i);
    if (dupInPaste.length) throw new AppException('VALIDATION_ERROR', `Duplicate numbers in pasted text: ${[...new Set(dupInPaste)].join(', ')}`, 400);
    // Exam-wide duplicate check (existing DB numbers)
    const sectionRow = await this.prisma.mockSection.findUnique({ where: { id: group.sectionId }, select: { examId: true } });
    const existingNums = new Set<number>();
    if (sectionRow) {
      const allQs = await this.prisma.mockQuestion.findMany({
        where: { group: { section: { examId: sectionRow.examId, ...(group.section.exam.type === 'multilevel' ? { skill: group.section.skill } : {}) } } },
        select: { number: true },
      });
      for (const q of allQs) existingNums.add(q.number);
      const collisions = nums.filter((n) => existingNums.has(n));
      if (collisions.length) throw new AppException('VALIDATION_ERROR', `Already used in this exam: ${[...new Set(collisions)].join(', ')}`, 400);
    }
    const isAuto = AUTO_SKILLS.includes(group.section.skill);
    const answers = dto.answers ?? {};
    const missing: number[] = [];
    const base = await this.prisma.mockQuestion.count({ where: { groupId } });

    const data = parsed.questions.map((q, i) => {
      let correctAnswers: string[] | undefined;
      if (isAuto) {
        const raw = answers[String(q.number)];
        if (raw && raw.trim()) correctAnswers = buildCorrectAnswers(q.type, q.options, raw.trim());
        else missing.push(q.number);
      }
      return {
        groupId,
        number: q.number,
        sortOrder: base + i,
        type: q.type,
        prompt: q.prompt,
        options: q.options ? (q.options as Prisma.InputJsonValue) : undefined,
        correctAnswers: correctAnswers ? (correctAnswers as Prisma.InputJsonValue) : undefined,
        points: this.resolvePoints(group.section.exam.type, isAuto, dto.points),
      };
    });
    if (isAuto && missing.length) {
      throw new AppException(
        'MISSING_ANSWERS',
        `Quyidagi savollarga javob kiritilmagan: ${missing.join(', ')}`,
        400,
      );
    }

    const questions = await this.mutateContent(examId, async (tx) => {
      if (parsed.instructions && !group.instructions) {
        await tx.mockQuestionGroup.update({ where: { id: groupId }, data: { instructions: parsed.instructions } });
      }
      await tx.mockQuestion.createMany({ data });
      return tx.mockQuestion.findMany({ where: { groupId }, orderBy: { sortOrder: 'asc' } });
    });
    await this.audit.log({
      userId: actor.id,
      action: 'mock.questions.import',
      entity: 'mockQuestionGroup',
      entityId: groupId,
      newValue: { count: data.length },
    });
    return { added: data.length, questions };
  }

  async saveGroupContent(actor: AuthUser, groupId: string, dto: SaveGroupContentDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const group = await tx.mockQuestionGroup.findUnique({
        where: { id: groupId },
        include: { questions: true, section: { include: { exam: true } } },
      });
      if (!group) throw new AppException('MOCK_GROUP_NOT_FOUND', 'Blok topilmadi', 404);
      const exam = group.section.exam;
      if (!['admin', 'super_admin', 'teacher'].includes(actor.role) ||
          (actor.role === 'teacher' && exam.createdById !== actor.id)) {
        throw new AppException('MOCK_NOT_OWNER', 'Bu imtihonni tahrirlash huquqi yo‘q', 403);
      }
      // Content changes after students start would alter their questions and results.
      if (exam.isPublished || await tx.mockAttempt.count({ where: { examId: exam.id } })) {
        throw new AppException(
          'MOCK_CONTENT_LOCKED',
          'O‘quvchilar ishlatgan kontentni o‘zgartirib bo‘lmaydi. Imtihondan nusxa oling',
          409,
        );
      }
      // Optimistic concurrency: eski tabning saqlashi konflikt sifatida qaytadi.
      const checkVersion = (dto as { expectedContentVersion?: number }).expectedContentVersion;
      if (checkVersion !== undefined && (exam as { contentVersion?: number }).contentVersion !== checkVersion) {
        throw new AppException(
          'MOCK_CONTENT_CONFLICT',
          'Imtihon boshqa joyda saqlangan. Qayta yuklab, o‘zgarishlarni qayta kiriting',
          409,
        );
      }
      const ownIds = new Set(group.questions.map((q) => q.id));
      const keptIds = dto.questions.flatMap((q) => q.id ? [q.id] : []);
      const removed = new Set(dto.deletedQuestionIds);
      if (new Set(keptIds).size !== keptIds.length || keptIds.some((id) => !ownIds.has(id) || removed.has(id)) ||
          dto.deletedQuestionIds.some((id) => !ownIds.has(id))) {
        throw new AppException(
          'MOCK_CONTENT_CONFLICT',
          'Savollar boshqa joyda o‘zgargan. Blokni qayta yuklang',
          409,
        );
      }
      // Do not silently drop another editor's newly added questions.
      if (group.questions.some((q) => !keptIds.includes(q.id) && !removed.has(q.id))) {
        throw new AppException(
          'MOCK_CONTENT_CONFLICT',
          'Blokka yangi savollar qo‘shilgan. Saqlashdan oldin qayta yuklang',
          409,
        );
      }
      const numbers = dto.questions.map((q) => q.number);
      if (new Set(numbers).size !== numbers.length) {
        throw new AppException('VALIDATION_ERROR', 'Blok ichida savol raqamlari takrorlanmasligi kerak', 400);
      }
      const others = await tx.mockQuestion.findMany({
        where: { group: { section: { examId: exam.id, ...(exam.type === 'multilevel' ? { skill: group.section.skill } : {}) } }, groupId: { not: groupId }, number: { in: numbers } },
        select: { number: true },
      });
      if (others.length) {
        throw new AppException(
          'VALIDATION_ERROR',
          `Bu savol raqamlari imtihonda ishlatilgan: ${others.map((q) => q.number).join(', ')}`,
          400,
        );
      }
      const isAuto = AUTO_SKILLS.includes(group.section.skill);
      const rows = dto.questions.map((q, index) => {
        this.validateQuestion(q, isAuto, index, false);
        return {
          number: q.number, sortOrder: index, type: q.type, prompt: q.prompt.trim(),
          options: q.options ?? [], correctAnswers: q.correctAnswers ?? [],
          acceptedVariants: q.acceptedVariants ?? [], wordLimit: q.wordLimit ?? null,
          answerRule: q.answerRule ?? null,
          points: this.resolvePoints(exam.type, isAuto, q.points, `Question ${index + 1}: `),
        };
      });
      const contentHtml = dto.contentHtml !== undefined
        ? sanitizeMockContent(dto.contentHtml)
        : group.contentHtml;
      const audioScript = dto.audioScript !== undefined
        ? sanitizeMockContent(dto.audioScript)
        : group.audioScript;
      assertDraftGapNumbers(contentHtml);
      const { questions: _questions, deletedQuestionIds: _deleted, expectedContentVersion: _v, ...material } = dto;
      await tx.mockQuestionGroup.update({
        where: { id: groupId },
        data: {
          ...material,
          ...(dto.contentHtml !== undefined ? { contentHtml } : {}),
          ...(dto.audioScript !== undefined ? { audioScript } : {}),
        },
      });
      await tx.mockQuestion.deleteMany({ where: { groupId, id: { in: dto.deletedQuestionIds } } });
      const questions = [];
      for (const [index, data] of rows.entries()) {
        const id = dto.questions[index].id;
        questions.push(id
          ? await tx.mockQuestion.update({ where: { id }, data })
          : await tx.mockQuestion.create({ data: { ...data, groupId } }));
      }
      await this.reconcileCurrentMultilevelDraft(tx, exam);
      const freshGroup = await tx.mockQuestionGroup.findUnique({
        where: { id: groupId },
        include: { questions: { orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }] } },
      });
      if (!freshGroup) throw new AppException('MOCK_GROUP_NOT_FOUND', 'Blok topilmadi', 404);
      // Every successful content write invalidates snapshots held by other editors.
      const bumped = await tx.mockExam.update({
        where: { id: exam.id, isPublished: false, attempts: { none: {} } },
        data: { contentVersion: { increment: 1 } },
        select: { contentVersion: true },
      });
      const version = bumped.contentVersion;
      return { saved: questions.length, questions, group: freshGroup, version };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2025', 'P2034'].includes(error.code)) {
        throw new AppException('MOCK_CONTENT_CONFLICT', 'Exam content changed. Reload before saving', 409);
      }
      throw error;
    });
    await this.audit.log({ userId: actor.id, action: 'mock.group.content.save', entity: 'mockQuestionGroup', entityId: groupId, newValue: { count: result.saved } });
    return result;
  }

  /** Keep student catalogue readiness byte-for-byte aligned with start(). */
  private isReadyForStart(exam: { type: MockExamType; specificationVersion?: string | null; profile?: string; sections: unknown[] }): boolean {
    if (exam.type !== 'multilevel') return true;
    return exam.specificationVersion === MULTILEVEL_VERSION &&
      multilevelBlueprintIssues(exam.sections as never, exam.profile === 'full_mock').length === 0;
  }

  /**
   * Safe compatibility repair for drafts authored before task/part semantics
   * were persisted. Published exams and attempts retain their old contracts.
   */
  async repairMultilevelDraft(actor: AuthUser, id: string) {
    await this.assertCanAuthor(actor, id);
    const repaired = await this.prisma.$transaction(async (tx) => {
      const exam = await tx.mockExam.findUnique({ where: { id } });
      if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
      if (exam.type !== 'multilevel' || exam.specificationVersion !== MULTILEVEL_VERSION) {
        throw new AppException('VALIDATION_ERROR', 'Only current-version Multilevel drafts can be repaired', 400);
      }
      if (exam.isPublished || await tx.mockAttempt.count({ where: { examId: id } })) {
        throw new AppException('MOCK_CONTENT_LOCKED', 'Published or attempted exams cannot be repaired; clone the exam instead', 409);
      }
      const changed = await this.reconcileCurrentMultilevelDraft(tx, exam);
      if (changed) await tx.mockExam.update({ where: { id }, data: { contentVersion: { increment: 1 } } });
      return changed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    await this.audit.log({ userId: actor.id, action: 'mock.exam.multilevel.repair', entity: 'mockExam', entityId: id, newValue: { repaired } });
    return { repaired };
  }

  private async reconcileCurrentMultilevelDraft(
    tx: Prisma.TransactionClient,
    exam: { id: string; type: MockExamType; specificationVersion?: string | null; isPublished: boolean },
  ): Promise<number> {
    if (exam.type !== 'multilevel' || exam.specificationVersion !== MULTILEVEL_VERSION || exam.isPublished) return 0;
    const sections = await tx.mockSection.findMany({
      where: { examId: exam.id, skill: { in: ['writing', 'speaking'] } },
      include: { groups: { orderBy: { sortOrder: 'asc' } } },
    });
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const section of sections) {
      const spec = MULTILEVEL_SPECIFICATION[section.skill];
      const groups = [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder);
      const sharedStimulus = section.skill === 'writing'
        ? groups[0]?.stimulusRef || groups[1]?.stimulusRef || `multilevel:${exam.id}:writing-task-1`
        : null;
      groups.forEach((group, index) => {
        const expected = spec.parts[index];
        if (!expected?.rawMax) return;
        const data: Prisma.MockQuestionGroupUpdateInput = {};
        if (group.maxScore !== expected.rawMax) data.maxScore = expected.rawMax;
        if (section.skill === 'writing' && index < 2 && group.stimulusRef !== sharedStimulus) data.stimulusRef = sharedStimulus;
        if (Object.keys(data).length) writes.push(tx.mockQuestionGroup.update({ where: { id: group.id }, data }));
      });
    }
    await Promise.all(writes);
    return writes.length;
  }

  async addQuestions(actor: AuthUser, groupId: string, dto: AddQuestionsDto) {
    const group = await this.prisma.mockQuestionGroup.findUnique({
      where: { id: groupId },
      include: { section: { select: { skill: true, exam: { select: { type: true } } } } },
    });
    if (!group) throw new AppException('MOCK_GROUP_NOT_FOUND', 'Blok topilmadi', 404);
    const examId = await this.assertCanAuthorForGroup(actor, groupId);

    const isAuto = AUTO_SKILLS.includes(group.section.skill);
    const base = await this.prisma.mockQuestion.count({ where: { groupId } });

    dto.questions.forEach((q, i) => this.validateQuestion(q, isAuto, i));
    // Duplicate numbers within batch
    const batchNums = dto.questions.map((q) => q.number);
    const batchDups = batchNums.filter((n, i) => batchNums.indexOf(n) !== i);
    if (batchDups.length) throw new AppException('VALIDATION_ERROR', `Duplicate numbers in batch: ${[...new Set(batchDups)].join(', ')}`, 400);
    // Exam-wide duplicates
    const secRow = await this.prisma.mockSection.findUnique({ where: { id: group.sectionId }, select: { examId: true } });
    if (secRow) {
      const existing = await this.prisma.mockQuestion.findMany({ where: { group: { section: { examId: secRow.examId, ...(group.section.exam.type === 'multilevel' ? { skill: group.section.skill } : {}) } } }, select: { number: true } });
      const used = new Set(existing.map((x) => x.number));
      const coll = batchNums.filter((n) => used.has(n));
      if (coll.length) throw new AppException('VALIDATION_ERROR', `Already used in this exam: ${[...new Set(coll)].join(', ')}`, 400);
    }

    const questions = await this.mutateContent(examId, async (tx) => {
      await tx.mockQuestion.createMany({
        data: dto.questions.map((q, i) => ({
          groupId,
          number: q.number,
          sortOrder: q.sortOrder ?? base + i,
          type: q.type,
          prompt: q.prompt,
          options: q.options ? (q.options as Prisma.InputJsonValue) : undefined,
          correctAnswers: q.correctAnswers ? (q.correctAnswers as Prisma.InputJsonValue) : undefined,
          acceptedVariants: q.acceptedVariants ? (q.acceptedVariants as Prisma.InputJsonValue) : undefined,
          points: this.resolvePoints(group.section.exam.type, isAuto, q.points, `#${i + 1}-savol: `),
          wordLimit: q.wordLimit,
          answerRule: q.answerRule,
        })),
      });
      return tx.mockQuestion.findMany({ where: { groupId }, orderBy: { sortOrder: 'asc' } });
    });
    await this.audit.log({
      userId: actor.id,
      action: 'mock.questions.add',
      entity: 'mockQuestionGroup',
      entityId: groupId,
      newValue: { count: dto.questions.length },
    });

    return { added: dto.questions.length, questions };
  }

  async updateQuestion(actor: AuthUser, questionId: string, dto: UpdateQuestionDto) {
    const question = await this.prisma.mockQuestion.findUnique({
      where: { id: questionId },
      include: {
        group: { include: { section: { select: { skill: true, exam: { select: { type: true } } } } } },
      },
    });
    if (!question) throw new AppException('MOCK_QUESTION_NOT_FOUND', 'Savol topilmadi', 404);
    const examId = await this.assertCanAuthorForQuestion(actor, questionId);

    const type = dto.type ?? question.type;
    const isAuto = AUTO_SKILLS.includes(question.group.section.skill);
    const merged = {
      number: dto.number ?? question.number,
      type,
      prompt: dto.prompt ?? question.prompt,
      options: dto.options ?? (question.options as string[] | null) ?? undefined,
      correctAnswers:
        dto.correctAnswers ?? (question.correctAnswers as string[] | null) ?? undefined,
      points: dto.points,
      wordLimit: dto.wordLimit,
      answerRule: dto.answerRule !== undefined ? dto.answerRule : question.answerRule,
    };
    this.validateQuestion(merged, isAuto, 0);

    const updated = await this.mutateContent(examId, (tx) => tx.mockQuestion.update({
      where: { id: questionId },
      data: {
        ...(dto.number !== undefined ? { number: dto.number } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.prompt !== undefined ? { prompt: dto.prompt } : {}),
        ...(dto.options !== undefined
          ? { options: dto.options as Prisma.InputJsonValue }
          : {}),
        ...(dto.correctAnswers !== undefined
          ? { correctAnswers: dto.correctAnswers as Prisma.InputJsonValue }
          : {}),
        ...(dto.acceptedVariants !== undefined
          ? { acceptedVariants: dto.acceptedVariants as Prisma.InputJsonValue }
          : {}),
        ...(dto.points !== undefined
          ? {
              points: this.resolvePoints(
                question.group.section.exam.type,
                isAuto,
                dto.points,
              ),
            }
          : {}),
        ...(dto.wordLimit !== undefined ? { wordLimit: dto.wordLimit } : {}),
        ...(dto.answerRule !== undefined ? { answerRule: dto.answerRule } : {}),
      },
    }));
    await this.audit.log({
      userId: actor.id,
      action: 'mock.question.update',
      entity: 'mockQuestion',
      entityId: questionId,
    });
    return updated;
  }

  async deleteQuestion(actor: AuthUser, questionId: string) {
    const question = await this.prisma.mockQuestion.findUnique({ where: { id: questionId } });
    if (!question) throw new AppException('MOCK_QUESTION_NOT_FOUND', 'Savol topilmadi', 404);
    const examId = await this.assertCanAuthorForQuestion(actor, questionId);
    await this.mutateContent(examId, (tx) => tx.mockQuestion.delete({ where: { id: questionId } }));
    await this.audit.log({
      userId: actor.id,
      action: 'mock.question.delete',
      entity: 'mockQuestion',
      entityId: questionId,
    });
    return { deleted: true };
  }

  // ─────────────────────────── Clone / readiness / preview ───────────────────────────

  /**
   * Imtihonni to'liq nusxalash — har qanday staff boshqa imtihonni O'Z qoralamasiga
   * ko'chiradi. Yangisi har doim isPublished=false, createdById=cloner.
   * Media fayllar (audio/image) nusxalanmaydi — umumiy fayl o'chib ketmasligi uchun.
   */
  async cloneExam(actor: AuthUser, id: string) {
    const source = await this.prisma.mockExam.findUnique({
      where: { id },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            groups: {
              orderBy: { sortOrder: 'asc' },
              include: { questions: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!source) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);

    const copy = await this.prisma.$transaction(async (tx) => {
      const exam = await tx.mockExam.create({
        data: {
          type: source.type,
          specificationVersion: source.specificationVersion,
          speakingProfileVersion: source.type === 'multilevel' ? BESTWAY_MULTILEVEL_SPEAKING_2026_V2 : null,
          assessmentPolicy: source.assessmentPolicy,
          profile: source.profile,
          title: `${source.title} (copy)`.slice(0, 200),
          description: source.description,
          level: source.level,
          practiceLevel: source.practiceLevel,
          isPublished: false,
          isDemo: false,
          price: source.price,
          isFreeForApproved: source.isFreeForApproved,
          createdById: actor.id,
        },
      });
      for (const s of source.sections) {
        const section = await tx.mockSection.create({
          data: {
            examId: exam.id,
            skill: s.skill,
            title: s.title,
            sortOrder: s.sortOrder,
            durationMinutes: s.durationMinutes,
            instructions: s.instructions,
          },
        });
        for (const g of s.groups) {
          const group = await tx.mockQuestionGroup.create({
            data: {
              sectionId: section.id,
              sortOrder: g.sortOrder,
              title: g.title,
              instructions: g.instructions,
              passageText: g.passageText,
              contentHtml: g.contentHtml,
              audioScript: g.audioScript,
              contentLayout: g.contentLayout,
              optionsReusable: g.optionsReusable,
              partNumber: g.partNumber,
              audioDurationSec: g.audioDurationSec,
              audioPlayLimit: g.audioPlayLimit,
            },
          });
          if (g.questions.length) {
            await tx.mockQuestion.createMany({
              data: g.questions.map((q) => ({
                groupId: group.id,
                number: q.number,
                sortOrder: q.sortOrder,
                type: q.type,
                prompt: q.prompt,
                options: q.options ?? Prisma.JsonNull,
                correctAnswers: q.correctAnswers ?? Prisma.JsonNull,
                acceptedVariants: q.acceptedVariants ?? Prisma.JsonNull,
                points: q.points,
                wordLimit: q.wordLimit,
                answerRule: q.answerRule,
              })),
            });
          }
        }
      }
      return exam;
    });

    await this.audit.log({
      userId: actor.id,
      action: 'mock.exam.clone',
      entity: 'mockExam',
      entityId: copy.id,
      oldValue: { sourceId: id, title: source.title },
    });
    return copy;
  }

  /** Publish-readiness checklist — nashr oldidan kamchiliklarni ko'rsatadi (bloklamaydi). */
  async readiness(actor: AuthUser, id: string, effectiveProfile?: string) {
    const exam = await this.prisma.mockExam.findUnique({
      where: { id },
      include: {
        sections: {
          include: {
            groups: { include: { questions: true } },
          },
        },
      },
    });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    void actor;

    // Profile-aware publish gate: practice validates only existing content,
    // full_mock additionally enforces the strict IELTS blueprint.
    const profile = effectiveProfile ?? (exam as { profile?: string }).profile ?? 'practice';
    const isFullMock = profile === 'full_mock';
    const bySkill = new Map(exam.sections.map((s) => [s.skill, s]));
    const items: Array<{ key: string; ok: boolean; detail: string }> = [];

    const groupCount = exam.sections.reduce((n, s) => n + s.groups.length, 0);
    const questionTotal = exam.sections.reduce(
      (n, s) => n + s.groups.reduce((m, g) => m + g.questions.length, 0),
      0,
    );
    items.push({
      key: 'has_content',
      ok: exam.sections.length > 0 && groupCount > 0 && questionTotal > 0,
      detail:
        exam.sections.length > 0 && groupCount > 0 && questionTotal > 0
          ? `${exam.sections.length} section(s), ${groupCount} group(s), ${questionTotal} question(s)`
          : 'needs at least one section with a group and a question',
    });

    const requiredSkills = isFullMock ? (exam.type === 'multilevel' ? (['listening', 'reading', 'writing', 'speaking'] as const) : (['listening', 'reading', 'writing'] as const)) : [];
    for (const skill of requiredSkills) {
      const section = bySkill.get(skill);
      items.push({
        key: `${skill}_section`,
        ok: !!section,
        detail: section ? 'exists' : 'missing section',
      });
    }
    for (const skill of ['listening', 'reading', 'writing', 'speaking'] as const) {
      const section = bySkill.get(skill);
      if (!section) continue;
      if (skill === 'listening') {
        const groups = section.groups as Array<{
          partNumber: number | null;
          audioKey: string | null;
          questions: unknown[];
        }>;
        if (isFullMock && exam.type !== 'multilevel') {
          const parts = new Set(groups.map((g) => g.partNumber).filter((p) => p != null));
          items.push({
            key: 'listening_parts',
            ok: groups.length === 4 && parts.size === 4 && [1, 2, 3, 4].every((part) => parts.has(part)),
            detail: `${groups.length} groups, parts: ${[...parts].sort().join(',') || '—'}`,
          });
          const count = groups.reduce((total, group) => total + group.questions.length, 0);
          items.push({ key: 'listening_questions', ok: count === 40, detail: `${count}/40 questions` });
        }
        items.push({
          key: 'listening_audio',
          ok: groups.length > 0 && groups.every((g) => !!g.audioKey),
          detail: `${groups.filter((g) => g.audioKey).length}/${groups.length} groups with audio`,
        });
      }
      if (skill === 'reading') {
        const groups = section.groups as Array<{ passageText: string | null; contentHtml?: string | null; questions: unknown[] }>;
        if (isFullMock && exam.type !== 'multilevel') {
          const count = groups.reduce((total, group) => total + group.questions.length, 0);
          items.push({ key: 'reading_groups', ok: groups.length === 3, detail: `${groups.length}/3 passages` });
          items.push({ key: 'reading_questions', ok: count === 40, detail: `${count}/40 questions` });
        }
        const missingPassage = groups.filter((g) => g.questions.length > 0 && !g.passageText?.trim() && !g.contentHtml?.trim()).length;
        items.push({
          key: 'reading_passage',
          ok: missingPassage === 0,
          detail: missingPassage === 0 ? 'all passages have text' : `${missingPassage} passage(s) without text`,
        });
      }
      if (skill === 'writing') {
        const questions = (section.groups as Array<{ questions: Array<{ type: string; prompt: string }> }>).flatMap((g) => g.questions);
        if (isFullMock && exam.type !== 'multilevel') {
          const types = new Set(questions.map((q) => q.type));
          items.push({
            key: 'writing_tasks',
            ok: questions.length === 2 && types.has('essay_task1') && types.has('essay_task2'),
            detail: `${questions.length}/2 tasks: ${[...types].join(',') || '—'}`,
          });
        } else {
          const essays = questions.filter(
            (q) => (q.type === 'essay_task1' || q.type === 'essay_task2') && q.prompt.trim() !== '',
          );
          items.push({
            key: 'writing_content',
            ok: essays.length > 0,
            detail: essays.length > 0 ? `${essays.length} essay task(s)` : 'needs at least one essay task with a prompt',
          });
        }
      }
      if (skill === 'speaking' && !isFullMock) {
        const tasks = (section.groups as Array<{ questions: Array<{ type: string }> }>).flatMap((g) => g.questions)
          .filter((q) => q.type === 'speaking_task');
        items.push({
          key: 'speaking_content',
          ok: tasks.length > 0,
          detail: tasks.length > 0 ? `${tasks.length} speaking task(s)` : 'needs at least one speaking task',
        });
      }
    }

    // Auto savollarda javob kaliti bormi (trim empty)
    let missingKeys = 0;
    let manualBadPoints = 0;
    const ielts = exam.type === 'ielts_academic' || exam.type === 'ielts_general';
    if (!ielts && isFullMock) {
      const problems = multilevelBlueprintIssues(exam.sections, isFullMock);
      items.push({ key: 'multilevel_blueprint', ok: problems.length === 0, detail: problems.join('; ') || MULTILEVEL_VERSION });
    }
    const seenNumbers = new Map<string | number, number>();
    let duplicateCount = 0;
    const unavailableMedia: string[] = [];
    for (const s of exam.sections) {
      const auto = AUTO_SKILLS.includes(s.skill);
      for (const g of s.groups) {
        for (const key of [g.audioKey, g.imageKey]) {
          if (!key) continue;
          try { if (!this.storage.exists(key)) unavailableMedia.push(g.id ?? s.skill); }
          catch { unavailableMedia.push(g.id ?? s.skill); }
        }
        const questionIssues = objectiveGroupIssues(g, auto);
        try {
          if (gapNumbersFromHtml(g.contentHtml).length) assertGappedDocumentQuestions(g.contentHtml, g.questions.map((q) => q.number));
        }
        catch (error) { questionIssues.push(error instanceof Error ? error.message : 'Gap/question mapping is invalid'); }
        items.push({ key: `question_group:${g.id ?? s.skill}`, ok: questionIssues.length === 0, detail: questionIssues.join('; ') || 'question format and mappings valid' });
        for (const q of g.questions) {
          const keys = (q.correctAnswers as string[] | null) ?? [];
          const nonEmpty = keys.filter((a) => a.trim() !== '');
          if (auto && nonEmpty.length === 0) missingKeys++;
          if (ielts && !auto && q.points !== IELTS_MANUAL_POINTS) manualBadPoints++;
          const numberKey = ielts ? q.number : `${s.skill}:${q.number}`;
          const c = seenNumbers.get(numberKey) ?? 0;
          if (c === 1) duplicateCount++;
          seenNumbers.set(numberKey, c + 1);
        }
      }
    }
    items.push({ key: 'answer_keys', ok: missingKeys === 0, detail: `${missingKeys} auto Q without key` });
    items.push({ key: 'media_assets', ok: unavailableMedia.length === 0, detail: unavailableMedia.length ? `${unavailableMedia.length} media asset(s) unavailable or invalid` : 'all referenced media available' });
    items.push({
      key: 'manual_points',
      ok: !ielts || manualBadPoints === 0,
      detail: ielts ? `${manualBadPoints} W/S Q not 9pt` : 'n/a (multilevel)',
    });
    items.push({ key: 'duplicate_numbers', ok: duplicateCount === 0, detail: duplicateCount === 0 ? 'no duplicates' : `${duplicateCount} duplicate number(s)` });

    const total = questionTotal;
    items.push({ key: 'total_questions', ok: total > 0, detail: `${total} question(s)` });

    // Resolving a review warning must not publish generated template prose.
    // Match the case-sensitive scaffold prefixes, not ordinary "replace" prose.
    const templateMarker = /\bREPLACE(?:\s+[—-]\s+|\s+WITH THE COMPLETE TEXT FOR READING PASSAGE\b)/;
    const hasMarker = (values: unknown[]) => values.some((value) => typeof value === 'string' && templateMarker.test(value));
    const generatedTemplate = await this.prisma.mockImportReviewIssue.count({ where: {
      import: { examId: id }, OR: [
        { message: { startsWith: 'Template placeholders and sample answer keys must be replaced' } },
        { message: { startsWith: 'Replace and verify all Listening placeholders and answer keys' } },
        { message: { startsWith: 'Replace and verify all Part ' } },
      ],
    } }) > 0;
    let placeholderBlocks = hasMarker([exam.title, exam.description]) ? 1 : 0;
    for (const section of exam.sections) if (hasMarker([section.title, section.instructions])) placeholderBlocks++;
    for (const section of exam.sections) for (const group of section.groups) {
      const values: unknown[] = [group.title, group.passageText, group.contentHtml, group.audioScript, group.instructions,
        ...group.questions.flatMap((question) => [question.prompt, ...(Array.isArray(question.options) ? question.options : [])])];
      const placeholderKey = generatedTemplate && group.questions.some((question) =>
        [question.correctAnswers, question.acceptedVariants].some((answers) => Array.isArray(answers) && answers.includes('REPLACE')));
      if (placeholderKey || hasMarker(values)) placeholderBlocks++;
    }
    items.push({ key: 'template_placeholders', ok: placeholderBlocks === 0,
      detail: placeholderBlocks ? `${placeholderBlocks} content block(s) still contain generated template placeholders` : 'no generated template placeholders' });

    // AI import review issues: teacher resolve qilgunga qadar publish bloklanadi.
    const openImportIssues = await this.prisma.mockImportReviewIssue.count({
      where: { import: { examId: id }, status: 'open' },
    });
    items.push({
      key: 'import_issues',
      ok: openImportIssues === 0,
      detail: openImportIssues === 0 ? 'no open import issues' : `${openImportIssues} open import issue(s) — resolve in Exam Builder`,
    });

    return { examId: id, ready: items.every((i) => i.ok), items };
  }

  /**
   * Student-preview: xodim imtihonni o'quvchi ko'radigan holatda ko'radi
   * (javob kalitlarisiz, kirish eshigi bilan).
   */
  async preview(actor: AuthUser, id: string) {
    const exam = await this.prisma.mockExam.findUnique({
      where: { id },
      include: EXAM_INCLUDE,
    });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    const shaped = shapeExam(exam as unknown as ExamRow, false, this.base);
    const access =
      actor.role === 'student' ? await this.accessSvc.accessFor(actor, exam) : 'granted';
    return { ...shaped, access };
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private validateQuestion(
    q: { type: MockQuestionType; prompt?: string; options?: string[]; correctAnswers?: string[]; acceptedVariants?: string[]; wordLimit?: number | null; answerRule?: string | null; points?: number },
    isAuto: boolean,
    index: number,
    complete = true,
  ): void {
    const at = `#${index + 1}-savol: `;
    const opts = (q.options ?? []).filter((o) => o.trim() !== '');
    const keys = (q.correctAnswers ?? []).filter((a) => a.trim() !== '');
    if (complete && OPTION_TYPES.has(q.type) && opts.length < 2) {
      throw new AppException('OPTIONS_REQUIRED', `${at}variantlar kamida 2 ta bo'lsin`, 400);
    }
    if (complete && isAuto && keys.length === 0) {
      throw new AppException(
        'CORRECT_ANSWER_REQUIRED',
        `${at}Listening/Reading savoli uchun to'g'ri javob majburiy`,
        400,
      );
    }
    if (q.wordLimit != null && (!Number.isInteger(q.wordLimit) || q.wordLimit < 1 || q.wordLimit > 50)) {
      throw new AppException('VALIDATION_ERROR', `${at}word limit 1-50 bo'lsin`, 400);
    }
    if (q.points != null && (!Number.isInteger(q.points) || q.points < 1 || q.points > 20)) {
      throw new AppException('VALIDATION_ERROR', `${at}points 1-20 bo'lsin`, 400);
    }
    const issues = objectiveQuestionIssues(q, isAuto, complete);
    if (issues.length) throw new AppException('VALIDATION_ERROR', `${at}${issues.join('; ')}`, 400);
  }

  private resolvePoints(
    examType: MockExamType,
    isAuto: boolean,
    points: number | undefined,
    label = '',
  ): number {
    const ielts = examType === 'ielts_academic' || examType === 'ielts_general';
    if (!isAuto && ielts) {
      if (points !== undefined && points !== IELTS_MANUAL_POINTS) {
        throw new AppException(
          'VALIDATION_ERROR',
          `${label}IELTS Writing/Speaking savoli uchun points aynan ${IELTS_MANUAL_POINTS} bo'lsin (band shkalasi 0–9, qo'lda baholash)`,
          400,
        );
      }
      return IELTS_MANUAL_POINTS;
    }
    return points ?? 1;
  }

  private assertPracticeLevel(type: MockExamType, profile: string, practiceLevel: string | null | undefined): void {
    if (practiceLevel != null && (type !== 'multilevel' || profile !== 'practice')) {
      throw new AppException('VALIDATION_ERROR', 'Practice level is only available for Multilevel practice exams', 400);
    }
  }

  private defaultSectionOrder(skill: string): number {
    return ['listening', 'reading', 'writing', 'speaking'].indexOf(skill);
  }

  private async examOrThrow(id: string) {
    const exam = await this.prisma.mockExam.findUnique({ where: { id } });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    return exam;
  }

  /**
   * Teacher faqat O'ZI yaratgan imtihonni tahrirlaydi (createdById).
   * Admin/super_admin — barcha imtihonlar. Eski (createdById=null) imtihonlar teacher uchun yopiq.
   */
  private async assertCanAuthor(actor: AuthUser, examId: string, contentChange = true): Promise<void> {
    const exam = await this.examOrThrow(examId);
    if (!['admin', 'super_admin', 'teacher'].includes(actor.role) ||
        (actor.role === 'teacher' && exam.createdById !== actor.id)) {
      throw new AppException(
        'MOCK_NOT_OWNER',
        'Bu imtihonni faqat yaratgan o‘qituvchi (yoki admin) tahrirlay oladi',
        403,
      );
    }
    if (contentChange && exam.isPublished) {
      throw new AppException('MOCK_CONTENT_LOCKED', 'Unpublish an unused draft or clone this exam before editing published content', 409);
    }
    if (contentChange && await this.prisma.mockAttempt.count({ where: { examId } }) > 0) {
      throw new AppException('EXAM_VERSION_IN_USE', 'Clone this exam before editing content used by attempts', 409);
    }
  }

  private async assertCanAuthorForGroup(actor: AuthUser, groupId: string): Promise<string> {
    const group = await this.prisma.mockQuestionGroup.findUnique({
      where: { id: groupId },
      select: { section: { select: { examId: true } } },
    });
    if (!group) throw new AppException('MOCK_GROUP_NOT_FOUND', 'Blok topilmadi', 404);
    await this.assertCanAuthor(actor, group.section.examId);
    return group.section.examId;
  }

  private async assertCanAuthorForQuestion(actor: AuthUser, questionId: string): Promise<string> {
    const question = await this.prisma.mockQuestion.findUnique({
      where: { id: questionId },
      select: { group: { select: { section: { select: { examId: true } } } } },
    });
    if (!question) throw new AppException('MOCK_QUESTION_NOT_FOUND', 'Savol topilmadi', 404);
    await this.assertCanAuthor(actor, question.group.section.examId);
    return question.group.section.examId;
  }

  /** The exam row serializes legacy writes against publishing and invalidates stale drafts. */
  private async mutateContent<T>(examId: string, mutate: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.mockExam.updateMany({
          where: { id: examId, isPublished: false, attempts: { none: {} } },
          data: { contentVersion: { increment: 1 } },
        });
        if (locked.count !== 1) throw new AppException('MOCK_CONTENT_CONFLICT', 'Exam state changed. Reload or clone before editing', 409);
        return mutate(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new AppException('MOCK_CONTENT_CONFLICT', 'Another editor changed this exam. Reload before saving', 409);
      }
      throw error;
    }
  }

  private async sectionOrThrow(id: string) {
    const section = await this.prisma.mockSection.findUnique({ where: { id } });
    if (!section) throw new AppException('MOCK_SECTION_NOT_FOUND', 'Bo\'lim topilmadi', 404);
    return section;
  }

  private async groupOrThrow(id: string) {
    const group = await this.prisma.mockQuestionGroup.findUnique({ where: { id } });
    if (!group) throw new AppException('MOCK_GROUP_NOT_FOUND', 'Blok topilmadi', 404);
    return group;
  }
}
