/** Public assessment contract. Provider credentials and raw prompts stay on the server. */
export type AssessmentStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "RETRY" | "FAILED" | "NEEDS_REVIEW";
export type AssessmentProgram = "IELTS_ACADEMIC" | "IELTS_GENERAL" | "MULTILEVEL";
export type AssessmentPolicy = "PRACTICE_AUTO_AI" | "FULL_MOCK_AI_WITH_REVIEW" | "MANUAL_ONLY";
export type PronunciationEvidence = "UNAVAILABLE" | "ACOUSTIC";

export interface AssessmentPartFeedback {
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

export interface AssessmentResult {
  parts: Array<{
    id: string;
    rawScore: number | null;
    criteria: Record<string, number | null>;
    evidence: Record<string, string>;
    feedback: AssessmentPartFeedback;
  }>;
  overallStrengths: string[];
  priorityImprovements: string[];
  grammarCorrections: Array<{ original: string; corrected: string; explanation: string }>;
  vocabularyUpgrades: Array<{ original: string; alternative: string; explanation: string }>;
  improvedExamples: Array<{ partId: string; text: string }>;
  recommendedPractice: string[];
  confidence: number;
  pronunciationEvidence: PronunciationEvidence;
}

export interface AssessmentJobView {
  id: string;
  skill: "writing" | "speaking";
  program: AssessmentProgram;
  status: AssessmentStatus;
  policyMode: AssessmentPolicy;
  version: number;
  aiScore: number | null;
  teacherScore: number | null;
  finalScore: number | null;
  finalScoreSource: "AI" | "TEACHER" | "ADJUDICATED" | null;
  confidence: number | null;
  rubricVersion: string;
  promptVersion: string;
  evaluation: { result: AssessmentResult } | null;
  approvedFeedback: AssessmentResult | null;
  submissions: Array<{
    questionId: string;
    partId: string;
    prompt: string;
    context: string;
    originalResponse: string;
    wordCount: number;
    audioUrl: string | null;
    transcript: {
      text: string;
      confidence: number | null;
      segments: Array<{ start: number; end: number; text: string; confidence: number | null }>;
      pronunciationEvidence: PronunciationEvidence;
    } | null;
  }>;
  parts: Array<{ id: string; max: number; task: string; context: string }>;
}

export interface AttemptAssessments {
  attemptId: string;
  assessments: AssessmentJobView[];
}

export type AssessmentReviewAction = "ACCEPT" | "OVERRIDE" | "EDIT_FEEDBACK" | "REGRADE" | "NEEDS_REVIEW";
export interface AssessmentReviewInput {
  action: AssessmentReviewAction;
  expectedVersion: number;
  reason: string;
  parts?: Array<{ id: string; rawScore?: number; criteria?: Record<string, number> }>;
  feedback?: AssessmentResult;
}
