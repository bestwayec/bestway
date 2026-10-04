import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessService } from '../common/access.service';
import { ExamProgramService } from '../common/exam-program.service';
import { AuthUser } from '../common/types';
import { multilevelFixture } from '../mock/multilevel.fixture';
import { scoreAssessment } from './assessment-scoring';
import { AssessmentService, assessmentPolicy } from './assessment.service';
import { workflowInput, workflowResult } from './assessment-workflow.fixture';

const actor = (id = 'teacher', role: AuthUser['role'] = 'teacher') => ({ id, role, name: 'Test', phone: '', studentProfile: null } satisfies AuthUser);

function setup(policy = 'PRACTICE_AUTO_AI') {
  const input = workflowInput();
  const result = workflowResult(input);
  const job = { id: 'job', attemptId: 'attempt', studentId: 'student', program: 'MULTILEVEL', skill: 'writing', inputHash: 'input-hash', inputSnapshot: input,
    rubricVersion: input.rubricVersion, promptVersion: input.promptVersion, policyMode: policy, status: 'NEEDS_REVIEW', version: 2, generation: 0,
    attemptCount: 1, leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 60000), aiScore: scoreAssessment(input, result).score,
    teacherScore: null, finalScore: null, finalScoreSource: null, finalResult: null, approvedFeedback: null, selectedEvaluationId: 'evaluation', failureCode: null,
    attempt: { id: 'attempt', status: 'grading', exam: { type: 'multilevel' } }, evaluations: [{ id: 'evaluation', role: 'PRIMARY', result, provider: 'deepseek', model: 'fake-model' }], transcripts: [],
  };
  const update = vi.fn().mockImplementation(async ({ data }) => {
    for (const [key, value] of Object.entries(data)) {
      (job as Record<string, unknown>)[key] = value && typeof value === 'object' && 'increment' in value
        ? Number((job as Record<string, unknown>)[key]) + Number(value.increment) : value;
    }
    return job;
  });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    mockAttempt: { findUnique: vi.fn().mockResolvedValue({ id: 'attempt', studentId: 'student', exam: { type: 'multilevel' } }), findUniqueOrThrow: vi.fn().mockResolvedValue(job.attempt) },
    assessmentJob: { findUnique: vi.fn().mockResolvedValue(job), findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ ...job })), findFirst: vi.fn().mockImplementation(async ({ where }) => where.status ? null : job), findMany: vi.fn().mockResolvedValue([job]), update, updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockImplementation(async ({ data }) => ({ ...job, ...data, id: 'regrade', version: 1 })) },
    mockAnswer: { upsert: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    studentProfile: { findUnique: vi.fn().mockResolvedValue({ availablePrograms: ['MULTILEVEL'], group: { teacherId: 'teacher' } }) },
  };
  const prisma = { ...tx, $transaction: vi.fn().mockImplementation(async (callback) => callback(tx)) };
  const storage = { exists: vi.fn().mockReturnValue(true), resolve: vi.fn().mockReturnValue('private/audio.webm'), delete: vi.fn() };
  const service = new AssessmentService(prisma as never, new AccessService(prisma as never), new ExamProgramService(prisma as never), storage as never, { get: (name: string) => name === 'ASSESSMENT_POLICY' ? policy : undefined } as never);
  const recompute = vi.fn().mockResolvedValue({});
  return { input, result, job, tx, prisma, storage, service, recompute };
}

afterEach(() => vi.useRealTimers());

describe('durable assessment retries', () => {
  it('retries known transient failures with bounded backoff and stops at max attempts', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T00:00:00Z'));
    const { service, tx, job } = setup();
    for (let attemptCount = 1; attemptCount <= 3; attemptCount++) {
      await service.fail({ ...job, attemptCount } as never, 'PROVIDER_RATE_LIMITED', true, false);
      const { where, data } = tx.assessmentJob.updateMany.mock.lastCall![0];
      expect(where).toEqual({ id: job.id, status: 'PROCESSING', leaseToken: 'lease' });
      expect(data.status).toBe(attemptCount < 3 ? 'RETRY' : 'NEEDS_REVIEW');
      expect(data.retryAt).toEqual(attemptCount < 3 ? new Date(Date.now() + 15000 * 2 ** (attemptCount - 1)) : null);
      expect(data.leaseToken).toBeNull();
    }
  });

  it.each([['PROVIDER_TIMEOUT', true, true], ['PROVIDER_AUTH_FAILED', false, false], ['RESULT_SCHEMA_INVALID', false, false]])('sends %s directly to review without repeat charged calls', async (code, transient, uncertain) => {
    const { service, tx, job } = setup();
    await service.fail(job as never, code, transient, uncertain);
    expect(tx.assessmentJob.updateMany.mock.lastCall![0].data).toMatchObject({ status: 'NEEDS_REVIEW', failureCode: code, retryAt: null, leaseToken: null, completedAt: expect.any(Date) });
  });

  it('recovers an expired uncertain provider attempt into review without claiming it again', async () => {
    const { service, tx, job } = setup();
    tx.assessmentJob.findMany.mockResolvedValue([{ ...job, status: 'PROCESSING', evaluations: [{ status: 'STARTED', uncertain: false }], transcripts: [] }] as never);
    await expect(service.claim()).resolves.toBeNull();
    expect(tx.assessmentJob.updateMany.mock.lastCall![0].data).toMatchObject({ status: 'NEEDS_REVIEW', failureCode: 'PROVIDER_OUTCOME_UNCERTAIN' });
    expect(tx.assessmentJob.update).not.toHaveBeenCalled();
  });

  it('does not restart an expired job after its bounded attempt budget is exhausted', async () => {
    const { service, tx, job } = setup();
    tx.assessmentJob.findMany.mockResolvedValue([{ ...job, status: 'PROCESSING', attemptCount: 3, evaluations: [{ status: 'FAILED', uncertain: false }], transcripts: [] }] as never);
    await service.claim();
    expect(tx.assessmentJob.updateMany.mock.lastCall![0].data.status).toBe('NEEDS_REVIEW');
  });

  it('rejects a stale lease before a worker can project a final score', async () => {
    const { service, tx, job, result, recompute } = setup();
    job.status = 'PROCESSING'; job.leaseToken = 'teacher-replaced-lease';
    await expect(service.finish({ ...job, leaseToken: 'old-lease' } as never, result, 'evaluation', false, recompute)).rejects.toMatchObject({ code: 'ASSESSMENT_STALE_LEASE' });
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });
});

describe('submission identity and manual fallback', () => {
  function enqueueSetup(policy: string) {
    const state = setup(policy);
    const sections = multilevelFixture().filter((section) => section.skill === 'writing').map((section) => ({ ...section, sortOrder: 0, groups: section.groups.map((group, index) => ({ ...group, id: `group-${index}`, title: 'Synthetic task', questions: group.questions.map((question, qi) => ({ ...question, id: `question-${index}-${qi}`, sortOrder: qi })) })) }));
    const attempt = { id: 'attempt', studentId: 'student', flowMode: 'section', specificationVersion: 'test-specification', speakingProfileVersion: null, mediaState: {}, exam: { type: 'multilevel', profile: 'practice', assessmentPolicy: null, sections }, answers: sections.flatMap((section) => section.groups.flatMap((group) => group.questions.map((question) => ({ questionId: question.id, response: 'Original response' })))) };
    state.tx.mockAttempt.findUniqueOrThrow.mockResolvedValue(attempt as never);
    const rows = new Map<string, unknown>();
    const upsert = vi.fn().mockImplementation(async ({ where, create }) => {
      const key = JSON.stringify(where.attemptId_skill_inputHash_generation);
      if (!rows.has(key)) rows.set(key, { id: `job-${rows.size}`, ...create });
      return rows.get(key);
    });
    Object.assign(state.tx.assessmentJob, { upsert });
    return { ...state, attempt, upsert, rows };
  }

  it('repeated submission uses the same attempt/skill/input-hash/generation identity', async () => {
    const { service, attempt, upsert, rows } = enqueueSetup('PRACTICE_AUTO_AI');
    const first = await service.enqueue(attempt.id);
    const duplicate = await service.enqueue(attempt.id);
    expect(duplicate).toEqual(first); expect(rows.size).toBe(1);
    expect(upsert.mock.calls[0][0].where).toEqual(upsert.mock.calls[1][0].where);
    expect(upsert.mock.calls[0][0].update).toEqual({});
    expect(upsert.mock.calls[0][0].create.status).toBe('PENDING');
  });

  it('changed original evidence gets a new input hash without changing the prior snapshot', async () => {
    const { service, attempt, upsert, rows } = enqueueSetup('PRACTICE_AUTO_AI');
    await service.enqueue(attempt.id);
    attempt.answers[0].response = 'Changed original evidence';
    await service.enqueue(attempt.id);
    expect(rows.size).toBe(2);
    expect(upsert.mock.calls[0][0].create.inputHash).not.toBe(upsert.mock.calls[1][0].create.inputHash);
    expect(upsert.mock.calls[0][0].create.inputSnapshot.parts[0].responses[0].originalResponse).toBe('Original response');
  });

  it('manual-only creates a durable review job preserving original evidence', async () => {
    const { service, attempt, upsert } = enqueueSetup('MANUAL_ONLY');
    await service.enqueue(attempt.id);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ policyMode: 'MANUAL_ONLY', status: 'NEEDS_REVIEW', failureCode: 'MANUAL_POLICY' });
    expect(upsert.mock.calls[0][0].create.inputSnapshot.parts[0].responses[0].originalResponse).toBe('Original response');
  });

  it('promotes a practice policy to review mode for a full mock', () => {
    expect(assessmentPolicy('PRACTICE_AUTO_AI', null, true)).toBe('FULL_MOCK_AI_WITH_REVIEW');
    expect(assessmentPolicy('unknown-policy', null, false)).toBe('MANUAL_ONLY');
  });
});

describe('scoped assessment access', () => {
  it('allows an enrolled student to read their own assessment', async () => {
    const { service, tx } = setup();
    await expect(service.forAttempt(actor('student', 'student'), 'attempt')).resolves.toMatchObject({ attemptId: 'attempt', assessments: [{ id: 'job' }] });
    expect(tx.studentProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'student' }, select: { availablePrograms: true, activeProgram: true } });
  });

  it('denies cross-student reads before retrieving any assessment', async () => {
    const { service, tx } = setup();
    await expect(service.forAttempt(actor('other-student', 'student'), 'attempt')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(tx.assessmentJob.findMany).not.toHaveBeenCalled();
  });

  it('denies revoked enrollment for assessment and original audio', async () => {
    const { service, tx, input, job } = setup();
    input.parts[0].responses[0].audioKey = 'mock/original.webm'; job.inputSnapshot = input;
    tx.studentProfile.findUnique.mockResolvedValue({ availablePrograms: [], group: { teacherId: 'teacher' } });
    for (const request of [service.forAttempt(actor('student', 'student'), 'attempt'), service.authorizedAudio(actor('student', 'student'), 'job', 'question')]) {
      await expect(request).rejects.toMatchObject({ code: 'PROGRAM_NOT_ENROLLED', status: 403 });
    }
  });

  it('permits the assigned teacher and denies an unrelated teacher', async () => {
    const { service, tx } = setup();
    await expect(service.forAttempt(actor(), 'attempt')).resolves.toMatchObject({ attemptId: 'attempt' });
    tx.assessmentJob.findMany.mockClear();
    await expect(service.forAttempt(actor('outside-teacher'), 'attempt')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(tx.assessmentJob.findMany).not.toHaveBeenCalled();
  });

  it('denies another student access to protected original audio', async () => {
    const { service, storage } = setup();
    await expect(service.authorizedAudio(actor('other-student', 'student'), 'job', 'question')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(storage.exists).not.toHaveBeenCalled();
  });
});

describe('teacher review and audit history', () => {
  it('overrides with deterministic scores, projects and recomputes in the locked transaction, and records old/new values with reason', async () => {
    const { service, tx, job, input, recompute } = setup();
    const expected = scoreAssessment(input, workflowResult(input, 3)).score;
    await expect(service.review(actor(), job.id, { action: 'OVERRIDE', expectedVersion: 2, reason: 'Teacher checked the original response', parts: [{ id: '1.1', rawScore: 3 }] }, recompute)).resolves.toEqual({ saved: true, jobId: 'job', version: 3, status: 'SUCCEEDED' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.mockAnswer.upsert.mock.calls[0][0].update).toMatchObject({ score: 3, isGraded: true, gradedById: 'teacher' });
    expect(recompute).toHaveBeenCalledWith(tx, 'attempt');
    expect(job).toMatchObject({ teacherScore: expected, finalScore: expected, finalScoreSource: 'TEACHER', leaseToken: null });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'teacher', action: 'assessment.override', entityId: 'job', oldValue: expect.objectContaining({ finalScore: null, version: 2 }), newValue: expect.objectContaining({ finalScore: expected, source: 'TEACHER', version: 3, reason: 'Teacher checked the original response' }) }) });
  });

  it('rejects students and unrelated teachers before review mutation', async () => {
    const { service, prisma, recompute } = setup();
    const dto = { action: 'NEEDS_REVIEW' as const, expectedVersion: 2, reason: 'Review' };
    await expect(service.review(actor('student', 'student'), 'job', dto, recompute)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(service.review(actor('outside-teacher'), 'job', dto, recompute)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['stale-version', 'reopened', 'newer-job'])('rejects %s review without projection or audit', async (caseName) => {
    const { service, tx, job, recompute } = setup();
    if (caseName === 'reopened') job.attempt.status = 'in_progress';
    if (caseName === 'newer-job') tx.assessmentJob.findFirst.mockResolvedValue({ id: 'new-job' } as never);
    await expect(service.review(actor(), 'job', { action: 'NEEDS_REVIEW', expectedVersion: caseName === 'stale-version' ? 1 : 2, reason: 'Review' }, recompute)).rejects.toMatchObject({ status: 409 });
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('manual-only rejects a provider regrade but allows a teacher override', async () => {
    const { service, tx, recompute } = setup('MANUAL_ONLY');
    await expect(service.review(actor(), 'job', { action: 'REGRADE', expectedVersion: 2, reason: 'Try AI' }, recompute)).rejects.toMatchObject({ code: 'ASSESSMENT_MANUAL_POLICY' });
    expect(tx.assessmentJob.create).not.toHaveBeenCalled();
    await expect(service.review(actor(), 'job', { action: 'OVERRIDE', expectedVersion: 2, reason: 'Manual grading', parts: [{ id: '1.1', rawScore: 4 }] }, recompute)).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('accepts a complete AI result only through staff review and leaves original submission fields intact', async () => {
    const { service, tx, recompute } = setup('FULL_MOCK_AI_WITH_REVIEW');
    await service.review(actor(), 'job', { action: 'ACCEPT', expectedVersion: 2, reason: 'Verified rubric' }, recompute);
    expect(tx.assessmentJob.update.mock.calls[0][0].data).toMatchObject({ finalScoreSource: 'AI', approvedFeedback: expect.any(Object) });
    const projected = tx.mockAnswer.upsert.mock.calls[0][0];
    expect(projected.update).not.toHaveProperty('response'); expect(projected.update).not.toHaveProperty('audioKey');
    expect(projected.create.response).toBe('My original response.');
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('assessment.accept');
  });

  it.each([false, true])('accepts the independent-rater mean rather than only the selected adjudicator (prior teacher result: %s)', async (previousTeacherResult) => {
    const { service, tx, job, input, recompute } = setup('FULL_MOCK_AI_WITH_REVIEW');
    const combined = workflowResult(input, 4.5);
    const expected = scoreAssessment(input, combined).score;
    job.evaluations = [
      { id: 'adjudicator', role: 'ADJUDICATOR', result: workflowResult(input, 5), provider: 'deepseek', model: 'fake-second-rater' },
      { id: 'primary', role: 'PRIMARY', result: workflowResult(input, 4), provider: 'deepseek', model: 'fake-first-rater' },
    ];
    job.selectedEvaluationId = 'adjudicator';
    Object.assign(job, { aiScore: expected, finalResult: previousTeacherResult ? workflowResult(input, 3) : combined,
      ...(previousTeacherResult ? { finalScoreSource: 'TEACHER', finalScore: scoreAssessment(input, workflowResult(input, 3)).score, teacherScore: scoreAssessment(input, workflowResult(input, 3)).score, status: 'SUCCEEDED' } : {}) });
    await service.review(actor(), 'job', { action: 'ACCEPT', expectedVersion: 2, reason: 'Accept independent-rater assessment' }, recompute);
    expect(tx.mockAnswer.upsert.mock.calls[0][0].update.score).toBe(4.5);
    expect(job).toMatchObject({ finalScore: expected, finalScoreSource: 'ADJUDICATED' });
  });

  it('retains separate audit entries with their historical old values for repeated teacher overrides', async () => {
    const { service, tx, input, recompute } = setup();
    await service.review(actor(), 'job', { action: 'OVERRIDE', expectedVersion: 2, reason: 'First reading', parts: [{ id: '1.1', rawScore: 3 }] }, recompute);
    await service.review(actor(), 'job', { action: 'OVERRIDE', expectedVersion: 3, reason: 'Second reading with rubric', parts: [{ id: '1.1', rawScore: 4 }] }, recompute);
    const first = tx.auditLog.create.mock.calls[0][0].data;
    const second = tx.auditLog.create.mock.calls[1][0].data;
    expect(first).toMatchObject({ oldValue: { finalScore: null, version: 2 }, newValue: { finalScore: scoreAssessment(input, workflowResult(input, 3)).score, version: 3, reason: 'First reading' } });
    expect(second).toMatchObject({ oldValue: { finalScore: scoreAssessment(input, workflowResult(input, 3)).score, version: 3 }, newValue: { finalScore: scoreAssessment(input, workflowResult(input, 4)).score, version: 4, reason: 'Second reading with rubric' } });
  });

  it('feedback edit preserves score facts and blocks disguised score changes', async () => {
    const { service, tx, result, recompute } = setup();
    const feedback = structuredClone(result); feedback.parts[0].feedback.grammar = 'Teacher explanation';
    await service.review(actor(), 'job', { action: 'EDIT_FEEDBACK', expectedVersion: 2, reason: 'Clearer feedback', feedback }, recompute);
    expect(tx.assessmentJob.update.mock.calls[0][0].data).toMatchObject({ approvedFeedback: expect.any(Object) });
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled(); expect(recompute).not.toHaveBeenCalled();
    feedback.parts[0].rawScore = 5;
    await expect(service.review(actor(), 'job', { action: 'EDIT_FEEDBACK', expectedVersion: 3, reason: 'Hidden override', feedback }, recompute)).rejects.toMatchObject({ code: 'ASSESSMENT_FEEDBACK_SCORE_CHANGE' });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
});

describe('worker finalization guards', () => {
  it('finalizes a confident practice result through the deterministic projection', async () => {
    const { service, tx, job, result, recompute } = setup(); job.status = 'PROCESSING';
    await service.finish(job as never, result, 'evaluation', false, recompute);
    expect(job).toMatchObject({ status: 'SUCCEEDED', finalScoreSource: 'AI', finalScore: scoreAssessment(job.inputSnapshot, result).score, leaseToken: null });
    expect(tx.mockAnswer.upsert).toHaveBeenCalledOnce(); expect(recompute).toHaveBeenCalledWith(tx, 'attempt');
  });

  it('keeps a full mock pending teacher confirmation even for a confident complete result', async () => {
    const { service, tx, job, result, recompute } = setup('FULL_MOCK_AI_WITH_REVIEW'); job.status = 'PROCESSING';
    await service.finish(job as never, result, 'evaluation', false, recompute);
    expect(job).toMatchObject({ status: 'NEEDS_REVIEW', failureCode: 'TEACHER_CONFIRMATION_REQUIRED', aiScore: expect.any(Number), finalScore: null });
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled(); expect(recompute).not.toHaveBeenCalled();
  });

  it('preserves existing teacher scores and final rubric when a regrade finishes', async () => {
    const { service, tx, job, input, result, recompute } = setup(); job.status = 'PROCESSING';
    const teacherResult = workflowResult(input, 3);
    const teacherScore = scoreAssessment(input, teacherResult).score;
    Object.assign(job, { finalScoreSource: 'TEACHER', finalScore: teacherScore, teacherScore, finalResult: teacherResult });
    await service.finish(job as never, result, 'evaluation', false, recompute);
    expect(job).toMatchObject({ status: 'SUCCEEDED', finalScoreSource: 'TEACHER', finalScore: teacherScore, teacherScore, finalResult: teacherResult, aiScore: scoreAssessment(input, result).score });
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled(); expect(recompute).not.toHaveBeenCalled();
  });

  it('cannot overwrite legacy teacher grading even when the job has no teacher projection yet', async () => {
    const { service, tx, job, result, recompute } = setup(); job.status = 'PROCESSING';
    tx.mockAnswer.count.mockResolvedValue(1);
    await service.finish(job as never, result, 'evaluation', false, recompute);
    expect(job).toMatchObject({ status: 'NEEDS_REVIEW', finalScore: null });
    expect(tx.mockAnswer.upsert).not.toHaveBeenCalled(); expect(recompute).not.toHaveBeenCalled();
  });
});
