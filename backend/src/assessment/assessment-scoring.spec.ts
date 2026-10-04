import { describe, expect, it } from 'vitest';
import { AssessmentInput, AssessmentPartResult, AssessmentProgram, AssessmentResult, AssessmentSkill, PartFeedback } from './contracts';
import { mayFinalizeAutomatically, scoreAssessment } from './assessment-scoring';

const feedback: PartFeedback = {
  taskCoverage: '', grammar: '', vocabulary: '', fluencyCohesion: '', ideaDevelopment: '', register: '', spellingPunctuation: '',
  strengths: [], issues: [], missedPrompts: [], usefulPhrases: [], forCovered: null, againstCovered: null, position: '', argumentBalance: '',
};

function input(program: AssessmentProgram, skill: AssessmentSkill, parts: Array<{ id: string; max: number; weight?: number }>): AssessmentInput {
  return {
    program, skill, specificationVersion: null, speakingProfileVersion: null, rubricVersion: 'test-rubric', promptVersion: 'test-prompt',
    pronunciationEvidence: 'UNAVAILABLE',
    parts: parts.map((part) => ({ ...part, task: 'Synthetic grading task', context: '', responses: [] })),
  };
}

function result(parts: Array<{ id: string; rawScore: number | null; criteria?: Record<string, number | null> }>): AssessmentResult {
  return {
    parts: parts.map((part): AssessmentPartResult => ({ ...part, criteria: part.criteria ?? {}, evidence: {}, feedback })),
    overallStrengths: [], priorityImprovements: [], grammarCorrections: [], vocabularyUpgrades: [], improvedExamples: [], recommendedPractice: [],
    confidence: 0.99, pronunciationEvidence: 'UNAVAILABLE',
  };
}

describe('application-owned assessment arithmetic', () => {
  it('adds three Multilevel writing raw rubric grades to /16 before conversion', () => {
    const assessment = input('MULTILEVEL', 'writing', [
      { id: 'informal_email', max: 5 }, { id: 'formal_email', max: 5 }, { id: 'publication', max: 6 },
    ]);
    const evaluation = result([
      { id: 'informal_email', rawScore: 3.5 }, { id: 'formal_email', rawScore: 4 }, { id: 'publication', rawScore: 5 },
    ]);
    expect(scoreAssessment(assessment, evaluation)).toMatchObject({ rawTotal: 12.5, score: 62, level: 'B2' });
    evaluation.parts.forEach((part, index) => { part.rawScore = [5, 5, 6][index]; });
    expect(scoreAssessment(assessment, evaluation)).toMatchObject({ rawTotal: 16, score: 75, level: 'C1' });
  });

  it('adds four holistic Multilevel speaking part grades to /21 before conversion', () => {
    const assessment = input('MULTILEVEL', 'speaking', [
      { id: '1.1', max: 5 }, { id: '1.2', max: 5 }, { id: '2', max: 5 }, { id: '3', max: 6 },
    ]);
    const evaluation = result([
      { id: '1.1', rawScore: 4 }, { id: '1.2', rawScore: 4.5 }, { id: '2', rawScore: 4.5 }, { id: '3', rawScore: 5 },
    ]);
    expect(scoreAssessment(assessment, evaluation)).toMatchObject({ rawTotal: 18, score: 64, level: 'B2' });
    evaluation.parts.forEach((part, index) => { part.rawScore = [5, 5, 5, 6][index]; });
    expect(scoreAssessment(assessment, evaluation)).toMatchObject({ rawTotal: 21, score: 75, level: 'C1' });
  });

  it('rejects a raw grade above its formal task maximum', () => {
    const assessment = input('MULTILEVEL', 'writing', [{ id: 'informal_email', max: 5 }]);
    expect(() => scoreAssessment(assessment, result([{ id: 'informal_email', rawScore: 5.5 }]))).toThrow();
  });

  it.each(['IELTS_ACADEMIC', 'IELTS_GENERAL'] as const)('weights %s Writing Task 2 twice Task 1 and ignores model task totals', (program) => {
    const assessment = input(program, 'writing', [{ id: 'task1:q1', max: 9, weight: 1 }, { id: 'task2:q2', max: 9, weight: 2 }]);
    const evaluation = result([
      { id: 'task1:q1', rawScore: 9, criteria: { ta: 6, cc: 6, lr: 6, gra: 6 } },
      { id: 'task2:q2', rawScore: 0, criteria: { ta: 9, cc: 9, lr: 9, gra: 9 } },
    ]);
    expect(scoreAssessment(assessment, evaluation)).toEqual({
      score: 8, rawTotal: null, level: null, parts: [{ id: 'task1:q1', score: 6 }, { id: 'task2:q2', score: 9 }],
    });
  });

  it('weights all four IELTS Speaking criteria equally when acoustic evidence exists', () => {
    const assessment = input('IELTS_ACADEMIC', 'speaking', [{ id: 'speaking', max: 9 }]);
    assessment.pronunciationEvidence = 'ACOUSTIC';
    const evaluation = result([{ id: 'speaking', rawScore: 9, criteria: { fluency: 4, lexical: 6, grammar: 8, pronunciation: 6 } }]);
    evaluation.pronunciationEvidence = 'ACOUSTIC';
    expect(scoreAssessment(assessment, evaluation)).toEqual({ score: 6, rawTotal: null, level: null, parts: [{ id: 'speaking', score: 6 }] });
  });

  it('keeps transcript-only IELTS Speaking pending despite high other criteria and confidence', () => {
    const assessment = input('IELTS_GENERAL', 'speaking', [{ id: 'speaking', max: 9 }]);
    const evaluation = result([{ id: 'speaking', rawScore: 9, criteria: { fluency: 9, lexical: 9, grammar: 9, pronunciation: null } }]);
    expect(scoreAssessment(assessment, evaluation)).toEqual({ score: null, rawTotal: null, level: null, parts: [{ id: 'speaking', score: null }] });
    expect(mayFinalizeAutomatically('PRACTICE_AUTO_AI', assessment, evaluation)).toBe(false);
  });
});
