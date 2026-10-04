import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSpeakingAudio } from './speaking-audio';

describe('speaking upload container validation', () => {
  it('rejects empty, truncated and text files advertised as audio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bestway-audio-'));
    try {
      const path = join(dir, 'take.webm');
      for (const content of ['', 'RIFF', 'not actually an audio recording']) {
        writeFileSync(path, content);
        expect(() => assertSpeakingAudio({ path, size: Buffer.byteLength(content) })).toThrow();
      }
    } finally { unlinkSync(join(dir, 'take.webm')); rmdirSync(dir); }
  });
  it.each(['RIFF0000WAVEdata', 'OggS000000000000', '0000ftypisom0000', 'ID30000000000000'])('recognizes supported container %s without claiming decoding', (content) => {
    const dir = mkdtempSync(join(tmpdir(), 'bestway-audio-'));
    try {
      const path = join(dir, 'take'); writeFileSync(path, content);
      expect(() => assertSpeakingAudio({ path, size: content.length })).not.toThrow();
    } finally { unlinkSync(join(dir, 'take')); rmdirSync(dir); }
  });
});
