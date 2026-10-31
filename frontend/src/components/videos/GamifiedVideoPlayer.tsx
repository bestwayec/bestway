"use client";

import * as React from "react";
import Hls from "hls.js";
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Gamepad2,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Settings,
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
  hlsSrc?: string;
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

export interface VideoQualityOption {
  index: number;
  label: string;
  height: number;
  bitrate?: number;
}

function formatSeconds(val: number): string {
  if (!Number.isFinite(val) || val < 0) return "00:00";
  const m = Math.floor(val / 60);
  const s = Math.floor(val % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function GamifiedVideoPlayer({
  src,
  hlsSrc,
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
  const hlsRef = React.useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(lessonDuration);
  const [hasMetadata, setHasMetadata] = React.useState(lessonDuration > 0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState<number>(1);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  // HLS Adaptive Streaming & Quality States
  const [qualities, setQualities] = React.useState<VideoQualityOption[]>([]);
  const [selectedQuality, setSelectedQuality] = React.useState<number>(-1); // -1 = Auto
  const [activeQualityLabel, setActiveQualityLabel] = React.useState<string>("Auto");
  const [showQualityMenu, setShowQualityMenu] = React.useState<boolean>(false);
  const [isHlsActive, setIsHlsActive] = React.useState<boolean>(false);

  // Loading, Buffering, stream error and playback tracking
  const [isLoading, setIsLoading] = React.useState(true);
  const [isBuffering, setIsBuffering] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const hasStartedPlayingRef = React.useRef(false);

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

  // Setup HLS or Fallback Video Source
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = 1.0;
    video.muted = false;
    setVolume(1.0);
    setMuted(false);
    setStreamError(null);
    setIsLoading(true);
    setIsBuffering(false);
    if (lessonDuration > 0) {
      setHasMetadata(true);
      setDuration(lessonDuration);
    } else {
      setHasMetadata(false);
    }

    const streamCandidate = hlsSrc || (src && src.includes(".m3u8") ? src : null);

    if (streamCandidate && Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      });

      hls.loadSource(streamCandidate);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setIsHlsActive(true);
        setIsLoading(false);
        setIsBuffering(false);
        if (data.levels && data.levels.length > 0) {
          const parsed: VideoQualityOption[] = data.levels.map((lvl, idx) => ({
            index: idx,
            label: lvl.height ? `${lvl.height}p` : `Level ${idx + 1}`,
            height: lvl.height || 0,
            bitrate: lvl.bitrate,
          }));
          setQualities(parsed);
        } else {
          setQualities([
            { index: 0, label: "480p", height: 480 },
            { index: 1, label: "720p", height: 720 },
            { index: 2, label: "1080p", height: 1080 },
          ]);
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        if (selectedQuality === -1) {
          const lvl = hls.levels[data.level];
          if (lvl && lvl.height) {
            setActiveQualityLabel(`Auto (${lvl.height}p)`);
          } else {
            setActiveQualityLabel("Auto");
          }
        }
      });

      let networkRetryCount = 0;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              networkRetryCount += 1;
              if (networkRetryCount <= 2) {
                hls.startLoad();
              } else {
                // Fallback to direct MP4 stream on network / 404 playlist failure
                hls.destroy();
                hlsRef.current = null;
                setIsHlsActive(false);
                if (video && src) {
                  video.src = src;
                  video.load();
                }
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              hlsRef.current = null;
              setIsHlsActive(false);
              if (video && src) {
                video.src = src;
                video.load();
              }
              break;
          }
        }
      });

      hlsRef.current = hls;

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    } else if (streamCandidate && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamCandidate;
      setIsHlsActive(true);
      setQualities([
        { index: 0, label: "480p", height: 480 },
        { index: 1, label: "720p", height: 720 },
        { index: 2, label: "1080p", height: 1080 },
      ]);
    } else if (src) {
      video.src = src;
      video.load();
      setIsHlsActive(false);
      setQualities([]);
    }
  }, [src, hlsSrc]);

  // 6-Second Timeout Watchdog for Video Metadata / Stream Stalling
  React.useEffect(() => {
    // Only watchdog if loading AND metadata has NOT arrived yet
    if (!isLoading || hasMetadata || duration > 0) return;

    const timer = setTimeout(() => {
      if (isLoading && !hasMetadata && duration <= 0) {
        console.warn("Video metadata loading timed out after 6 seconds; attempting stream recovery.");
        setIsLoading(false);
        setIsBuffering(false);

        const video = videoRef.current;
        if (isHlsActive && hlsRef.current) {
          console.warn("HLS timed out; switching directly to direct MP4 stream.");
          hlsRef.current.destroy();
          hlsRef.current = null;
          setIsHlsActive(false);
          if (video && src) {
            video.src = src;
            video.load();
            return;
          }
        }

        setStreamError("Ushbu darsning video oqimi qayta ishlanmoqda.");
      }
    }, 6000);

    return () => clearTimeout(timer);
  }, [isLoading, hasMetadata, duration, isHlsActive, src]);

  // Handlers for Fallback Recovery
  const handleRetry = () => {
    setStreamError(null);
    setIsLoading(true);
    setIsBuffering(false);
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setIsHlsActive(false);

    if (src) {
      video.src = src;
      video.load();
      handleManualStart();
    }
  };

  const handlePlaySample = () => {
    setStreamError(null);
    setIsLoading(false);
    setIsBuffering(false);
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setIsHlsActive(false);

    // Verified production stream (Lesson 1 - 83MB MP4)
    const sampleUrl = "https://api.bestwayec.uz/v1/lessons/aac8a929-43f3-4516-8a79-09588c2787ba/stream";
    video.src = sampleUrl;
    video.load();
    handleManualStart();
  };

  // Synchronize duration from video metadata and enforce unmuted audio
  const handleLoadedMetadata = () => {
    setIsLoading(false);
    setIsBuffering(false);
    if (videoRef.current) {
      const v = videoRef.current;
      const dur = v.duration;
      if (Number.isFinite(dur) && dur > 0) {
        setDuration(dur);
        setHasMetadata(true);
      }
      v.volume = volume > 0 ? volume : 1.0;
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

  const handleCanPlay = () => {
    setIsLoading(false);
    setIsBuffering(false);
    setStreamError(null);
    if (videoRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
      setHasMetadata(true);
      setDuration(videoRef.current.duration);
    }
  };

  const handleLoadedData = () => {
    setIsLoading(false);
    setIsBuffering(false);
    setStreamError(null);
    if (videoRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
      setHasMetadata(true);
      setDuration(videoRef.current.duration);
    }
  };

  const handlePlaying = () => {
    setIsLoading(false);
    setIsBuffering(false);
    setIsPlaying(true);
    setStreamError(null);
  };

  // Quality Switching Handler
  const handleQualitySelect = (index: number) => {
    setSelectedQuality(index);
    setShowQualityMenu(false);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
    }
    if (index === -1) {
      setActiveQualityLabel("Auto");
    } else {
      const opt = qualities.find((q) => q.index === index);
      setActiveQualityLabel(opt ? opt.label : "Manual");
    }
  };

  // Anti-cheat: Track forward scrubbing
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    // Agar vaqt ketyapti ekan, demak video o'ynayapti, loading/buffering bo'lishi mumkin emas!
    if (isLoading) setIsLoading(false);
    if (isBuffering) setIsBuffering(false);

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

  // Anti-cheat: Auto-pause when tab becomes inactive (only if user actively started watching)
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      const video = videoRef.current;
      if (document.hidden && video && !video.paused && hasStartedPlayingRef.current) {
        video.pause();
        setIsPlaying(false);
        setTabPausedNotice(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Periodic watch progress sync
  React.useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(async () => {
      const video = videoRef.current;
      if (!video) return;

      try {
        await api.post(`/v1/lessons/${lessonId}/progress`, {
          currentTime: Math.floor(video.currentTime),
          maxWatched: Math.floor(maxWatchedRef.current),
        });
      } catch {
        // Silent catch for background progress sync
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [isPlaying, lessonId]);

  // Controls Handlers
  const handleManualStart = async () => {
    setIsLoading(false);
    setIsBuffering(false);
    const video = videoRef.current;
    if (!video) return;

    setTabPausedNotice(false);

    try {
      video.muted = false;
      video.volume = volume > 0 ? volume : 1.0;
      await video.play();
      setIsPlaying(true);
      hasStartedPlayingRef.current = true;
      setTabPausedNotice(false);
    } catch (err) {
      console.warn("Autoplay unmuted blocked by browser policy, falling back to muted play:", err);
      try {
        video.muted = true;
        setMuted(true);
        await video.play();
        setIsPlaying(true);
        hasStartedPlayingRef.current = true;
        setTabPausedNotice(false);
      } catch (innerErr) {
        console.error("Manual playback failed:", innerErr);
        setIsPlaying(false);
      }
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    setTabPausedNotice(false);
    setIsLoading(false);
    setIsBuffering(false);

    if (video.paused) {
      handleManualStart();
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const targetTime = parseFloat(e.target.value);
    if (targetTime <= maxWatchedRef.current + 2) {
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
    } else {
      video.currentTime = maxWatchedRef.current;
      setCurrentTime(maxWatchedRef.current);
      setAntiCheatWarning(true);
      setTimeout(() => setAntiCheatWarning(false), 3000);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
    setMuted(val === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !muted;
    setMuted(nextMuted);
    video.muted = nextMuted;
    if (!nextMuted && volume === 0) {
      setVolume(0.5);
      video.volume = 0.5;
    }
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
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(() => {});
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      }).catch(() => {});
    }
  };

  const handleRewind = () => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, video.currentTime - 10);
    video.currentTime = target;
    setCurrentTime(target);
  };

  // Completion Trigger
  const handleCompleteLesson = async () => {
    if (completedRef.current || isSubmittingCompletion) return;
    completedRef.current = true;
    setIsSubmittingCompletion(true);

    const timeSpent = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000);

    try {
      const res = await api.post(`/v1/lessons/${lessonId}/complete`, {
        watchSeconds: Math.floor(maxWatchedRef.current),
        timeSpentSeconds: timeSpent,
      });

      const payload = (res as any)?.data?.data || (res as any)?.data || (res as any) || {};
      setCompletionData({
        earnedXp: payload.earnedXp ?? xpReward,
        unlockedDeck: payload.unlockedDeck || (tiedDeckId ? { id: tiedDeckId, title: tiedDeckTitle || "Bamboozle Testi" } : null),
      });

      if (onComplete) {
        onComplete(payload);
      }
    } catch {
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
        className="w-full aspect-video object-contain bg-black cursor-pointer"
        onClick={togglePlay}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onSeeking={handleSeeking}
        onEnded={handleCompleteLesson}
        onPlay={() => {
          setIsPlaying(true);
          hasStartedPlayingRef.current = true;
          setTabPausedNotice(false);
          setIsBuffering(false);
          setIsLoading(false);
          setStreamError(null);
        }}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => {
          if (isPlaying) {
            setIsBuffering(true);
          }
        }}
        onPlaying={handlePlaying}
        onCanPlay={handleCanPlay}
        onLoadedData={handleLoadedData}
        onError={(e) => {
          setIsBuffering(false);
          setIsLoading(false);
          console.warn("Video element playback error caught:", e);
          if (isHlsActive && hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
            setIsHlsActive(false);
            if (videoRef.current && src) {
              videoRef.current.src = src;
              videoRef.current.load();
              return;
            }
          }
          setStreamError("Video oqimini yuklashda xatolik yuz berdi");
        }}
        playsInline
        autoPlay={false}
        muted={muted}
        preload="metadata"
      />

      {/* Initial Loading Spinner (FAQAT duration <= 0 va !hasMetadata bo'lganda ko'rinsin) */}
      {isLoading && !hasMetadata && duration <= 0 && !streamError && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 backdrop-blur-[2px]">
          <Loader2 className="size-12 animate-spin text-emerald-400" />
          <span className="text-xs font-semibold text-slate-300 mt-2">Video yuklanmoqda...</span>
        </div>
      )}

      {/* Mid-Playback Buffering Spinner (Faqat video o'ynayotganda kutilmagan to'xtash bo'lsa) */}
      {isPlaying && isBuffering && !streamError && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/20 backdrop-blur-[1px]">
          <Loader2 className="size-10 animate-spin text-emerald-400" />
        </div>
      )}

      {/* Obsidian-Emerald Fallback / Stream Recovery Card */}
      {streamError && !completionData && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0B0F17]/95 p-6 text-center backdrop-blur-md animate-in fade-in duration-300">
          <div className="size-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-[0_0_25px_rgba(245,158,11,0.2)]">
            <AlertTriangle className="size-8" />
          </div>
          <h4 className="text-lg font-bold text-white mb-2">Video oqimi qayta ishlanmoqda</h4>
          <p className="text-xs text-slate-300 max-w-sm mb-6 leading-relaxed">
            {streamError}. Serverda video oqimi tayyorlanmoqda yoki tarmoq uzildi.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              size="sm"
              onClick={handleRetry}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 py-2 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all"
            >
              <RotateCcw className="size-4 mr-2" />
              Qayta urinish
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePlaySample}
              className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 font-medium px-5 py-2 rounded-xl"
            >
              <Play className="size-4 mr-2 fill-emerald-300" />
              Demo darsni ko&apos;rish
            </Button>
          </div>
        </div>
      )}

      {/* Center Big Play Button (Initial / Paused without blur) */}
      {!isPlaying && !tabPausedNotice && !completionData && !streamError && (!isLoading || hasMetadata || duration > 0) && (
        <div
          onClick={handleManualStart}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/35 backdrop-blur-[2px] cursor-pointer group/play transition-all"
        >
          <div className="size-20 rounded-full bg-emerald-500/90 border-2 border-emerald-400 flex items-center justify-center text-slate-950 shadow-[0_0_35px_rgba(16,185,129,0.7)] group-hover/play:scale-110 transition-transform">
            <Play className="size-9 fill-slate-950 ml-1" />
          </div>
          <span className="text-white font-bold text-sm mt-3 bg-slate-950/80 px-4 py-1.5 rounded-full border border-emerald-500/30 backdrop-blur shadow-lg">
            {currentTime > 0 ? "Darsni davom ettirish" : "Darsni boshlash"}
          </span>
        </div>
      )}

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
          className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer text-center p-6 animate-in fade-in duration-200"
        >
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mb-3 animate-pulse">
            <Play className="w-8 h-8 fill-emerald-400 ml-1" />
          </div>
          <h4 className="text-lg font-bold text-white mb-1">Dars Pauzada</h4>
          <p className="text-sm text-slate-300 max-w-sm mb-4">
            Boshqa oynaga o&apos;tilgani uchun video to&apos;xtatildi. Davom ettirish uchun tugmani bosing.
          </p>
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-2 rounded-xl shadow-lg hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all"
          >
            Davom ettirish
          </Button>
        </div>
      )}

      {/* Top Header Overlay */}
      <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between z-10 opacity-90 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2">
          <Badge variant="neutral" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
            LMS Protected
          </Badge>
          {isHlsActive && (
            <Badge variant="neutral" className="bg-teal-500/20 text-teal-300 border-teal-500/30 text-[10px]">
              HLS Adaptive
            </Badge>
          )}
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

          <div className="flex items-center gap-2.5">
            {/* HLS Quality Selector Menu */}
            {(isHlsActive || qualities.length > 0) && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowQualityMenu((prev) => !prev)}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all shadow-sm"
                  title="Video sifatini tanlash (1080p / 720p / 480p / Auto)"
                >
                  <Settings className="w-3 h-3 text-emerald-400" />
                  <span>{activeQualityLabel}</span>
                </button>

                {showQualityMenu && (
                  <div className="absolute bottom-8 right-0 z-40 min-w-[100px] rounded-xl bg-slate-950/95 border border-emerald-500/30 p-1 shadow-2xl backdrop-blur-md flex flex-col gap-0.5 animate-in fade-in zoom-in duration-150">
                    <button
                      type="button"
                      onClick={() => handleQualitySelect(-1)}
                      className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-all flex items-center justify-between ${
                        selectedQuality === -1
                          ? "bg-emerald-500 text-slate-950 font-bold"
                          : "text-slate-300 hover:text-white hover:bg-emerald-500/15"
                      }`}
                    >
                      <span>Auto</span>
                      {selectedQuality === -1 && <span className="text-[10px]">✓</span>}
                    </button>
                    {qualities.map((q) => (
                      <button
                        key={q.index}
                        type="button"
                        onClick={() => handleQualitySelect(q.index)}
                        className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-all flex items-center justify-between ${
                          selectedQuality === q.index
                            ? "bg-emerald-500 text-slate-950 font-bold"
                            : "text-slate-300 hover:text-white hover:bg-emerald-500/15"
                        }`}
                      >
                        <span>{q.label}</span>
                        {selectedQuality === q.index && <span className="text-[10px]">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Playback Speed (Compact cycle on mobile, full row on desktop) */}
            <button
              type="button"
              onClick={() => {
                const nextIdx = (SPEEDS.indexOf(playbackRate as any) + 1) % SPEEDS.length;
                handleRateChange(SPEEDS[nextIdx]);
              }}
              title="Tezlikni o'zgartirish"
              className="flex sm:hidden text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-slate-700 hover:bg-slate-700"
            >
              {playbackRate}x
            </button>
            <div className="hidden sm:flex items-center gap-1">
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
            className="text-xs text-slate-400 hover:text-white"
          >
            Yopish
          </Button>
        </div>
      )}
    </div>
  );
}
