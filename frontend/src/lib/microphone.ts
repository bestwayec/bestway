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
