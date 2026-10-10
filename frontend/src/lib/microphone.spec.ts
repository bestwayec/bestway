import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioRecorder, microphoneErrorMessage, recordedAudioBlob, recordingFileName } from './microphone';

afterEach(() => vi.unstubAllGlobals());

describe('browser microphone formats', () => {
  it('uses MP4 when WebM is unsupported and preserves its playback suffix', () => {
    const construct = vi.fn();
    class Recorder {
      mimeType: string;
      static isTypeSupported(type: string) { return type === 'audio/mp4'; }
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) { construct(options); this.mimeType = options?.mimeType ?? ''; }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    const recorder = createAudioRecorder({} as MediaStream);
    expect(construct).toHaveBeenCalledExactlyOnceWith({ mimeType: 'audio/mp4' });
    const blob = recordedAudioBlob(recorder, [new Blob(['real data'], { type: 'audio/mp4' })]);
    expect(recordingFileName(blob)).toBe('speaking.m4a');
  });

  it('falls back to the browser default and uses a typed audio chunk when mimeType is empty', () => {
    const construct = vi.fn();
    class Recorder {
      mimeType = '';
      static isTypeSupported() { return false; }
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) { construct(options); }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    const recorder = createAudioRecorder({} as MediaStream);
    expect(construct).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(recordingFileName(recordedAudioBlob(recorder, [new Blob(['data'], { type: 'audio/ogg;codecs=opus' })]))).toBe('speaking.ogg');
  });

  it('retries a browser format rejection but does not hide device errors', () => {
    const construct = vi.fn();
    class Recorder {
      mimeType: string;
      static isTypeSupported() { return true; }
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        construct(options);
        if (options?.mimeType?.includes('codecs')) throw new DOMException('unsupported', 'NotSupportedError');
        this.mimeType = options?.mimeType ?? '';
      }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    expect(createAudioRecorder({} as MediaStream).mimeType).toBe('audio/webm');
    expect(construct).toHaveBeenCalledTimes(2);
    vi.stubGlobal('MediaRecorder', class {
      static isTypeSupported() { return true; }
      constructor() { throw new DOMException('Device busy', 'NotReadableError'); }
    });
    expect(() => createAudioRecorder({} as MediaStream)).toThrow('Device busy');
  });

  it.each(['audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm'])('rejects empty %s takes instead of uploading them', (mimeType) => {
    expect(() => recordedAudioBlob({ mimeType }, [])).toThrow('empty');
  });

  it('rejects unknown or missing formats without labelling them WebM', () => {
    expect(() => recordedAudioBlob({ mimeType: '' }, [new Blob(['data'])])).toThrow('unsupported');
    expect(() => recordingFileName({ type: 'video/mp4' })).toThrow('unsupported');
  });

  it.each([
    ['NotAllowedError', 'permission denied'], ['SecurityError', 'permission denied'],
    ['NotFoundError', 'No microphone'], ['NotReadableError', 'close other apps'],
  ])('explains %s so a student can resolve microphone access', (name, message) => {
    expect(microphoneErrorMessage(new DOMException('failure', name))).toContain(message);
  });
});
