"use client";

export { GamifiedVideoPlayer } from "./GamifiedVideoPlayer";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface VideoPlayerProps {
  src: string;
  autoPlay?: boolean;
  title?: string;
}

const SPEEDS = [0.5, 1, 1.5, 2] as const;
const SEEK_STEP = 5;
const HIDE_DELAY_MS = 2600;

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "00:00";
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function VideoPlayer({ src, autoPlay = false, title }: VideoPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const hideTimer = React.useRef<number | null>(null);
  const blobRef = React.useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState<number>(1);
  const [showControls, setShowControls] = React.useState(true);

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;

  const clearHideTimer = React.useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = React.useCallback(() => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      // Keep controls visible while paused so mobile users can resume.
      const video = videoRef.current;
      if (video && !video.paused) setShowControls(false);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  React.useEffect(() => {
    if (src && src.startsWith("blob:")) {
      blobRef.current = src;
    }
    return () => {
      clearHideTimer();
      if (blobRef.current) {
        try {
          URL.revokeObjectURL(blobRef.current);
        } catch (_) {}
        blobRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [src, clearHideTimer]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  React.useEffect(() => {
    if (autoPlay) {
      // showControls defaults to true — just schedule auto-hide.
      scheduleHide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlay = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, []);

  const seekTo = React.useCallback(
    (next: number) => {
      const video = videoRef.current;
      if (!video || safeDuration <= 0) return;
      const clamped = Math.min(Math.max(next, 0), safeDuration);
      video.currentTime = clamped;
      setCurrentTime(clamped);
    },
    [safeDuration],
  );

  const changeVolume = React.useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, 0), 1);
    setVolume(clamped);
    setMuted(clamped === 0);
  }, []);

  const toggleMute = React.useCallback(() => {
    setMuted((prev) => {
      if (!prev && volume === 0) setVolume(0.5);
      return !prev;
    });
  }, [volume]);

  const cycleSpeed = React.useCallback(() => {
    setPlaybackRate((prev) => {
      const index = SPEEDS.indexOf(prev as (typeof SPEEDS)[number]);
      return SPEEDS[(index + 1) % SPEEDS.length];
    });
  }, []);

  const handleSeekKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        seekTo(currentTime + SEEK_STEP);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        seekTo(currentTime - SEEK_STEP);
      } else if (event.key === "Home") {
        event.preventDefault();
        seekTo(0);
      } else if (event.key === "End") {
        event.preventDefault();
        seekTo(safeDuration);
      }
    },
    [currentTime, safeDuration, seekTo],
  );

  const handleVolumeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        changeVolume(volume + 0.05);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        changeVolume(volume - 0.05);
      }
    },
    [changeVolume, volume],
  );

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      data-slot="video-player"
      className={cn(
        "group relative aspect-video w-full overflow-hidden rounded-[12px] bg-black",
        "focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-within:ring-offset-black",
      )}
      onMouseEnter={() => {
        clearHideTimer();
        setShowControls(true);
      }}
      onMouseLeave={() => {
        if (isPlaying) scheduleHide();
      }}
      onFocus={() => {
        clearHideTimer();
        setShowControls(true);
      }}
      onBlur={() => {
        if (isPlaying) scheduleHide();
      }}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        aria-label={title ?? "Video player"}
        className="size-full cursor-pointer object-contain"
        onClick={() => setShowControls((prev) => !prev)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => {
          setIsPlaying(true);
          scheduleHide();
        }}
        onPause={() => {
          setIsPlaying(false);
          clearHideTimer();
          setShowControls(true);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setShowControls(true);
        }}
      >
        <track kind="captions" srcLang="en" label="English captions" />
      </video>

      {/* Center play affordance while paused */}
      {!isPlaying && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute inset-0 grid place-items-center bg-black/25 transition-colors hover:bg-black/35"
        >
          <span className="grid size-14 place-items-center rounded-full bg-white/95 text-black shadow-lg transition-transform hover:scale-105">
            <Play className="size-6 fill-current" aria-hidden />
          </span>
        </button>
      )}

      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-3 pt-10"
          >
            {title && (
              <p className="mb-2 line-clamp-1 text-left text-sm font-medium text-white/90">{title}</p>
            )}

            {/* Seek */}
            <input
              type="range"
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(safeDuration)}
              aria-valuenow={Math.round(currentTime)}
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(safeDuration)}`}
              min={0}
              max={safeDuration}
              step={0.1}
              value={Number.isFinite(currentTime) ? Math.min(currentTime, safeDuration) : 0}
              disabled={safeDuration <= 0}
              onChange={(event) => seekTo(Number(event.target.value))}
              onKeyDown={handleSeekKeyDown}
              className="mb-2 h-1.5 w-full cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-40"
            />

            <div className="flex items-center gap-1.5 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={isPlaying ? "Pause video" : "Play video"}
                onClick={togglePlay}
                className="shrink-0 text-white hover:bg-white/15 hover:text-white"
              >
                {isPlaying ? <Pause aria-hidden /> : <Play aria-hidden />}
              </Button>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={muted ? "Unmute video" : "Mute video"}
                  aria-pressed={muted}
                  onClick={toggleMute}
                  className="shrink-0 text-white hover:bg-white/15 hover:text-white"
                >
                  <VolumeIcon aria-hidden />
                </Button>
                <input
                  type="range"
                  role="slider"
                  aria-label="Volume"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
                  aria-valuetext={muted ? "Muted" : `${Math.round(volume * 100)} percent`}
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(event) => changeVolume(Number(event.target.value))}
                  onKeyDown={handleVolumeKeyDown}
                  className="hidden h-1 w-20 cursor-pointer accent-white sm:block"
                />
              </div>

              <p className="ml-1 text-xs font-medium text-white/90 tabular-nums" aria-live="off">
                {formatTime(currentTime)} / {formatTime(safeDuration)}
              </p>

              <span className="flex-1" />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Playback speed ${playbackRate}x, activate to change speed`}
                onClick={cycleSpeed}
                className="shrink-0 px-2 text-xs text-white tabular-nums hover:bg-white/15 hover:text-white"
              >
                {playbackRate}x
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
