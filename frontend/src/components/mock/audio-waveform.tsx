"use client";

import { useEffect, useRef } from "react";

const BARS = 28;

/** Live microphone amplitude bars. Renders nothing visible when Web Audio is unavailable. */
export function AudioWaveform({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const Ctx: typeof AudioContext | undefined =
      typeof window === "undefined" ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!el || !stream || !active || !Ctx) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    try {
      ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const g = el.getContext("2d");
      const draw = () => {
        raf = requestAnimationFrame(draw);
        if (!g) return;
        analyser.getByteFrequencyData(data);
        const { width, height } = el;
        g.clearRect(0, 0, width, height);
        const step = width / BARS;
        g.fillStyle = "#10B981";
        for (let i = 0; i < BARS; i++) {
          const level = data[Math.floor((i / BARS) * data.length)] / 255;
          const h = Math.max(3, level * height);
          g.fillRect(i * step + 1, (height - h) / 2, Math.max(2, step - 3), h);
        }
      };
      draw();
    } catch {
      /* decorative only */
    }
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => undefined);
    };
  }, [stream, active]);

  if (!active) return null;
  return <canvas ref={canvas} width={280} height={44} aria-hidden className="h-11 w-full max-w-[280px]" />;
}
