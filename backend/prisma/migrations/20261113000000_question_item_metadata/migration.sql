-- Item bank metadata on questions. Additive only: two nullable columns, nothing removed or rewritten.
-- Exam, section, part and question type already come from the question's group/section/exam rows.
ALTER TABLE "MockQuestion" ADD COLUMN "cefrLevel" TEXT;
ALTER TABLE "MockQuestion" ADD COLUMN "skillTags" JSONB;
