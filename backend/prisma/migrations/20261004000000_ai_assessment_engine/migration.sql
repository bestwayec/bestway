-- CreateEnum
CREATE TYPE "AssessmentPolicyMode" AS ENUM ('PRACTICE_AUTO_AI', 'FULL_MOCK_AI_WITH_REVIEW', 'MANUAL_ONLY');

-- CreateEnum
CREATE TYPE "AssessmentJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AssessmentScoreSource" AS ENUM ('AI', 'TEACHER', 'ADJUDICATED');

-- CreateEnum
CREATE TYPE "AssessmentCallStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "MockExam" ADD COLUMN     "assessmentPolicy" "AssessmentPolicyMode",
ADD COLUMN     "speakingProfileVersion" TEXT;

-- AlterTable
ALTER TABLE "MockAttempt" ADD COLUMN     "speakingProfileVersion" TEXT;

-- CreateTable
CREATE TABLE "AssessmentJob" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "skill" "MockSkill" NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "rubricVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "policyMode" "AssessmentPolicyMode" NOT NULL,
    "status" "AssessmentJobStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "selectedEvaluationId" TEXT,
    "aiScore" DOUBLE PRECISION,
    "teacherScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION,
    "finalScoreSource" "AssessmentScoreSource",
    "confidence" DOUBLE PRECISION,
    "finalResult" JSONB,
    "approvedFeedback" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentEvaluation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" "AssessmentCallStatus" NOT NULL DEFAULT 'STARTED',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "result" JSONB,
    "confidence" DOUBLE PRECISION,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "failureCode" TEXT,
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AssessmentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechTranscript" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "audioHash" TEXT NOT NULL,
    "status" "AssessmentCallStatus" NOT NULL DEFAULT 'STARTED',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT,
    "segments" JSONB,
    "confidence" DOUBLE PRECISION,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "durationMs" INTEGER,
    "pronunciationEvidence" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "failureCode" TEXT,
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SpeechTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentJob_status_retryAt_createdAt_idx" ON "AssessmentJob"("status", "retryAt", "createdAt");

-- CreateIndex
CREATE INDEX "AssessmentJob_attemptId_skill_createdAt_idx" ON "AssessmentJob"("attemptId", "skill", "createdAt");

-- CreateIndex
CREATE INDEX "AssessmentJob_studentId_createdAt_idx" ON "AssessmentJob"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentJob_attemptId_skill_inputHash_generation_key" ON "AssessmentJob"("attemptId", "skill", "inputHash", "generation");

-- CreateIndex
CREATE INDEX "AssessmentEvaluation_jobId_status_idx" ON "AssessmentEvaluation"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentEvaluation_jobId_role_attemptNumber_key" ON "AssessmentEvaluation"("jobId", "role", "attemptNumber");

-- CreateIndex
CREATE INDEX "SpeechTranscript_audioHash_status_idx" ON "SpeechTranscript"("audioHash", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SpeechTranscript_jobId_questionId_attemptNumber_key" ON "SpeechTranscript"("jobId", "questionId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "AssessmentJob" ADD CONSTRAINT "AssessmentJob_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "MockAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentJob" ADD CONSTRAINT "AssessmentJob_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentEvaluation" ADD CONSTRAINT "AssessmentEvaluation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AssessmentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechTranscript" ADD CONSTRAINT "SpeechTranscript_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AssessmentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
