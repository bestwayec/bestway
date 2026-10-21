/** Public assessment contract. Provider credentials and raw prompts stay on the server. */
export type AssessmentStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "RETRY" | "FAILED" | "NEEDS_REVIEW";
export type AssessmentProgram = "IELTS_ACADEMIC" | "IELTS_GENERAL" | "MULTILEVEL";
export type AssessmentPolicy = "PRACTICE_AUTO_AI" | "FULL_MOCK_AI_WITH_REVIEW" | "MANUAL_ONLY";
export type PronunciationEvidence = "UNAVAILABLE" | "ACOUSTIC";

/** Internal classroom practice grade; the original rubric remains separately available. */
export interface PracticeGrade {
  policyId: string;
  score: number;
  scaleMax: number;
  rangeMin: number;
  rangeMax: number;
  rawScore: number;
  rawMax: number;
  isOfficial: false;
}

export interface AssessmentGradingPolicy {
  id: string;
  scaleMax: number;
  rangeMin: number;
  rangeMax: number;
}

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
  practiceGrade?: PracticeGrade | null;
  parts: Array<{
    id: string;
    rawScore: number | null;
    criteria: Record<string, number | null>;
    evidence: Record<string, string>;
    evidenceQuotes?: Array<{ criterion: string; responseIndex: number; quote: string }>;
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
  practiceMode?: "PARTIAL";
  rawMax?: number;
  gradingPolicy?: AssessmentGradingPolicy | null;
  aiPracticeGrade?: PracticeGrade | null;
  teacherPracticeGrade?: PracticeGrade | null;
  practiceGrade?: PracticeGrade | null;
  evaluation: { result: AssessmentResult } | null;
  approvedFeedback: AssessmentResult | null;
  finalResult?: AssessmentResult | null;
  submissions: Array<{
    questionId: string;
    partId: string;
    prompt: string;
    context: string;
    originalResponse: string;
    wordCount: number;
    audioUrl: string | null;
    imageUrls?: string[];
    imageKeys?: string[];
    ocrText?: string;
    teacherScore?: number | null;
    teacherFeedback?: string | null;
    transcript: {
      text: string;
      confidence: number | null;
      segments: Array<{ start: number; end: number; text: string; confidence: number | null }>;
      pronunciationEvidence: PronunciationEvidence;
      speechDiagnostics?: {
        mispronounced_words?: Array<{ word: string; issue: string; suggestion: string; approximate_ms?: number }>;
        pauses_and_hesitations?: Array<{ type: string; text: string; approximate_ms?: number }>;
        fluency_score?: number;
        clarity_rating?: string;
      } | null;
    } | null;
  }>;
  parts: Array<{ id: string; max: number; task: string; context: string }>;
}

export interface AttemptAssessments {
  attemptId: string;
  status?: string;
  overall_band?: number | null;
  confidence?: number | null;
  provisional?: boolean;
  teacher_confirmed?: boolean;
  is_teacher_reviewed?: boolean;
  isTeacherReviewed?: boolean;
  teacher_comment?: string | null;
  teacherComment?: string | null;
  teacher_reviewed_by?: string | null;
  teacherReviewedBy?: string | null;
  criteria_scores?: Record<string, number>;
  strengths?: string[];
  weaknesses?: string[];
  mistakes_and_fixes?: Array<{ original: string; corrected: string; explanation: string }>;
  vocabulary_upgrades?: Array<{ original: string; alternative: string; explanation: string }>;
  next_action?: string;
  band_8_rewrite?: string;
  speechDiagnostics?: Record<string, any> | null;
  assessments: AssessmentJobView[];
}

export interface TeacherGradeAttemptInput {
  final_score?: number;
  finalScore?: number;
  writing_score?: number;
  writingScore?: number;
  speaking_score?: number;
  speakingScore?: number;
  teacher_comment?: string;
  teacherComment?: string;
  comment?: string;
  criteria_scores?: Record<string, number>;
  criteriaScores?: Record<string, number>;
}

export type AssessmentReviewAction = "ACCEPT" | "OVERRIDE" | "EDIT_FEEDBACK" | "REGRADE" | "NEEDS_REVIEW";
export interface AssessmentReviewInput {
  action: AssessmentReviewAction;
  expectedVersion: number;
  reason: string;
  parts?: Array<{ id: string; rawScore?: number; criteria?: Record<string, number> }>;
  feedback?: AssessmentResult;
}

export interface AssessmentOverviewWeakModule {
  module: string;
  skill: string;
  questionType?: string;
  questionTypeLabel?: string;
  parts?: string[];
  totalQuestions: number;
  correctCount: number;
  errorCount: number;
  accuracyPercent: number;
  errorRatePercent: number;
  severity: "high" | "medium" | "low";
  recommendation: string;
}

export interface DualScaleIeltsPrediction {
  currentBand: number;
  predictedBand: number;
  trendDelta: number;
  targetBand: number;
  targetProgressPercent: number;
  gapToTarget: number;
  cefrLevel: string;
  skillBreakdown?: Record<string, number>;
}

export interface DualScaleMultilevelPrediction {
  currentScore: number;
  predictedScore: number;
  trendDelta: number;
  targetScore: number;
  targetCefr: string;
  targetProgressPercent: number;
  gapToTarget: number;
  cefrLevel: string;
  scaleBands?: Array<{ level: string; min: number; max: number; label: string }>;
  skillBreakdown?: Record<string, number>;
}

export interface StudentPredictionOverview {
  studentId: string;
  studentName?: string | null;
  activeProgram?: string;
  attemptsAnalyzed: number;
  trend: "improving" | "stable" | "declining" | "insufficient_data";
  ielts: DualScaleIeltsPrediction;
  multilevel: DualScaleMultilevelPrediction;
  history?: Array<{
    attemptId: string;
    examId?: string;
    examTitle: string;
    examType?: string;
    date: string;
    rawScore?: number;
    rawMax?: number;
    ieltsBand?: number;
    multilevelScore?: number;
    cefrLevel?: string;
    skills?: Record<string, number>;
    skillsMultilevel?: Record<string, number>;
  }>;
  weakModules: AssessmentOverviewWeakModule[];
}

export interface AssessmentOverviewData {
  user: {
    id: string;
    name?: string | null;
    phone?: string | null;
    role?: string;
  };
  prediction: StudentPredictionOverview;
  recentAttempts?: Array<{
    id: string;
    examId?: string;
    examTitle?: string;
    type?: string;
    status?: string;
    overallBand?: number;
    overallScore?: number;
    startedAt?: string;
    finishedAt?: string;
    [key: string]: unknown;
  }>;
  writingAssessments?: Array<AssessmentJobView>;
  speakingAssessments?: Array<AssessmentJobView>;
  statistics?: {
    totalAttempts?: number;
    averageIeltsBand?: number;
    averageMultilevelScore?: number;
    bestIeltsBand?: number;
    bestMultilevelScore?: number;
    [key: string]: unknown;
  };
}
