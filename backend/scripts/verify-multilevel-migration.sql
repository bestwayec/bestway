-- Run only after baseline migrations, in the isolated verification database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'multilevel_verification' THEN
    RAISE EXCEPTION 'This fixture is restricted to multilevel_verification';
  END IF;
END $$;
BEGIN;
INSERT INTO "User" ("id","name","phone","passwordHash","role","updatedAt") VALUES
  ('migration-student','Migration fixture','fixture-student','not-a-login-hash','student',now()),
  ('migration-admin','Migration admin','fixture-admin','not-a-login-hash','admin',now());
INSERT INTO "StudentProfile" ("userId","linkCode","isApproved","currentPoints") VALUES ('migration-student','migration-fixture',true,17);
INSERT INTO "MockExam" ("id","type","title","updatedAt") VALUES
  ('migration-ielts','ielts_academic','Historical IELTS',now()),
  ('migration-multilevel','multilevel','Historical Multilevel',now());
INSERT INTO "MockAttempt" ("id","studentId","examId","status","overallBand","cefrLevel") VALUES
  ('migration-ielts-attempt','migration-student','migration-ielts','completed',7.5,'C1'),
  ('migration-multilevel-attempt','migration-student','migration-multilevel','completed',NULL,'A2');
\ir ../prisma/migrations/20261003000000_multilevel_exam_track/migration.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "StudentProfile" WHERE "userId"='migration-student' AND "availablePrograms"=ARRAY['IELTS']::"ExamProgram"[] AND "activeProgram"='IELTS' AND "currentPoints"=17) THEN
    RAISE EXCEPTION 'Student defaults or existing data changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "MockAttempt" WHERE "id"='migration-ielts-attempt' AND "overallBand"=7.5 AND "cefrLevel"='C1' AND "specificationVersion" IS NULL) THEN
    RAISE EXCEPTION 'Historical IELTS result changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "MockAttempt" WHERE "id"='migration-multilevel-attempt' AND "cefrLevel"='A2' AND "specificationVersion" IS NULL AND "overallScore" IS NULL) THEN
    RAISE EXCEPTION 'Historical Multilevel result changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "MockExam" WHERE "id"='migration-multilevel' AND "specificationVersion"='UZBMB_MULTILEVEL_EN_2026_V1') THEN
    RAISE EXCEPTION 'Exam specification backfill missing';
  END IF;
  BEGIN
    UPDATE "StudentProfile" SET "activeProgram"='MULTILEVEL' WHERE "userId"='migration-student';
    RAISE EXCEPTION 'Invalid active program accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
COMMIT;
SELECT 'PASS: defaults, existing IELTS/historical Multilevel data, exam backfill and enrollment constraint' AS result;
