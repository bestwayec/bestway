-- Review material per question (S3: a review that explains mistakes). Additive only: three nullable
-- columns, nothing removed or rewritten. Existing questions keep NULL and show no highlight.
ALTER TABLE "MockQuestion" ADD COLUMN "evidenceText" TEXT;
ALTER TABLE "MockQuestion" ADD COLUMN "evidenceOffset" INTEGER;
ALTER TABLE "MockQuestion" ADD COLUMN "audioStartSec" DOUBLE PRECISION;
