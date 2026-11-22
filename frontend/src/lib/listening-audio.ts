/** Listening audio gate: types and pure helpers (no I/O) for the Exam Builder panel. */

export type AudioStatus = "MISSING" | "UPLOADED" | "VERIFIED";

export interface ListeningPartAudio {
  groupId: string;
  partNumber: number | null;
  title: string | null;
  questionNumbers: number[];
  questionRange: [number, number] | null;
  questionCount: number;
  status: AudioStatus;
  problems: string[];
  hasAudio: boolean;
  durationSec: number | null;
  audio: null | {
    container: string;
    codec: string;
    sizeBytes: number;
    revision: number;
    originalName: string;
    checksum: string;
    uploadedAt: string | null;
    verifiedAt: string | null;
    verificationNote: string | null;
  };
}

export interface ExamGate {
  examId: string;
  gated: boolean;
  published: boolean;
  rights: null | { status: "unverified" | "verified" | "original"; sources: Record<string, string>; note: string | null; verifiedAt: string | null };
  audio: { requiredVerified: boolean; parts: ListeningPartAudio[]; verifiedParts: number; totalParts: number; allVerified: boolean; missingParts: number[] };
  blockers: string[];
}

export const AUDIO_ACCEPT = ".mp3,.m4a,audio/mpeg,audio/mp4";
export const MAX_AUDIO_MB = 200;

export function statusVariant(status: AudioStatus): "danger" | "warning" | "success" {
  return status === "VERIFIED" ? "success" : status === "UPLOADED" ? "warning" : "danger";
}

/** "Part 2: 11–20" style label; null when the part has no questions. */
export function rangeLabel(part: Pick<ListeningPartAudio, "questionRange">): string | null {
  return part.questionRange ? `${part.questionRange[0]}–${part.questionRange[1]}` : null;
}

export function summarize(parts: readonly Pick<ListeningPartAudio, "status">[]): { missing: number; uploaded: number; verified: number; total: number } {
  const count = (s: AudioStatus) => parts.filter((p) => p.status === s).length;
  return { missing: count("MISSING"), uploaded: count("UPLOADED"), verified: count("VERIFIED"), total: parts.length };
}

/** Client-side pre-check before sending; the server re-validates everything. */
export function precheckAudioFile(file: { name: string; size: number }): string | null {
  const ext = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (ext !== ".mp3" && ext !== ".m4a") return "Only MP3 or M4A recordings are accepted.";
  if (file.size > MAX_AUDIO_MB * 1024 * 1024) return `The recording is larger than ${MAX_AUDIO_MB} MB.`;
  if (file.size < 20 * 1024) return "The file is too small to be a Listening recording.";
  return null;
}

export function verifiable(part: Pick<ListeningPartAudio, "status" | "hasAudio" | "questionNumbers">, role: string | undefined): boolean {
  return (role === "admin" || role === "super_admin") && part.hasAudio && part.questionNumbers.length > 0 && part.status !== "VERIFIED";
}

/** Verification is allowed only when every question of the part is ticked and the whole recording was played. */
export function canSubmitVerification(part: Pick<ListeningPartAudio, "questionNumbers">, ticked: readonly number[], listenedFully: boolean): boolean {
  if (!listenedFully || part.questionNumbers.length === 0) return false;
  const set = new Set(ticked);
  return part.questionNumbers.every((n) => set.has(n)) && set.size === part.questionNumbers.length;
}

export function fmtDuration(totalSec: number | null | undefined): string {
  if (totalSec == null) return "—";
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One sentence the UI shows under the exam title while the draft is blocked. */
export function draftNotice(gate: Pick<ExamGate, "published" | "blockers">): string | null {
  if (gate.published || gate.blockers.length === 0) return null;
  return "This exam stays in DRAFT and is not visible to students until every item below is resolved.";
}
