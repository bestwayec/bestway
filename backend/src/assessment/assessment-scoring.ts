import { AppException } from '../common/app.exception';
import { convertExpertScore, multilevelLevel } from '../mock/multilevel-specification';
import { roundHalfBand } from '../mock/mock-scoring';
import { AssessmentInput, AssessmentPartResult, AssessmentPolicy, AssessmentResult } from './contracts';

export interface DeterministicAssessmentScore {
  score: number | null;
  rawTotal: number | null;
  level: string | null;
  parts: Array<{ id: string; score: number | null }>;
}

export function halfPoint(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && Number.isInteger(value * 2);
}

/** LLM arithmetic is discarded. Only validated criterion/raw inputs are used. */
export function scoreAssessment(input: AssessmentInput, result: AssessmentResult): DeterministicAssessmentScore {
  const byId = new Map(result.parts.map((p) => [p.id, p]));
  if (byId.size !== input.parts.length || result.parts.length !== input.parts.length) throw new AppException('ASSESSMENT_INVALID_SCORE', 'Incomplete rubric', 400);
  const parts = input.parts.map((part) => {
    const rated = byId.get(part.id);
    if (!rated) throw new AppException('ASSESSMENT_INVALID_SCORE', 'Missing rubric part', 400);
    if (input.program === 'MULTILEVEL') {
      if (!halfPoint(rated.rawScore, part.max)) throw new AppException('ASSESSMENT_INVALID_SCORE', 'Raw score must use half points within the task maximum', 400);
      return { id: part.id, score: rated.rawScore };
    }
    const keys = input.skill === 'writing' ? ['ta', 'cc', 'lr', 'gra'] : ['fluency', 'lexical', 'grammar', 'pronunciation'];
    if (input.skill === 'speaking' && rated.criteria.pronunciation === null) return { id: part.id, score: null };
    if (!keys.every((key) => halfPoint(rated.criteria[key], 9))) throw new AppException('ASSESSMENT_INVALID_SCORE', 'Four criterion bands are required', 400);
    return { id: part.id, score: keys.reduce((sum, key) => sum + rated.criteria[key]!, 0) / 4 };
  });
  if (parts.some((p) => p.score === null)) return { score: null, rawTotal: null, level: null, parts };
  if (input.program === 'MULTILEVEL') {
    const rawTotal = parts.reduce((sum, p) => sum + p.score!, 0);
    const score = convertExpertScore(input.skill, rawTotal);
    return { score, rawTotal, level: multilevelLevel(score), parts };
  }
  const weights = input.parts.map((p) => input.skill === 'writing' ? p.weight ?? (p.id.startsWith('task2') ? 2 : 1) : 1);
  const mean = parts.reduce((sum, p, i) => sum + p.score! * weights[i], 0) / weights.reduce((sum, weight) => sum + weight, 0);
  return { score: roundHalfBand(mean), rawTotal: null, level: null, parts };
}

export function shouldAdjudicate(input: AssessmentInput, result: AssessmentResult, threshold = 0.85): boolean {
  if (result.confidence < threshold) return true;
  const score = scoreAssessment(input, result).score;
  return input.program === 'MULTILEVEL' && score !== null && [38, 51, 65].some((boundary) => Math.abs(score - boundary) <= 1);
}

export function mayFinalizeAutomatically(policy: AssessmentPolicy, input: AssessmentInput, result: AssessmentResult, threshold = 0.85): boolean {
  return policy === 'PRACTICE_AUTO_AI' && result.confidence >= threshold && scoreAssessment(input, result).score !== null;
}

/** Teacher-supplied numbers use the same deterministic engine, never LLM totals. */
export function teacherResult(input: AssessmentInput, base: AssessmentResult, parts: Array<{ id: string; rawScore?: number; criteria?: Record<string, number> }>): AssessmentResult {
  if (parts.length !== input.parts.length || new Set(parts.map((p) => p.id)).size !== parts.length) throw new AppException('ASSESSMENT_INVALID_SCORE', 'Provide each formal part once', 400);
  const overrides = new Map(parts.map((p) => [p.id, p]));
  const rated: AssessmentPartResult[] = input.parts.map((part) => {
    const override = overrides.get(part.id);
    const original = base.parts.find((p) => p.id === part.id);
    if (!override || !original) throw new AppException('ASSESSMENT_INVALID_SCORE', 'Unknown rubric part', 400);
    return { ...original, rawScore: input.program === 'MULTILEVEL' ? override.rawScore ?? null : null, criteria: input.program === 'MULTILEVEL' ? original.criteria : override.criteria ?? {} };
  });
  const next: AssessmentResult = { ...base, parts: rated, pronunciationEvidence: input.program !== 'MULTILEVEL' && input.skill === 'speaking' ? 'ACOUSTIC' : base.pronunciationEvidence };
  if (scoreAssessment(input, next).score === null) throw new AppException('ASSESSMENT_INVALID_SCORE', 'A complete teacher score is required', 400);
  return next;
}
