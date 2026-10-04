-- Add learning/interaction metadata without changing existing question primitives.
CREATE TYPE "PracticeLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1');
ALTER TABLE "MockExam" ADD COLUMN "practiceLevel" "PracticeLevel";
ALTER TABLE "MockQuestionGroup" ADD COLUMN "optionsReusable" BOOLEAN;
ALTER TABLE "MockQuestion" ADD COLUMN "answerRule" TEXT;
