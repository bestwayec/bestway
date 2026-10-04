/* Opt-in synthetic provider smoke gate. Normal CI never calls paid providers. */
const { ConfigService } = require('@nestjs/config');
const { mkdtemp, rm, writeFile } = require('fs/promises');
const { tmpdir } = require('os');
const { join } = require('path');
const { DeepSeekAssessmentProvider } = require('../src/assessment/deepseek.provider');
const { DeepgramSpeechToTextProvider } = require('../src/assessment/deepgram.provider');

const optIn = process.env.RUN_REAL_ASSESSMENT_SMOKE === 'true';
const deepseekReady = Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_BASE_URL && process.env.DEEPSEEK_MODEL);
const sttReady = Boolean(process.env.STT_API_KEY && process.env.STT_BASE_URL && process.env.STT_MODEL && process.env.STT_PROVIDER);
if (!optIn) { console.log('REAL_DEEPSEEK_SMOKE_NOT_RUN'); console.log('REAL_STT_SMOKE_NOT_RUN'); process.exit(0); }
if (!deepseekReady || !sttReady) { console.error('Real provider smoke requested but backend-only DeepSeek/STT configuration is incomplete'); process.exit(2); }

const input = { program: 'MULTILEVEL', skill: 'writing', specificationVersion: 'UZBMB_MULTILEVEL_EN_2026_V1', speakingProfileVersion: null,
  rubricVersion: 'BESTWAY_MULTILEVEL_WRITING_RUBRIC_2026_V1', promptVersion: 'BESTWAY_ASSESSMENT_PROMPT_2026_V1', pronunciationEvidence: 'UNAVAILABLE',
  parts: [{ id: '1.1', max: 5, task: 'Write a short informal email to a friend about a study plan.', context: 'Synthetic smoke fixture only.', responses: [{ questionId: 'synthetic-smoke', prompt: 'Write the email.', originalResponse: 'Hi friend, I will study English this weekend and share my plan.' }] }] };
const config = new ConfigService(process.env);
let temp;
(async () => {
  try {
    const graded = await new DeepSeekAssessmentProvider(config).assess(input, 'PRIMARY');
    console.log(`REAL_DEEPSEEK_SMOKE_PASSED model=${graded.model} confidence=${graded.result.confidence}`);
    temp = await mkdtemp(join(tmpdir(), 'bestway-assessment-smoke-'));
    const wav = Buffer.alloc(16044); wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(16036, 4); wav.write('WAVE', 8, 'ascii'); wav.write('fmt ', 12, 'ascii'); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36, 'ascii'); wav.writeUInt32LE(16000, 40);
    const audio = join(temp, 'synthetic.wav'); await writeFile(audio, wav);
    const transcript = await new DeepgramSpeechToTextProvider(config).transcribe({ audioPath: audio, mimeType: 'audio/wav', language: 'en', durationMs: 1000 });
    console.log(`REAL_STT_SMOKE_PASSED model=${transcript.model} pronunciationEvidence=${transcript.pronunciationEvidence}`);
  } catch (error) { console.error(`REAL_PROVIDER_SMOKE_FAILED ${error?.message ?? 'unknown error'}`); process.exitCode = 1; }
  finally { if (temp) await rm(temp, { recursive: true, force: true }); }
})();
