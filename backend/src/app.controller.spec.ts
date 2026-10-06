import { afterEach, describe, expect, it } from 'vitest';
import { AppController } from './app.controller';

const previousBuildCommit = process.env.BUILD_COMMIT;
const previousDesktopVersion = process.env.DESKTOP_LATEST_VERSION;
const previousDesktopUrl = process.env.DESKTOP_DOWNLOAD_URL;
const previousDesktopPrerelease = process.env.DESKTOP_PRERELEASE;

afterEach(() => {
  if (previousBuildCommit === undefined) delete process.env.BUILD_COMMIT;
  else process.env.BUILD_COMMIT = previousBuildCommit;
  if (previousDesktopVersion === undefined) delete process.env.DESKTOP_LATEST_VERSION;
  else process.env.DESKTOP_LATEST_VERSION = previousDesktopVersion;
  if (previousDesktopUrl === undefined) delete process.env.DESKTOP_DOWNLOAD_URL;
  else process.env.DESKTOP_DOWNLOAD_URL = previousDesktopUrl;
  if (previousDesktopPrerelease === undefined) delete process.env.DESKTOP_PRERELEASE;
  else process.env.DESKTOP_PRERELEASE = previousDesktopPrerelease;
});

describe('health endpoint', () => {
  it('exposes the deployed build commit without exposing configuration secrets', () => {
    process.env.BUILD_COMMIT = '1dcd46e8be08a1d612fb76babb3c12fcb65dd1a0';
    expect(new AppController().health()).toMatchObject({
      status: 'ok',
      buildCommit: '1dcd46e8be08a1d612fb76babb3c12fcb65dd1a0',
    });
  });

  it('advertises the current RC as a manual installer, not an unsigned updater package', () => {
    delete process.env.DESKTOP_LATEST_VERSION;
    delete process.env.DESKTOP_DOWNLOAD_URL;
    delete process.env.DESKTOP_PRERELEASE;
    expect(new AppController().desktopVersion()).toEqual({
      version: '0.5.1-rc.1',
      downloadUrl: 'https://github.com/bestwayec/bw-tauri/releases/download/v0.5.1-rc.1/Bestway.App_0.5.1-rc.1_x64-setup.exe',
      prerelease: true,
      updateChannel: 'manual_installer',
    });
  });
});

describe('desktop-version endpoint', () => {
  it('returns the configured release so production never needs a code change', () => {
    process.env.DESKTOP_LATEST_VERSION = '9.9.9';
    process.env.DESKTOP_DOWNLOAD_URL = 'https://example.invalid/Bestway.App_9.9.9_x64-setup.exe';
    process.env.DESKTOP_PRERELEASE = 'false';
    expect(new AppController().desktopVersion()).toEqual({
      version: '9.9.9',
      downloadUrl: 'https://example.invalid/Bestway.App_9.9.9_x64-setup.exe',
      prerelease: false,
      updateChannel: 'manual_installer',
    });
  });

  it('never advertises a Tauri updater signature for the manual-installer RC', () => {
    const release = new AppController().desktopVersion() as Record<string, unknown>;
    expect(release).not.toHaveProperty('signature');
    expect(release).not.toHaveProperty('pubkey');
    expect(release).not.toHaveProperty('updaterUrl');
    expect(release.updateChannel).toBe('manual_installer');
  });
});
