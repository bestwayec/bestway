/** Pure helpers for the pre-exam device check (components/mock/device-check.tsx). */

export type CheckState = "idle" | "running" | "ok" | "warn" | "fail";

/** Round trip of one API request (the same proxy the exam uses). Thresholds are about autosave, not speed tests. */
export function classifyLatency(ms: number): Exclude<CheckState, "idle" | "running"> {
  if (!Number.isFinite(ms) || ms < 0) return "fail";
  return ms <= 1500 ? "ok" : "warn";
}

/**
 * Peak input level (0..1) from byte time-domain samples of an AnalyserNode, where 128 is silence.
 * A peak under MIN_VOICE_LEVEL means the microphone delivered (almost) silence.
 */
export function peakLevel(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i] - 128) / 128);
  return peak;
}

export const MIN_VOICE_LEVEL = 0.04;

export function canRecordAudio(): boolean {
  return typeof window !== "undefined"
    && window.isSecureContext !== false
    && typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== "undefined";
}
