"use client";

import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  Music,
  TriangleAlert,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/input";
import { tx } from "./types";

export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Professional media card for one Listening part's audio.
 *
 * Audio belongs to the part — never per question. File bytes travel through
 * the existing `POST /mock/groups/:id/media` endpoint on Save; this card
 * only reflects real stored state (`hasAudio`, stored duration) plus the
 * locally selected pending file. No storage keys or paths are ever shown.
 */
export function ListeningAudioCard({
  groupId,
  partLabel,
  hasAudio,
  durationSec,
  playLimit,
  pendingFile,
  pendingUrl,
  uploading,
  uploadError,
  uploadErrorDetail,
  onPickFile,
  onClearPending,
  onPlayLimitChange,
}: {
  groupId: string;
  partLabel: string;
  hasAudio: boolean;
  durationSec: number | null;
  playLimit: number;
  pendingFile: File | null;
  pendingUrl: string | null;
  /** True while a save is uploading the pending file. */
  uploading: boolean;
  /** Friendly upload-failure message (shown instead of raw server errors). */
  uploadError: string | null;
  uploadErrorDetail?: string | null;
  onPickFile: (f: File) => void;
  onClearPending: () => void;
  onPlayLimitChange: (n: number) => void;
}) {
  const t = useTranslations("examBuilder");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <section aria-label={tx(t, "audio", "Audio")} className="rounded-field border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Music className="size-4" aria-hidden />
          {tx(t, "audio", "Audio")}
        </p>
        {hasAudio && !pendingFile && (
          <Badge variant="success">
            <CheckCircle2 className="size-3" aria-hidden />
            {tx(t, "audioReady", "Audio ready")}
          </Badge>
        )}
        {!hasAudio && !pendingFile && (
          <Badge variant="warning">
            <TriangleAlert className="size-3" aria-hidden />
            {tx(t, "audioMissing", "Audio missing")}
          </Badge>
        )}
        {pendingFile && (
          <Badge variant="info">{tx(t, "audioPending", "Selected — uploads on save")}</Badge>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        aria-label={tx(t, "uploadAudio", "Upload audio")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPickFile(f);
        }}
      />

      {/* 1. No audio */}
      {!hasAudio && !pendingFile && (
        <div className="mt-2 rounded-field border border-dashed border-border-strong p-4 text-center">
          <p className="text-sm font-medium text-fg">
            {tx(t, "uploadListeningAudio", "Upload listening audio")}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-fg-muted">
            {tx(
              t,
              "uploadAudioHint",
              "One audio file per part. Students hear it during the exam; the replay limit below controls how many times.",
            )}
          </p>
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} className="mt-2.5">
            <Upload className="size-4" aria-hidden />
            {tx(t, "uploadAudio", "Upload audio")}
          </Button>
        </div>
      )}

      {/* 2/3. Selected (pending) or uploaded — one player, never one per question. */}
      {(pendingFile || hasAudio) && (
        <div className="mt-2 space-y-2">
          {pendingUrl ? (
            <audio controls preload="metadata" src={pendingUrl} className="h-9 w-full" aria-label={`${partLabel} — selected audio`} />
          ) : (
            <audio
              controls
              preload="none"
              src={`/api/backend/mock/groups/${groupId}/audio`}
              className="h-9 w-full"
              aria-label={`${partLabel} — audio`}
            />
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            {pendingFile ? (
              <>
                <span className="min-w-0 truncate font-medium text-fg" title={pendingFile.name}>
                  {pendingFile.name}
                </span>
                <span aria-hidden>·</span>
                <span>{fmtFileSize(pendingFile.size)}</span>
                {uploading ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-fg-muted" role="status">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {tx(t, "uploadingAudio", "Uploading audio…")}
                  </span>
                ) : (
                  <span>{tx(t, "audioPendingNote", "Uploads when you save.")}</span>
                )}
              </>
            ) : (
              <>
                <span>
                  {tx(t, "duration", "Duration")}:{" "}
                  {durationSec != null ? (
                    <span className="font-medium text-fg tabular-nums">{fmtDuration(durationSec)}</span>
                  ) : (
                    <span className="text-fg-subtle">{tx(t, "durationUnknown", "Not available")}</span>
                  )}
                </span>
              </>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {pendingFile && !uploading && (
                <Button size="sm" variant="ghost" onClick={onClearPending} aria-label={tx(t, "removeSelection", "Remove selected audio")}>
                  <X className="size-4" aria-hidden />
                  {tx(t, "remove", "Remove")}
                </Button>
              )}
              {!pendingFile && (
                <Button size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
                  <Upload className="size-4" aria-hidden />
                  {tx(t, "replaceAudio", "Replace audio")}
                </Button>
              )}
            </span>
          </div>
        </div>
      )}

      {/* 5. Upload failed — friendly first, technical detail collapsed. */}
      {uploadError && (
        <div className="mt-2 flex items-start gap-2 rounded-field border border-danger-border bg-danger-bg px-3 py-2" role="alert">
          <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-danger">{uploadError}</p>
            <p className="text-xs text-fg-muted">
              {tx(t, "uploadFailedHint", "Your selection is kept — check the file and save again.")}
            </p>
            {uploadErrorDetail && (
              <details className="mt-1 text-xs text-fg-subtle">
                <summary className="cursor-pointer">{tx(t, "techDetails", "Technical details")}</summary>
                <p className="mt-0.5 break-words">{uploadErrorDetail}</p>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Student-experience setting, in human language. */}
      <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-2.5">
        <Field
          label={tx(t, "audioReplayLimit", "Audio replay limit")}
          hint={tx(t, "audioReplayHint", "How many times the student can play this audio during the exam.")}
          htmlFor={`replay-${groupId}`}
          className="w-36"
        >
          <select
            id={`replay-${groupId}`}
            value={playLimit}
            onChange={(e) => onPlayLimitChange(Number(e.target.value))}
            className="h-9 w-full rounded-field border border-border bg-surface px-2 text-sm text-fg"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1
                  ? tx(t, "onePlay", "1 play")
                  : `${n} ${tx(t, "plays", "plays")}`}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
}
