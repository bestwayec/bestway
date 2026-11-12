"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleAlert, Loader2, Mic, Volume2, Wifi, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { canRecordAudio, classifyLatency, MIN_VOICE_LEVEL, peakLevel, type CheckState } from "@/lib/device-check";
import { assertMicrophoneAvailable, microphoneProblem, requestMicrophoneStream } from "@/lib/microphone";
import { cn } from "@/lib/utils";

type Row = { state: CheckState; detail?: string };

const ICON: Record<CheckState, React.ReactNode> = {
  idle: null,
  running: <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden="true" />,
  ok: <CheckCircle2 className="size-4 text-success" aria-hidden="true" />,
  warn: <CircleAlert className="size-4 text-warning" aria-hidden="true" />,
  fail: <XCircle className="size-4 text-danger" aria-hidden="true" />,
};

/** Plays a short synthetic tone (not exam audio) so the student can confirm the speakers work. */
async function playTestTone(): Promise<void> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("no-audio");
  const ctx = new Ctx();
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    await new Promise((resolve) => setTimeout(resolve, 700));
    osc.stop();
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Opens the microphone for ~2 s and reports the loudest input it heard, then releases it. */
async function measureMicrophone(): Promise<number> {
  assertMicrophoneAvailable();
  const stream = await requestMicrophoneStream({ audio: true });
  const ctx = new AudioContext();
  try {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let peak = 0;
    const until = performance.now() + 2000;
    while (performance.now() < until) {
      analyser.getByteTimeDomainData(buf);
      peak = Math.max(peak, peakLevel(buf));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return peak;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    await ctx.close().catch(() => undefined);
  }
}

/**
 * Optional pre-exam device check. Every result is measured on this device right now, or confirmed by the
 * student (the sound test); nothing is assumed. It never blocks starting the exam.
 */
export function DeviceCheck({ needsMicrophone }: { needsMicrophone: boolean }) {
  const t = useTranslations("mock.deviceCheck");
  const tMic = useTranslations("mock.mic");
  const [net, setNet] = React.useState<Row>({ state: "idle" });
  const [sound, setSound] = React.useState<Row>({ state: "idle" });
  const [mic, setMic] = React.useState<Row>({ state: "idle" });
  const [heardPending, setHeardPending] = React.useState(false);
  const started = net.state !== "idle";

  async function checkNetwork() {
    setNet({ state: "running" });
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNet({ state: "fail", detail: t("netOffline") });
      return;
    }
    const t0 = performance.now();
    try {
      await api.get("/health");
      const ms = Math.round(performance.now() - t0);
      const state = classifyLatency(ms);
      setNet({ state, detail: state === "ok" ? t("netOk", { ms }) : t("netSlow", { ms }) });
    } catch {
      setNet({ state: "fail", detail: t("netFail") });
    }
  }

  async function checkSound() {
    setSound({ state: "running" });
    try {
      await playTestTone();
      setHeardPending(true);
      setSound({ state: "running", detail: t("soundAsk") });
    } catch {
      setSound({ state: "fail", detail: t("soundUnsupported") });
    }
  }

  async function checkMic() {
    if (!canRecordAudio()) {
      setMic({ state: "fail", detail: t("micUnsupported") });
      return;
    }
    setMic({ state: "running", detail: t("micSpeak") });
    try {
      const level = await measureMicrophone();
      setMic(level >= MIN_VOICE_LEVEL ? { state: "ok", detail: t("micOk") } : { state: "warn", detail: t("micSilent") });
    } catch (error) {
      setMic({ state: "fail", detail: tMic(`help.${microphoneProblem(error)}`) });
    }
  }

  async function runAll() {
    // The tone starts inside the click (browsers allow audio only from a user gesture); the request runs alongside.
    await Promise.all([checkSound(), checkNetwork()]);
  }

  const rows: Array<{ id: string; icon: React.ReactNode; label: string; row: Row; action?: React.ReactNode }> = [
    { id: "net", icon: <Wifi className="size-4" aria-hidden="true" />, label: t("net"), row: net },
    {
      id: "sound",
      icon: <Volume2 className="size-4" aria-hidden="true" />,
      label: t("sound"),
      row: sound,
      action: heardPending ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => { setHeardPending(false); setSound({ state: "ok", detail: t("soundHeard") }); }}>
            {t("heardYes")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setHeardPending(false); setSound({ state: "warn", detail: t("soundNotHeard") }); }}>
            {t("heardNo")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void checkSound()}>{t("playAgain")}</Button>
        </div>
      ) : null,
    },
  ];
  if (needsMicrophone) {
    rows.push({
      id: "mic",
      icon: <Mic className="size-4" aria-hidden="true" />,
      label: t("mic"),
      row: mic,
      action: started && mic.state !== "running" ? (
        <Button size="sm" variant="outline" onClick={() => void checkMic()}>
          {mic.state === "idle" ? t("micTest") : t("micRetest")}
        </Button>
      ) : null,
    });
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {!started ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-fg-muted">{t("intro")}</p>
          <Button size="sm" variant="outline" onClick={() => void runAll()}>{t("run")}</Button>
        </div>
      ) : (
        <ul className="space-y-3" aria-live="polite">
          {rows.map(({ id, icon, label, row, action }) => (
            <li key={id} className="space-y-1.5">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-fg-muted">{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium text-fg">
                    <span>{label}</span>
                    {ICON[row.state]}
                  </div>
                  {row.detail && (
                    <p className={cn("text-sm", row.state === "fail" ? "text-danger" : row.state === "warn" ? "text-warning" : "text-fg-muted")}>
                      {row.detail}
                    </p>
                  )}
                </div>
              </div>
              {action && <div className="pl-6">{action}</div>}
            </li>
          ))}
          <li className="pl-6">
            <Button size="sm" variant="ghost" onClick={() => void checkNetwork()} disabled={net.state === "running"}>
              {t("netRetest")}
            </Button>
          </li>
        </ul>
      )}
    </div>
  );
}
