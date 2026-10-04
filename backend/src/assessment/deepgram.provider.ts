import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'fs/promises';
import { AssessmentProviderError, SpeechToTextProvider, SpeechTranscriptResult } from './contracts';
import { boundedConfig, providerJson, providerRecord, providerUrl } from './provider-http';

@Injectable()
export class DeepgramSpeechToTextProvider implements SpeechToTextProvider {
  constructor(private readonly config: ConfigService) {}

  async transcribe(input: { audioPath: string; mimeType: string; language: string; durationMs?: number }): Promise<SpeechTranscriptResult> {
    const provider = this.config.get<string>('STT_PROVIDER')?.trim().toLowerCase();
    const key = this.config.get<string>('STT_API_KEY')?.trim();
    const model = this.config.get<string>('STT_MODEL')?.trim();
    if (provider !== 'deepgram' || !key || !model) throw new AssessmentProviderError('STT_NOT_CONFIGURED');
    const url = providerUrl(this.config.get<string>('STT_BASE_URL') || 'https://api.deepgram.com/v1', 'listen');
    if (!/^audio\/(webm|ogg|wav|mpeg|mp4|x-wav|x-m4a)(;.*)?$/i.test(input.mimeType) || !/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(input.language)) throw new AssessmentProviderError('STT_INPUT_INVALID');
    let audio: Buffer;
    try {
      const info = await stat(input.audioPath);
      if (!info.isFile() || !info.size || info.size > 25 * 1024 * 1024) throw new AssessmentProviderError('STT_INPUT_INVALID');
      audio = await readFile(input.audioPath);
    } catch (error) { if (error instanceof AssessmentProviderError) throw error; throw new AssessmentProviderError('STT_AUDIO_UNAVAILABLE'); }
    url.searchParams.set('model', model); url.searchParams.set('language', input.language);
    url.searchParams.set('punctuate', 'true'); url.searchParams.set('filler_words', 'true');
    // Candidate recordings are sent as bytes, never as a publicly accessible storage URL.
    url.searchParams.set('mip_opt_out', 'true');
    const response = providerRecord(await providerJson(url, { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': input.mimeType }, body: new Uint8Array(audio) },
      boundedConfig(this.config.get('ASSESSMENT_STT_TIMEOUT_MS'), 90000, 1000, 180000)));
    const results = providerRecord(response.results);
    if (!Array.isArray(results.channels) || results.channels.length !== 1) throw new AssessmentProviderError('STT_RESPONSE_INVALID');
    const channel = providerRecord(results.channels[0]);
    if (!Array.isArray(channel.alternatives) || !channel.alternatives.length) throw new AssessmentProviderError('STT_RESPONSE_INVALID');
    const alternative = providerRecord(channel.alternatives[0]);
    if (typeof alternative.transcript !== 'string' || !alternative.transcript.trim()) throw new AssessmentProviderError('STT_EMPTY_TRANSCRIPT');
    if (alternative.transcript.length > 100000 || !Array.isArray(alternative.words) || alternative.words.length > 20000) throw new AssessmentProviderError('STT_RESPONSE_INVALID');
    const confidence = (value: unknown): number | null => {
      if (value === undefined || value === null) return null;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new AssessmentProviderError('STT_RESPONSE_INVALID');
      return value;
    };
    const metadata = response.metadata ? providerRecord(response.metadata) : {};
    const duration = metadata.duration;
    if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)) throw new AssessmentProviderError('STT_RESPONSE_INVALID');
    const segments = alternative.words.map(item => {
      const word = providerRecord(item);
      if (typeof word.start !== 'number' || typeof word.end !== 'number' || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end < word.start || (typeof duration === 'number' && word.end > duration + 1)) throw new AssessmentProviderError('STT_RESPONSE_INVALID');
      const text = word.punctuated_word ?? word.word;
      if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new AssessmentProviderError('STT_RESPONSE_INVALID');
      return { start: word.start, end: word.end, text, confidence: confidence(word.confidence) };
    });
    return { text: alternative.transcript, confidence: confidence(alternative.confidence), segments, provider: 'deepgram', model,
      durationMs: typeof duration === 'number' ? Math.round(duration * 1000) : input.durationMs ?? null,
      pronunciationEvidence: 'UNAVAILABLE' };
  }
}
