-- Exam lifecycle (Exam Builder 2.0): DRAFT -> VALIDATED -> PUBLISHED -> ARCHIVED.
-- Additive only: three nullable columns; existing exams keep NULL (draft or published by isPublished).
-- validatedVersion records the contentVersion that passed readiness, so any later edit makes the
-- validation stale without a write. archivedAt marks an exam withdrawn from use; attempts and
-- results are untouched.
ALTER TABLE "MockExam" ADD COLUMN "validatedAt" TIMESTAMP(3);
ALTER TABLE "MockExam" ADD COLUMN "validatedVersion" INTEGER;
ALTER TABLE "MockExam" ADD COLUMN "archivedAt" TIMESTAMP(3);
