import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { ArticlesModule } from './articles/articles.module';
import { AssessmentModule } from './assessment/assessment.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AccessModule } from './common/access.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { RolesGuard } from './common/roles.guard';
import { TransformInterceptor } from './common/transform.interceptor';
import { GameModule } from './game/game.module';
import { GroupsModule } from './groups/groups.module';
import { MockModule } from './mock/mock.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PointsModule } from './points/points.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { StatsModule } from './stats/stats.module';
import { GalleryModule } from './gallery/gallery.module';
import { TeachersModule } from './teachers/teachers.module';
import { TelegramModule } from './telegram/telegram.module';
import { TestsModule } from './tests/tests.module';
import { UsersModule } from './users/users.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Oylik ball reset uchun cron rejalashtiruvchi
    ScheduleModule.forRoot(),
    // Umumiy rate-limit: bitta IP dan daqiqasiga 300 so'rov
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AccessModule,
    AuditModule,
    SettingsModule,
    TelegramModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    AttendanceModule,
    PaymentsModule,
    PointsModule,
    GameModule,
    TestsModule,
    MockModule,
    AssessmentModule,
    VideosModule,
    ArticlesModule,
    TeachersModule,
    GalleryModule,
    StatsModule,
  ],
  controllers: [AppController],
  providers: [
    // Guardlar ro'yxat tartibida ishlaydi: throttle → auth → rol
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
