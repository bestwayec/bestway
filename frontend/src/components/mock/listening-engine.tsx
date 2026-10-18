"use client";

import * as React from "react";
import { Clock, Play, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AudioTimestampItem } from "@/lib/types";

const REVIEW_SEC = 120;

function fmt(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Global in-memory Blob cache (url -> objectUrl).
 * Once an audio URL is fetched as a Blob, cache the resulting object URL so subsequent
 * renders or part switches reuse the cached Blob URL with 0ms network latency!
 */
export const mediaBlobCache = new Map<string, string>();

export async function fetchAudioBlobUrl(url: string, signal?: AbortSignal): Promise<string> {
  const cached = mediaBlobCache.get(url);
  if (cached) return cached;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  mediaBlobCache.set(url, objectUrl);
  return objectUrl;
}

export function clearMediaBlobCache(): void {
  for (const objectUrl of mediaBlobCache.values()) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  }
  mediaBlobCache.clear();
}

/**
 * Listening audio engine — spec §2.1 + Single Audio Part Timestamps (v0.8.0).
 * strict (exam full_test): play ONCE, no pause/rewind/ff, volume only.
 * After audio ends → 2:00 review countdown → onReviewComplete (auto-advance).
 * practice: native controls, unlimited replay.
 * When `startSec` is provided (from Single Audio Timestamps or part switching),
 * automatically seeks `audioRef.current.currentTime = startSec`.
 */
export function ListeningAudio({
  src,
  strict,
  startSec,
  endSec,
  partLabel,
  timestamps,
  onEnded,
  onReviewComplete,
}: {
  src: string;
  strict: boolean;
  startSec?: number | null;
  endSec?: number | null;
  partLabel?: string;
  timestamps?: AudioTimestampItem[] | null;
  onEnded?: () => void;
  onReviewComplete?: () => void;
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [started, setStarted] = React.useState(false);
  const [ended, setEnded] = React.useState(false);
  const [reviewLeft, setReviewLeft] = React.useState<number | null>(null);
  const doneRef = React.useRef(false);
  const lastSeekSecRef = React.useRef<number | null>(null);

  const [activeSrc, setActiveSrc] = React.useState<string>(() => {
    if (!src || src.startsWith("blob:") || src.startsWith("data:")) return src;
    return mediaBlobCache.get(src) ?? src;
  });

  React.useEffect(() => {
    if (!src || src.startsWith("blob:") || src.startsWith("data:")) {
      setActiveSrc(src);
      return;
    }
    const cached = mediaBlobCache.get(src);
    if (cached) {
      setActiveSrc(cached);
      return;
    }
    let alive = true;
    const ctrl = new AbortController();
    fetchAudioBlobUrl(src, ctrl.signal)
      .then((blobUrl) => {
        if (alive) setActiveSrc(blobUrl);
      })
      .catch(() => {
        if (alive) setActiveSrc(src);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [src]);

  // Seek to startSec when switching Listening parts or when metadata loads
  const applyStartSeek = React.useCallback((targetSec: number | null | undefined) => {
    if (targetSec == null || targetSec < 0 || !Number.isFinite(targetSec)) return;
    const el = audioRef.current;
    if (!el) return;
    try {
      if (el.readyState >= 1) {
        el.currentTime = targetSec;
        lastSeekSecRef.current = targetSec;
      }
    } catch {
      // ignore if media not ready yet; onLoadedMetadata will apply it
    }
  }, []);

  React.useEffect(() => {
    if (startSec != null && startSec >= 0 && lastSeekSecRef.current !== startSec) {
      applyStartSeek(startSec);
    }
  }, [startSec, applyStartSeek]);

  // Review countdown (exactly 2 minutes, spec §2.1)
  React.useEffect(() => {
    if (reviewLeft == null) return;
    if (reviewLeft <= 0) {
      if (!doneRef.current) {
        doneRef.current = true;
        onReviewComplete?.();
      }
      return;
    }
    const id = setTimeout(() => setReviewLeft((v) => (v == null ? v : v - 1)), 1000);
    return () => clearTimeout(id);
  }, [reviewLeft, onReviewComplete]);

  function handleEnded() {
    setEnded(true);
    onEnded?.();
    if (strict) setReviewLeft(REVIEW_SEC);
  }

  function handleTimeUpdate() {
    if (endSec != null && endSec > 0 && audioRef.current) {
      if (audioRef.current.currentTime >= endSec && !ended) {
        if (!strict) {
          // In practice mode, let the user continue or pause cleanly
          return;
        }
      }
    }
  }

  if (!strict) {
    return (
      <div className="mt-3 space-y-2">
        <audio
          ref={audioRef}
          controls
          src={activeSrc}
          className="w-full"
          preload="metadata"
          onLoadedMetadata={() => {
            if (startSec != null && startSec > 0) {
              applyStartSeek(startSec);
            }
          }}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        >
          <track kind="captions" />
        </audio>
        {(startSec != null || (timestamps && timestamps.length > 0)) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            {startSec != null && (
              <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 font-medium text-brand">
                <Clock className="size-3" />
                {partLabel ? `${partLabel}: ` : ""}
                {fmt(startSec)}
                {endSec != null ? ` – ${fmt(endSec)}` : ""}
              </span>
            )}
            {timestamps &&
              timestamps.map((ts) => (
                <button
                  key={ts.partNumber}
                  type="button"
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = ts.startSec;
                      void audioRef.current.play().catch(() => {});
                    }
                  }}
                  className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-fg hover:border-brand hover:text-brand transition-colors"
                >
                  {ts.label || `Part ${ts.partNumber}`} ({fmt(ts.startSec)})
                </button>
              ))}
          </div>
        )}
      </div>
    );
  }

  async function playOnce() {
    const el = audioRef.current;
    if (!el || started) return;
    if (startSec != null && startSec > 0) {
      applyStartSeek(startSec);
    }
    setStarted(true);
    try {
      await el.play();
    } catch {
      setStarted(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-[8px] border border-border bg-bg-subtle p-3">
      {/* Hidden audio: no native controls → no pause/seek UI. Volume via control below. */}
      <audio
        ref={audioRef}
        src={activeSrc}
        preload="auto"
        controlsList="nodownload noplaybackrate"
        onLoadedMetadata={() => {
          if (startSec != null && startSec > 0) {
            applyStartSeek(startSec);
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onContextMenu={(e) => e.preventDefault()}
      >
        <track kind="captions" />
      </audio>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={playOnce} disabled={started}>
          <Play />
          {started ? (ended ? "Played once" : "Playing… (once only)") : "Play audio (once only)"}
        </Button>
        {startSec != null && startSec >= 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand tabular-nums">
            <Clock className="size-3" />
            {partLabel ? `${partLabel} · ` : ""}
            {fmt(startSec)}
            {endSec != null ? ` – ${fmt(endSec)}` : ""}
          </span>
        )}
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <Volume2 className="size-4" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={1}
            aria-label="Volume"
            className="h-1 w-28 accent-current"
            onChange={(e) => {
              if (audioRef.current) audioRef.current.volume = Number(e.target.value);
            }}
          />
        </label>
        {reviewLeft != null && reviewLeft > 0 && (
          <span className="ml-auto text-sm font-semibold tabular-nums" aria-live="polite">
            Review: {fmt(reviewLeft)}
          </span>
        )}
        {reviewLeft === 0 && (
          <span className="ml-auto text-sm font-semibold text-warning">
            Review over — moving on…
          </span>
        )}
      </div>
      {!started && (
        <p className="text-xs text-fg-muted">
          Exam mode: audio plays once, no pause / rewind / fast-forward.
        </p>
      )}
    </div>
  );
}
