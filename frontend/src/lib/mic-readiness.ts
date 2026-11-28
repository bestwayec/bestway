/**
 * Remembers that the microphone check passed for an attempt on this browser, so a reload or a browser
 * restart does not interrupt a valid Speaking attempt with the check again. The record is reused only
 * while it is still believable for this device: the same browser (user agent), within its lifetime, and
 * the browser still reports the microphone permission as granted. Anything else means "check again".
 * Nothing about the recording itself is stored.
 */
import { microphonePermission, type MicrophonePermission } from "@/lib/microphone";

export const MIC_READY_TTL_MS = 12 * 60 * 60 * 1000;
const key = (attemptId: string) => `bw_mic_ready_${attemptId}`;
type Record = { at: number; ua: string };

function userAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

export function rememberMicReady(attemptId: string, now = Date.now()): void {
  try {
    window.localStorage.setItem(key(attemptId), JSON.stringify({ at: now, ua: userAgent() } satisfies Record));
    window.sessionStorage.setItem(`bw_mic_checked_${attemptId}`, "1");
  } catch {}
}

export function forgetMicReady(attemptId: string): void {
  try {
    window.localStorage.removeItem(key(attemptId));
    window.sessionStorage.removeItem(`bw_mic_checked_${attemptId}`);
  } catch {}
}

/** The stored record when it belongs to this browser and is still fresh; otherwise null. */
export function storedMicReady(attemptId: string, now = Date.now()): Record | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key(attemptId)) || "null") as Partial<Record> | null;
    if (!raw || typeof raw.at !== "number" || typeof raw.ua !== "string") return null;
    if (raw.ua !== userAgent() || now - raw.at > MIC_READY_TTL_MS || raw.at > now + 60_000) return null;
    return { at: raw.at, ua: raw.ua };
  } catch {
    return null;
  }
}

/** Pure decision, kept separate for tests. */
export function micReadyDecision(stored: boolean, permission: MicrophonePermission): "reuse" | "check" {
  return stored && permission === "granted" ? "reuse" : "check";
}

/**
 * True when the earlier successful check may be reused. A permission that is denied, still to be asked
 * or unknown to the browser always means a fresh check, so the student is never told a microphone is
 * ready when the browser has not confirmed it.
 */
export async function canReuseMicReady(attemptId: string, now = Date.now()): Promise<boolean> {
  const stored = storedMicReady(attemptId, now) !== null;
  if (!stored) return false;
  const permission = await microphonePermission();
  if (permission === "denied") forgetMicReady(attemptId);
  return micReadyDecision(stored, permission) === "reuse";
}
