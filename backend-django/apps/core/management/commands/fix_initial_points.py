"""Management command to ensure the global setting for initialPoints is set to 100
and grant 100 points to existing students who currently have 0 points.
"""
from __future__ import annotations

from uuid import uuid4

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.legacy_schema.models import Notification, PointsLog, Setting, StudentProfile


class Command(BaseCommand):
    help = "Set initialPoints=100 and award 100 initial points to existing students with 0 points."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be updated without committing changes.",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)
        now = timezone.now()

        self.stdout.write("Checking system setting for initialPoints...")
        setting = Setting.objects.filter(key="initialPoints").first()
        raw_val = setting.value if setting else None
        need_setting_update = False
        try:
            val_int = int(raw_val)
            if val_int != 100:
                need_setting_update = True
        except (TypeError, ValueError):
            need_setting_update = True

        if need_setting_update:
            if not dry_run:
                Setting.objects.update_or_create(
                    key="initialPoints",
                    defaults={"value": 100},
                )
            self.stdout.write(self.style.SUCCESS("Updated Setting 'initialPoints' to 100."))
        else:
            self.stdout.write("Setting 'initialPoints' is already 100.")

        students_with_zero = StudentProfile.objects.filter(current_points=0)
        count = students_with_zero.count()
        self.stdout.write(f"Found {count} students with 0 points.")

        if count == 0:
            self.stdout.write(self.style.SUCCESS("All students already have points assigned."))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(f"[DRY RUN] Would update {count} students to 100 points."))
            return

        updated = 0
        with transaction.atomic():
            for profile in students_with_zero:
                profile.current_points = 100
                profile.save(update_fields=["current_points"])

                PointsLog.objects.create(
                    id=str(uuid4()),
                    student_id=profile.user_id,
                    change=100,
                    reason="Boshlang'ich ball",
                    created_at=now,
                )

                Notification.objects.create(
                    id=str(uuid4()),
                    user_id=profile.user_id,
                    type="points",
                    text="Xush kelibsiz! Sizga boshlang'ich 100 ball taqdim etildi.",
                    read=False,
                    created_at=now,
                )
                updated += 1

        self.stdout.write(self.style.SUCCESS(f"Successfully awarded 100 initial points to {updated} students!"))
