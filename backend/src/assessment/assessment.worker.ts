import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { AssessmentJob, Prisma } from '@prisma/client';
import { canonicalChecksum } from '../mock/mock-import-validate';
import { MockGradingService } from '../mock/mock-grading.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../videos/storage.service';
import { AssessmentInput, AssessmentProviderError, AssessmentResult, ProviderEvaluation } from './contracts';
import { DeepSeekAssessmentProvider } from './deepseek.provider';
import { DeepgramSpeechToTextProvider } from './deepgram.provider';
import { AssessmentService } from './assessment.service';
import { audioChecksum } from './assessment-snapshot';
import { scoreAssessment, shouldAdjudicate } from './assessment-scoring';
import { combineAssessmentResults, validateAssessmentResult } from './result-validation';

function sanitizedFailure(error: unknown) {
  return error instanceof AssessmentProviderError ? error : new AssessmentProviderError('ASSESSMENT_INTERNAL_FAILURE', false, true);
}

@Injectable()
export class AssessmentWorker {
  private busy = false;
  constructor(private readonly prisma: PrismaService, private readonly service: AssessmentService, private readonly grader: DeepSeekAssessmentProvider,
    private readonly speech: DeepgramSpeechToTextProvider, private readonly storage: StorageService, private readonly grading: MockGradingService, private readonly config: ConfigService) {}

  @Interval(20_000)
  async tick() {
    if (this.busy || this.config.get<string>('ASSESSMENT_WORKER_ENABLED') === 'false') return;
    this.busy = true;
    try { await this.runOnce(); }
    // Operational failures contain no student text, prompt, key or provider body.
    catch { /* The durable job/lease is recovered by the next worker tick. */ }
    finally { this.busy = false; }
  }

  async runOnce(): Promise<boolean> {
    const job = await this.service.claim();
    if (!job) return false;
    try {
      const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: job.attemptId } });
      if (!attempt || attempt.status === 'in_progress') throw new AssessmentProviderError('ATTEMPT_REOPENED');
      const immutable = job.inputSnapshot as unknown as AssessmentInput;
      if (canonicalChecksum(immutable) !== job.inputHash) throw new AssessmentProviderError('ASSESSMENT_INPUT_HASH_MISMATCH');
      const input: AssessmentInput = JSON.parse(JSON.stringify(immutable));
      if (input.skill === 'speaking') await this.transcribe(job, input);
      const primary = await this.rate(job, input, 'PRIMARY');
      let result = primary.result;
      let selected = primary.id;
      let adjudicated = false;
      if (this.config.get<string>('ASSESSMENT_ADJUDICATION_ENABLED') !== 'false' && shouldAdjudicate(input, result, this.service.confidenceThreshold)) {
        const adjudicator = await this.rate(job, input, 'ADJUDICATOR');
        result = combineAssessmentResults(result, adjudicator.result, input);
        const disagreement = primary.result.parts.some((p) => {
          const other = adjudicator.result.parts.find((r) => r.id === p.id)!;
          if (input.program === 'MULTILEVEL') return p.rawScore !== null && other.rawScore !== null && Math.abs(p.rawScore - other.rawScore) > 1;
          return Object.keys(p.criteria).some((key) => p.criteria[key] !== null && other.criteria[key] !== null && Math.abs(p.criteria[key]! - other.criteria[key]!) > 1.5);
        });
        if (disagreement) result = { ...result, confidence: Math.min(result.confidence, this.service.confidenceThreshold - 0.01) };
        selected = adjudicator.id;
        adjudicated = true;
      }
      await this.service.finish(job, result, selected, adjudicated, (tx, id) => this.grading.recompute(tx, id));
    } catch (error) {
      const failure = sanitizedFailure(error);
      await this.service.fail(job, failure.code, failure.transient, failure.uncertain);
    }
    return true;
  }

  private async refreshLease(job: AssessmentJob) {
    const saved = await this.prisma.assessmentJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken }, data: { leaseExpiresAt: new Date(Date.now() + 10 * 60_000) } });
    if (!saved.count) throw new AssessmentProviderError('ASSESSMENT_STALE_LEASE');
  }

  private async transcribe(job: AssessmentJob, input: AssessmentInput) {
    for (const response of input.parts.flatMap((p) => p.responses)) {
      if (!response.audioKey || !response.audioHash || !response.mimeType) throw new AssessmentProviderError('ASSESSMENT_AUDIO_MISSING');
      await this.refreshLease(job);
      const saved = await this.prisma.speechTranscript.findFirst({ where: { jobId: job.id, questionId: response.questionId, audioHash: response.audioHash, status: 'SUCCEEDED' }, orderBy: { completedAt: 'desc' } });
      if (saved) { response.transcript = saved.text ?? ''; continue; }
      // Regrade reuses transcription of the same immutable recording, scoped to
      // this student's attempt, never a global cross-student content cache.
      const cached = await this.prisma.speechTranscript.findFirst({ where: { job: { attemptId: job.attemptId, studentId: job.studentId }, questionId: response.questionId, audioHash: response.audioHash, status: 'SUCCEEDED' }, orderBy: { completedAt: 'desc' } });
      if (cached) {
        await this.prisma.speechTranscript.create({ data: { jobId: job.id, questionId: response.questionId, audioHash: response.audioHash, attemptNumber: job.attemptCount, status: 'SUCCEEDED',
          text: cached.text, segments: cached.segments as Prisma.InputJsonValue, confidence: cached.confidence, provider: cached.provider, model: cached.model, durationMs: cached.durationMs,
          pronunciationEvidence: cached.pronunciationEvidence, completedAt: new Date() } });
        response.transcript = cached.text ?? ''; continue;
      }
      const audioPath = this.storage.resolve(response.audioKey);
      if (await audioChecksum(audioPath) !== response.audioHash) throw new AssessmentProviderError('ASSESSMENT_AUDIO_CHANGED');
      const transcript = await this.prisma.$transaction(async (tx) => {
        await this.service.requireLease(job, tx);
        return tx.speechTranscript.create({ data: { jobId: job.id, questionId: response.questionId, audioHash: response.audioHash!, attemptNumber: job.attemptCount,
          provider: this.config.get<string>('STT_PROVIDER') ?? 'deepgram', model: this.config.get<string>('STT_MODEL') ?? 'UNCONFIGURED' } });
      });
      try {
        const output = await this.speech.transcribe({ audioPath, mimeType: response.mimeType, language: 'en', durationMs: response.durationMs });
        // The configured ASR adapter has no real acoustic pronunciation signals.
        // Word confidence and timestamps are never promoted to pronunciation.
        await this.prisma.speechTranscript.updateMany({ where: { id: transcript.id, status: 'STARTED' }, data: { status: 'SUCCEEDED', text: output.text, segments: output.segments as unknown as Prisma.InputJsonValue,
          confidence: output.confidence, provider: output.provider, model: output.model, durationMs: output.durationMs, pronunciationEvidence: 'UNAVAILABLE', completedAt: new Date() } });
        response.transcript = output.text;
      } catch (error) {
        const failure = sanitizedFailure(error);
        await this.prisma.speechTranscript.updateMany({ where: { id: transcript.id, status: 'STARTED' }, data: { status: 'FAILED', failureCode: failure.code, uncertain: failure.uncertain, completedAt: new Date() } });
        throw failure;
      }
    }
    input.pronunciationEvidence = 'UNAVAILABLE';
  }

  private async rate(job: AssessmentJob, input: AssessmentInput, role: 'PRIMARY' | 'ADJUDICATOR'): Promise<{ id: string; result: AssessmentResult }> {
    await this.refreshLease(job);
    const cached = await this.prisma.assessmentEvaluation.findFirst({ where: { jobId: job.id, role, status: 'SUCCEEDED' }, orderBy: { completedAt: 'desc' } });
    if (cached) return { id: cached.id, result: validateAssessmentResult(cached.result, input) };
    const evaluation = await this.prisma.$transaction(async (tx) => {
      await this.service.requireLease(job, tx);
      return tx.assessmentEvaluation.create({ data: { jobId: job.id, role, attemptNumber: job.attemptCount, inputHash: canonicalChecksum(input), provider: 'deepseek',
        model: this.config.get<string>(role === 'PRIMARY' ? 'DEEPSEEK_MODEL' : 'DEEPSEEK_ADJUDICATOR_MODEL') ?? 'UNCONFIGURED' } });
    });
    try {
      const output: ProviderEvaluation = await this.grader.assess(input, role);
      const result = validateAssessmentResult(output.result, input);
      await this.prisma.assessmentEvaluation.updateMany({ where: { id: evaluation.id, status: 'STARTED' }, data: { status: 'SUCCEEDED', result: result as unknown as Prisma.InputJsonValue,
        provider: output.provider, model: output.model, confidence: result.confidence, inputTokens: output.inputTokens, outputTokens: output.outputTokens, latencyMs: output.latencyMs, completedAt: new Date() } });
      if (role === 'PRIMARY') await this.prisma.assessmentJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken }, data: { aiScore: scoreAssessment(input, result).score, confidence: result.confidence, selectedEvaluationId: evaluation.id } });
      return { id: evaluation.id, result };
    } catch (error) {
      const failure = sanitizedFailure(error);
      await this.prisma.assessmentEvaluation.updateMany({ where: { id: evaluation.id, status: 'STARTED' }, data: { status: 'FAILED', failureCode: failure.code, uncertain: failure.uncertain, completedAt: new Date() } });
      throw failure;
    }
  }
}
