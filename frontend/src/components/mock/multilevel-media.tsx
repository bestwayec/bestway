"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordingKey, recoverRecording, retainRecording, releaseRecording, markActiveRecording } from '@/lib/durable-recordings';
import { assertMicrophoneAvailable, createAudioRecorder, microphoneErrorMessage, recordedAudioBlob } from '@/lib/microphone';

export interface MediaPhase { startedAt: string; prepEndsAt: string; expiresAt: string; plays: number; serverTime: string; playLimit: number }
function seconds(iso: string, offset: number) { return Math.max(0, Math.ceil((Date.parse(iso) - Date.now() - offset)/1000)); }
function recorderStatus(status: string, recorded: boolean) {
  if (recorded) return 'Uploaded';
  return ({ idle: 'Microphone required', checking: 'Preparing', starting: 'Preparing', ready: 'Ready', preparing: 'Preparing', recording: 'Recording', finalizing: 'Preparing upload', uploading: 'Uploading', saved: 'Complete', retry: 'Retry required' } as Record<string, string>)[status] ?? 'Preparing';
}

/** Server grants each play; only volume is adjustable during timed playback. */
export function MultilevelListening({ prepare, play, load }: {
  prepare: () => Promise<MediaPhase>; play: () => Promise<MediaPhase>; load: () => Promise<Blob>;
}) {
  const [phase, setPhase] = useState<MediaPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const offset = useRef(0);
  const blobUrl = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); }, []);
  useEffect(() => {
    if (!phase) return;
    const tick = () => { const remaining = seconds(playing ? phase.expiresAt : phase.prepEndsAt, offset.current); setLeft(remaining); if (playing && remaining === 0) setPlaying(false); };
    tick(); const id = window.setInterval(tick, 250); return () => clearInterval(id);
  }, [phase, playing]);
  async function start() {
    setBusy(true); setError(null);
    try { const next = await prepare(); offset.current = Date.parse(next.serverTime)-Date.now(); setPhase(next); setPlaying(next.plays > 0 && seconds(next.expiresAt, offset.current) > 0); }
    catch { setError('Audio could not be prepared. Please try again.'); }
    finally { setBusy(false); }
  }
  async function playAudio() {
    setBusy(true); setError(null);
    try {
      const next = await play(); setPhase(next); offset.current = Date.parse(next.serverTime)-Date.now();
      if (!blobUrl.current) { blobUrl.current = URL.createObjectURL(await load()); setSrc(blobUrl.current); }
      const el = audio.current;
      if (!el) throw new Error('Audio element unavailable');
      el.src = blobUrl.current; el.currentTime = 0; await el.play(); setPlaying(true);
    } catch { setError('Audio could not be loaded or played. Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="my-3 space-y-2 rounded-lg border border-current/20 p-3">
    <audio ref={audio} src={src ?? undefined} onEnded={() => setPlaying(false)} onError={() => setError('Audio failed to play. Contact your supervisor.')}><track kind="captions" /></audio>
    {!phase ? <button type="button" disabled={busy} onClick={() => void start()}>Preview this part</button> : <>
      <p role="status">{playing ? 'Playing' : left > 0 ? 'Preview' : 'Ready'} · {left}s · {phase.plays}/{phase.playLimit} plays</p>
      <button type="button" disabled={busy || playing || left > 0 || phase.plays >= phase.playLimit} onClick={() => void playAudio()}>Play audio</button>
    </>}
    <label className="block text-sm">Volume <input aria-label="Audio volume" type="range" min="0" max="1" step="0.05" defaultValue="1" onChange={(e) => { if (audio.current) audio.current.volume = Number(e.target.value); }} /></label>
    {busy && <p role="status">Loading audio…</p>}{error && <p role="alert">{error}</p>}
  </div>;
}

/** Microphone preflight, server timing, durable takes and upload acknowledgement. */
export function MultilevelRecorder({ attemptId, questionId, timed, initialHasAudio, startPhase, upload, onUploaded }: {
  attemptId: string; questionId: string; timed: boolean; initialHasAudio: boolean;
  startPhase: () => Promise<MediaPhase>; upload: (blob: Blob) => Promise<unknown>; onUploaded?: () => void;
}) {
  const key = recordingKey(attemptId, questionId);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Blob | null>(null);
  const [recorded, setRecorded] = useState(initialHasAudio);
  const [phase, setPhase] = useState<MediaPhase | null>(null);
  const [left, setLeft] = useState(0);
  const [level, setLevel] = useState(0);
  const [meterAvailable, setMeterAvailable] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const offset = useRef(0);
  const uploadRef = useRef(upload); uploadRef.current = upload;
  const context = useRef<AudioContext | null>(null);
  const meterFrame = useRef<number | null>(null);
  const onUploadedRef = useRef(onUploaded); onUploadedRef.current = onUploaded;
  const retainedRef = useRef<Blob | null>(null);
  const uploading = useRef(false);
  const busy = useRef(false);
  const aliveRef = useRef(true);
  const captureGeneration = useRef(0);
  const invalidateCapture = useCallback(() => { captureGeneration.current++; }, []);
  const stage = useCallback((next: string) => {
    busy.current = ['checking','starting','preparing','recording','finalizing','uploading'].includes(next);
    markActiveRecording(key, busy.current);
    setStatus(next);
  }, [key]);
  const closeMeter = useCallback(() => {
    if (meterFrame.current !== null) cancelAnimationFrame(meterFrame.current);
    meterFrame.current = null;
    const ctx = context.current; context.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }, []);
  const closeMicrophone = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    closeMeter();
  }, [closeMeter]);
  async function send(blob: Blob) {
    if (uploading.current) return;
    uploading.current = true; stage('uploading'); setError(null);
    try { await uploadRef.current(blob); await releaseRecording(key); retainedRef.current = null; setPending(null); setRecorded(true); stage('saved'); onUploadedRef.current?.(); window.dispatchEvent(new CustomEvent("multilevel:recording-uploaded", { detail: { attemptId, questionId } })); }
    catch { stage('retry'); setError('Audio upload failed. Your recording has been preserved.'); }
    finally { uploading.current = false; }
  }
  const sendRef = useRef(send); sendRef.current = send;
  useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    void recoverRecording(key).then((blob) => { if (alive && blob) { retainedRef.current = blob; setPending(blob); setStatus('retry'); } }).catch(() => { if (alive) setError('Saved recording recovery is unavailable. Keep this page open and retry the upload.'); });
    const retry = () => { if (retainedRef.current) void sendRef.current(retainedRef.current); };
    window.addEventListener('online', retry);
    return () => { alive = false; aliveRef.current = false; invalidateCapture(); window.removeEventListener('online', retry); if (recorder.current?.state === 'recording') { stage('finalizing'); recorder.current.stop(); } else markActiveRecording(key, false); closeMicrophone(); };
  }, [key, stage, closeMicrophone, invalidateCapture]);
  useEffect(() => {
    if (!phase) return;
    const id = window.setInterval(() => {
      const remaining = seconds(status === 'preparing' ? phase.prepEndsAt : phase.expiresAt, offset.current); setLeft(remaining);
      if (seconds(phase.prepEndsAt, offset.current) <= 0 && status === 'preparing') beginRecording();
      if (seconds(phase.expiresAt, offset.current) <= 0 && recorder.current?.state === 'recording') { stage('finalizing'); recorder.current.stop(); }
    }, 200);
    return () => clearInterval(id);
    // beginRecording uses refs; phase/status identify the current stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, status]);
  async function preflight() {
    if (busy.current) return;
    stage('checking'); setError(null); setMeterAvailable(false); setLevel(0);
    const current = ++captureGeneration.current;
    let input: MediaStream;
    try {
      closeMicrophone();
      assertMicrophoneAvailable();
      input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current || captureGeneration.current !== current) { input.getTracks().forEach((track) => track.stop()); return; }
      stream.current = input;
      // Verify capture support before the server starts a timed response.
      recorder.current = createAudioRecorder(stream.current);
      stage('ready');
    } catch (e) {
      if (!aliveRef.current || captureGeneration.current !== current) return;
      closeMicrophone(); stage('idle');
      setError(microphoneErrorMessage(e));
      return;
    }
    // The input meter is optional; Web Audio failure must not discard an open mic.
    let meterContext: AudioContext | undefined;
    try {
      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return;
      const ctx = new AudioContextConstructor(); context.current = ctx; meterContext = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      if (!aliveRef.current || context.current !== ctx) return;
      if (ctx.state !== 'running') { closeMeter(); return; }
      const analyser = ctx.createAnalyser(); ctx.createMediaStreamSource(input).connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      const meter = () => {
        if (context.current !== ctx || ctx.state === 'closed') return;
        if (ctx.state !== 'running') { setMeterAvailable(false); closeMeter(); return; }
        analyser.getByteTimeDomainData(buffer);
        setLevel(Math.max(...buffer.map((v) => Math.abs(v-128))) / 128);
        meterFrame.current = requestAnimationFrame(meter);
      };
      setMeterAvailable(true); meter();
    } catch {
      if (captureGeneration.current === current && aliveRef.current) {
        if (context.current === meterContext) closeMeter();
        setMeterAvailable(false);
      }
    }
  }
  function beginRecording() {
    if (!stream.current || recorder.current?.state === 'recording') return;
    try {
    const mr = recorder.current?.state === 'inactive' ? recorder.current : createAudioRecorder(stream.current); recorder.current = mr;
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onerror = () => { stage('finalizing'); setError('Recording failed. Check your microphone.'); if (mr.state === 'recording') mr.stop(); };
    mr.onstop = () => {
      stage('finalizing'); closeMicrophone();
      let blob: Blob;
      try { blob = recordedAudioBlob(mr, chunks); }
      catch (e) { stage('idle'); setError(`${microphoneErrorMessage(e)}${timed ? ' Contact your supervisor for a timed retry.' : ''}`); return; }
      retainedRef.current = blob; setPending(blob);
      void retainRecording(key, blob).then(() => sendRef.current(blob)).catch(() => { stage('retry'); setError('Could not persist the take locally. Keep this page open and retry upload.'); });
    };
    mr.start(1000); stage('recording');
    } catch (e) { closeMicrophone(); stage('idle'); setError(microphoneErrorMessage(e)); }
  }
  async function start() {
    if (busy.current) return;
    stage('starting'); setError(null);
    const current = captureGeneration.current;
    try { const next = await startPhase();
      if (!aliveRef.current || captureGeneration.current !== current) return;
      offset.current = Date.parse(next.serverTime)-Date.now(); setPhase(next);
      if (timed && seconds(next.expiresAt, offset.current) <= 0) throw new Error('This speaking response has expired.');
      if (timed) stage('preparing'); else beginRecording();
    } catch { if (aliveRef.current && captureGeneration.current === current) { closeMicrophone(); stage('idle'); setError('Speaking response could not be started. Please try again.'); } }
  }
  return <div className="my-3 space-y-3 rounded-[10px] border border-current/20 bg-bg-subtle p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="font-semibold text-fg">{recorderStatus(status, recorded)}</p>
      {phase && <p className="rounded-[8px] bg-surface px-3 py-1.5 text-2xl font-bold tabular-nums text-fg" aria-label={`${left} seconds remaining`}>{left}s</p>}
    </div>
    {status === 'recording' && <p className="flex items-center gap-2 text-sm font-medium text-danger"><span className="size-2 animate-pulse rounded-full bg-danger" />Recording in progress</p>}
    {!pending && !(timed && recorded) && <>
      <button className="rounded-[8px] border border-border bg-surface px-3 py-2 text-sm font-medium text-fg disabled:opacity-50" type="button" disabled={['checking','starting','preparing','recording','finalizing','uploading'].includes(status)} onClick={() => void preflight()}>Test microphone</button>
      {status === 'ready' && <>{meterAvailable ? <><meter className="block w-full" aria-label="Microphone input level" min="0" max="1" value={level} /><p className="text-sm text-fg-muted">Speak and check that the meter responds.</p></> : <p className="text-sm text-fg-muted">Microphone access is ready. The input meter is unavailable in this browser; you can still record.</p>}<button className="rounded-[8px] bg-brand px-3 py-2 text-sm font-semibold text-white" type="button" onClick={() => void start()}>Start response</button></>}
      {status === 'recording' && !timed && <button className="rounded-[8px] bg-danger px-3 py-2 text-sm font-semibold text-white" type="button" onClick={() => recorder.current?.stop()}>Stop recording</button>}
    </>}
    {pending && <button className="rounded-[8px] border border-border bg-surface px-3 py-2 text-sm font-medium text-fg disabled:opacity-50" type="button" disabled={status === 'uploading'} onClick={() => void send(pending)}>Retry upload of saved recording</button>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
