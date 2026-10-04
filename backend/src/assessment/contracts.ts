export type AssessmentProgram = 'IELTS_ACADEMIC' | 'IELTS_GENERAL' | 'MULTILEVEL';
export type AssessmentSkill = 'writing' | 'speaking';
export type AssessmentPolicy = 'PRACTICE_AUTO_AI' | 'FULL_MOCK_AI_WITH_REVIEW' | 'MANUAL_ONLY';
export type PronunciationEvidence = 'UNAVAILABLE' | 'ACOUSTIC';

export interface AssessmentResponse {
  questionId: string;
  prompt: string;
  originalResponse: string;
  audioKey?: string;
  audioHash?: string;
  mimeType?: string;
  durationMs?: number;
  transcript?: string;
  partNumber?: number;
}
export interface AssessmentPart {
  id: string;
  max: number;
  task: string;
  context: string;
  weight?: number;
  responses: AssessmentResponse[];
  imageKeys?: string[];
  prepSeconds?: number[];
  responseSeconds?: number[];
}
export interface AssessmentInput {
  program: AssessmentProgram;
  skill: AssessmentSkill;
  specificationVersion: string | null;
  speakingProfileVersion: string | null;
  rubricVersion: string;
  promptVersion: string;
  pronunciationEvidence: PronunciationEvidence;
  parts: AssessmentPart[];
}
export interface PartFeedback {
  taskCoverage: string;
  grammar: string;
  vocabulary: string;
  fluencyCohesion: string;
  ideaDevelopment: string;
  register: string;
  spellingPunctuation: string;
  strengths: string[];
  issues: string[];
  missedPrompts: string[];
  usefulPhrases: string[];
  forCovered: boolean | null;
  againstCovered: boolean | null;
  position: string;
  argumentBalance: string;
}
export interface AssessmentPartResult {
  id: string;
  rawScore: number | null;
  criteria: Record<string, number | null>;
  evidence: Record<string, string>;
  feedback: PartFeedback;
}
export interface AssessmentResult {
  parts: AssessmentPartResult[];
  overallStrengths: string[];
  priorityImprovements: string[];
  grammarCorrections: Array<{ original: string; corrected: string; explanation: string }>;
  vocabularyUpgrades: Array<{ original: string; alternative: string; explanation: string }>;
  improvedExamples: Array<{ partId: string; text: string }>;
  recommendedPractice: string[];
  confidence: number;
  pronunciationEvidence: PronunciationEvidence;
}
export interface ProviderEvaluation {
  result: AssessmentResult;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}
export interface AssessmentProvider {
  assess(input: AssessmentInput, role: 'PRIMARY' | 'ADJUDICATOR'): Promise<ProviderEvaluation>;
}
export interface SpeechTranscriptResult {
  text: string;
  segments: Array<{ start: number; end: number; text: string; confidence: number | null }>;
  confidence: number | null;
  provider: string;
  model: string;
  durationMs: number | null;
  pronunciationEvidence: PronunciationEvidence;
}
export interface SpeechToTextProvider {
  transcribe(input: { audioPath: string; mimeType: string; language: string; durationMs?: number }): Promise<SpeechTranscriptResult>;
}

/** Sanitized operational failures only: never retain provider bodies or essays in errors. */
export class AssessmentProviderError extends Error {
  constructor(public readonly code: string, public readonly transient = false, public readonly uncertain = false) {
    super(code);
    this.name = 'AssessmentProviderError';
  }
}
