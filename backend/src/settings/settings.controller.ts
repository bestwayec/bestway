import { Body, Controller, Delete, Get, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../common/decorators';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/types';
import { parseBandTable } from '../mock/mock-scoring';
import { UpdateExamProgramPolicyDto, UpdateIeltsBandsDto, UpdateSettingsDto } from './dto/settings.dto';
import { SETTING_KEYS, SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('exam-program-policy')
  @Roles('super_admin', 'admin', 'teacher')
  async getProgramPolicy() {
    return { accessPolicy: await this.settings.getJson('examProgramAccessPolicy', 'SELF_SELECT') };
  }

  @Put('exam-program-policy')
  @Roles('super_admin')
  async updateProgramPolicy(@CurrentUser() user: AuthUser, @Body() dto: UpdateExamProgramPolicyDto) {
    const old = await this.getProgramPolicy();
    await this.settings.setJson('examProgramAccessPolicy', dto.accessPolicy);
    const fresh = await this.getProgramPolicy();
    await this.audit.log({ userId: user.id, action: 'settings.exam-program-policy.update', entity: 'setting', oldValue: old, newValue: fresh });
    return fresh;
  }

  /** Tizim sozlamalari (ball limitlari) */
  @Get()
  @Roles('super_admin', 'admin', 'teacher')
  get() {
    return this.settings.all();
  }

  /** Sozlamalarni o'zgartirish — faqat Super Admin */
  @Patch()
  @Roles('super_admin')
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    const old = await this.settings.all();
    if (dto.teacherPointLimit !== undefined) {
      await this.settings.setNumber(SETTING_KEYS.teacherPointLimit, dto.teacherPointLimit);
    }
    if (dto.initialPoints !== undefined) {
      await this.settings.setNumber(SETTING_KEYS.initialPoints, dto.initialPoints);
    }
    if (dto.monthlyFee !== undefined) {
      await this.settings.setNumber(SETTING_KEYS.monthlyFee, dto.monthlyFee);
    }
    if (dto.gameThreshold !== undefined) {
      await this.settings.setNumber(SETTING_KEYS.gameThreshold, dto.gameThreshold);
    }
    const fresh = await this.settings.all();
    await this.audit.log({
      userId: user.id,
      action: 'settings.update',
      entity: 'setting',
      oldValue: old,
      newValue: fresh,
    });
    return fresh;
  }

  /** IELTS xom→band jadvallari (amaldagi — standart yoki admin tahrirlagan) */
  @Get('ielts-bands')
  @Roles('super_admin', 'admin', 'teacher')
  async getBands() {
    const [tables, customized] = await Promise.all([
      this.settings.getBandTables(),
      this.settings.bandTablesCustomized(),
    ]);
    return { ...tables, customized };
  }

  /** Band jadvallarini yangilash — faqat Super Admin (equating uchun) */
  @Put('ielts-bands')
  @Roles('super_admin')
  async updateBands(@CurrentUser() user: AuthUser, @Body() dto: UpdateIeltsBandsDto) {
    const old = await this.settings.getBandTables();
    const apply = (input: unknown, key: string) => {
      if (input === undefined) return null;
      try {
        return { key, table: parseBandTable(input) };
      } catch (e) {
        throw new AppException('VALIDATION_ERROR', (e as Error).message, 400);
      }
    };
    for (const item of [
      apply(dto.listening, SETTING_KEYS.ieltsBandListening),
      apply(dto.readingAcademic, SETTING_KEYS.ieltsBandReadingAcademic),
      apply(dto.readingGeneral, SETTING_KEYS.ieltsBandReadingGeneral),
    ]) {
      if (item) await this.settings.setJson(item.key, item.table);
    }
    const fresh = await this.settings.getBandTables();
    await this.audit.log({
      userId: user.id,
      action: 'settings.ielts-bands.update',
      entity: 'setting',
      oldValue: old,
      newValue: fresh,
    });
    return fresh;
  }

  /** Band jadvallarini standartga qaytarish — faqat Super Admin */
  @Delete('ielts-bands')
  @Roles('super_admin')
  async resetBands(@CurrentUser() user: AuthUser) {
    const old = await this.settings.getBandTables();
    await Promise.all([
      this.settings.deleteKey(SETTING_KEYS.ieltsBandListening),
      this.settings.deleteKey(SETTING_KEYS.ieltsBandReadingAcademic),
      this.settings.deleteKey(SETTING_KEYS.ieltsBandReadingGeneral),
    ]);
    const fresh = await this.settings.getBandTables();
    await this.audit.log({
      userId: user.id,
      action: 'settings.ielts-bands.reset',
      entity: 'setting',
      oldValue: old,
      newValue: fresh,
    });
    return fresh;
  }
}
