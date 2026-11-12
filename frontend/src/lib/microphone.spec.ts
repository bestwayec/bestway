// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULLSCREEN_GUARD_EVENT, microphoneProblem, primeMicrophonePermission, requestMicrophoneStream } from './microphone';
import uz from '../../messages/uz.json';
import en from '../../messages/en.json';

const microphoneHelpUz = (problem: string) => (uz.mock.mic.help as Record<string, string>)[problem];

const calls: string[] = [];
let fullscreenElement: Element | null;
let getUserMedia: ReturnType<typeof vi.fn>;
const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;

function listenForGuard() {
  const handler = (event: Event) => calls.push(`guard:${(event as CustomEvent).detail.paused ? 'paused' : 'resumed'}`);
  window.addEventListener(FULLSCREEN_GUARD_EVENT, handler);
  return () => window.removeEventListener(FULLSCREEN_GUARD_EVENT, handler);
}

function setPermission(state: string | null) {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: state === null ? undefined : { query: vi.fn().mockResolvedValue({ state }) },
  });
}

beforeEach(() => {
  calls.length = 0; track.stop.mockReset();
  fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  document.exitFullscreen = vi.fn(async () => { calls.push('exitFullscreen'); fullscreenElement = null; });
  document.documentElement.requestFullscreen = vi.fn(async () => { calls.push('requestFullscreen'); fullscreenElement = document.documentElement; });
  getUserMedia = vi.fn(async () => { calls.push('getUserMedia'); return stream; });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {};
});
afterEach(() => { setPermission(null); });

describe('microphoneProblem', () => {
  it.each([
    [{ name: 'NotAllowedError' }, 'denied'],
    [{ name: 'PermissionDismissedError' }, 'denied'],
    [{ name: 'NotFoundError' }, 'notFound'],
    [{ name: 'NotReadableError' }, 'busy'],
    [{ name: 'NotSupportedError' }, 'unsupported'],
    [new Error('Microphone recording requires a secure HTTPS connection.'), 'insecure'],
    [new Error('Microphone recording is unavailable in this browser.'), 'unsupported'],
    [new Error('boom'), 'other'],
  ])('%j -> %s', (error, expected) => expect(microphoneProblem(error)).toBe(expected));

  it('gives Uzbek instructions for a refusal, including the overlay hint and a way to retry', () => {
    const text = microphoneHelpUz('denied');
    expect(text).toContain('Qayta urinish');
    expect(text).toContain('Ruxsat berish');
    expect(text).toContain('suzuvchi tugmalar');
    for (const problem of ['notFound', 'busy', 'insecure', 'unsupported', 'other'] as const) {
      expect(microphoneHelpUz(problem)).not.toMatch(/\b(permission|denied|retry)\b/i);
    }
  });

  it('has help text in every locale for every problem the runtime can report', () => {
    for (const problem of ['denied', 'notFound', 'busy', 'insecure', 'unsupported', 'other'] as const) {
      expect((uz.mock.mic.help as Record<string, string>)[problem]).toBeTruthy();
      expect((en.mock.mic.help as Record<string, string>)[problem]).toBeTruthy();
    }
  });
});

describe('requestMicrophoneStream', () => {
  it('leaves full screen for the permission prompt without raising a violation, then returns', async () => {
    const stop = listenForGuard();
    fullscreenElement = document.documentElement;
    await expect(requestMicrophoneStream()).resolves.toBe(stream);
    stop();
    expect(calls).toEqual(['guard:paused', 'exitFullscreen', 'getUserMedia', 'requestFullscreen', 'guard:resumed']);
  });

  it('resumes the guard and rethrows when the permission is refused', async () => {
    const stop = listenForGuard();
    fullscreenElement = document.documentElement;
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    await expect(requestMicrophoneStream()).rejects.toMatchObject({ name: 'NotAllowedError' });
    stop();
    expect(calls.at(-1)).toBe('guard:resumed');
    expect(calls).toContain('requestFullscreen');
  });

  it('does not touch full screen when the page is not in it', async () => {
    const stop = listenForGuard();
    await requestMicrophoneStream();
    stop();
    expect(calls).toEqual(['getUserMedia']);
  });

  it('still returns when full screen cannot be restored', async () => {
    fullscreenElement = document.documentElement;
    document.documentElement.requestFullscreen = vi.fn(async () => { throw new Error('needs a gesture'); });
    await expect(requestMicrophoneStream()).resolves.toBe(stream);
  });
});

describe('primeMicrophonePermission', () => {
  it('asks once while the permission is undecided and releases the microphone', async () => {
    setPermission('prompt');
    await expect(primeMicrophonePermission()).resolves.toBe('granted');
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it.each(['granted', 'denied'])('does not prompt when it is already %s', async (state) => {
    setPermission(state);
    await expect(primeMicrophonePermission()).resolves.toBe(state);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('reports a refusal instead of throwing, so the exam can still start', async () => {
    setPermission('prompt');
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    await expect(primeMicrophonePermission()).resolves.toBe('denied');
  });

  it('is a no-op where the Permissions API is missing', async () => {
    setPermission(null);
    await expect(primeMicrophonePermission()).resolves.toBe('unknown');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
