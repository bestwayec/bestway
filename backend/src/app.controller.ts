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
      version: process.env.DESKTOP_LATEST_VERSION?.trim() || '0.5.1-rc.1',
      downloadUrl: process.env.DESKTOP_DOWNLOAD_URL?.trim()
        || 'https://github.com/bestwayec/bw-tauri/releases/download/v0.5.1-rc.1/Bestway.App_0.5.1-rc.1_x64-setup.exe',
      // This is a manual installer release. Tauri updater signing metadata is
      // intentionally not advertised because the RC has no updater signature.
      prerelease: process.env.DESKTOP_PRERELEASE?.trim() !== 'false',
      updateChannel: 'manual_installer',
    };
  }
}
