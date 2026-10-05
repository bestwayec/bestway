-- Multilevel Writing and Speaking are scored per task/part, not per child
-- response. These nullable fields are additive so published historical exams
-- and completed attempts retain their original representation.
ALTER TABLE "MockQuestionGroup" ADD COLUMN "maxScore" INTEGER;
ALTER TABLE "MockQuestionGroup" ADD COLUMN "stimulusRef" TEXT;
