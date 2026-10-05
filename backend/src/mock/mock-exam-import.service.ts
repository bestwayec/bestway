import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { MULTILEVEL_VERSION } from './multilevel-specification';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeMockContent } from './mock-content';
import { canonicalDecision } from './question-engine';
import { canonicalChecksum, validateImportPackage, type ImportReport } from './mock-import-validate';

type Pkg = Record<string, any>;

function isStaff(user: AuthUser): boolean {
  return user.role === 'teacher' || user.role === 'admin' || user.role === 'super_admin';
}

function assertStaff(user: AuthUser): void {
  if (!isStaff(user)) {
    throw new AppException('MOCK_FORBIDDEN', 'Bu amal faqat xodimlar uchun', 403);
  }
}

const SKILL_ORDER = ['listening', 'reading', 'writing', 'speaking'];
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Review issue JSON-pointer ini eng yaqin paket manbasiga yechadi
 * (question > group > section) — editor navigatsiyasi uchun.
 */
export function resolveIssueSource(pkg: unknown, pointer: string): { kind: string; key: string } | null {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return null;
  const parts = pointer.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts[0] !== 'exam' || parts[1] !== 'sections') return null;
  const root = pkg as Pkg;
  const sections = root?.exam?.sections;
  if (!Array.isArray(sections)) return null;
  const si = Number(parts[2]);
  const section = sections[si];
  if (!section || typeof section.key !== 'string') return null;
  let out = { kind: 'section', key: section.key as string };
  if (parts[3] === 'groups') {
    const gi = Number(parts[4]);
    const g = section.groups?.[gi];
    if (!g || typeof g.key !== 'string') return out;
    out = { kind: 'group', key: g.key as string };
    if (parts[5] === 'questions') {
      const qi = Number(parts[6]);
      const q = g.questions?.[qi];
      if (!q || typeof q.key !== 'string') return out;
      out = { kind: 'question', key: q.key as string };
    }
  }
  return out;
}

export interface CommitResult {
  examId: string;
  importId: string;
  revision: number;
  replay: boolean;
  addedToExisting: boolean;
  editorUrl: string;
}

@Injectable()
export class MockExamImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Dry-run: normalize + report, hech narsa persist qilinmaydi. */
  async validateDryRun(
    actor: AuthUser,
    pkg: unknown,
    mediaBindings: Record<string, string> = {},
    rawText?: string,
  ): Promise<ImportReport> {
    assertStaff(actor);
    return validateImportPackage(pkg, { mediaBindings, rawText });
  }

  /** Staged upload metadata — controller multer orqali faylni diskka yozadi. */
  async stageMedia(actor: AuthUser, file: Express.Multer.File) {
    assertStaff(actor);
    if (!file) throw new AppException('NO_FILE', 'Fayl yuklanmadi', 400);
    const kind = file.mimetype.startsWith('audio/') ? 'audio' : file.mimetype.startsWith('image/') ? 'image' : null;
    if (!kind) throw new AppException('INVALID_FILE_TYPE', 'Audio yoki rasm yuklang', 400);
    const checksum = createHash('sha256').update(`${file.filename}:${file.size}`).digest('hex');
    const staged = await this.prisma.mockStagedMedia.create({
      data: {
        ownerId: actor.id,
        storageKey: `mock/${file.filename}`,
        fileName: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksum,
        kind,
        expiresAt: new Date(Date.now() + STAGED_TTL_MS),
      },
    });
    return {
      uploadId: staged.id,
      fileName: staged.fileName,
      mimeType: staged.mimeType,
      sizeBytes: staged.sizeBytes,
      kind: staged.kind,
      expiresAt: staged.expiresAt,
    };
  }

  /**
   * Yangi draft yaratadi yoki tanlangan editable draftga paketni qo'shadi.
   * Hech qachon publish qilmaydi.
   * (createdById, packageId, revision) bo'yicha idempotent: bir xil paket replay,
   * o'zgargan content 409.
   */
  async commitImport(
    actor: AuthUser,
    pkg: unknown,
    mediaBindings: Record<string, string> = {},
    validatedChecksum?: string,
    rawText?: string,
    targetExamId?: string,
  ): Promise<CommitResult> {
    assertStaff(actor);
    const report = validateImportPackage(pkg, { mediaBindings, rawText });
    if (!report.canImport) {
      const first = report.issues.find((i) => i.blocks.includes('import'));
      throw new AppException(
        'MOCK_IMPORT_INVALID',
        `Import validation failed: ${first?.code} ${first?.path}${report.totalIssues > 1 ? ` (+${report.totalIssues - 1})` : ''}`,
        422,
      );
    }
    if (!validatedChecksum || validatedChecksum !== report.checksum) {
      throw new AppException(
        'MOCK_IMPORT_STALE',
        'Validated checksum mismatch — run validate again before import',
        422,
      );
    }
    const p = pkg as Pkg;
    const packageId: string = p.packageId;
    const revision: number = p.revision;

    const existing = await this.prisma.mockExamImport.findUnique({
      where: { createdById_packageId_revision: { createdById: actor.id, packageId, revision } },
    });
    if (existing) return this.replayOrConflict(existing, report.checksum, revision, targetExamId);

    // Staged binding ownership/expiry/kind — tranzaksiyadan oldin tekshiriladi.
    const stagedByKey = await this.resolveBindings(actor, p, mediaBindings);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const target = targetExamId
          ? await (tx as any).mockExam.findUnique({
              where: { id: targetExamId },
              include: {
                sections: {
                  include: {
                    groups: {
                      include: { questions: true },
                    },
                  },
                },
                _count: { select: { attempts: true } },
              },
            })
          : null;
        if (targetExamId && !target) {
          throw new AppException('MOCK_EXAM_NOT_FOUND', 'Tanlangan imtihon topilmadi', 404);
        }
        if (target) {
          const isAdmin = actor.role === 'admin' || actor.role === 'super_admin';
          if (!isAdmin && target.createdById !== actor.id) {
            throw new AppException('MOCK_NOT_OWNER', 'Bu imtihonni tahrirlash huquqi yo‘q', 403);
          }
          if (target.isPublished || (target._count?.attempts ?? 0) > 0) {
            throw new AppException(
              'MOCK_CONTENT_LOCKED',
              'Nashr qilingan yoki o‘quvchilar ishlatgan imtihonga import qilib bo‘lmaydi. Avval nusxa oling',
              409,
            );
          }
          if (target.type !== p.exam.type) {
            throw new AppException(
              'MOCK_IMPORT_TYPE_MISMATCH',
              `Paket turi ${p.exam.type}, tanlangan imtihon turi esa ${target.type}`,
              409,
            );
          }
          // Lock the exam row before appending content so publication cannot race
          // the draft check, and every open editor observes a new content version.
          const locked = await tx.mockExam.updateMany({
            where: { id: target.id, isPublished: false, attempts: { none: {} }, contentVersion: target.contentVersion },
            data: { contentVersion: { increment: 1 } },
          });
          if (locked.count !== 1) throw new AppException('MOCK_CONTENT_CONFLICT', 'Exam changed. Reload before appending the import', 409);
        }
        const exam = target ?? await (tx as any).mockExam.create({
          data: {
            type: p.exam.type,
            ...(p.exam.type === 'multilevel' ? { specificationVersion: MULTILEVEL_VERSION } : {}),
            title: (p.exam.title as string).slice(0, 200),
            description: p.exam.description ?? null,
            level: p.exam.level ?? null,
            practiceLevel: p.exam.practiceLevel ?? null,
            isDemo: p.exam.isDemo ?? false,
            isPublished: false, // JSON hech qachon avtomatik publish qilmaydi
            price: p.exam.price ?? 0,
            isFreeForApproved: p.exam.isFreeForApproved ?? false,
            createdById: actor.id, // ownership sessiyadan
            profile: p.profile ?? 'practice',
            contentVersion: 1,
          },
        });
        const sourceMaps: Array<{ kind: string; sourceKey: string; entityId: string }> = [];
        const sections: any[] = p.exam.sections;
        let sectionOrder = 0;
        for (const s of sections) {
          const existingSection = target?.sections?.find((item: any) => item.skill === s.skill) ?? null;
          if (existingSection) {
            const existingNumbers = new Set<number>(
              existingSection.groups.flatMap((group: any) =>
                group.questions.map((question: any) => question.number as number),
              ),
            );
            const incomingNumbers = (s.groups as any[]).flatMap((group: any) =>
              (group.questions as any[]).map((question: any) => question.number as number),
            );
            const numberCollision = incomingNumbers.find((number: number) => existingNumbers.has(number));
            if (numberCollision !== undefined) {
              throw new AppException(
                'MOCK_IMPORT_NUMBER_COLLISION',
                `${s.skill} bo‘limida ${numberCollision}-savol allaqachon mavjud`,
                409,
              );
            }
            if (s.skill === 'listening') {
              const existingParts = new Set<number>(
                existingSection.groups
                  .map((group: any) => group.partNumber)
                  .filter((part: unknown): part is number => typeof part === 'number'),
              );
              const incomingParts = (s.groups as any[])
                .map((group: any) => group.partNumber)
                .filter((part: unknown): part is number => typeof part === 'number');
              const partCollision = incomingParts.find((part: number) => existingParts.has(part));
              if (partCollision !== undefined) {
                throw new AppException(
                  'MOCK_IMPORT_PART_COLLISION',
                  `Listening Part ${partCollision} tanlangan imtihonda allaqachon mavjud`,
                  409,
                );
              }
            }
          }
          const section = existingSection ?? await (tx as any).mockSection.create({
            data: {
              examId: exam.id,
              skill: s.skill,
              title: s.title ?? null,
              sortOrder: SKILL_ORDER.indexOf(s.skill) >= 0 ? SKILL_ORDER.indexOf(s.skill) : sectionOrder,
              durationMinutes: s.durationMinutes ?? null,
              instructions: s.instructions ?? null,
            },
          });
          sourceMaps.push({ kind: 'section', sourceKey: s.key, entityId: section.id });
          sectionOrder++;
          let groupOrder = existingSection?.groups?.length
            ? Math.max(...existingSection.groups.map((group: any) => group.sortOrder ?? 0)) + 1
            : 0;
          for (const g of s.groups as any[]) {
            const audioStaged = typeof g.audioRef === 'string' ? stagedByKey.get(g.audioRef) : null;
            const imageStaged = typeof g.imageRef === 'string' ? stagedByKey.get(g.imageRef) : null;
            const group = await (tx as any).mockQuestionGroup.create({
              data: {
                sectionId: section.id,
                sortOrder: groupOrder++,
                title: g.title ?? null,
                instructions: g.instructions ?? null,
                passageText: g.passageText || null,
                contentHtml: sanitizeMockContent(g.contentHtml),
                audioScript: sanitizeMockContent(g.audioScript),
                contentLayout: g.contentLayout ?? null,
                optionsReusable: g.optionsReusable ?? null,
                partNumber: s.skill === 'listening' ? (g.partNumber ?? null) : null,
                audioPlayLimit: g.audioPlayLimit ?? 1,
                audioDurationSec: null, // server o'lchovi keyin; staged metadata da duration yo'q
                ...(audioStaged ? { audioKey: (audioStaged as any).storageKey } : {}),
                ...(imageStaged ? { imageKey: (imageStaged as any).storageKey } : {}),
              },
            });
            sourceMaps.push({ kind: 'group', sourceKey: g.key, entityId: group.id });
            let qOrder = 0;
            for (const q of g.questions as any[]) {
              const created = await (tx as any).mockQuestion.create({
                data: {
                  groupId: group.id,
                  number: q.number,
                  sortOrder: qOrder++,
                  type: q.type,
                  prompt: (q.prompt as string).trim(),
                  options: (q.options ?? []) as Prisma.InputJsonValue,
                  correctAnswers: (q.type === 'true_false_notgiven' || q.type === 'yes_no_notgiven' ? (q.correctAnswers ?? []).map(canonicalDecision) : q.correctAnswers ?? []) as Prisma.InputJsonValue,
                  acceptedVariants: (q.acceptedVariants ?? []) as Prisma.InputJsonValue,
                  points: q.points ?? 1,
                  wordLimit: q.wordLimit ?? null,
                  answerRule: q.answerRule ?? null,
                },
              });
              sourceMaps.push({ kind: 'question', sourceKey: q.key, entityId: created.id });
            }
          }
        }
        const importRow = await (tx as any).mockExamImport.create({
          data: {
            createdById: actor.id,
            packageId,
            revision,
            schemaVersion: '1.0',
            profile: p.profile ?? 'practice',
            rawChecksum: report.checksum,
            normalizedChecksum: report.checksum,
            validatedChecksum,
            examId: exam.id,
          },
        });
        if (sourceMaps.length) {
          await (tx as any).mockImportSourceMap.createMany({
            data: sourceMaps.map((m) => ({ ...m, importId: importRow.id })),
          });
        }
        const reviewIssues: any[] = Array.isArray(p.reviewIssues) ? p.reviewIssues : [];
        if (reviewIssues.length) {
          await (tx as any).mockImportReviewIssue.createMany({
            data: reviewIssues.map((r: any) => {
              const src = resolveIssueSource(p, r.path);
              return {
                importId: importRow.id,
                sourceKey: src?.key ?? null,
                entityKind: src?.kind ?? null,
                code: r.code,
                path: r.path,
                message: r.message,
                status: 'open',
              };
            }),
          });
        }
        if (stagedByKey.size) {
          const ids = [...stagedByKey.values()].map((s: any) => s.id);
          await (tx as any).mockStagedMedia.updateMany({
            where: { id: { in: ids } },
            data: { claimedAt: new Date(), claimedImportId: importRow.id },
          });
        }
        return { examId: exam.id, importId: importRow.id, addedToExisting: !!target };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
      await this.audit.log({
        userId: actor.id,
        action: result.addedToExisting ? 'mock.exam.import.append' : 'mock.exam.import',
        entity: 'mockExam',
        entityId: result.examId,
        newValue: { packageId, revision, checksum: report.checksum, targetExamId: targetExamId ?? null },
      });
      return {
        examId: result.examId,
        importId: result.importId,
        revision,
        replay: false,
        addedToExisting: result.addedToExisting,
        editorUrl: `/exam-builder/${result.examId}`,
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new AppException('MOCK_CONTENT_CONFLICT', 'Another editor changed this exam. Reload before importing', 409);
      }
      // Concurrent retry: unique buzilishi → replay yoki 409 (preflight poygasi).
      if (typeof e === 'object' && e !== null && (e as any).code === 'P2002') {
        const raced = await this.prisma.mockExamImport.findUnique({
          where: { createdById_packageId_revision: { createdById: actor.id, packageId, revision } },
        });
        if (raced) return this.replayOrConflict(raced, report.checksum, revision, targetExamId);
      }
      throw e;
    }
  }

  /** Yo'qolgan javobdan keyin holatni tiklash — egasi yoki admin ko'radi. */
  async getByPackage(actor: AuthUser, packageId: string, revision: number) {
    assertStaff(actor);
    const row = await this.prisma.mockExamImport.findUnique({
      where: { createdById_packageId_revision: { createdById: actor.id, packageId, revision } },
    });
    if (!row) {
      // Admin boshqa teacher importini ko'ra oladi (explicit authorized lookup).
      if (actor.role === 'admin' || actor.role === 'super_admin') {
        const anyRow = await this.prisma.mockExamImport.findFirst({ where: { packageId, revision } });
        if (!anyRow) throw new AppException('MOCK_IMPORT_NOT_FOUND', 'Import topilmadi', 404);
        return this.shapeStatus(anyRow, true);
      }
      throw new AppException('MOCK_IMPORT_NOT_FOUND', 'Import topilmadi', 404);
    }
    return this.shapeStatus(row, true);
  }

  private shapeStatus(row: { id: string; examId: string; revision: number }, replay: boolean) {
    return {
      importId: row.id,
      examId: row.examId,
      revision: row.revision,
      replay,
      addedToExisting: false,
      editorUrl: `/exam-builder/${row.examId}`,
    };
  }

  /**
   * Exam Builder uchun import provenance: paket kimligi, vaqti, ochiq
   * issue lar va source-key → DB ID xaritasi (issue navigatsiyasi uchun).
   * Faqat imtihon egasi (yoki admin) ko'radi; javob kalitlari Marvel emas —
   * issue xabarlari staff-only.
   */
  async getByExam(actor: AuthUser, examId: string) {
    assertStaff(actor);
    const exam = await this.prisma.mockExam.findUnique({ where: { id: examId } });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    const owner = (exam as { createdById?: string | null }).createdById;
    const isAdmin = actor.role === 'admin' || actor.role === 'super_admin';
    if (!isAdmin && owner !== actor.id) {
      throw new AppException('MOCK_IMPORT_NOT_FOUND', 'Import topilmadi', 404);
    }
    const imports = await this.prisma.mockExamImport.findMany({
      where: { examId },
      orderBy: { revision: 'desc' },
    });
    if (!imports.length) throw new AppException('MOCK_IMPORT_NOT_FOUND', 'Import topilmadi', 404);
    const latest = imports[0] as any;
    const [issues, maps] = await Promise.all([
      this.prisma.mockImportReviewIssue.findMany({
        where: { importId: latest.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.mockImportSourceMap.findMany({ where: { importId: latest.id } }),
    ]);
    return {
      packageId: latest.packageId as string,
      revision: latest.revision as number,
      profile: latest.profile as string,
      importedAt: latest.createdAt,
      openIssues: (issues as any[]).filter((i) => i.status !== 'resolved').length,
      issues: (issues as any[]).map((i) => ({
        id: i.id, code: i.code, path: i.path, message: i.message,
        sourceKey: i.sourceKey ?? null, entityKind: i.entityKind ?? null, status: i.status,
      })),
      sourceMaps: (maps as any[]).map((m) => ({ kind: m.kind, sourceKey: m.sourceKey, entityId: m.entityId })),
    };
  }

  /** Ochiq issue ni yopish — egasi yoki admin, audit bilan (publish gate ochiladi). */
  async resolveIssue(actor: AuthUser, issueId: string) {
    assertStaff(actor);
    const issue = await this.prisma.mockImportReviewIssue.findUnique({ where: { id: issueId } });
    if (!issue) throw new AppException('MOCK_IMPORT_NOT_FOUND', 'Issue topilmadi', 404);
    const importRow = await this.prisma.mockExamImport.findUnique({ where: { id: (issue as any).importId } });
    if (!importRow) throw new AppException('MOCK_IMPORT_NOT_FOUND', 'Import topilmadi', 404);
    const exam = await this.prisma.mockExam.findUnique({ where: { id: (importRow as any).examId } });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    const isAdmin = actor.role === 'admin' || actor.role === 'super_admin';
    if (!isAdmin && (exam as { createdById?: string | null }).createdById !== actor.id) {
      throw new AppException('MOCK_FORBIDDEN', 'Bu amal faqat imtihon egasi uchun', 403);
    }
    const updated = await this.prisma.mockImportReviewIssue.update({
      where: { id: issueId },
      data: { status: 'resolved', resolvedById: actor.id, resolvedAt: new Date() },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'mock.exam.import.issue.resolve',
      entity: 'mockImportReviewIssue',
      entityId: issueId,
      newValue: { code: (issue as any).code, path: (issue as any).path },
    });
    return updated;
  }

  private replayOrConflict(
    existing: { id: string; examId: string; revision: number; normalizedChecksum: string },
    checksum: string,
    revision: number,
    targetExamId?: string,
  ): CommitResult {
    if (existing.normalizedChecksum !== checksum) {
      throw new AppException(
        'MOCK_IMPORT_CONFLICT',
        'Same revision with changed content — increment revision for a new draft',
        409,
      );
    }
    // Identical replay: teacher tahririga tegilmaydi, asl imtihon qaytariladi.
    return {
      examId: existing.examId,
      importId: existing.id,
      revision,
      replay: true,
      addedToExisting: !!targetExamId && existing.examId === targetExamId,
      editorUrl: `/exam-builder/${existing.examId}`,
    };
  }

  /** Binding → staged row; egalik, muddat va kind tekshiruvi. */
  private async resolveBindings(actor: AuthUser, p: Pkg, mediaBindings: Record<string, string>) {
    const declKind = new Map<string, string>();
    for (const m of (p.media as any[]) ?? []) declKind.set(m.key, m.kind);
    for (const key of Object.keys(mediaBindings)) {
      if (!declKind.has(key)) {
        throw new AppException('MOCK_IMPORT_BINDING', `Unknown media key "${key}"`, 422);
      }
    }
    const out = new Map<string, any>();
    const ids = [...new Set(Object.values(mediaBindings))];
    if (!ids.length) return out;
    const rows = await this.prisma.mockStagedMedia.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r: any) => [r.id, r]));
    for (const [sourceKey, uploadId] of Object.entries(mediaBindings)) {
      const row: any = byId.get(uploadId);
      if (!row) throw new AppException('MOCK_IMPORT_MEDIA', `Staged upload not found for "${sourceKey}"`, 422);
      if (row.ownerId !== actor.id) {
        throw new AppException('MOCK_IMPORT_MEDIA', `Staged upload for "${sourceKey}" belongs to another user`, 403);
      }
      if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
        throw new AppException('MOCK_IMPORT_MEDIA', `Staged upload for "${sourceKey}" has expired`, 410);
      }
      if (row.kind !== declKind.get(sourceKey)) {
        throw new AppException('MOCK_IMPORT_MEDIA', `Media kind mismatch for "${sourceKey}"`, 422);
      }
      out.set(sourceKey, row);
    }
    return out;
  }
}
