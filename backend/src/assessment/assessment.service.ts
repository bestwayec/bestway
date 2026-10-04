import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssessmentJob, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AccessService } from '../common/access.service';
import { ExamProgramService } from '../common/exam-program.service';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../videos/storage.service';
import { canonicalChecksum, canonicalStringify } from '../mock/mock-import-validate';
import { ExamRow } from '../mock/mock-shape';
import { roundHalfBand } from '../mock/mock-scoring';
import { AssessmentInput, AssessmentPolicy, AssessmentResult } from './contracts';
import { assessmentBlueprintFailure, audioChecksum, buildAssessmentInput } from './assessment-snapshot';
import { mayFinalizeAutomatically, scoreAssessment, teacherResult } from './assessment-scoring';
import { ReviewAssessmentDto } from './assessment.dto';
import { combineAssessmentResults, validateAssessmentResult } from './result-validation';

export const ASSESSMENT_EXAM_INCLUDE = { sections: { orderBy: { sortOrder: 'asc' as const }, include: { groups: { orderBy: { sortOrder: 'asc' as const }, include: { questions: { orderBy: { sortOrder: 'asc' as const } } } } } } } satisfies Prisma.MockExamInclude;
type Recompute = (tx: Prisma.TransactionClient, attemptId: string) => Promise<unknown>;
const policies: AssessmentPolicy[] = ['MANUAL_ONLY', 'PRACTICE_AUTO_AI', 'FULL_MOCK_AI_WITH_REVIEW'];

function emptyResult(input: AssessmentInput): AssessmentResult {
  return { parts: input.parts.map((part) => ({ id: part.id, rawScore: input.program === 'MULTILEVEL' ? 0 : null, criteria: {}, evidence: {},
    feedback: { taskCoverage: '', grammar: '', vocabulary: '', fluencyCohesion: '', ideaDevelopment: '', register: '', spellingPunctuation: '', strengths: [], issues: [], missedPrompts: [], usefulPhrases: [], forCovered: null, againstCovered: null, position: '', argumentBalance: '' },
  })), overallStrengths: [], priorityImprovements: [], grammarCorrections: [], vocabularyUpgrades: [], improvedExamples: [], recommendedPractice: [], confidence: 0, pronunciationEvidence: 'UNAVAILABLE' };
}

export function assessmentPolicy(configured: string | undefined, override: string | null, fullMock: boolean): AssessmentPolicy {
  const requested = override ?? configured ?? 'MANUAL_ONLY';
  const policy = policies.includes(requested as AssessmentPolicy) ? requested as AssessmentPolicy : 'MANUAL_ONLY';
  // A full mock is never silently finalized under a practice-only policy.
  return fullMock && policy === 'PRACTICE_AUTO_AI' ? 'FULL_MOCK_AI_WITH_REVIEW' : policy;
}

export function feedbackOnly(next: AssessmentResult, previous: AssessmentResult): boolean {
  const facts = (result: AssessmentResult) => ({ confidence: result.confidence, pronunciationEvidence: result.pronunciationEvidence, parts: result.parts.map((p) => ({ id: p.id, rawScore: p.rawScore, criteria: p.criteria, evidence: p.evidence })).sort((a, b) => a.id.localeCompare(b.id)) });
  return canonicalStringify(facts(next)) === canonicalStringify(facts(previous));
}

@Injectable()
export class AssessmentService {
  readonly confidenceThreshold: number;
  readonly maxAttempts: number;
  private readonly base: string;
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly programs: ExamProgramService, private readonly storage: StorageService, private readonly config: ConfigService) {
    this.base = `${config.get<string>('PUBLIC_URL') ?? 'http://localhost:3001'}/v1`;
    this.confidenceThreshold = this.numberSetting('ASSESSMENT_CONFIDENCE_THRESHOLD', 0.85, 0.5, 1);
    this.maxAttempts = this.numberSetting('ASSESSMENT_MAX_ATTEMPTS', 3, 1, 3);
  }

  private numberSetting(name: string, fallback: number, min: number, max: number) {
    const raw = Number(this.config.get<string>(name));
    return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
  }

  /** Called inside the submission transaction after locking its MockAttempt. */
  async enqueueAttempt(tx: Prisma.TransactionClient, attemptId: string, wanted?: string[]) {
    const attempt = await tx.mockAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { exam: { include: ASSESSMENT_EXAM_INCLUDE }, answers: true } });
    const jobs = [];
    for (const section of attempt.exam.sections) {
      if ((section.skill !== 'writing' && section.skill !== 'speaking') || (wanted?.length && !wanted.includes(section.skill))) continue;
      let missingAudio = false;
      const input = await buildAssessmentInput(attempt.exam as unknown as ExamRow, attempt, section.skill, attempt.answers, async (key) => {
        try { return await audioChecksum(this.storage.resolve(key)); }
        catch { missingAudio = true; return 'UNAVAILABLE'; }
      });
      const inputHash = canonicalChecksum(input);
      const policy = assessmentPolicy(this.config.get<string>('ASSESSMENT_POLICY'), attempt.exam.assessmentPolicy, attempt.exam.profile === 'full_mock' || attempt.flowMode === 'full_test');
      const failureCode = missingAudio ? 'ASSESSMENT_AUDIO_MISSING' : assessmentBlueprintFailure(input) ?? (policy === 'MANUAL_ONLY' ? 'MANUAL_POLICY' : null);
      const job = await tx.assessmentJob.upsert({
        where: { attemptId_skill_inputHash_generation: { attemptId, skill: section.skill, inputHash, generation: 0 } }, update: {},
        create: { attemptId, studentId: attempt.studentId, program: input.program, skill: section.skill, inputHash, inputSnapshot: input as unknown as Prisma.InputJsonValue,
          rubricVersion: input.rubricVersion, promptVersion: input.promptVersion, policyMode: policy, status: failureCode ? 'NEEDS_REVIEW' : 'PENDING', failureCode },
      });
      jobs.push(job);
    }
    return jobs;
  }

  /** Public submission hook used by the existing mock controller. */
  async enqueue(attemptId: string, wanted?: string[]) {
    return this.prisma.$transaction((tx) => this.enqueueAttempt(tx, attemptId, wanted));
  }

  async forAttempt(viewer: AuthUser, attemptId: string) {
    const attempt = await this.prisma.mockAttempt.findUnique({ where: { id: attemptId }, include: { exam: { select: { type: true } } } });
    if (!attempt) throw new AppException('MOCK_ATTEMPT_NOT_FOUND', 'Attempt not found', 404);
    await this.access.assertCanViewStudent(viewer, attempt.studentId);
    if (viewer.role === 'student') await this.programs.assertAccess(viewer.id, attempt.exam.type);
    const rows = await this.prisma.assessmentJob.findMany({ where: { attemptId }, include: { evaluations: { where: { status: 'SUCCEEDED' }, orderBy: { completedAt: 'desc' } }, transcripts: { where: { status: 'SUCCEEDED' }, orderBy: { completedAt: 'desc' } } }, orderBy: [{ generation: 'desc' }, { createdAt: 'desc' }] });
    const seen = new Set<string>();
    return { attemptId, assessments: rows.filter((job) => !seen.has(job.skill) && Boolean(seen.add(job.skill))).map((job) => {
      const input = job.inputSnapshot as unknown as AssessmentInput;
      const evaluation = job.evaluations.find((e) => e.id === job.selectedEvaluationId) ?? job.evaluations[0];
      return { id: job.id, skill: job.skill, program: job.program, status: job.status, policyMode: job.policyMode, version: job.version,
        aiScore: job.aiScore, teacherScore: job.teacherScore, finalScore: job.finalScore, finalScoreSource: job.finalScoreSource, confidence: job.confidence, rubricVersion: job.rubricVersion, promptVersion: job.promptVersion,
        failureCode: job.failureCode, teacherReviewed: job.finalScoreSource === 'TEACHER' || job.approvedFeedback !== null,
        evaluation: evaluation?.result ? { result: evaluation.result, provider: evaluation.provider, model: evaluation.model } : null,
        finalResult: job.finalResult,
        approvedFeedback: job.approvedFeedback,
        submissions: input.parts.flatMap((part) => part.responses.map((response) => {
          const transcript = job.transcripts.find((t) => t.questionId === response.questionId && t.audioHash === response.audioHash);
          return { questionId: response.questionId, partId: part.id, partNumber: response.partNumber, prompt: response.prompt, context: part.context,
            originalResponse: response.originalResponse, wordCount: response.originalResponse.trim().split(/\s+/).filter(Boolean).length,
            audioUrl: response.audioKey ? `${this.base}/assessment/jobs/${job.id}/audio/${encodeURIComponent(response.questionId)}` : null,
            transcript: transcript ? { text: transcript.text, confidence: transcript.confidence, segments: transcript.segments, pronunciationEvidence: transcript.pronunciationEvidence } : null };
        })),
        parts: input.parts.map(({ id, max, task, context }) => ({ id, max, task, context })),
      };
    }) };
  }

  async authorizedAudio(viewer: AuthUser, jobId: string, questionId: string) {
    const job = await this.prisma.assessmentJob.findUnique({ where: { id: jobId }, include: { attempt: { include: { exam: { select: { type: true } } } } } });
    if (!job) throw new AppException('ASSESSMENT_NOT_FOUND', 'Assessment not found', 404);
    await this.access.assertCanViewStudent(viewer, job.studentId);
    if (viewer.role === 'student') await this.programs.assertAccess(viewer.id, job.attempt.exam.type);
    const response = (job.inputSnapshot as unknown as AssessmentInput).parts.flatMap((p) => p.responses).find((r) => r.questionId === questionId);
    if (!response?.audioKey || !this.storage.exists(response.audioKey)) throw new AppException('FILE_NOT_FOUND', 'Audio not found', 404);
    return response.audioKey;
  }

  /** All review actions serialize with submissions and worker finalization. */
  async review(actor: AuthUser, jobId: string, dto: ReviewAssessmentDto, recompute: Recompute) {
    if (!['teacher', 'admin', 'super_admin'].includes(actor.role)) throw new AppException('FORBIDDEN', 'Staff access required', 403);
    if (!dto.reason.trim()) throw new AppException('ASSESSMENT_REASON_REQUIRED', 'Review reason is required', 400);
    const before = await this.prisma.assessmentJob.findUnique({ where: { id: jobId } });
    if (!before) throw new AppException('ASSESSMENT_NOT_FOUND', 'Assessment not found', 404);
    await this.access.assertCanViewStudent(actor, before.studentId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MockAttempt" WHERE "id" = ${before.attemptId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "AssessmentJob" WHERE "id" = ${jobId} FOR UPDATE`;
      const job = await tx.assessmentJob.findUniqueOrThrow({ where: { id: jobId }, include: { attempt: true, evaluations: { where: { status: 'SUCCEEDED' }, orderBy: { completedAt: 'desc' } } } });
      if (job.version !== dto.expectedVersion) throw new AppException('ASSESSMENT_STALE_VERSION', 'Assessment changed; refresh before reviewing', 409);
      if (job.attempt.status === 'in_progress') throw new AppException('MOCK_ATTEMPT_NOT_SUBMITTED', 'Attempt has been reopened', 409);
      const latest = await tx.assessmentJob.findFirst({ where: { attemptId: job.attemptId, skill: job.skill }, orderBy: [{ generation: 'desc' }, { createdAt: 'desc' }] });
      if (latest?.id !== job.id) throw new AppException('ASSESSMENT_STALE_VERSION', 'A newer assessment exists', 409);
      const input = job.inputSnapshot as unknown as AssessmentInput;
      const evaluated = job.evaluations.find((e) => e.id === job.selectedEvaluationId) ?? job.evaluations[0];
      const base = (job.finalResult ?? evaluated?.result) as unknown as AssessmentResult | null;
      let updated: AssessmentJob;
      if (dto.action === 'REGRADE') {
        if (job.policyMode === 'MANUAL_ONLY') throw new AppException('ASSESSMENT_MANUAL_POLICY', 'Enable an AI policy before requesting a regrade', 400);
        const running = await tx.assessmentJob.findFirst({ where: { attemptId: job.attemptId, skill: job.skill, status: { in: ['PENDING', 'PROCESSING', 'RETRY'] } } });
        if (running) throw new AppException('ASSESSMENT_ALREADY_RUNNING', 'An assessment is already queued', 409);
        updated = await tx.assessmentJob.create({ data: { attemptId: job.attemptId, studentId: job.studentId, program: job.program, skill: job.skill, inputHash: job.inputHash, inputSnapshot: job.inputSnapshot as Prisma.InputJsonValue,
          generation: job.generation + 1, rubricVersion: job.rubricVersion, promptVersion: job.promptVersion, policyMode: job.policyMode,
          teacherScore: job.teacherScore, finalScore: job.finalScore, finalScoreSource: job.finalScoreSource, ...(job.finalResult ? { finalResult: job.finalResult as Prisma.InputJsonValue } : {}) } });
        await tx.assessmentJob.update({ where: { id: job.id }, data: { version: { increment: 1 } } });
      } else if (dto.action === 'NEEDS_REVIEW') {
        updated = await tx.assessmentJob.update({ where: { id: jobId }, data: { status: 'NEEDS_REVIEW', failureCode: 'TEACHER_REVIEW_REQUESTED', leaseToken: null, leaseExpiresAt: null, version: { increment: 1 } } });
      } else if (dto.action === 'EDIT_FEEDBACK') {
        if (!base || !dto.feedback) throw new AppException('ASSESSMENT_NO_RESULT', 'Feedback is not available', 400);
        // Teacher-approved numeric pronunciation may be present even though the
        // original AI input deliberately has no acoustic pronunciation evidence.
        const validationInput = { ...input, pronunciationEvidence: dto.feedback.pronunciationEvidence };
        const approved = validateAssessmentResult(dto.feedback, validationInput);
        if (!feedbackOnly(approved, base)) throw new AppException('ASSESSMENT_FEEDBACK_SCORE_CHANGE', 'Use score override to change rubric evidence or scores', 400);
        updated = await tx.assessmentJob.update({ where: { id: jobId }, data: { approvedFeedback: approved as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      } else {
        let result: AssessmentResult;
        if (dto.action === 'ACCEPT') {
          if (!base || job.aiScore === null || !['SUCCEEDED', 'NEEDS_REVIEW'].includes(job.status)) throw new AppException('ASSESSMENT_NO_COMPLETE_AI_RESULT', 'A complete AI result is required', 400);
          if (!evaluated?.result) throw new AppException('ASSESSMENT_NO_COMPLETE_AI_RESULT', 'A complete AI result is required', 400);
          // The selected adjudicator is one independent rater. Accept the same
          // combined rubric the worker scored, even after a prior teacher override.
          if (evaluated.role === 'ADJUDICATOR') {
            const primary = job.evaluations.find((evaluation) => evaluation.role === 'PRIMARY');
            if (!primary?.result) throw new AppException('ASSESSMENT_NO_COMPLETE_AI_RESULT', 'Both independent results are required', 400);
            result = combineAssessmentResults(primary.result as unknown as AssessmentResult, evaluated.result as unknown as AssessmentResult, input);
          } else {
            result = validateAssessmentResult(evaluated.result, input);
          }
        } else {
          result = teacherResult(input, base ?? emptyResult(input), dto.parts ?? []);
        }
        const score = scoreAssessment(input, result);
        if (score.score === null) throw new AppException('ASSESSMENT_INVALID_SCORE', 'Complete rubric scores are required', 400);
        const source = dto.action === 'OVERRIDE' ? 'TEACHER' : job.evaluations.some((e) => e.role === 'ADJUDICATOR') ? 'ADJUDICATED' : 'AI';
        await this.projectFinal(tx, job, result, actor.id);
        updated = await tx.assessmentJob.update({ where: { id: jobId }, data: { status: 'SUCCEEDED', failureCode: null, finalScore: score.score, finalScoreSource: source,
          ...(dto.action === 'OVERRIDE' ? { teacherScore: score.score } : {}), finalResult: result as unknown as Prisma.InputJsonValue,
          approvedFeedback: result as unknown as Prisma.InputJsonValue, leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), version: { increment: 1 } } });
        await recompute(tx, job.attemptId);
      }
      await tx.auditLog.create({ data: { userId: actor.id, action: `assessment.${dto.action.toLowerCase()}`, entity: 'AssessmentJob', entityId: job.id,
        oldValue: { finalScore: job.finalScore, teacherScore: job.teacherScore, source: job.finalScoreSource, version: job.version, status: job.status },
        newValue: { finalScore: updated.finalScore, teacherScore: updated.teacherScore, source: updated.finalScoreSource, version: updated.version, reason: dto.reason, newJobId: updated.id } } });
      return { saved: true, jobId: updated.id, version: updated.version, status: updated.status };
    }, { timeout: 20_000 });
  }

  async claim(): Promise<AssessmentJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const expired = await tx.assessmentJob.findMany({ where: { status: 'PROCESSING', leaseExpiresAt: { lt: now } }, include: { evaluations: true, transcripts: true }, take: 20 });
      for (const job of expired) {
        const uncertain = [...job.evaluations, ...job.transcripts].some((c) => c.status === 'STARTED' || c.uncertain);
        const exhausted = job.attemptCount >= this.maxAttempts;
        const retry = !uncertain && !exhausted;
        await tx.assessmentJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseExpiresAt: { lt: now } }, data: { status: retry ? 'RETRY' : 'NEEDS_REVIEW', failureCode: uncertain ? 'PROVIDER_OUTCOME_UNCERTAIN' : exhausted ? 'ASSESSMENT_ATTEMPTS_EXHAUSTED' : 'WORKER_RESTARTED', leaseToken: null, leaseExpiresAt: null, retryAt: retry ? now : null, ...(retry ? {} : { completedAt: now }), version: { increment: 1 } } });
      }
      const ids = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AssessmentJob" WHERE "status" IN ('PENDING', 'RETRY') AND ("retryAt" IS NULL OR "retryAt" <= ${now}) ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!ids.length) return null;
      return tx.assessmentJob.update({ where: { id: ids[0].id }, data: { status: 'PROCESSING', leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 10 * 60_000), startedAt: now, attemptCount: { increment: 1 }, version: { increment: 1 } } });
    });
  }

  async requireLease(job: AssessmentJob, tx: Prisma.TransactionClient = this.prisma) {
    const current = await tx.assessmentJob.findUnique({ where: { id: job.id } });
    if (!current || current.status !== 'PROCESSING' || current.leaseToken !== job.leaseToken || !current.leaseExpiresAt || current.leaseExpiresAt.getTime() < Date.now()) throw new AppException('ASSESSMENT_STALE_LEASE', 'Worker lease is no longer active', 409);
    return current;
  }

  async finish(job: AssessmentJob, result: AssessmentResult, selectedEvaluationId: string, adjudicated: boolean, recompute: Recompute) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MockAttempt" WHERE "id" = ${job.attemptId} FOR UPDATE`;
      const current = await this.requireLease(job, tx);
      const attempt = await tx.mockAttempt.findUniqueOrThrow({ where: { id: job.attemptId } });
      const input = job.inputSnapshot as unknown as AssessmentInput;
      const score = scoreAssessment(input, result);
      const teacherTouched = await tx.mockAnswer.count({ where: { attemptId: job.attemptId, questionId: { in: input.parts.flatMap((p) => p.responses.map((r) => r.questionId)) }, gradedById: { not: null } } });
      const auto = current.finalScoreSource !== 'TEACHER' && teacherTouched === 0 && attempt.status !== 'in_progress' && mayFinalizeAutomatically(job.policyMode, input, result, this.confidenceThreshold);
      if (auto) await this.projectFinal(tx, current, result, null);
      await tx.assessmentJob.update({ where: { id: job.id }, data: { status: auto || current.finalScoreSource === 'TEACHER' ? 'SUCCEEDED' : 'NEEDS_REVIEW', failureCode: score.score === null ? 'PRONUNCIATION_EVIDENCE_UNAVAILABLE' : auto ? null : 'TEACHER_CONFIRMATION_REQUIRED',
        aiScore: score.score, confidence: result.confidence, selectedEvaluationId,
        ...(current.finalScoreSource !== 'TEACHER' ? { finalResult: result as unknown as Prisma.InputJsonValue } : {}),
        ...(auto ? { finalScore: score.score, finalScoreSource: adjudicated ? 'ADJUDICATED' : 'AI', approvedFeedback: result as unknown as Prisma.InputJsonValue } : {}),
        leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), version: { increment: 1 } } });
      if (auto) await recompute(tx, job.attemptId);
    });
  }

  async fail(job: AssessmentJob, code: string, transient: boolean, uncertain: boolean) {
    const retry = transient && !uncertain && job.attemptCount < this.maxAttempts;
    return this.prisma.assessmentJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken }, data: { status: retry ? 'RETRY' : 'NEEDS_REVIEW', failureCode: code,
      retryAt: retry ? new Date(Date.now() + Math.min(5 * 60_000, 15_000 * 2 ** (job.attemptCount - 1))) : null,
      leaseToken: null, leaseExpiresAt: null, ...(retry ? {} : { completedAt: new Date() }), version: { increment: 1 } } });
  }

  private async projectFinal(tx: Prisma.TransactionClient, job: AssessmentJob, result: AssessmentResult, actorId: string | null) {
    const input = job.inputSnapshot as unknown as AssessmentInput;
    const score = scoreAssessment(input, result);
    for (const part of input.parts) {
      const rated = result.parts.find((p) => p.id === part.id)!;
      const partScore = score.parts.find((p) => p.id === part.id)!.score;
      if (partScore === null) throw new AppException('ASSESSMENT_INVALID_SCORE', 'Incomplete rubric cannot be finalized', 400);
      for (const response of part.responses) await tx.mockAnswer.upsert({ where: { attemptId_questionId: { attemptId: job.attemptId, questionId: response.questionId } },
        update: { score: partScore, isGraded: true, gradedById: actorId, rubricScores: rated.criteria as Prisma.InputJsonValue },
        create: { attemptId: job.attemptId, questionId: response.questionId, response: response.originalResponse, audioKey: response.audioKey, score: partScore, isGraded: true, gradedById: actorId, rubricScores: rated.criteria as Prisma.InputJsonValue } });
    }
  }

  /** Preserve legacy teacher controls, recording their selected complete skill. */
  async recordLegacyGrade(tx: Prisma.TransactionClient, attemptId: string, questionId: string) {
    const jobs = await tx.assessmentJob.findMany({ where: { attemptId }, orderBy: [{ generation: 'desc' }, { createdAt: 'desc' }] });
    const job = jobs.find((j) => (j.inputSnapshot as unknown as AssessmentInput).parts.some((p) => p.responses.some((r) => r.questionId === questionId)));
    if (!job) return;
    const input = job.inputSnapshot as unknown as AssessmentInput;
    const answers = await tx.mockAnswer.findMany({ where: { attemptId, questionId: { in: input.parts.flatMap((p) => p.responses.map((r) => r.questionId)) } } });
    if (input.parts.some((p) => p.responses.some((r) => !answers.find((a) => a.questionId === r.questionId)?.isGraded))) return;
    const base = (job.finalResult as unknown as AssessmentResult | null) ?? emptyResult(input);
    const result = { ...base, parts: input.parts.map((part) => {
      const selected = part.responses.map((r) => answers.find((a) => a.questionId === r.questionId)!);
      const mean = selected.reduce((sum, a) => sum + (a.score ?? 0), 0) / selected.length;
      const previous = base.parts.find((p) => p.id === part.id)!;
      const keys = input.skill === 'writing' ? ['ta', 'cc', 'lr', 'gra'] : ['fluency', 'lexical', 'grammar', 'pronunciation'];
      const criteria = Object.fromEntries(keys.map((key) => [key, roundHalfBand(selected.reduce((sum, a) => sum + ((a.rubricScores as Record<string, number> | null)?.[key] ?? a.score ?? 0), 0) / selected.length)]));
      return { ...previous, rawScore: input.program === 'MULTILEVEL' ? roundHalfBand(mean) : null, criteria: input.program === 'MULTILEVEL' ? previous.criteria : criteria };
    }) };
    const score = scoreAssessment(input, result);
    await tx.assessmentJob.update({ where: { id: job.id }, data: { teacherScore: score.score, finalScore: score.score, finalScoreSource: 'TEACHER', finalResult: result as unknown as Prisma.InputJsonValue, status: 'SUCCEEDED', failureCode: null,
      leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), version: { increment: 1 } } });
  }
}
