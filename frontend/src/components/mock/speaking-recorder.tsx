"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AudioWaveform } from './audio-waveform';
import { useUploadMockSpeaking } from '@/hooks/use-mock';
import { assertMicrophoneAvailable, createAudioRecorder, microphoneErrorMessage, OPTIMAL_AUDIO_CONSTRAINTS, recordedAudioBlob, recordingFileName } from '@/lib/microphone';
import { markActiveRecording, recordingKey, recoverRecording, releaseRecording, retainRecording } from '@/lib/durable-recordings';

export function SpeakingRecorder({ attemptId, questionId, initialHasAudio }: {
  attemptId: string; questionId: string; initialHasAudio: boolean;
}) {
  const t = useTranslations('mock');
  const tx = useTranslations('mock.runnerUx');
  const tc = useTranslations('common');
  const upload = useUploadMockSpeaking(attemptId);
  const key = recordingKey(attemptId, questionId);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasAudio, setHasAudio] = useState(initialHasAudio);
  const [audioVersion, setAudioVersion] = useState(0);
  const [pending, setPending] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const busy = useRef(false);
  const uploading = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const retained = useRef<Blob | null>(null);
  const uploadRef = useRef(upload.mutateAsync);
  useEffect(() => { uploadRef.current = upload.mutateAsync; }, [upload.mutateAsync]);
  const invalidateCapture = useCallback(() => { generation.current++; }, []);

  const closeMicrophone = useCallback(() => {
    try {
      stream.current?.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
    } catch {}
    stream.current = null;
    setLiveStream(null);
  }, []);

  async function send(blob: Blob) {
    if (uploading.current) return;
    uploading.current = true; busy.current = true; markActiveRecording(key, true);
    if (alive.current) { setSending(true); setError(null); }
    try {
      const form = new FormData(); form.append('audio', blob, recordingFileName(blob));
      await uploadRef.current({ questionId, form });
      await releaseRecording(key); retained.current = null;
      if (alive.current) { setPending(null); setHasAudio(true); setAudioVersion((version) => version + 1); toast.success(tc('saved')); }
      window.dispatchEvent(new CustomEvent('multilevel:recording-uploaded', { detail: { attemptId, questionId } }));
    } catch {
      if (alive.current) setError('Audio upload failed. Your recording has been preserved. Retry the upload.');
    } finally {
      uploading.current = false; busy.current = false; markActiveRecording(key, false);
      if (alive.current) setSending(false);
    }
  }
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });
  const halt = useCallback(() => {
    try {
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.stop();
      }
    } catch {
      closeMicrophone();
      busy.current = false;
      markActiveRecording(key, false);
      if (alive.current) setRecording(false);
    }
  }, [closeMicrophone, key]);

  useEffect(() => {
    alive.current = true;
    const current = generation.current;
    void recoverRecording(key).then((blob) => {
      if (alive.current && generation.current === current && blob) { retained.current = blob; setPending(blob); }
    }).catch(() => { if (alive.current && generation.current === current) setError('Saved recording recovery is unavailable. Keep this page open and retry upload.'); });
    const retry = () => { if (retained.current) void sendRef.current(retained.current); };
    window.addEventListener('mock-stop-recordings', halt);
    window.addEventListener('online', retry);
    return () => {
      alive.current = false; invalidateCapture();
      window.removeEventListener('mock-stop-recordings', halt);
      window.removeEventListener('online', retry);
      halt(); closeMicrophone();
      if (!recorder.current) markActiveRecording(key, false);
    };
  }, [key, halt, closeMicrophone, invalidateCapture]);

  async function start() {
    if (busy.current || retained.current) return;
    busy.current = true; markActiveRecording(key, true); setStarting(true); setError(null);
    const current = generation.current;
    try {
      assertMicrophoneAvailable();
      const input = await navigator.mediaDevices.getUserMedia({ audio: OPTIMAL_AUDIO_CONSTRAINTS });
      if (!alive.current || generation.current !== current) {
        input.getTracks().forEach((track) => { try { track.stop(); } catch {} });
        return;
      }
      stream.current = input; setLiveStream(input);
      const mr = createAudioRecorder(input, { audioBitsPerSecond: 28000 }); recorder.current = mr;
      const chunks: Blob[] = [];
      mr.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      mr.onerror = () => {
        if (alive.current) setError('Recording failed. Check your microphone.');
        try {
          if (mr.state !== 'inactive') mr.stop();
          else { closeMicrophone(); busy.current = false; markActiveRecording(key, false); if (alive.current) setRecording(false); }
        } catch {
          closeMicrophone(); busy.current = false; markActiveRecording(key, false); if (alive.current) setRecording(false);
        }
      };
      mr.onstop = () => {
        closeMicrophone();
        if (alive.current) setRecording(false);
        let blob: Blob;
        try { blob = recordedAudioBlob(mr, chunks); }
        catch (failure) {
          busy.current = false; markActiveRecording(key, false);
          if (alive.current) setError(microphoneErrorMessage(failure));
          return;
        }
        retained.current = blob; if (alive.current) setPending(blob);
        void retainRecording(key, blob).then(() => sendRef.current(blob)).catch(() => {
          busy.current = false; markActiveRecording(key, false);
          if (alive.current) setError('Could not persist the take locally. Keep this page open and retry upload.');
        });
      };
      mr.start(1000); setRecording(true);
    } catch (failure) {
      closeMicrophone(); busy.current = false; markActiveRecording(key, false);
      if (alive.current) { const message = microphoneErrorMessage(failure); setError(message); toast.error(message); }
    } finally {
      if (alive.current && generation.current === current) setStarting(false);
    }
  }

  return <div className="flex flex-wrap items-center gap-3 rounded-[8px] border border-border bg-bg-subtle p-3">
    <p className="w-full text-xs text-fg-muted">{tx(recording ? 'recordingHint' : sending || pending ? 'uploadHint' : hasAudio ? 'uploadedHint' : 'microphoneHint')}</p>
    {recording ? <Button size="sm" variant="danger" className="min-h-[44px] min-w-[44px] px-4 touch-manipulation" onClick={halt}><Square className="fill-current" />{t('stopRecording')}</Button>
      : pending ? <Button size="sm" variant="outline" className="min-h-[44px] min-w-[44px] px-4 touch-manipulation" loading={sending} onClick={() => void send(pending)}>Retry upload of saved recording</Button>
      : <Button size="sm" variant="outline" className="min-h-[44px] min-w-[44px] px-4 touch-manipulation" loading={starting || sending || upload.isPending} onClick={() => void start()}><Mic />{hasAudio ? t('reRecord') : t('record')}</Button>}
    {hasAudio && !recording && <audio key={audioVersion} controls src={`/api/backend/mock/attempts/${attemptId}/answers/${questionId}/audio`} className="h-11 min-h-[44px]" preload="none"><track kind="captions" /></audio>}
    {recording && <AudioWaveform stream={liveStream} active={recording} />}
    {recording && <span className="flex items-center gap-1.5 text-sm text-danger"><span className="size-2 animate-pulse rounded-full bg-danger" />{t('recording')}</span>}
    {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
  </div>;
}
