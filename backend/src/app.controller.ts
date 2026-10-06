import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators';

@ApiTags('health')
@Controller()
export class AppController {
  /** Server holati (monitoring uchun) */
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      buildCommit: process.env.BUILD_COMMIT?.trim() || null,
    };
  }

  /**
   * Desktop ilova ishga tushganda yangilanish bor-yo'qligini tekshiradi.
   * Ochiq endpoint (auth shart emas). Qiymatlar ENV dan olinadi;
   * `DESKTOP_LATEST_VERSION` hozirgi relizga teng bo'lsa — bildirishnoma chiqmaydi.
   */
  @Public()
  @Get('desktop-version')
  desktopVersion() {
    return {
      version: process.env.DESKTOP_LATEST_VERSION?.trim() || '0.1.9',
      downloadUrl: process.env.DESKTOP_DOWNLOAD_URL?.trim() || null,
    };
  }
}
