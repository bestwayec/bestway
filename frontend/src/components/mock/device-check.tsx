"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleAlert, Globe, KeyRound, Loader2, Mic, Volume2, Wifi, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { browserSupport, canRecordAudio, classifyLatency, MIN_VOICE_LEVEL, peakLevel, summarizeNetwork, type CheckState } from "@/lib/device-check";
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

/** Plays a short synthetic tone (never exam audio, so no playback allowance is used) at the chosen volume. */
async function playTestTone(volume: number): Promise<void> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("no-audio");
  const ctx = new Ctx();
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.value = 0.3 * Math.max(0, Math.min(1, volume));
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    await new Promise((resolve) => setTimeout(resolve, 700));
    osc.stop();
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/**
 * Opens the microphone for ~2 s, reports the live level while it listens and the loudest input it
 * heard, then releases the stream. Nothing is recorded or kept.
 */
async function measureMicrophone(onLevel: (level: number) => void): Promise<number> {
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
      const level = peakLevel(buf);
      peak = Math.max(peak, level);
      onLevel(level);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return peak;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    onLevel(0);
    await ctx.close().catch(() => undefined);
  }
}

export type ReadinessSummary = { done: boolean; requiredProblems: number };

/**
 * Pre-exam readiness check. Every result is measured on this device right now, or confirmed by the
 * student (the sound test); nothing is assumed. Required checks are marked as such; the check itself
 * never starts the timed attempt and never touches exam media.
 */
export function DeviceCheck({
  needsMicrophone,
  checkSession = false,
  onSummary,
}: {
  needsMicrophone: boolean;
  /** Also confirm the sign-in is still valid (an authenticated request). */
  checkSession?: boolean;
  onSummary?: (summary: ReadinessSummary) => void;
}) {
  const t = useTranslations("mock.deviceCheck");
  const tMic = useTranslations("mock.mic");
  const [net, setNet] = React.useState<Row>({ state: "idle" });
  const [session, setSession] = React.useState<Row>({ state: "idle" });
  const [browser, setBrowser] = React.useState<Row>({ state: "idle" });
  const [sound, setSound] = React.useState<Row>({ state: "idle" });
  const [mic, setMic] = React.useState<Row>({ state: "idle" });
  const [micLevel, setMicLevel] = React.useState(0);
  const [volume, setVolume] = React.useState(0.8);
  const [heardPending, setHeardPending] = React.useState(false);
  const started = net.state !== "idle";

  async function checkNetwork() {
    setNet({ state: "running" });
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNet({ state: "fail", detail: t("netOffline") });
      return;
    }
    // Three requests, one after another: one reply alone says little about a connection.
    const samples: Array<number | null> = [];
    for (let i = 0; i < 3; i += 1) {
      const t0 = performance.now();
      try {
        await api.get("/health");
        samples.push(Math.round(performance.now() - t0));
      } catch {
        samples.push(null);
      }
    }
    const result = summarizeNetwork(samples);
    if (result.replied === 0) setNet({ state: "fail", detail: t("netFail") });
    else if (result.replied < samples.length) setNet({ state: "warn", detail: t("netUnstable", { replied: result.replied, total: samples.length }) });
    else {
      const state = classifyLatency(result.medianMs);
      setNet({ state, detail: state === "ok" ? t("netOk", { ms: result.medianMs }) : t("netSlow", { ms: result.medianMs }) });
    }
  }

  async function checkSignIn() {
    if (!checkSession) return;
    setSession({ state: "running" });
    try {
      await api.get("/auth/me");
      setSession({ state: "ok", detail: t("sessionOk") });
    } catch {
      setSession({ state: "fail", detail: t("sessionFail") });
    }
  }

  function checkBrowser() {
    const support = browserSupport(needsMicrophone);
    const missing = Object.entries(support).filter(([, ok]) => !ok).map(([name]) => t(`feature.${name}`));
    setBrowser(missing.length ? { state: "fail", detail: t("browserMissing", { list: missing.join(", ") }) } : { state: "ok", detail: t("browserOk") });
  }

  async function checkSound() {
    setSound({ state: "running" });
    try {
      await playTestTone(volume);
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
      const level = await measureMicrophone(setMicLevel);
      setMic(level >= MIN_VOICE_LEVEL ? { state: "ok", detail: t("micOk") } : { state: "warn", detail: t("micSilent") });
    } catch (error) {
      setMic({ state: "fail", detail: tMic(`help.${microphoneProblem(error)}`) });
    }
  }

  async function runAll() {
    checkBrowser();
    // The tone starts inside the click (browsers allow audio only from a user gesture); the requests run alongside.
    await Promise.all([checkSound(), checkNetwork(), checkSignIn()]);
  }

  type Item = { id: string; icon: React.ReactNode; label: string; row: Row; required: boolean; action?: React.ReactNode };
  const rows: Item[] = [
    { id: "browser", icon: <Globe className="size-4" aria-hidden="true" />, label: t("browser"), row: browser, required: true },
    {
      id: "net", icon: <Wifi className="size-4" aria-hidden="true" />, label: t("net"), row: net, required: true,
      action: started && net.state !== "running" && net.state !== "ok" ? (
        <Button size="sm" variant="ghost" onClick={() => void checkNetwork()}>{t("netRetest")}</Button>
      ) : null,
    },
  ];
  if (checkSession) {
    rows.push({
      id: "session", icon: <KeyRound className="size-4" aria-hidden="true" />, label: t("session"), row: session, required: true,
      action: session.state === "fail" ? <Button size="sm" variant="ghost" onClick={() => void checkSignIn()}>{t("retry")}</Button> : null,
    });
  }
  rows.push({
    id: "sound",
    icon: <Volume2 className="size-4" aria-hidden="true" />,
    label: t("sound"),
    row: sound,
    required: false,
    action: (
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <span>{t("volume")}</span>
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label={t("volume")} className="w-28 accent-[var(--color-brand,currentColor)]" />
        </label>
        {heardPending ? (
          <>
            <Button size="sm" variant="outline" onClick={() => { setHeardPending(false); setSound({ state: "ok", detail: t("soundHeard") }); }}>
              {t("heardYes")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setHeardPending(false); setSound({ state: "warn", detail: t("soundNotHeard") }); }}>
              {t("heardNo")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void checkSound()}>{t("playAgain")}</Button>
          </>
        ) : started && sound.state !== "running" ? (
          <Button size="sm" variant="ghost" onClick={() => void checkSound()}>{t("playAgain")}</Button>
        ) : null}
      </div>
    ),
  });
  if (needsMicrophone) {
    rows.push({
      id: "mic",
      icon: <Mic className="size-4" aria-hidden="true" />,
      label: t("mic"),
      row: mic,
      required: true,
      action: started ? (
        <div className="flex flex-wrap items-center gap-3">
          {mic.state !== "running" && (
            <Button size="sm" variant="outline" onClick={() => void checkMic()}>
              {mic.state === "idle" ? t("micTest") : t("micRetest")}
            </Button>
          )}
          {mic.state === "running" && (
            <span className="flex items-center gap-2 text-sm text-fg-muted">
              {t("micLevel")}
              <span className="relative h-2 w-32 overflow-hidden rounded-full bg-bg-subtle" role="meter" aria-label={t("micLevel")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(micLevel * 100)}>
                <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${Math.min(100, Math.round(micLevel * 250))}%` }} />
              </span>
            </span>
          )}
        </div>
      ) : null,
    });
  }

  const requiredRows = rows.filter((item) => item.required);
  const done = started && rows.every((item) => item.row.state !== "running" && item.row.state !== "idle");
  const requiredProblems = requiredRows.filter((item) => item.row.state === "fail" || item.row.state === "idle" || (item.id === "mic" && item.row.state === "warn")).length;
  React.useEffect(() => { onSummary?.({ done, requiredProblems }); }, [done, requiredProblems, onSummary]);

  return (
    <div className="mt-3 border-t border-border pt-3">
      {!started ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-fg-muted">{t("intro")}</p>
          <Button size="sm" variant="outline" onClick={() => void runAll()}>{t("run")}</Button>
        </div>
      ) : (
        <>
          <ul className="space-y-3" aria-live="polite">
            {rows.map(({ id, icon, label, row, action, required }) => (
              <li key={id} className="space-y-1.5" data-check={id} data-check-state={row.state}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-fg-muted">{icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-fg">
                      <span>{label}</span>
                      <span className={cn("rounded-full border px-1.5 text-xs font-medium", required ? "border-border-strong text-fg-muted" : "border-border text-fg-subtle")}>
                        {required ? t("required") : t("recommended")}
                      </span>
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
          </ul>
          {done && (
            <p className={cn("mt-3 rounded-control border px-3 py-2 text-sm", requiredProblems ? "border-warning-border bg-warning-bg text-warning" : "border-success-border bg-success-bg text-success")} data-readiness-summary>
              {requiredProblems ? t("summaryProblems", { count: requiredProblems }) : t("summaryOk")}
            </p>
          )}
          <p className="mt-2 text-xs text-fg-muted">{t("netCaveat")}</p>
        </>
      )}
    </div>
  );
}
