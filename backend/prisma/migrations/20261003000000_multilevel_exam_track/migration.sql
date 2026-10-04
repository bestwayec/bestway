-- Additive only. Existing IELTS and historical Multilevel results are preserved.
CREATE TYPE "ExamProgram" AS ENUM ('IELTS', 'MULTILEVEL');
ALTER TABLE "StudentProfile"
  ADD COLUMN "availablePrograms" "ExamProgram"[] NOT NULL DEFAULT ARRAY['IELTS']::"ExamProgram"[],
  ADD COLUMN "activeProgram" "ExamProgram" DEFAULT 'IELTS';
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_activeProgram_available"
  CHECK ("activeProgram" IS NULL OR "activeProgram" = ANY("availablePrograms"));
ALTER TABLE "MockExam" ADD COLUMN "specificationVersion" TEXT;
-- Content must pass the new readiness blueprint before new attempts may start.
UPDATE "MockExam" SET "specificationVersion" = 'UZBMB_MULTILEVEL_EN_2026_V1' WHERE "type" = 'multilevel';
ALTER TABLE "MockAttempt"
  ADD COLUMN "specificationVersion" TEXT,
  ADD COLUMN "scoreMethod" TEXT,
  ADD COLUMN "scoreVersion" TEXT,
  ADD COLUMN "standardScores" JSONB,
  ADD COLUMN "overallScore" DOUBLE PRECISION,
  ADD COLUMN "mediaState" JSONB;
