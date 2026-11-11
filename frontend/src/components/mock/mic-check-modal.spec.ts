// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MicCheckModal } from './mic-check-modal';

class FakeRecorder {
  static isTypeSupported() { return true; }
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

let host: HTMLDivElement;
let root: Root;
let getUserMedia: ReturnType<typeof vi.fn>;
const onConfirm = vi.fn();
const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;

const render = () => act(async () => root.render(React.createElement(MicCheckModal, { open: true, onConfirm })));
const button = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const click = (text: string) => act(async () => { button(text)!.click(); });
const denied = () => Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  HTMLMediaElement.prototype.pause = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  onConfirm.mockReset(); stopTrack.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('MicCheckModal', () => {
  it('passes the 5 second test once the microphone is allowed', async () => {
    getUserMedia.mockResolvedValue(stream);
    await render();
    await click('Sinovni boshlash');
    expect(document.body.textContent).toContain('Ovoz yozilmoqda');
    await act(async () => { await vi.advanceTimersByTimeAsync(5200); });
    expect(document.body.textContent).toContain('Yozuv tayyor');
    expect(stopTrack).toHaveBeenCalled();
    await click('Speakingni boshlash');
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('explains a refusal in Uzbek, offers Retry, and then succeeds on the retry', async () => {
    getUserMedia.mockRejectedValueOnce(denied()).mockResolvedValueOnce(stream);
    await render();
    await click('Sinovni boshlash');
    const text = document.body.textContent ?? '';
    expect(text).toContain('Mikrofonga ruxsat berilmadi');
    expect(text).toContain('Ruxsat berish');
    expect(text).not.toMatch(/Microphone permission denied/);
    await click('Qayta urinish');
    await act(async () => { await vi.advanceTimersByTimeAsync(5200); });
    expect(document.body.textContent).toContain('Yozuv tayyor');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('never traps the student: after a failure the exam can continue without the microphone', async () => {
    getUserMedia.mockRejectedValue(denied());
    await render();
    await click('Sinovni boshlash');
    expect(button('Mikrofonsiz davom etish')).toBeTruthy();
    await click('Mikrofonsiz davom etish');
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('says so when there is no microphone', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' }));
    await render();
    await click('Sinovni boshlash');
    expect(document.body.textContent).toContain('Mikrofon topilmadi');
    expect(button('Qayta urinish')).toBeTruthy();
  });
});
