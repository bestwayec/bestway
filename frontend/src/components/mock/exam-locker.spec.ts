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

const mount = () => act(async () => root.render(React.createElement(Locker, { active: true, attemptId: 'a1', onAnomaly }, React.createElement('p', null, 'exam'))));
const guard = (paused: boolean) => act(async () => { window.dispatchEvent(new CustomEvent(FULLSCREEN_GUARD_EVENT, { detail: { paused } })); });
const leaveFullscreen = () => act(async () => { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')); });
const returnButtonShown = () => [...document.body.querySelectorAll('button')].some((b) => b.textContent?.includes('Return to full screen'));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fullscreenElement = document.documentElement;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  document.documentElement.requestFullscreen = vi.fn(async () => { fullscreenElement = document.documentElement; });
  window.sessionStorage.setItem('bw_fullscreen_notice_a1', '1');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  onAnomaly.mockReset();
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

describe('ExamLocker records but never stops the exam', () => {
  it('every exit is recorded, the notice is not modal, and three or more exits do not hand the exam in', async () => {
    let now = Date.parse('2026-11-13T10:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    await mount();
    for (let i = 0; i < 4; i++) {
      await leaveFullscreen();
      await act(async () => { fullscreenElement = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); });
      now += 2000;   // separate exits, not one double event
    }
    clock.mockRestore();
    expect(onAnomaly.mock.calls.filter(([e]) => e === 'exit_fullscreen').length).toBe(4);
    const notice = document.querySelector('[data-testid="exam-integrity-notice"]')!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('Leaving the exam window was recorded');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(host.textContent).toContain('exam');
  });

  it('does not ask for full screen without a click by the student', async () => {
    window.sessionStorage.clear();
    fullscreenElement = null;
    const request = document.documentElement.requestFullscreen as ReturnType<typeof vi.fn>;
    await mount();
    expect(request).not.toHaveBeenCalled();
    const start = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'I understand, start')!;
    await act(async () => start.click());
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('ExamLocker clipboard policy in the timed exam', () => {
  const clip = (type: 'copy' | 'cut' | 'paste', target: Element, text = '') => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  it('blocks and logs pasting outside text, allows moving the student\'s own text inside the answer', async () => {
    await mount();
    const area = document.createElement('div'); area.setAttribute('data-exam-writing', '');
    const answer = document.createElement('textarea'); answer.value = 'Cities are growing quickly.'; area.appendChild(answer); document.body.appendChild(area);
    expect(clip('paste', answer, 'a model answer from a website')).toBe(true);
    expect(onAnomaly).toHaveBeenCalledWith('paste_blocked');
    onAnomaly.mockReset();
    answer.setSelectionRange(0, 6);
    expect(clip('cut', answer)).toBe(false);
    expect(clip('paste', answer, 'Cities')).toBe(false);
    expect(onAnomaly).not.toHaveBeenCalled();
    const passage = document.querySelector('p')!;
    expect(clip('copy', passage)).toBe(true);
    expect(onAnomaly).toHaveBeenCalledWith('copy_blocked');
    area.remove();
  });
});
