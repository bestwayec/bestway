import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { Paginated } from '../common/pagination';
import { AuthUser } from '../common/types';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExamProgramService } from '../common/exam-program.service';
import { ListPurchasesQueryDto } from './dto/mock.dto';
import { studentExamTitle } from './student-exam-title';

export type MockAccess = 'granted' | 'pending' | 'locked';

interface ExamAccessInfo {
  id: string;
  type?: string;
  isDemo: boolean;
  isPublished: boolean;
  price: number;
  isFreeForApproved: boolean;
}

function isStaff(user?: AuthUser): boolean {
  return (
    !!user &&
    (user.role === 'admin' || user.role === 'super_admin' || user.role === 'teacher')
  );
}

/** Mock imtihonga kirish huquqi + pullik xarid (video modeli kabi qo'lda tasdiq) */
@Injectable()
export class MockAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly programs: ExamProgramService,
  ) {}

  /** Bitta imtihon uchun kirish holati */
  async accessFor(user: AuthUser | undefined, exam: ExamAccessInfo): Promise<MockAccess> {
    if (isStaff(user)) return 'granted';
    if (user?.role === 'student' && !await this.programs.canAccess(user.id, exam.type ?? 'ielts')) return 'locked';
    if (exam.type === 'multilevel' && user?.role !== 'student') return 'locked';
    if (exam.isDemo || exam.price === 0) return 'granted';
    if (!user || user.role !== 'student') return 'locked';
    if (user.studentProfile?.isApproved && exam.isFreeForApproved) return 'granted';
    const p = await this.prisma.mockPurchase.findUnique({
      where: { userId_examId: { userId: user.id, examId: exam.id } },
    });
    if (p?.status === 'purchased') return 'granted';
    if (p?.status === 'pending_confirmation') return 'pending';
    return 'locked';
  }

  /** Ro'yxat uchun bir necha imtihon kirish holatini bir so'rovda hisoblaydi */
  async annotateAccess(
    user: AuthUser | undefined,
    exams: ExamAccessInfo[],
  ): Promise<Map<string, MockAccess>> {
    const map = new Map<string, MockAccess>();
    if (isStaff(user)) {
      for (const e of exams) map.set(e.id, 'granted');
      return map;
    }
    const approved = user?.role === 'student' && !!user.studentProfile?.isApproved;
    const enrolled = user?.role === 'student' ? (await this.programs.state(user.id)).availablePrograms : null;
    let statusByExam = new Map<string, string>();
    if (user?.role === 'student' && exams.length) {
      const purchases = await this.prisma.mockPurchase.findMany({
        where: { userId: user.id, examId: { in: exams.map((e) => e.id) } },
        select: { examId: true, status: true },
      });
      statusByExam = new Map(purchases.map((p) => [p.examId, p.status]));
    }
    for (const e of exams) {
      let acc: MockAccess;
      if (enrolled && !enrolled.includes(e.type === 'multilevel' ? 'MULTILEVEL' : 'IELTS')) acc = 'locked';
      else if (e.type === 'multilevel' && !enrolled) acc = 'locked';
      else if (e.isDemo || e.price === 0) acc = 'granted';
      else if (!user || user.role !== 'student') acc = 'locked';
      else if (approved && e.isFreeForApproved) acc = 'granted';
      else {
        const s = statusByExam.get(e.id);
        acc = s === 'purchased' ? 'granted' : s === 'pending_confirmation' ? 'pending' : 'locked';
      }
      map.set(e.id, acc);
    }
    return map;
  }

  /** start() dan oldin: kirish huquqi bo'lmasa 402 */
  async assertCanStart(student: AuthUser, exam: ExamAccessInfo): Promise<void> {
    await this.programs.assertAccess(student.id, exam.type ?? 'ielts');
    const a = await this.accessFor(student, exam);
    if (a === 'granted') return;
    if (a === 'pending') {
      throw new AppException('MOCK_PURCHASE_PENDING', 'Xaridingiz tasdiqlanishini kuting', 402);
    }
    throw new AppException('MOCK_PAYMENT_REQUIRED', "Bu imtihon uchun to'lov talab qilinadi", 402);
  }

  /** O'quvchi sotib olish so'rovi qoldiradi (admin keyin qo'lda tasdiqlaydi) */
  async purchase(student: AuthUser, examId: string) {
    const exam = await this.prisma.mockExam.findUnique({ where: { id: examId } });
    if (!exam || (!exam.isPublished && !exam.isDemo)) {
      throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    }
    const access = await this.accessFor(student, exam);
    if (access === 'granted') {
      throw new AppException('MOCK_ALREADY_ACCESSIBLE', 'Bu imtihon sizga allaqachon ochiq', 400);
    }
    await this.prisma.mockPurchase.updateMany({
      where: { userId: student.id, examId, status: { not: 'purchased' } },
      data: { status: 'pending_confirmation', amount: exam.price },
    });
    const purchase = await this.prisma.mockPurchase.upsert({
      where: { userId_examId: { userId: student.id, examId } },
      update: {},
      create: {
        userId: student.id,
        examId,
        status: 'pending_confirmation',
        amount: exam.price,
      },
    });
    await this.audit.log({
      userId: student.id,
      action: 'mock.purchase.request',
      entity: 'mockPurchase',
      entityId: purchase.id,
      newValue: { examId, amount: exam.price },
    });
    return { status: purchase.status, amount: purchase.amount };
  }

  /** Admin: xaridlar ro'yxati (tasdiqlash paneli) */
  async listPurchases(q: ListPurchasesQueryDto) {
    const where: Prisma.MockPurchaseWhereInput = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.mockPurchase.count({ where }),
      this.prisma.mockPurchase.findMany({
        where,
        include: {
          user: { select: { name: true, phone: true } },
          exam: { select: { title: true, price: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
    ]);
    return new Paginated(
      rows.map((p) => ({
        id: p.id,
        userId: p.userId,
        userName: p.user.name,
        userPhone: p.user.phone,
        examId: p.examId,
        examTitle: p.exam.title,
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt,
      })),
      { page: q.page, limit: q.limit, total },
    );
  }

  /** Admin xarid so'rovini rad etadi (kutilayotgan yozuv o'chadi, o'quvchiga xabar boradi) */
  async rejectPurchase(admin: AuthUser, examId: string, userId: string) {
    const purchase = await this.prisma.mockPurchase.findUnique({
      where: { userId_examId: { userId, examId } },
      include: { exam: { select: { title: true } } },
    });
    if (!purchase || purchase.status !== 'pending_confirmation') {
      throw new AppException('MOCK_PURCHASE_NOT_PENDING', 'Kutilayotgan xarid topilmadi', 404);
    }
    await this.prisma.mockPurchase.delete({ where: { id: purchase.id } });
    await this.audit.log({
      userId: admin.id,
      action: 'mock.purchase.reject',
      entity: 'mockPurchase',
      entityId: purchase.id,
      newValue: { userId, examId },
    });
    await this.notifications.notify(
      userId,
      'announcement',
      `"${studentExamTitle(purchase.exam.title)}" mock imtihoni xarid so'rovingiz rad etildi. Tafsilotlar uchun admin bilan bog'laning.`,
    );
    return { rejected: true };
  }

  /** Admin xaridni qo'lda tasdiqlaydi (pul naqd/bank orqali olingan) */
  async confirmPurchase(admin: AuthUser, examId: string, userId: string) {
    const exam = await this.prisma.mockExam.findUnique({ where: { id: examId } });
    if (!exam) throw new AppException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404);
    const purchase = await this.prisma.mockPurchase.upsert({
      where: { userId_examId: { userId, examId } },
      update: { status: 'purchased', confirmedById: admin.id },
      create: {
        userId,
        examId,
        status: 'purchased',
        confirmedById: admin.id,
        amount: exam.price,
      },
    });
    await this.audit.log({
      userId: admin.id,
      action: 'mock.purchase.confirm',
      entity: 'mockPurchase',
      entityId: purchase.id,
      newValue: { userId, examId },
    });
    await this.notifications.notify(
      userId,
      'announcement',
      `"${studentExamTitle(exam.title)}" mock imtihoni siz uchun ochildi. Omad!`,
    );
    return { confirmed: true };
  }
}
