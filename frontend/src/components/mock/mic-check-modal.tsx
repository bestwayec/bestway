"use client";

import * as React from "react";
import { Mic, Square, Play, Pause, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assertMicrophoneAvailable, createAudioRecorder, microphoneErrorMessage, recordedAudioBlob } from "@/lib/microphone";

interface MicCheckModalProps {
  open: boolean;
  onConfirm: () => void;
  onClose?: () => void;
}

export function MicCheckModal({ open, onConfirm, onClose }: MicCheckModalProps) {
  const [step, setStep] = React.useState<"idle" | "recording" | "review" | "error">("idle");
  const [countdown, setCountdown] = React.useState(5);
  const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const audioElemRef = React.useRef<HTMLAudioElement | null>(null);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  const cleanupAudio = React.useCallback(() => {
    if (audioElemRef.current) {
      audioElemRef.current.pause();
      audioElemRef.current.src = "";
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  }, [audioUrl]);

  const stopStream = React.useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!open) {
      if (timerRef.current) clearInterval(timerRef.current);
      stopStream();
      cleanupAudio();
      setStep("idle");
      setCountdown(5);
      setIsPlaying(false);
      setErrorMsg(null);
    }
  }, [open, stopStream, cleanupAudio]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopStream();
      cleanupAudio();
    };
  }, [stopStream, cleanupAudio]);

  const startTest = async () => {
    cleanupAudio();
    setErrorMsg(null);
    setStep("recording");
    setCountdown(5);

    try {
      assertMicrophoneAvailable();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mr = createAudioRecorder(stream);
      recorderRef.current = mr;
      const chunks: Blob[] = [];

      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };

      mr.onerror = () => {
        stopStream();
        setErrorMsg("Ovoz yozishda xatolik yuz berdi.");
        setStep("error");
      };

      mr.onstop = () => {
        stopStream();
        try {
          const blob = recordedAudioBlob(mr, chunks);
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
          setStep("review");
        } catch (err) {
          setErrorMsg(microphoneErrorMessage(err));
          setStep("error");
        }
      };

      mr.start();

      let timeLeft = 5;
      timerRef.current = setInterval(() => {
        timeLeft -= 1;
        setCountdown(timeLeft);
        if (timeLeft <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (mr.state === "recording") {
            mr.stop();
          }
        }
      }, 1000);
    } catch (err) {
      stopStream();
      setErrorMsg(microphoneErrorMessage(err));
      setStep("error");
    }
  };

  const togglePlayback = () => {
    if (!audioElemRef.current || !audioUrl) return;
    if (isPlaying) {
      audioElemRef.current.pause();
      setIsPlaying(false);
    } else {
      audioElemRef.current.play();
      setIsPlaying(true);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Mic className="size-6" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-fg">Mikrofonni sinovdan o&apos;tkazish</h3>
            <p className="text-xs text-fg-muted">Speaking qismidan oldin mikrofoni tekshiring</p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-border/70 bg-bg/50 p-4 text-center">
          {step === "idle" && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-fg-muted">
                Tugmani bosing va 5 soniya davomida mikrofonga biror narsa gapiring.
              </p>
              <Button onClick={startTest} className="w-full">
                <Mic className="mr-2 size-4" />
                Sinovni boshlash (5 soniya)
              </Button>
            </div>
          )}

          {step === "recording" && (
            <div className="space-y-3 py-3">
              <div className="relative mx-auto flex size-20 items-center justify-center rounded-full bg-danger/10 text-danger animate-pulse">
                <Square className="size-8 fill-danger" />
                <span className="absolute text-xl font-bold">{countdown}</span>
              </div>
              <p className="text-sm font-medium text-fg">Ovoz yozilmoqda... Iltimos gapiring ({countdown}s)</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full bg-danger transition-all duration-1000"
                  style={{ width: `${((5 - countdown) / 5) * 100}%` }}
                />
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-center gap-2 text-success">
                <CheckCircle2 className="size-5" />
                <span className="text-sm font-medium">Yozuv tayyor! O&apos;zingizni eshitib ko&apos;ring:</span>
              </div>

              {audioUrl && (
                <div className="flex items-center justify-center gap-3">
                  <audio
                    ref={audioElemRef}
                    src={audioUrl}
                    onEnded={() => setIsPlaying(false)}
                    onPause={() => setIsPlaying(false)}
                  />
                  <Button variant="outline" size="sm" onClick={togglePlayback}>
                    {isPlaying ? <Pause className="mr-1.5 size-4" /> : <Play className="mr-1.5 size-4" />}
                    {isPlaying ? "To'xtatish" : "Eshitib ko'rish"}
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={onConfirm} className="w-full">
                  <CheckCircle2 className="mr-2 size-4" />
                  Ovoz eshitildi — Speakingni boshlash
                </Button>
                <Button variant="ghost" size="sm" onClick={startTest}>
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Qayta sinab ko&apos;rish
                </Button>
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-3 py-2 text-left">
              <div className="flex items-start gap-2 text-danger">
                <AlertTriangle className="size-5 shrink-0 mt-0.5" />
                <p className="text-sm">{errorMsg || "Mikrofon bilan bog'lanishda xatolik yuz berdi."}</p>
              </div>
              <Button onClick={startTest} variant="outline" className="w-full mt-2">
                <RefreshCw className="mr-2 size-4" />
                Qayta urinish
              </Button>
            </div>
          )}
        </div>

        {onClose && step !== "recording" && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-fg-muted hover:text-fg underline-offset-4 hover:underline"
            >
              Yopish
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
