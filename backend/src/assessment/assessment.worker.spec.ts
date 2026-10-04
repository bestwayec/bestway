import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalChecksum } from '../mock/mock-import-validate';
import { AssessmentProviderError } from './contracts';
import { AssessmentWorker } from './assessment.worker';
import { workflowInput, workflowResult } from './assessment-workflow.fixture';

const audio = vi.hoisted(() => ({ checksum: vi.fn() }));
vi.mock('./assessment-snapshot', async (importOriginal) => ({ ...await importOriginal<typeof import('./assessment-snapshot')>(), audioChecksum: audio.checksum }));

function setup(skill: 'writing' | 'speaking' = 'writing') {
  audio.checksum.mockReset().mockResolvedValue('verified-audio-hash');
  const input = workflowInput(skill);
  const job = { id: 'job', attemptId: 'attempt', studentId: 'student', inputHash: canonicalChecksum(input), inputSnapshot: input,
    skill, program: 'MULTILEVEL', policyMode: 'PRACTICE_AUTO_AI', attemptCount: 1, leaseToken: 'lease', status: 'PROCESSING' };
  type LedgerRow = { id: string; [key: string]: unknown };
  const transcripts: LedgerRow[] = [];
  const evaluations: LedgerRow[] = [];
  const ledger = (rows: LedgerRow[], prefix: string) => ({
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async ({ data }) => { const row = { id: `${prefix}-${rows.length + 1}`, status: 'STARTED', ...data }; rows.push(row); return row; }),
    updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
      const row = rows.find((item) => item.id === where.id && item.status === where.status);
      if (!row) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    }),
    delete: vi.fn(), deleteMany: vi.fn(),
  });
  const tx = { speechTranscript: ledger(transcripts, 'transcript'), assessmentEvaluation: ledger(evaluations, 'evaluation'), assessmentJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  const prisma = { ...tx, mockAttempt: { findUnique: vi.fn().mockResolvedValue({ status: 'grading' }) }, $transaction: vi.fn().mockImplementation(async (callback) => callback(tx)) };
  const service = { confidenceThreshold: 0.85, claim: vi.fn().mockResolvedValue(job), requireLease: vi.fn().mockResolvedValue(job), finish: vi.fn().mockResolvedValue(undefined), fail: vi.fn().mockResolvedValue(undefined) };
  const grader = { assess: vi.fn().mockResolvedValue({ result: workflowResult(input), provider: 'deepseek', model: 'fake-grader', inputTokens: 10, outputTokens: 20, latencyMs: 1 }) };
  const speech = { transcribe: vi.fn().mockResolvedValue({ text: 'My preserved transcript.', segments: [{ start: 0, end: 1, text: 'My', confidence: 0.9 }], confidence: 0.9, provider: 'deepgram', model: 'fake-stt', durationMs: 30000, pronunciationEvidence: 'UNAVAILABLE' }) };
  const storage = { resolve: vi.fn().mockReturnValue('private/original.webm'), delete: vi.fn(), save: vi.fn() };
  const grading = { recompute: vi.fn().mockResolvedValue({}) };
  const config = { get: (name: string) => ({ ASSESSMENT_ADJUDICATION_ENABLED: 'false', STT_PROVIDER: 'deepgram', STT_MODEL: 'fake-stt', DEEPSEEK_MODEL: 'fake-grader' } as Record<string, string>)[name] };
  const worker = new AssessmentWorker(prisma as never, service as never, grader as never, speech as never, storage as never, grading as never, config as never);
  return { worker, input, job, tx, prisma, service, grader, speech, storage, transcripts, evaluations };
}

afterEach(() => vi.restoreAllMocks());

describe('assessment worker provider calls and input integrity', () => {
  it('executes an immutable writing job, persists normalized evidence, and finalizes once', async () => {
    const { worker, service, grader, evaluations, input } = setup();
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(grader.assess).toHaveBeenCalledOnce();
    expect(grader.assess).toHaveBeenCalledWith(input, 'PRIMARY');
    expect(evaluations).toEqual([expect.objectContaining({ status: 'SUCCEEDED', inputHash: canonicalChecksum(input), result: workflowResult(input), provider: 'deepseek', model: 'fake-grader' })]);
    expect(service.finish).toHaveBeenCalledOnce(); expect(service.fail).not.toHaveBeenCalled();
  });

  it('does no work when no durable job is claimable', async () => {
    const { worker, service, grader, speech } = setup();
    service.claim.mockResolvedValue(null as never);
    await expect(worker.runOnce()).resolves.toBe(false);
    expect(grader.assess).not.toHaveBeenCalled(); expect(speech.transcribe).not.toHaveBeenCalled();
  });

  it('rejects altered evidence before either provider is called', async () => {
    const { worker, input, service, grader, speech } = setup('speaking');
    input.parts[0].responses[0].originalResponse = 'Tampered response';
    await worker.runOnce();
    expect(service.fail).toHaveBeenCalledWith(expect.any(Object), 'ASSESSMENT_INPUT_HASH_MISMATCH', false, false);
    expect(grader.assess).not.toHaveBeenCalled(); expect(speech.transcribe).not.toHaveBeenCalled();
  });

  it('does not grade an attempt that was reopened', async () => {
    const { worker, prisma, service, grader } = setup();
    prisma.mockAttempt.findUnique.mockResolvedValue({ status: 'in_progress' });
    await worker.runOnce();
    expect(service.fail).toHaveBeenCalledWith(expect.any(Object), 'ATTEMPT_REOPENED', false, false);
    expect(grader.assess).not.toHaveBeenCalled();
  });

  it('reuses a successful evaluation after restart without a duplicate provider request', async () => {
    const { worker, tx, input, grader, service } = setup();
    tx.assessmentEvaluation.findFirst.mockResolvedValue({ id: 'persisted-evaluation', result: workflowResult(input) } as never);
    await worker.runOnce();
    expect(grader.assess).not.toHaveBeenCalled(); expect(tx.assessmentEvaluation.create).not.toHaveBeenCalled();
    expect(service.finish.mock.calls[0][2]).toBe('persisted-evaluation');
  });

  it.each([['PROVIDER_RATE_LIMITED', true, false], ['PROVIDER_UNAVAILABLE', true, false], ['PROVIDER_TIMEOUT', true, true], ['RESULT_SCHEMA_INVALID', false, false]])('persists %s and delegates bounded retry/review to the durable service', async (code, transient, uncertain) => {
    const { worker, grader, service, evaluations } = setup();
    grader.assess.mockRejectedValue(new AssessmentProviderError(code, transient, uncertain));
    await worker.runOnce();
    expect(evaluations[0]).toMatchObject({ status: 'FAILED', failureCode: code, uncertain });
    expect(service.fail).toHaveBeenCalledWith(expect.any(Object), code, transient, uncertain);
    expect(service.finish).not.toHaveBeenCalled(); expect(grader.assess).toHaveBeenCalledOnce();
  });

  it('sanitizes an unexpected failure without persisting private text', async () => {
    const { worker, grader, service, evaluations } = setup();
    grader.assess.mockRejectedValue(new Error('private essay and api-key'));
    await worker.runOnce();
    expect(service.fail).toHaveBeenCalledWith(expect.any(Object), 'ASSESSMENT_INTERNAL_FAILURE', false, true);
    expect(JSON.stringify(evaluations)).not.toContain('private essay');
  });
});

describe('STT failure and durable evidence preservation', () => {
  it('stores successful transcription, passes it to grading, and preserves the original immutable input', async () => {
    const { worker, input, grader, speech, storage, transcripts } = setup('speaking');
    const before = structuredClone(input);
    await worker.runOnce();
    expect(speech.transcribe).toHaveBeenCalledWith({ audioPath: 'private/original.webm', mimeType: 'audio/webm', language: 'en', durationMs: 30000 });
    expect(transcripts[0]).toMatchObject({ status: 'SUCCEEDED', text: 'My preserved transcript.', pronunciationEvidence: 'UNAVAILABLE', audioHash: 'verified-audio-hash' });
    expect(grader.assess.mock.calls[0][0].parts[0].responses[0].transcript).toBe('My preserved transcript.');
    expect(input).toEqual(before); expect(storage.delete).not.toHaveBeenCalled(); expect(storage.save).not.toHaveBeenCalled();
  });

  it.each([['PROVIDER_TIMEOUT', true, true], ['PROVIDER_UNAVAILABLE', true, false], ['STT_EMPTY_TRANSCRIPT', false, false], ['STT_RESPONSE_INVALID', false, false]])('preserves original audio and records %s for retry/review', async (code, transient, uncertain) => {
    const { worker, speech, service, grader, storage, input, transcripts, tx } = setup('speaking');
    speech.transcribe.mockRejectedValue(new AssessmentProviderError(code, transient, uncertain));
    await worker.runOnce();
    expect(transcripts[0]).toMatchObject({ status: 'FAILED', failureCode: code, uncertain });
    expect(service.fail).toHaveBeenCalledWith(expect.any(Object), code, transient, uncertain);
    expect(input.parts[0].responses[0].audioKey).toBe('mock/student-recording.webm');
    expect(storage.delete).not.toHaveBeenCalled(); expect(storage.save).not.toHaveBeenCalled();
    expect(tx.speechTranscript.delete).not.toHaveBeenCalled(); expect(tx.speechTranscript.deleteMany).not.toHaveBeenCalled();
    expect(grader.assess).not.toHaveBeenCalled();
  });

  it('keeps successful transcription when grading fails and reuses it on retry', async () => {
    const { worker, tx, grader, speech, service, storage, transcripts, input, job } = setup('speaking');
    grader.assess.mockRejectedValueOnce(new AssessmentProviderError('PROVIDER_UNAVAILABLE', true));
    await worker.runOnce();
    expect(transcripts[0]).toMatchObject({ status: 'SUCCEEDED', text: 'My preserved transcript.' });
    expect(service.fail).toHaveBeenCalledWith(expect.any(Object), 'PROVIDER_UNAVAILABLE', true, false);
    tx.speechTranscript.findFirst.mockResolvedValue(transcripts[0] as never);
    job.attemptCount = 2;
    await worker.runOnce();
    expect(speech.transcribe).toHaveBeenCalledOnce();
    expect(tx.speechTranscript.create).toHaveBeenCalledOnce(); expect(transcripts[0].text).toBe('My preserved transcript.');
    expect(grader.assess).toHaveBeenCalledTimes(2); expect(service.finish).toHaveBeenCalledOnce();
    expect(input.parts[0].responses[0].audioKey).toBe('mock/student-recording.webm'); expect(storage.delete).not.toHaveBeenCalled();
  });

  it('scopes transcription reuse to the same student attempt and immutable recording', async () => {
    const { worker, tx, input, speech, transcripts } = setup('speaking');
    tx.speechTranscript.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ text: 'Prior generation transcript', segments: [], confidence: 0.9, provider: 'deepgram', model: 'fake-stt', durationMs: 30000, pronunciationEvidence: 'UNAVAILABLE' } as never);
    await worker.runOnce();
    expect(tx.speechTranscript.findFirst.mock.calls[1][0].where).toEqual({ job: { attemptId: 'attempt', studentId: 'student' }, questionId: 'question', audioHash: input.parts[0].responses[0].audioHash, status: 'SUCCEEDED' });
    expect(speech.transcribe).not.toHaveBeenCalled();
    expect(transcripts[0]).toMatchObject({ status: 'SUCCEEDED', text: 'Prior generation transcript', jobId: 'job' });
  });

  it('detects changed audio before an STT request and preserves its storage key', async () => {
    const { worker, speech, storage, input, service } = setup('speaking');
    audio.checksum.mockResolvedValue('different-audio-hash');
    await worker.runOnce();
    expect(service.fail).toHaveBeenCalledWith(expect.any(Object), 'ASSESSMENT_AUDIO_CHANGED', false, false);
    expect(speech.transcribe).not.toHaveBeenCalled(); expect(storage.delete).not.toHaveBeenCalled();
    expect(input.parts[0].responses[0].audioKey).toBe('mock/student-recording.webm');
  });
});
