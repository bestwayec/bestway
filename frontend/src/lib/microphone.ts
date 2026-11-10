/** Keep the browser's actual audio format; the upload suffix determines playback. */
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

export function assertMicrophoneAvailable() {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error('Microphone recording requires a secure HTTPS connection.');
  }
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function' ||
    typeof MediaRecorder === 'undefined'
  ) {
    throw new Error('Microphone recording is unavailable in this browser. Use a browser with microphone recording support.');
  }
}

export function microphoneErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const lowerMsg = message.toLowerCase();

  if (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    name === 'PermissionDeniedError' ||
    name === 'PermissionDismissedError' ||
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('permission dismissed')
  ) {
    return 'Microphone permission denied. Allow microphone access in your browser and device settings, then retry.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect a microphone and retry.';
  }
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
    return 'The microphone could not be opened. Check your device and close other apps using the microphone, then retry.';
  }
  if (name === 'NotSupportedError') {
    return 'Microphone recording is not supported on this browser or device. Try another browser or app.';
  }
  return message || 'Microphone recording failed. Check your device and retry.';
}

export const OPTIMAL_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  sampleRate: 16000,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export function createAudioRecorder(stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder {
  for (const mimeType of AUDIO_TYPES) {
    if (typeof MediaRecorder.isTypeSupported !== 'function' || !MediaRecorder.isTypeSupported(mimeType)) continue;
    try { return new MediaRecorder(stream, options ? { mimeType, ...options } : { mimeType }); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'name' in error && error.name === 'NotSupportedError')) throw error;
    }
  }
  // Some browsers can record their default format without supporting our hints.
  return new MediaRecorder(stream, options);
}

export function recordingFileName(audio: Pick<Blob, 'type'>) {
  const type = audio.type.split(';')[0].trim().toLowerCase();
  const suffix: Record<string, string> = {
    'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
    'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/aac': 'aac',
  };
  if (!suffix[type]) throw new Error('The browser produced an unsupported audio format. Try another browser.');
  return `speaking.${suffix[type]}`;
}

export function recordedAudioBlob(recorder: Pick<MediaRecorder, 'mimeType'>, chunks: Blob[]) {
  const blob = new Blob(chunks, { type: recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || '' });
  if (!blob.size) throw new Error('The microphone produced an empty recording. Check the device and retry.');
  recordingFileName(blob);
  return blob;
}

export type MicrophoneProblem = 'denied' | 'notFound' | 'busy' | 'unsupported' | 'insecure' | 'other';

/** Classify a getUserMedia/recorder failure so screens can give the right instructions. */
export function microphoneProblem(error: unknown): MicrophoneProblem {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').toLowerCase();
  if (message.includes('secure https')) return 'insecure';
  if (message.includes('unavailable in this browser')) return 'unsupported';
  if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError', 'PermissionDismissedError'].includes(name) || message.includes('permission denied') || message.includes('permission dismissed')) return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'notFound';
  if (['NotReadableError', 'AbortError', 'TrackStartError'].includes(name)) return 'busy';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'other';
}

export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Current microphone permission, or 'unknown' where the Permissions API cannot tell. */
export async function microphonePermission(): Promise<MicrophonePermission> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The exam's full-screen guard listens for this so a deliberate, short full-screen exit is not a violation. */
export const FULLSCREEN_GUARD_EVENT = 'bw:fullscreen-guard';

function setFullscreenGuardPaused(paused: boolean) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FULLSCREEN_GUARD_EVENT, { detail: { paused } }));
}

/**
 * Open the microphone. Android withholds the permission dialog while a full-screen page (and its
 * system toast) is covering the screen ("close pop-ups or windows from other apps"), so when the exam
 * is full screen we leave it for the duration of the request, without counting that as a violation,
 * and go back afterwards. Callers must run this from a user gesture.
 */
export async function requestMicrophoneStream(constraints: MediaStreamConstraints = { audio: true }): Promise<MediaStream> {
  const wasFullscreen = typeof document !== 'undefined' && !!document.fullscreenElement;
  if (wasFullscreen) {
    setFullscreenGuardPaused(true);
    try { await document.exitFullscreen(); } catch { /* the request below still runs */ }
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } finally {
    if (wasFullscreen) {
      try { await document.documentElement.requestFullscreen(); } catch { /* the exam shows its "return to full screen" button */ }
      setFullscreenGuardPaused(false);
    }
  }
}

/** Ask once, before the exam goes full screen, and release the microphone again. */
export async function primeMicrophonePermission(): Promise<MicrophonePermission> {
  const state = await microphonePermission();
  if (state !== 'prompt') return state;
  try {
    assertMicrophoneAvailable();
    const stream = await requestMicrophoneStream({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return 'granted';
  } catch (error) {
    return microphoneProblem(error) === 'denied' ? 'denied' : 'unknown';
  }
}
