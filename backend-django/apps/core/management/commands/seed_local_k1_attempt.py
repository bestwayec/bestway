"""Local-only fixture: a production-shaped "single_skill" attempt without a frozen practice scope.

Live PIN rooms fall back to this shape (``live_exam_service._start_or_resume_live_attempt``) and
older attempts have it too. It reproduces K1 ("Failed to load questions ... (0 bo'lim)").
Refuses to run unless DEBUG is on and the database is a loopback ``*_local`` database.
Prints the new attempt id on stdout.
"""
from datetime import timedelta
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from apps.legacy_schema.models import MockAttempt, MockExam, User


class Command(BaseCommand):
    help = "Create a scope-less single_skill attempt for a synthetic student (local *_local DB only)."

    def add_arguments(self, parser):
        parser.add_argument("--phone", default="+998900000010")
        parser.add_argument("--exam", default="MOCK-RECORD-01")

    def handle(self, *args, **options):
        db = connection.settings_dict
        if not settings.DEBUG:
            raise CommandError("Refusing: DEBUG is off.")
        if db["HOST"] not in ("127.0.0.1", "localhost", "::1") or not str(db["NAME"]).endswith("_local"):
            raise CommandError("Refusing: database must be loopback and named *_local.")
        user = User.objects.filter(phone=options["phone"], role="student").first()
        if not user:
            raise CommandError("Synthetic student not found; run seed_local_dev first.")
        exam = MockExam.objects.filter(id=options["exam"]).first()
        if not exam:
            raise CommandError(f"Exam {options['exam']} not found locally.")
        MockAttempt.objects.filter(exam_id=exam.id, student_id=user.id, status="in_progress").update(status="completed")
        now = timezone.now().replace(microsecond=0)
        attempt = MockAttempt.objects.create(
            id=str(uuid4()), exam_id=exam.id, student_id=user.id,
            specification_version=exam.specification_version, speaking_profile_version=exam.speaking_profile_version,
            status="in_progress", started_at=now, mode="timed",
            deadline_at=now + timedelta(minutes=90), overall_deadline_at=now + timedelta(minutes=90),
            section_deadlines=None, flow_mode="single_skill", current_skill=None, media_state=None,
            anti_cheat_count=0,
        )
        self.stdout.write(attempt.id)
