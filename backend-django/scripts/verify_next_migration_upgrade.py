"""Deploy and verify the Next upgrade on a fresh disposable PostgreSQL database."""
import os
import shutil
import subprocess
import sys
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

backend = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend))
url = urlparse(os.environ.get("DATABASE_URL", ""))
if url.hostname not in {"127.0.0.1", "localhost", "::1"} or url.path != "/bestway_upgrade_local":
    raise SystemExit("Use a fresh loopback database named bestway_upgrade_local")

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
import django

django.setup()
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

prisma = backend.parent / "backend" / "prisma"
baseline = "20260710140141_init"
exam_review_migration = "20261125000000_question_review_explanation"
django_baseline = ("core", "0012_vocabulary_homework_and_review")
teacher_id, student_id, group_id = "upgrade-teacher", "upgrade-student", "upgrade-group"


def deploy(schema_path):
    subprocess.run(
        ["npx", "--yes", "prisma@5.22.0", "migrate", "deploy", "--schema", str(schema_path)],
        cwd=prisma.parent,
        check=True,
    )


def seed_prisma_baseline():
    with connection.cursor() as cursor:
        for user_id, phone, role in ((teacher_id, "+998900000081", "teacher"), (student_id, "+998900000082", "student")):
            cursor.execute(
                'INSERT INTO "User" ("id","name","phone","passwordHash","role","updatedAt") '
                'VALUES (%s,%s,%s,%s,%s::"Role",NOW())',
                [user_id, role.title(), phone, "unused", role],
            )
        cursor.execute(
            'INSERT INTO "Group" ("id","name","teacherId") VALUES (%s,%s,%s)',
            [group_id, "Legacy room", teacher_id],
        )
        cursor.execute(
            'INSERT INTO "StudentProfile" ("userId","groupId","currentPoints","linkCode") VALUES (%s,%s,42,%s)',
            [student_id, group_id, "UPGRADEFIXTURE"],
        )
        cursor.execute(
            'INSERT INTO "Attendance" ("id","studentId","groupId","date","state","markedById","updatedAt") '
            "VALUES ('upgrade-attendance',%s,%s,'2026-08-01','late',%s,NOW())",
            [student_id, group_id, teacher_id],
        )


def seed_django_baseline():
    call_command("migrate", *django_baseline, interactive=False)
    apps = MigrationExecutor(connection).loader.project_state([django_baseline]).apps
    def model(name):
        return apps.get_model("core", name)

    collection = model("VocabularySet").objects.create(title="Original set", created_by_id=teacher_id, group_id=group_id)
    word = model("VocabularyWord").objects.create(set=collection, english="book", uzbek="kitob")
    cohort = model("Cohort").objects.create(classroom_id=group_id, teacher_id=teacher_id, name="Legacy room", invite_code="UPGRADE")
    assignment = model("HomeworkAssignment").objects.create(
        cohort=cohort, vocabulary_set=collection, title="Original assignment", deadline=timezone.now() + timedelta(days=2),
    )
    model("HomeworkSubmission").objects.create(assignment=assignment, student_id=student_id, score_percent=100, is_passed=True)
    issued = [{"question": {"wordId": word.pk, "type": "eng_uzb", "prompt": "book", "options": []},
               "english": "book", "uzbek": "kitob", "expected": "kitob"}]
    model("VocabularyHomeworkSession").objects.create(
        assignment=assignment, student_id=student_id, mode="eng_uzb", questions=issued,
    )
    model("UserWeakWord").objects.create(student_id=student_id, word=word, review_count=7, interval_days=14)
    return assignment.pk, issued


def seed_exam_history():
    # SQL here creates fixture rows only. The schema at this point is the
    # deployed pre-review schema, which cannot load the new MockQuestion model.
    with connection.cursor() as cursor:
        cursor.execute(
            """INSERT INTO "MockExam" ("id", "type", "title", "updatedAt")
            VALUES ('upgrade-exam', 'ielts_academic', 'Historical exam', NOW())"""
        )
        cursor.execute(
            """INSERT INTO "MockSection" ("id", "examId", "skill")
            VALUES ('upgrade-reading', 'upgrade-exam', 'reading')"""
        )
        cursor.execute(
            """INSERT INTO "MockQuestionGroup" ("id", "sectionId")
            VALUES ('upgrade-passage', 'upgrade-reading')"""
        )
        cursor.execute(
            """INSERT INTO "MockQuestion" ("id", "groupId", "number", "type", "prompt")
            VALUES ('upgrade-question', 'upgrade-passage', 1, 'short_answer', 'Historical question')"""
        )
        cursor.execute(
            """INSERT INTO "MockAttempt" ("id", "examId", "studentId", "status", "submittedAt", "overallBand")
            VALUES ('upgrade-attempt', 'upgrade-exam', %s, 'completed', NOW(), 7)""",
            [student_id],
        )
        cursor.execute(
            """INSERT INTO "MockAnswer" ("id", "attemptId", "questionId", "response", "isCorrect", "score", "isGraded", "updatedAt")
            VALUES ('upgrade-answer', 'upgrade-attempt', 'upgrade-question', 'historical response', true, 1, true, NOW())"""
        )


def verify():
    with connection.cursor() as cursor:
        cursor.execute("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LIMIT 1")
        if cursor.fetchone():
            raise SystemExit("The upgrade database already contains tables")

    with TemporaryDirectory() as temp:
        stage = Path(temp)
        shutil.copy2(prisma / "schema.prisma", stage)
        (stage / "migrations").mkdir()
        shutil.copy2(prisma / "migrations" / "migration_lock.toml", stage / "migrations")
        shutil.copytree(prisma / "migrations" / baseline, stage / "migrations" / baseline)
        deploy(stage / "schema.prisma")
        call_command("check_legacy_schema", migration_history_only=True, allow_pending=True)
        seed_prisma_baseline()
        for migration in sorted((prisma / "migrations").iterdir()):
            if migration.is_dir() and baseline < migration.name < exam_review_migration:
                shutil.copytree(migration, stage / "migrations" / migration.name)
        deploy(stage / "schema.prisma")
        call_command("check_legacy_schema", migration_history_only=True, allow_pending=True)
        seed_exam_history()
    deploy(prisma / "schema.prisma")
    deploy(prisma / "schema.prisma")
    call_command("check_legacy_schema", migration_history_only=True)
    assignment_id, issued = seed_django_baseline()
    call_command("migrate", interactive=False)
    call_command("check_legacy_schema")
    call_command("migrate", check=True)

    from apps.core.models import HomeworkSubmission, UserWeakWord, VocabularyHomeworkSession
    from apps.legacy_schema.models import Attendance, Group, MockAnswer, StudentProfile

    assert Group.objects.get(pk=group_id).teacher_id == teacher_id
    profile = StudentProfile.objects.get(user_id=student_id)
    assert (profile.group_id, profile.current_points) == (group_id, 42)
    assert Attendance.objects.get(pk="upgrade-attendance").state == "late"
    grade = HomeworkSubmission.objects.get(assignment_id=assignment_id, student_id=student_id)
    assert (grade.score_percent, grade.is_passed) == (100, True)
    session = VocabularyHomeworkSession.objects.get(assignment_id=assignment_id, student_id=student_id)
    assert session.questions == issued
    assert session.assignment.vocabulary_set.revision == 1
    review = UserWeakWord.objects.get(student_id=student_id)
    assert (review.word.english, review.word.uzbek, review.review_count, review.interval_days) == ("book", "kitob", 7, 14)
    answer = MockAnswer.objects.select_related("attempt", "question").get(pk="upgrade-answer")
    assert (answer.response, answer.is_correct, answer.score, answer.is_graded) == ("historical response", True, 1, True)
    assert (answer.attempt.status, answer.attempt.overall_band) == ("completed", 7)
    assert answer.question.prompt == "Historical question" and answer.question.review_explanation is None
    print("PASS Prisma and Django upgrade preserved classroom, vocabulary, and completed exam history")


if __name__ == "__main__":
    verify()
