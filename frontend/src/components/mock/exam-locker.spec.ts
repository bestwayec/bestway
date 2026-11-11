// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { FULLSCREEN_GUARD_EVENT } from '@/lib/microphone';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const node = namespace.split('.').reduce((n: any, part) => n?.[part], en as any) ?? {};
    return node[key] ?? key;
  },
}));
import { ExamLocker, type ExamLockerProps } from './exam-locker';

// createElement takes the children as arguments; the props type requires them, so view it without.
const Locker = ExamLocker as React.FC<React.PropsWithChildren<Omit<ExamLockerProps, 'children'>>>;

let host: HTMLDivElement;
let root: Root;
let fullscreenElement: Element | null;
const onAnomaly = vi.fn();
const onForceSubmit = vi.fn();

const mount = () => act(async () => root.render(React.createElement(Locker, { active: true, attemptId: 'a1', onAnomaly, onForceSubmit }, React.createElement('p', null, 'exam'))));
const guard = (paused: boolean) => act(async () => { window.dispatchEvent(new CustomEvent(FULLSCREEN_GUARD_EVENT, { detail: { paused } })); });
const leaveFullscreen = () => act(async () => { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')); });
const returnButtonShown = () => document.body.textContent?.includes('Imtihon faqat to') ?? false;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fullscreenElement = document.documentElement;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  document.documentElement.requestFullscreen = vi.fn(async () => { fullscreenElement = document.documentElement; });
  window.sessionStorage.setItem('bw_fullscreen_notice_a1', '1');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  onAnomaly.mockReset(); onForceSubmit.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.sessionStorage.clear(); vi.unstubAllGlobals(); });

describe('ExamLocker full-screen guard', () => {
  it('records leaving full screen as a violation', async () => {
    await mount();
    await leaveFullscreen();
    expect(onAnomaly).toHaveBeenCalledWith('exit_fullscreen');
    expect(returnButtonShown()).toBe(true);
  });

  it('ignores the exit while the app pauses the guard for the microphone prompt', async () => {
    await mount();
    await guard(true);
    await leaveFullscreen();
    expect(onAnomaly).not.toHaveBeenCalled();
    expect(returnButtonShown()).toBe(false);
  });

  it('shows the way back to full screen if it could not be restored after the prompt', async () => {
    await mount();
    await guard(true);
    await leaveFullscreen();
    await guard(false);
    expect(onAnomaly).not.toHaveBeenCalled();
    expect(returnButtonShown()).toBe(true);
  });

  it('shows the full-screen notice once per attempt and explains the system message', async () => {
    window.sessionStorage.clear();
    await mount();
    const notice = document.body.querySelector('[data-testid="fullscreen-notice"]');
    expect(notice?.textContent).toContain('system message');
    await act(async () => (notice!.querySelector('button') as HTMLButtonElement).click());
    expect(document.body.querySelector('[data-testid="fullscreen-notice"]')).toBeNull();
    expect(window.sessionStorage.getItem('bw_fullscreen_notice_a1')).toBe('1');
  });
});
