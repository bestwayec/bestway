"use client";

import * as React from "react";
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Gamepad2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface GamifiedVideoPlayerProps {
  src: string;
  lessonId: string;
  lessonTitle: string;
  lessonDuration?: number;
  xpReward?: number;
  tiedDeckId?: string;
  tiedDeckTitle?: string;
  onComplete?: (result: any) => void;
  onStartBamboozle?: (deckId: string) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

function formatSeconds(val: number): string {
  if (!Number.isFinite(val) || val < 0) return "00:00";
  const m = Math.floor(val / 60);
  const s = Math.floor(val % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function GamifiedVideoPlayer({
  src,
  lessonId,
  lessonTitle,
  lessonDuration = 0,
  xpReward = 50,
  tiedDeckId,
  tiedDeckTitle,
  onComplete,
  onStartBamboozle,
}: GamifiedVideoPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(lessonDuration);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState<number>(1);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  // Anti-cheat state
  const maxWatchedRef = React.useRef(0);
  const [antiCheatWarning, setAntiCheatWarning] = React.useState(false);
  const [tabPausedNotice, setTabPausedNotice] = React.useState(false);
  const sessionStartTimeRef = React.useRef<number>(Date.now());
  const completedRef = React.useRef(false);

  // Completion modal state
  const [completionData, setCompletionData] = React.useState<{
    earnedXp: number;
    unlockedDeck?: { id: string; title: string; category?: string } | null;
  } | null>(null);
  const [isSubmittingCompletion, setIsSubmittingCompletion] = React.useState(false);

    React.useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = 1.0;
      video.muted = false;
      setVolume(1.0);
      setMuted(false);
    }
  }, [src]);

  // Synchronize duration from video metadata and enforce unmuted audio
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const v = videoRef.current;
      const dur = v.duration;
      if (Number.isFinite(dur) && dur > 0) {
        setDuration(dur);
      }
      v.volume = 1.0;
      v.muted = false;
      setVolume(1.0);
      setMuted(false);
      try {
        const anyVideo = v as any;
        if (anyVideo.audioTracks && anyVideo.audioTracks.length > 0) {
          for (let i = 0; i < anyVideo.audioTracks.length; i++) {
            anyVideo.audioTracks[i].enabled = true;
          }
        }
      } catch {
        // audioTracks API not supported across all browsers
      }
    }
  };

  // Anti-cheat: Track forward scrubbing
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const cur = video.currentTime;
    setCurrentTime(cur);

    if (cur > maxWatchedRef.current) {
      maxWatchedRef.current = cur;
    }

    // Auto-complete if reached end
    const safeDur = duration > 0 ? duration : lessonDuration;
    if (safeDur > 5 && cur >= safeDur * 0.95 && !completedRef.current) {
      handleCompleteLesson();
    }
  };

  // Anti-cheat: Prevent seeking forward past maximum watched timestamp
  const handleSeeking = () => {
    const video = videoRef.current;
    if (!video) return;

    // Allow scrubbing back, but block forward seeking beyond watched horizon (+2s buffer)
    if (video.currentTime > maxWatchedRef.current + 2) {
      video.currentTime = maxWatchedRef.current;
      setCurrentTime(maxWatchedRef.current);
      setAntiCheatWarning(true);
      setTimeout(() => setAntiCheatWarning(false), 3000);
    }
  };

  // Anti-cheat: Auto-pause when tab/window becomes inactive
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      const video = videoRef.current;
      if (document.hidden && video && !video.paused) {
        video.pause();
        setIsPlaying(false);
        setTabPausedNotice(true);
      }
    };

    const handleWindowBlur = () => {
      const video = videoRef.current;
      if (video && !video.paused) {
        video.pause();
        setIsPlaying(false);
        setTabPausedNotice(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    setTabPausedNotice(false);
    if (video.paused) {
      video.volume = muted ? 0 : (volume || 1.0);
      video.muted = muted;
      video
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          // If browser policy prevents unmuted playback without prior interaction, fallback to muted
          video.muted = true;
          setMuted(true);
          video
            .play()
            .then(() => setIsPlaying(true))
            .catch(() => setIsPlaying(false));
        });
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleRewind = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.currentTime - 10);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    const video = videoRef.current;
    if (!video) return;

    if (targetTime > maxWatchedRef.current + 2) {
      // Deny seeking forward
      video.currentTime = maxWatchedRef.current;
      setAntiCheatWarning(true);
      setTimeout(() => setAntiCheatWarning(false), 3000);
    } else {
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    setMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !muted;
    setMuted(nextMuted);
    video.muted = nextMuted;
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Submit lesson completion
  const handleCompleteLesson = async () => {
    if (completedRef.current || isSubmittingCompletion) return;
    completedRef.current = true;
    setIsSubmittingCompletion(true);

    const sessionDuration = Math.round((Date.now() - sessionStartTimeRef.current) / 1000);
    const watchedSeconds = Math.round(maxWatchedRef.current);

    try {
      const res = await api.post<any>(`/v1/lessons/${lessonId}/complete`, {
        sessionDuration,
        watchedSeconds,
      });

      const payload = res.data?.data || res.data || {};
      const earnedXp = payload.earned_xp || xpReward;
      const unlocked = payload.unlocked_deck || (tiedDeckId ? { id: tiedDeckId, title: tiedDeckTitle || "Bamboozle Testi" } : null);

      setCompletionData({ earnedXp, unlockedDeck: unlocked });
      if (onComplete) onComplete(payload);
    } catch {
      // In case of error, still show completion if completedRef was marked
      setCompletionData({
        earnedXp: xpReward,
        unlockedDeck: tiedDeckId ? { id: tiedDeckId, title: tiedDeckTitle || "Bamboozle Testi" } : null,
      });
    } finally {
      setIsSubmittingCompletion(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-2xl overflow-hidden bg-[#0B0F17] border border-emerald-500/20 shadow-2xl group select-none"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        className="w-full aspect-video object-contain bg-black cursor-pointer"
        onClick={togglePlay}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onSeeking={handleSeeking}
        onEnded={handleCompleteLesson}
        playsInline
        autoPlay={false}
        muted={muted}
        preload="auto"
      />

      {/* Unmute button if browser enforced muted playback */}
      {isPlaying && muted && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (videoRef.current) {
              videoRef.current.muted = false;
              videoRef.current.volume = 1.0;
              setVolume(1.0);
              setMuted(false);
            }
          }}
          className="absolute top-16 right-4 z-30 flex items-center gap-2 px-3.5 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-xl transition-all hover:scale-105 animate-pulse"
        >
          <Volume2 className="w-4 h-4" />
          <span>Ovozni yoqish</span>
        </button>
      )}

      {/* Anti-Cheat Toast Warning */}
      {antiCheatWarning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/90 text-slate-950 font-semibold shadow-lg text-sm backdrop-blur-md animate-bounce">
          <AlertTriangle className="w-4 h-4" />
          <span>Oldinga o&apos;tkazish taqiqlangan! Darsni to&apos;liq tomosha qiling.</span>
        </div>
      )}

      {/* Tab Inactive Auto-Pause Notice */}
      {tabPausedNotice && !isPlaying && !completionData && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm cursor-pointer text-center p-6"
        >
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mb-3 animate-pulse">
            <Play className="w-8 h-8 fill-emerald-400 ml-1" />
          </div>
          <h4 className="text-lg font-bold text-white mb-1">Dars Pauzada</h4>
          <p className="text-sm text-slate-300 max-w-sm">
            Boshqa oynaga o&apos;tilgani uchun video to&apos;xtatildi. Davom ettirish uchun ekranni bosing.
          </p>
        </div>
      )}

      {/* Top Header Overlay */}
      <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between z-10 opacity-90 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2">
          <Badge variant="neutral" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
            LMS Protected
          </Badge>
          <span className="text-sm font-semibold text-white drop-shadow truncate max-w-md">
            {lessonTitle}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
          <Sparkles className="w-3.5 h-3.5" />
          <span>+{xpReward} XP</span>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent z-10 flex flex-col gap-2">
        {/* Progress Slider (Scrubber locked to maxWatched) */}
        <div className="relative w-full flex items-center group/scrub">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.5}
            value={currentTime}
            onChange={handleSeekChange}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:h-2.5 transition-all"
          />
          {/* Visual indicator of max watched boundary */}
          <div
            className="absolute h-1.5 bg-emerald-500/30 pointer-events-none rounded-l-lg left-0 top-1/2 -translate-y-1/2"
            style={{ width: `${((maxWatchedRef.current || 0) / (duration || 1)) * 100}%` }}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2 text-white">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={togglePlay}
              className="text-white hover:text-emerald-400 hover:bg-emerald-500/10 p-2"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRewind}
              title="10 soniya orqaga"
              className="text-slate-300 hover:text-white p-2"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>

            {/* Time Display */}
            <span className="text-xs text-slate-300 font-mono ml-1">
              {formatSeconds(currentTime)} / {formatSeconds(duration || lessonDuration)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Playback Speed */}
            <div className="flex items-center gap-1">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleRateChange(s)}
                  className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                    playbackRate === s
                      ? "bg-emerald-500 text-slate-950 font-bold"
                      : "text-slate-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Volume */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="text-slate-300 hover:text-white p-1"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1 bg-slate-700 accent-emerald-500 rounded cursor-pointer hidden sm:block"
              />
            </div>

            {/* Fullscreen */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={toggleFullscreen}
              className="text-slate-300 hover:text-white p-2"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Lesson Complete Celebration Modal */}
      {completionData && (
        <div className="absolute inset-0 z-40 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-300">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/60 flex items-center justify-center text-emerald-400 mb-4 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
            <CheckCircle2 className="w-12 h-12" />
          </div>

          <h3 className="text-2xl font-black text-white mb-2">Dars Yakunlandi!</h3>
          <p className="text-sm text-slate-300 max-w-md mb-4">
            Siz &quot;{lessonTitle}&quot; mavzusidagi videoni to&apos;liq tomosha qilib bo&apos;ldingiz.
          </p>

          <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold mb-6">
            <Award className="w-5 h-5 text-emerald-400" />
            <span>+{completionData.earnedXp} XP Ball Jamg&apos;arildi!</span>
          </div>

          {completionData.unlockedDeck && (
            <div className="w-full max-w-sm p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-500/30 mb-6 flex flex-col items-center">
              <Badge variant="neutral" className="bg-emerald-500/20 text-emerald-400 mb-2">
                🎮 Yangi O&apos;yin Ochildi!
              </Badge>
              <h5 className="font-bold text-white text-base mb-1">{completionData.unlockedDeck.title}</h5>
              <p className="text-xs text-slate-400 mb-3">
                Mavzuni mustahkamlash uchun Bamboozle jamoaviy jangini boshlang.
              </p>
              <Button
                type="button"
                onClick={() => onStartBamboozle?.(completionData.unlockedDeck!.id)}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-2 rounded-lg flex items-center justify-center gap-2"
              >
                <Gamepad2 className="w-4 h-4" />
                <span>Bamboozle O&apos;yinini Boshlash</span>
              </Button>
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            onClick={() => setCompletionData(null)}
            className="text-slate-400 hover:text-white text-sm"
          >
            Yopish
          </Button>
        </div>
      )}
    </div>
  );
}
