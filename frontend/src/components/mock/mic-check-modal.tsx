"use client";

import * as React from "react";
import { Mic, Square, Play, Pause, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { assertMicrophoneAvailable, createAudioRecorder, microphoneProblem, recordedAudioBlob, requestMicrophoneStream } from "@/lib/microphone";

interface MicCheckModalProps {
  open: boolean;
  onConfirm: () => void;
  onClose?: () => void;
}

export function MicCheckModal({ open, onConfirm, onClose }: MicCheckModalProps) {
  const tm = useTranslations("mock.mic");
  const [step, setStep] = React.useState<"idle" | "recording" | "review" | "error">("idle");
  const [countdown, setCountdown] = React.useState(5);
  const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const audioElemRef = React.useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = React.useRef<string | null>(null);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  const stopStream = React.useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const cleanupAudio = React.useCallback(() => {
    if (audioElemRef.current) {
      audioElemRef.current.pause();
      audioElemRef.current.src = "";
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!open) {
      if (timerRef.current) clearInterval(timerRef.current);
      stopStream();
      cleanupAudio();
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
      const stream = await requestMicrophoneStream({ audio: true });
      streamRef.current = stream;

      const mr = createAudioRecorder(stream);
      recorderRef.current = mr;
      const chunks: Blob[] = [];

      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };

      mr.onerror = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        stopStream();
        setErrorMsg(tm("recordFailed"));
        setStep("error");
      };

      mr.onstop = () => {
        stopStream();
        try {
          const blob = recordedAudioBlob(mr, chunks);
          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          setAudioUrl(url);
          setStep("review");
        } catch (err) {
          setErrorMsg(tm(`help.${microphoneProblem(err)}`));
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
          try {
            if (mr.state === "recording") {
              mr.stop();
            }
          } catch {
            stopStream();
            setStep("error");
          }
        }
      }, 1000);
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current);
      stopStream();
      setErrorMsg(tm(`help.${microphoneProblem(err)}`));
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

  const handleConfirm = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopStream();
    cleanupAudio();
    setStep("idle");
    setCountdown(5);
    setIsPlaying(false);
    setAudioUrl(null);
    setErrorMsg(null);
    onConfirm();
  };

  const handleClose = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopStream();
    cleanupAudio();
    setStep("idle");
    setCountdown(5);
    setIsPlaying(false);
    setAudioUrl(null);
    setErrorMsg(null);
    onClose?.();
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
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand-subtle-fg">
            <Mic className="size-6" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-fg">{tm("title")}</h3>
            <p className="text-xs text-fg-muted">{tm("subtitle")}</p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-border/70 bg-bg/50 p-4 text-center">
          {step === "idle" && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-fg-muted">
                {tm("instructions")}
              </p>
              <Button onClick={startTest} className="w-full min-h-[44px] touch-manipulation">
                <Mic className="mr-2 size-4" />
                {tm("startTest")}
              </Button>
            </div>
          )}

          {step === "recording" && (
            <div className="space-y-3 py-3">
              <div className="relative mx-auto flex size-20 items-center justify-center rounded-full bg-danger/10 text-danger animate-pulse">
                <Square className="size-8 fill-danger" />
                <span className="absolute text-xl font-bold">{countdown}</span>
              </div>
              <p className="text-sm font-medium text-fg">{tm("recording", { seconds: countdown })}</p>
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
                <span className="text-sm font-medium">{tm("ready")}</span>
              </div>

              {audioUrl && (
                <div className="flex items-center justify-center gap-3">
                  <audio
                    ref={audioElemRef}
                    src={audioUrl}
                    onEnded={() => setIsPlaying(false)}
                    onPause={() => setIsPlaying(false)}
                  />
                  <Button variant="outline" size="sm" className="min-h-[44px] px-4 touch-manipulation" onClick={togglePlayback}>
                    {isPlaying ? <Pause className="mr-1.5 size-4" /> : <Play className="mr-1.5 size-4" />}
                    {isPlaying ? "To'xtatish" : "Eshitib ko'rish"}
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={handleConfirm} className="w-full min-h-[44px] touch-manipulation">
                  <CheckCircle2 className="mr-2 size-4" />
                  {tm("confirm")}
                </Button>
                <Button variant="ghost" size="sm" className="min-h-[44px] px-4 touch-manipulation" onClick={startTest}>
                  <RefreshCw className="mr-1.5 size-3.5" />
                  {tm("retest")}
                </Button>
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-3 py-2 text-left">
              <div className="flex items-start gap-2 text-danger">
                <AlertTriangle className="size-5 shrink-0 mt-0.5" />
                <p className="text-sm" role="alert">{errorMsg || tm("help.default")}</p>
              </div>
              <Button onClick={startTest} variant="outline" className="w-full min-h-[44px] mt-2 touch-manipulation">
                <RefreshCw className="mr-2 size-4" />
                {tm("retry")}
              </Button>
              {/* Never trap the student: without a microphone the other sections and Finish stay usable. */}
              <Button onClick={handleConfirm} variant="ghost" className="h-auto min-h-[44px] w-full whitespace-normal px-3 py-2 text-center text-xs text-fg-muted touch-manipulation" data-testid="mic-continue-without">
                {tm("continueWithout")}
              </Button>
            </div>
          )}
        </div>

        {onClose && step !== "recording" && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex min-h-[44px] items-center justify-center px-4 text-xs text-fg-muted hover:text-fg underline-offset-4 hover:underline touch-manipulation"
            >
              {tm("close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
