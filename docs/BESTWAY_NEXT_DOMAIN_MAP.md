# Domain and schema ownership

| Domain | Owner | Relationships and constraints |
| --- | --- | --- |
| User, StudentProfile, Group | Prisma and unmanaged Django mappings in `apps/legacy_schema/models.py` | User role and active status come from the database. StudentProfile is keyed by user and holds one nullable Group. Group stores teacher and schedule. |
| Attendance | Prisma | Tied to student, Group and day. Supports present, absent and late. Moving current membership must preserve historical rows. |
| TestAttempt, MockAttempt and related results | Prisma legacy schema | Attempts belong to users and exam definitions. Current group membership determines roster scope and does not own attempt records. |
| Exam, Question, AnswerKey | Django core | The newer CD exam domain lives beside legacy mock exams. Core migration 0007 creates CD question structures. |
| Cohort and CohortMembership | Django core 0005 | Cohort teacher, unique invite code and unique cohort/student pair. Memberships can be archived independently of Group membership. |
| HomeworkAssignment and HomeworkSubmission | Django core 0005 and 0008 | Assignment targets a Cohort and may reference a Lesson or MockExam. One submission per assignment/student. Source distinguishes teacher, exam, student and historical submissions. |
| VocabularySet, VocabularyWord, VocabularyAttempt, UserWeakWord | Django core 0001 | Set records owner, optional Group, visibility and level. Word belongs to set. Attempt belongs to student and set. Weak words are unique by student and word. |

The Prisma migration manifest is authoritative for legacy tables and is verified by Django tooling. Django migrations own only managed additions. Changes to legacy column types, enums or constraints require the normal Prisma migration sequence.

## Classroom bridge design

Use the legacy Group ID as the identifier for schedule, primary enrollment and attendance. Keep the Cohort ID for existing invitation and homework routes. Introduce an explicit, unique association in Django-owned schema only when a classroom needs homework. Never infer it from teacher or display name. Existing independent cohorts keep their IDs and memberships. Any legacy backfill should be reviewed and limited to verified pairs.

Resolve Group ownership on each classroom request. A teacher may enroll eligible students under the applicable roster policy. Current enrollment changes must retain attendance, assessments and submissions. Synchronize linked membership changes in a transaction and archive the associated enrollment instead of deleting submissions. Map the Group ID and optional linked Cohort ID explicitly in API responses.
