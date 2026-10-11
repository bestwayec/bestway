// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  upload: vi.fn(), recover: vi.fn(), retain: vi.fn(), release: vi.fn(), active: vi.fn(),
  toastError: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => ({ testMicrophone: 'Test microphone', startResponse: 'Start response', stopResponse: 'Stop recording', retryUpload: 'Retry upload of saved recording', meterUnavailable: 'you can still record', uploadedStatus: 'Uploaded', recordingStatus: 'Recording', uploadingStatus: 'Uploading' } as Record<string, string>)[key] ?? key }));
vi.mock('sonner', () => ({ toast: { error: services.toastError, success: services.toastSuccess } }));
vi.mock('@/hooks/use-mock', () => ({ useUploadMockSpeaking: () => ({ isPending: false, mutateAsync: services.upload }) }));
vi.mock('@/lib/durable-recordings', () => ({
  recordingKey: (attempt: string, question: string) => `${attempt}:${question}`,
  recoverRecording: services.recover, retainRecording: services.retain,
  releaseRecording: services.release, markActiveRecording: services.active,
}));
import { SpeakingRecorder } from './speaking-recorder';
import { MultilevelRecorder, type MediaPhase } from './multilevel-media';

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static formats = new Set(['audio/mp4']);
  static constructorFailure: Error | null = null;
  static startFailure: Error | null = null;
  static empty = false;
  static isTypeSupported(type: string) { return this.formats.has(type); }
  state: RecordingState = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    if (FakeRecorder.constructorFailure) throw FakeRecorder.constructorFailure;
    this.mimeType = options?.mimeType ?? 'audio/ogg'; FakeRecorder.instances.push(this);
  }
  start() { if (FakeRecorder.startFailure) throw FakeRecorder.startFailure; this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(FakeRecorder.empty ? [] : ['recorded audio'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
let getUserMedia: ReturnType<typeof vi.fn>;
let stopTrack: ReturnType<typeof vi.fn>;
let input: MediaStream;
let startPhase: ReturnType<typeof vi.fn>;

async function render(kind: 'legacy' | 'multilevel' = 'legacy', timed = false) {
  await act(async () => root.render(kind === 'legacy'
    ? React.createElement(SpeakingRecorder, { attemptId: 'attempt', questionId: 'question', initialHasAudio: false })
    : React.createElement(MultilevelRecorder, { attemptId: 'attempt', questionId: 'question', timed, initialHasAudio: false, startPhase, upload: services.upload })));
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((element) => element.textContent?.includes(label));
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
  Object.values(services).forEach((mock) => mock.mockReset());
  services.upload.mockResolvedValue({ saved: true }); services.recover.mockResolvedValue(undefined);
  services.retain.mockResolvedValue(undefined); services.release.mockResolvedValue(undefined);
  FakeRecorder.instances = []; FakeRecorder.formats = new Set(['audio/mp4']);
  FakeRecorder.constructorFailure = null; FakeRecorder.startFailure = null; FakeRecorder.empty = false;
  stopTrack = vi.fn(); input = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  getUserMedia = vi.fn().mockResolvedValue(input);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } }); vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', undefined);
  startPhase = vi.fn().mockResolvedValue({ startedAt: new Date().toISOString(), prepEndsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10000).toISOString(), serverTime: new Date().toISOString(), plays: 0, playLimit: 1 } satisfies MediaPhase);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); mounted = true;
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('legacy speaking recording lifecycle', () => {
  it('uploads MP4 with its matching extension and announces progress only after acknowledgement', async () => {
    const progress = vi.fn(); window.addEventListener('multilevel:recording-uploaded', progress);
    await render(); await click('record'); await click('stopRecording');
    expect(stopTrack).toHaveBeenCalled();
    const file = services.upload.mock.calls[0][0].form.get('audio') as File;
    expect(file.name).toBe('speaking.m4a'); expect(file.type).toBe('audio/mp4');
    expect(services.retain).toHaveBeenCalled(); expect(services.release).toHaveBeenCalled();
    expect(progress).toHaveBeenCalledTimes(1); expect((progress.mock.calls[0][0] as CustomEvent).detail).toEqual({ attemptId: 'attempt', questionId: 'question' });
    expect(host.querySelector('audio')).not.toBeNull();
    window.removeEventListener('multilevel:recording-uploaded', progress);
  });

  it.each(['constructor', 'start'])('stops granted microphone tracks when recorder %s fails', async (failure) => {
    if (failure === 'constructor') FakeRecorder.constructorFailure = new DOMException('Device busy', 'NotReadableError');
    else FakeRecorder.startFailure = new Error('Start failed');
    await render(); await click('record');
    expect(stopTrack).toHaveBeenCalled(); expect(services.upload).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('guards repeated clicks while microphone permission is pending', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    await render();
    const button = host.querySelector('button')!;
    await act(async () => { button.click(); button.click(); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => grant(input));
    expect(FakeRecorder.instances).toHaveLength(1);
  });

  it('closes a microphone granted after the component unmounts', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    await render(); await click('record');
    await act(async () => root.unmount()); mounted = false;
    await act(async () => grant(input));
    expect(stopTrack).toHaveBeenCalledExactlyOnceWith(); expect(FakeRecorder.instances).toHaveLength(0);
  });

  it('rejects empty audio and leaves it unsaved', async () => {
    FakeRecorder.empty = true;
    await render(); await click('record'); await click('stopRecording');
    expect(services.upload).not.toHaveBeenCalled(); expect(services.retain).not.toHaveBeenCalled();
    expect(host.textContent).toContain('empty recording'); expect(host.querySelector('audio')).toBeNull();
  });

  it('keeps a failed upload for a real retry without reporting it saved', async () => {
    services.upload.mockRejectedValueOnce(new Error('offline'));
    await render(); await click('record'); await click('stopRecording');
    expect(host.textContent).toContain('preserved'); expect(host.querySelector('audio')).toBeNull();
    expect(services.release).not.toHaveBeenCalled(); expect(services.toastSuccess).not.toHaveBeenCalled();
    await click('Retry upload'); expect(services.upload).toHaveBeenCalledTimes(2);
    expect(services.release).toHaveBeenCalledTimes(1); expect(host.querySelector('audio')).not.toBeNull();
  });
});

describe('Multilevel microphone preflight and server timing', () => {
  it('offers playback only after the server acknowledges upload', async () => {
    let acknowledge!: (value: unknown) => void;
    services.upload.mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    await render('multilevel'); await click('Test microphone'); await click('Start response'); await click('Stop recording');
    expect(host.querySelector('audio')).toBeNull(); expect(host.textContent).toContain('Uploading');
    await act(async () => acknowledge({ saved: true }));
    expect(host.querySelector('audio')?.getAttribute('src')).toBe('/api/backend/mock/attempts/attempt/answers/question/audio?v=1');
    expect(host.textContent).toContain('Uploaded');
    await click('Test microphone'); await click('Start response');
    expect(host.textContent).toContain('Recording'); expect(host.textContent).not.toContain('Uploaded');
    expect(host.querySelector('audio')).toBeNull();
    await click('Stop recording'); await act(async () => acknowledge({ saved: true }));
  });

  it('closes a microphone granted after preflight unmounts without starting a response', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    await render('multilevel'); await click('Test microphone');
    await act(async () => root.unmount()); mounted = false;
    await act(async () => grant(input));
    expect(stopTrack).toHaveBeenCalledExactlyOnceWith(); expect(FakeRecorder.instances).toHaveLength(0);
    expect(startPhase).not.toHaveBeenCalled();
  });

  it('does not start capture when the server phase resolves after leaving the page', async () => {
    let grant!: (phase: MediaPhase) => void;
    const phase = await startPhase();
    startPhase.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    await render('multilevel'); await click('Test microphone'); await click('Start response');
    await act(async () => root.unmount()); mounted = false;
    await act(async () => grant(phase));
    expect(stopTrack).toHaveBeenCalled(); expect(FakeRecorder.instances[0].state).toBe('inactive');
    expect(services.upload).not.toHaveBeenCalled();
  });

  it.each(['missing', 'constructor failure', 'resume failure'])('keeps capture usable when the optional input meter has %s', async (failure) => {
    if (failure === 'constructor failure') vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Web Audio unavailable'); } });
    if (failure === 'resume failure') vi.stubGlobal('AudioContext', class {
      state = 'suspended'; resume() { return Promise.reject(new Error('autoplay blocked')); } close() { return Promise.resolve(); }
    });
    await render('multilevel'); await click('Test microphone');
    expect(host.textContent).toContain('you can still record'); expect(host.querySelector('meter')).toBeNull();
    expect(stopTrack).not.toHaveBeenCalled(); expect(startPhase).not.toHaveBeenCalled();
    await click('Start response'); expect(FakeRecorder.instances[0].state).toBe('recording');
    await click('Stop recording'); expect(services.upload).toHaveBeenCalledTimes(1);
  });

  it('resumes a suspended input meter and releases it with the microphone', async () => {
    const resume = vi.fn(); const close = vi.fn().mockResolvedValue(undefined);
    class Context {
      state = 'suspended';
      resume() { resume(); this.state = 'running'; return Promise.resolve(); }
      close = close;
      createAnalyser() { return { fftSize: 2, getByteTimeDomainData: (array: Uint8Array) => array.set([128, 192]) }; }
      createMediaStreamSource() { return { connect: vi.fn() }; }
    }
    vi.stubGlobal('AudioContext', Context);
    await render('multilevel'); await click('Test microphone');
    expect(resume).toHaveBeenCalledTimes(1); expect(host.querySelector('meter')?.getAttribute('value')).toBe('0.5');
    await click('Start response'); await click('Stop recording');
    expect(close).toHaveBeenCalledTimes(1); expect(stopTrack).toHaveBeenCalled();
  });

  it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError'])('shows an actionable %s error without consuming a server phase', async (name) => {
    getUserMedia.mockRejectedValue(new DOMException('failure', name));
    await render('multilevel'); await click('Test microphone');
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(startPhase).not.toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0); expect(host.textContent).not.toContain('Start response');
  });

  it('allows a microphone retry after permission is corrected without losing the task', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('permission blocked', 'NotAllowedError'));
    await render('multilevel'); await click('Test microphone');
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(startPhase).not.toHaveBeenCalled();
    await click('Test microphone');
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(getUserMedia).toHaveBeenCalledTimes(2);
    await click('Start response'); await click('Stop recording');
    expect(services.upload).toHaveBeenCalledTimes(1); expect(host.querySelector('audio')).not.toBeNull();
  });

  it('supports a browser default format even when explicit WebM and MP4 hints are unsupported', async () => {
    FakeRecorder.formats.clear();
    await render('multilevel'); await click('Test microphone'); await click('Start response'); await click('Stop recording');
    expect((services.upload.mock.calls[0][0] as Blob).type).toBe('audio/ogg');
  });

  it('waits for the server preparation deadline and auto-stops at the response deadline', async () => {
    startPhase.mockResolvedValue({ ...await startPhase(), prepEndsAt: new Date(Date.now() + 2000).toISOString(), expiresAt: new Date(Date.now() + 4000).toISOString() });
    startPhase.mockClear();
    await render('multilevel', true); await click('Test microphone'); await click('Start response');
    expect(startPhase).toHaveBeenCalledTimes(1); expect(FakeRecorder.instances[0].state).toBe('inactive');
    await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(FakeRecorder.instances[0].state).toBe('recording');
    await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(FakeRecorder.instances[0].state).toBe('inactive');
    expect(services.upload).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('Uploaded');
  });
});
