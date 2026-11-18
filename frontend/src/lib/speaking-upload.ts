import { ApiError } from "@/lib/api-client";

/**
 * What to do when a Speaking recording upload fails. The recording itself is never discarded
 * here: it stays retained on the device until the server acknowledges it.
 *
 * - transient (no connection, server error, timeout, rate limit, lock, response window still
 *   open on the server clock): retry by itself with growing delays;
 * - final (the server will give the same answer again, e.g. the upload window is over or the
 *   audio is not a complete response): keep the take, show the message, retry only on request.
 *
 * Uploads are idempotent on the server: a timed response keeps the first accepted recording, so a
 * retry after a lost acknowledgement returns "saved" again.
 */
export const UPLOAD_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000, 30000] as const;

const TRANSIENT_CODES = new Set(["SPEAKING_RESPONSE_ACTIVE", "SPEAKING_PREPARATION_ACTIVE", "NETWORK_ERROR", "TIMEOUT", "RATE_LIMITED", "LOCKED"]);

export type UploadFailure = { kind: "transient"; delayMs: number } | { kind: "final"; code: string | null };

export function uploadFailurePlan(error: unknown, attempt: number): UploadFailure {
  const transient =
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status >= 500 ||
    [408, 409, 423, 425, 429].includes(error.status) ||
    TRANSIENT_CODES.has(error.code);
  if (transient && attempt < UPLOAD_RETRY_DELAYS_MS.length) {
    return { kind: "transient", delayMs: UPLOAD_RETRY_DELAYS_MS[attempt] };
  }
  return { kind: "final", code: error instanceof ApiError ? error.code : null };
}
