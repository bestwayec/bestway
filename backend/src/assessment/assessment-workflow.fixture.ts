import { AssessmentInput, AssessmentResult } from './contracts';

/** Synthetic evidence shared by assessment contract tests; no provider call. */
export function workflowInput(skill: AssessmentInput['skill'] = 'writing'): AssessmentInput {
  return {
    program: 'MULTILEVEL', skill, specificationVersion: 'test-specification', speakingProfileVersion: null,
    rubricVersion: 'test-rubric', promptVersion: 'test-prompt', pronunciationEvidence: 'UNAVAILABLE',
    parts: [{ id: '1.1', max: 5, task: 'Write to a friend', context: 'Synthetic library task', responses: [{
      questionId: 'question', prompt: 'Describe the library', originalResponse: 'My original response.',
      ...(skill === 'speaking' ? { audioKey: 'mock/student-recording.webm', audioHash: 'verified-audio-hash', mimeType: 'audio/webm', durationMs: 30000 } : {}),
    }] }],
  };
}

export function workflowResult(input: AssessmentInput, rawScore = 4): AssessmentResult {
  return {
    parts: input.parts.map((part) => ({
      id: part.id, rawScore,
      criteria: { taskCoverage: rawScore, grammar: rawScore, vocabulary: rawScore, cohesion: rawScore, ideaDevelopment: rawScore },
      evidence: { taskCoverage: 'Relevant evidence', grammar: 'Relevant evidence', vocabulary: 'Relevant evidence', cohesion: 'Relevant evidence', ideaDevelopment: 'Relevant evidence' },
      feedback: { taskCoverage: 'Covered', grammar: 'Improve accuracy', vocabulary: 'Suitable', fluencyCohesion: 'Clear', ideaDevelopment: 'Add an example', register: 'Suitable', spellingPunctuation: 'Check punctuation', strengths: ['Relevant'], issues: [], missedPrompts: [], usefulPhrases: [], forCovered: null, againstCovered: null, position: '', argumentBalance: '' },
    })),
    overallStrengths: ['Relevant'], priorityImprovements: ['Accuracy'], grammarCorrections: [], vocabularyUpgrades: [], improvedExamples: [], recommendedPractice: [],
    confidence: 0.95, pronunciationEvidence: 'UNAVAILABLE',
  };
}
