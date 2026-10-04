import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';
import {
  DesktopAuthorizeDto,
  DesktopExchangeDto,
  LinkChildDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  UpdateMeDto,
} from './dto/auth.dto';

const LINK_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DUMMY_PASSWORD_HASH = '$2a$10$S0DkiNylcFUhAIuwhOeOz.jS/i48bFSlu6E0mrcE/jVrZ9Ph9i6Zy';
/** Desktop kirish kodining yashash muddati (daqiqa) */
const DESKTOP_CODE_TTL_MIN = 5;
/** Desktop deep-link manzili — faqat shu manzil(lar)ga yo'naltiriladi */
const DEFAULT_DESKTOP_CALLBACK = 'bestway-exam://auth/callback';

function allowedDesktopRedirects(config: ConfigService): string[] {
  const raw = config.get<string>('DESKTOP_REDIRECT_URIS') ?? '';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [DEFAULT_DESKTOP_CALLBACK];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // Kontraktdagi user obyekti: { id, name, phone, role, createdAt }
  private toPublicUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  /** O'qiladigan, takrorlanmas 8 belgili bog'lash kodi */
  static generateLinkCode(): string {
    let out = '';
    for (let i = 0; i < 8; i++) out += LINK_CHARS[randomInt(LINK_CHARS.length)];
    return out;
  }

  private async uniqueLinkCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = AuthService.generateLinkCode();
      const exists = await tx.studentProfile.findUnique({ where: { linkCode: code } });
      if (!exists) return code;
    }
    throw new AppException('LINK_CODE_GENERATION_FAILED', 'Kod yaratib bo\'lmadi, qayta urinib ko\'ring', 500);
  }

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (exists) {
      throw new AppException('PHONE_TAKEN', "Bu telefon raqam allaqachon ro'yxatdan o'tgan", 409);
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const initialPoints = await this.settings.getNumber(SETTING_KEYS.initialPoints);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: dto.name, phone: dto.phone, passwordHash, role: dto.role },
      });
      if (dto.role === 'student') {
        // Biznes-qoida: har bir yangi o'quvchiga avtomatik boshlang'ich ball
        await tx.studentProfile.create({
          data: {
            userId: created.id,
            currentPoints: initialPoints,
            linkCode: await this.uniqueLinkCode(tx),
          },
        });
        await tx.pointsLog.create({
          data: { studentId: created.id, change: initialPoints, reason: "Boshlang'ich ball" },
        });
      }
      return created;
    });

    if (dto.role === 'student') {
      this.notifications
        .notify(
          user.id,
          'points',
          `Xush kelibsiz! Sizga boshlang'ich ${initialPoints} ball berildi.`,
        )
        .catch(() => undefined);
    }

    const tokens = await this.issueTokens(user);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone.trim() } });
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      throw new AppException('INVALID_CREDENTIALS', "Telefon raqam yoki parol noto'g'ri", 401);
    }
    if (!user.isActive) {
      await bcrypt.compare(dto.password, user.passwordHash);
      throw new AppException('USER_DEACTIVATED', 'Akkaunt bloklangan. Administratsiyaga murojaat qiling', 403);
    }
    if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new AppException('INVALID_CREDENTIALS', "Telefon raqam yoki parol noto'g'ri", 401);
    }
    const tokens = await this.issueTokens(user);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async refresh(dto: RefreshDto) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await tx.refreshToken.findUnique({
        where: { tokenHash: this.hashToken(dto.refreshToken) },
        include: { user: true },
      });
      if (!row || row.expiresAt < new Date() || !row.user.isActive) return { kind: 'invalid' as const };
      if (row.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { userId: row.userId, familyId: row.familyId },
          data: { revokedAt: new Date() },
        });
        return { kind: 'reuse' as const };
      }
      const accessToken = await this.jwt.signAsync({ sub: row.userId, role: row.user.role });
      const refreshToken = randomBytes(48).toString('base64url');
      const rawDays = parseInt(this.config.get<string>('JWT_REFRESH_TTL_DAYS') ?? '30', 10);
      const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
      const now = new Date();
      await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: now } });
      await tx.refreshToken.create({
        data: {
          userId: row.userId,
          tokenHash: this.hashToken(refreshToken),
          familyId: row.familyId || randomUUID(),
          expiresAt: new Date(now.getTime() + days * 86_400_000),
        },
      });
      return { kind: 'ok' as const, accessToken, refreshToken };
    });
    if (outcome.kind === 'invalid') {
      throw new AppException('INVALID_REFRESH_TOKEN', 'Sessiya muddati tugagan — qaytadan kiring', 401);
    }
    if (outcome.kind === 'reuse') {
      throw new AppException('SESSION_EXPIRED', 'Sessiya xavfsizlik sababli bekor qilindi — qaytadan kiring', 401);
    }
    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId, tokenHash: this.hashToken(refreshToken) },
      });
    } else {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }
    return { loggedOut: true };
  }

  /**
   * Desktop (Tauri) uchun bir martalik kirish kodi yaratish.
   * Web sahifa chaqiradi (o'quvchi sessiyasi bilan) — kod deep-link orqali
   * desktopga uzatiladi va `/auth/desktop/exchange` da sessiyaga almashadi.
   */
  async authorizeDesktop(user: AuthUser, dto: DesktopAuthorizeDto) {
    if (!allowedDesktopRedirects(this.config).includes(dto.redirect)) {
      throw new AppException('INVALID_REDIRECT', 'Ruxsat etilmagan qaytish manzili', 400);
    }
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser || !dbUser.isActive) {
      throw new AppException('USER_DEACTIVATED', 'Akkaunt bloklangan. Administratsiyaga murojaat qiling', 403);
    }
    if (dbUser.role !== 'student') {
      throw new AppException('NOT_A_STUDENT', 'Desktop ilova faqat o\u2018quvchilar uchun', 403);
    }
    const code = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.desktopAuthCode.create({
      data: {
        userId: dbUser.id,
        codeHash: this.hashToken(code),
        codeChallenge: dto.codeChallenge,
        deviceId: dto.deviceId,
        state: dto.state,
        expiresAt: new Date(now.getTime() + DESKTOP_CODE_TTL_MIN * 60_000),
      },
    });
    // Muddati o'tgan kodlarni tozalash
    await this.prisma.desktopAuthCode.deleteMany({
      where: { userId: dbUser.id, expiresAt: { lt: now } },
    });
    return {
      code,
      state: dto.state,
      expiresAt: new Date(now.getTime() + DESKTOP_CODE_TTL_MIN * 60_000).toISOString(),
    };
  }

  /**
   * Desktop kirish kodini sessiya tokenlariga almashtirish (PKCE-S256).
   * Kod bir martalik: muvaffaqiyatli (va muvaffaqiyatsiz urinishdan keyin ham
   * qayta ishlatib bo'lmaydi — topilsa darhol `usedAt` qo'yiladi).
   */
  async exchangeDesktopCode(dto: DesktopExchangeDto) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await tx.desktopAuthCode.findUnique({
        where: { codeHash: this.hashToken(dto.code) },
        include: { user: true },
      });
      if (!row) return { kind: 'invalid' as const };
      if (row.usedAt) return { kind: 'used' as const };
      if (row.expiresAt < new Date()) return { kind: 'expired' as const };
      // Qayta ishlatishga urinish — kodni kuydiramiz
      await tx.desktopAuthCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      if (row.deviceId !== dto.deviceId) return { kind: 'device' as const };
      if (!this.verifyChallenge(dto.verifier, row.codeChallenge)) {
        return { kind: 'verifier' as const };
      }
      if (!row.user.isActive) return { kind: 'deactivated' as const };
      if (row.user.role !== 'student') return { kind: 'role' as const };
      return { kind: 'ok' as const, user: row.user };
    });
    switch (outcome.kind) {
      case 'invalid':
        throw new AppException('INVALID_DESKTOP_CODE', 'Desktop kodi noto\u2018g\u2018ri', 401);
      case 'used':
        throw new AppException('DESKTOP_CODE_USED', 'Desktop kodi allaqachon ishlatilgan', 401);
      case 'expired':
        throw new AppException('DESKTOP_CODE_EXPIRED', 'Desktop kodi muddati o\u2018tgan — qaytadan urinib ko\u2018ring', 401);
      case 'device':
        throw new AppException('DEVICE_MISMATCH', 'Kod boshqa qurilma uchun yaratilgan', 400);
      case 'verifier':
        throw new AppException('INVALID_VERIFIER', 'Xavfsizlik tekshiruvi o\u2018tmadi', 401);
      case 'deactivated':
        throw new AppException('USER_DEACTIVATED', 'Akkaunt bloklangan. Administratsiyaga murojaat qiling', 403);
      case 'role':
        throw new AppException('NOT_A_STUDENT', 'Desktop ilova faqat o\u2018quvchilar uchun', 403);
    }
    const tokens = await this.issueTokens(outcome.user);
    return { user: this.toPublicUser(outcome.user), ...tokens };
  }

  /** PKCE-S256: BASE64URL(SHA256(verifier)) === codeChallenge (constant-time) */
  private verifyChallenge(verifier: string, challenge: string): boolean {
    const digest = createHash('sha256').update(verifier, 'utf8').digest();
    let expected: Buffer;
    try {
      expected = Buffer.from(challenge, 'base64url');
    } catch {
      return false;
    }
    if (expected.length !== digest.length) return false;
    return timingSafeEqual(digest, expected);
  }

  /** Ota-ona farzandini "bog'lash kodi" orqali ulaydi */
  async linkChild(parent: AuthUser, dto: LinkChildDto) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { linkCode: dto.linkCode.trim().toUpperCase() },
      include: { user: true, group: true },
    });
    if (!profile) {
      throw new AppException('INVALID_LINK_CODE', "Bog'lash kodi noto'g'ri", 404);
    }
    await this.prisma.parentStudent.upsert({
      where: {
        parentUserId_studentId: { parentUserId: parent.id, studentId: profile.userId },
      },
      update: {},
      create: { parentUserId: parent.id, studentId: profile.userId },
    });
    return {
      child: {
        studentId: profile.userId,
        name: profile.user.name,
        phone: profile.user.phone,
        groupId: profile.groupId,
        groupName: profile.group?.name ?? null,
        isApproved: profile.isApproved,
        currentPoints: profile.currentPoints,
      },
    };
  }

  /** Joriy foydalanuvchi profili — frontend sahifa yangilanganda ishlatadi */
  async me(auth: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw new AppException('USER_NOT_FOUND', 'Foydalanuvchi topilmadi', 404);

    const unreadNotifications = await this.prisma.notification.count({
      where: { userId: user.id, read: false },
    });

    let profile: unknown = null;
    if (user.role === 'student') {
      const p = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        include: { group: { select: { id: true, name: true } } },
      });
      if (p) {
        profile = {
          isApproved: p.isApproved,
          groupId: p.groupId,
          groupName: p.group?.name ?? null,
          currentPoints: p.currentPoints,
          linkCode: p.linkCode,
          availablePrograms: p.availablePrograms,
          activeProgram: p.activeProgram,
        };
      }
    } else if (user.role === 'parent') {
      const links = await this.prisma.parentStudent.findMany({
        where: { parentUserId: user.id },
        include: {
          student: { include: { user: true, group: { select: { id: true, name: true } } } },
        },
      });
      profile = {
        children: links.map((l) => ({
          studentId: l.studentId,
          name: l.student.user.name,
          groupId: l.student.groupId,
          groupName: l.student.group?.name ?? null,
          isApproved: l.student.isApproved,
          currentPoints: l.student.currentPoints,
        })),
      };
    } else if (user.role === 'teacher') {
      const groups = await this.prisma.group.findMany({
        where: { teacherId: user.id },
        include: { _count: { select: { students: true } } },
      });
      profile = {
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          studentsCount: g._count.students,
        })),
      };
    }

    return {
      user: this.toPublicUser(user),
      profile,
      unreadNotifications,
      telegramLinked: Boolean(user.telegramChatId),
    };
  }

  /** O'z ismini tahrirlash — barcha rollar uchun (profil sahifasi) */
  async updateMe(auth: AuthUser, dto: UpdateMeDto) {
    const name = dto.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 100) {
      throw new AppException('VALIDATION_ERROR', 'Ism 2 dan 100 belgigacha bo‘lishi kerak', 400);
    }
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw new AppException('USER_NOT_FOUND', 'Foydalanuvchi topilmadi', 404);
    if (!user.isActive) throw new AppException('FORBIDDEN', 'Faol bo‘lmagan akkaunt', 403);
    if (user.name !== name) {
      await this.prisma.user.update({ where: { id: user.id }, data: { name } });
      await this.audit.log({
        userId: user.id,
        action: 'user.updateMe',
        entity: 'user',
        entityId: user.id,
        oldValue: { name: user.name },
        newValue: { name },
      });
    }
    return this.me(auth);
  }

  private async issueTokens(user: User) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    const refreshToken = randomBytes(48).toString('base64url');
    const rawDays = parseInt(this.config.get<string>('JWT_REFRESH_TTL_DAYS') ?? '30', 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    // Muddati o'tgan sessiyalarni tozalash
    await this.prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });
    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
