// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import uz from '../../../messages/uz.json';

const locale = vi.hoisted(() => ({ current: 'en' as 'en' | 'uz' }));
vi.mock('next-intl', async () => {
  const messages = { en, uz } as unknown as Record<string, { mock: { runnerUx: Record<string, string> } }>;
  return {
    useTranslations: () => (key: string, values?: Record<string, unknown>) => {
      const template = messages[locale.current].mock.runnerUx[key] ?? key;
      return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
    },
  };
});
vi.mock('@/lib/durable-recordings', () => ({
  recordingKey: () => 'k', recoverRecording: vi.fn(), retainRecording: vi.fn(), releaseRecording: vi.fn(), markActiveRecording: vi.fn(),
}));
import { MultilevelListening, type MediaPhase } from './multilevel-media';

const NOW = Date.parse('2026-11-10T10:00:00Z');
function phase(over: Partial<MediaPhase> = {}): MediaPhase {
  return {
    startedAt: new Date(NOW).toISOString(), prepEndsAt: new Date(NOW + 20_000).toISOString(),
    expiresAt: new Date(NOW + 380_000).toISOString(), plays: 0, serverTime: new Date(NOW).toISOString(), playLimit: 2, ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const prepare = vi.fn();
const play = vi.fn();
const load = vi.fn();

async function render() {
  await act(async () => root.render(React.createElement(MultilevelListening, { prepare, play, load })));
}
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  prepare.mockReset().mockResolvedValue(phase()); play.mockReset(); load.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); locale.current = 'en'; });

describe('MultilevelListening (exam player)', () => {
  it('offers only a granted play and a volume control: no seek, pause or native controls', async () => {
    await render();
    expect(host.querySelector('audio')?.hasAttribute('controls')).toBe(false);
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(host.querySelector('input[type="range"]')?.getAttribute('aria-label')).toBe('Volume');
    expect(host.textContent).toContain('cannot be paused or rewound');
    expect(button('Play audio')).toBeUndefined();
  });

  it('locks Play audio until the server preview ends, then unlocks it', async () => {
    await render();
    await act(async () => button('Preview this part')!.click());
    expect(prepare).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('audio unlocks in 20s');
    expect(button('Play audio')!.disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(21_000); });
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Ready');
    expect(button('Play audio')!.disabled).toBe(false);
  });

  it('keeps Play audio disabled once the server-side play limit is used', async () => {
    prepare.mockResolvedValue(phase({ plays: 2, prepEndsAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW - 500).toISOString() }));
    await render();
    await act(async () => button('Preview this part')!.click());
    expect(host.textContent).toContain('All plays of this part are used');
    expect(host.textContent).toContain('Plays 2/2');
    expect(button('Play audio')!.disabled).toBe(true);
  });

  it('retries a failed final granted play without consuming another grant, then expires it', async () => {
    prepare.mockResolvedValue(phase({ plays: 1, prepEndsAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW - 500).toISOString() }));
    play.mockResolvedValue(phase({ plays: 2, prepEndsAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 10_000).toISOString() }));
    load.mockRejectedValue(new Error('temporary network failure'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    await act(async () => button('Preview this part')!.click());
    await act(async () => button('Play audio')!.click());
    expect(play).toHaveBeenCalledTimes(1);
    expect(button('Play audio')!.disabled).toBe(false);
    await act(async () => button('Play audio')!.click());
    expect(play).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(11_000); });
    expect(button('Play audio')!.disabled).toBe(true);
    log.mockRestore();
  });

  it('renders Uzbek copy without English leftovers', async () => {
    locale.current = 'uz';
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('Qismni ko‘zdan kechirish');
    expect(text).toContain('Ovoz balandligi');
    for (const english of ['Preview this part', 'Volume', 'Play audio']) expect(text).not.toContain(english);
  });

  it('shows a localized error when the preview cannot start', async () => {
    prepare.mockRejectedValue(new Error('network'));
    await render();
    await act(async () => button('Preview this part')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The preview could not be started. Please try again.');
  });
});
