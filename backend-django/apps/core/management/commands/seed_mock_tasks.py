from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.core.management.commands.seed_multilevel_test1_gym_diet import (
    seed_mock_test_1,
)
from apps.exams.management.commands.seed_ielts_mock1_academic import (
    seed_ielts_mock_1,
)


class Command(BaseCommand):
    help = (
        "Seeds all 4 CEFR skills for Multi-Level (CEFR) Mock Test 1 and all 4 skills for "
        "IELTS Academic Mock Test 1."
    )

    def handle(self, *args, **options):
        self.stdout.write("Seeding full authored tasks for Multi-Level (CEFR) Mock Test 1...")
        seed_mock_test_1(self.stdout, self.style)
        self.stdout.write("Seeding full authored tasks for IELTS Academic Mock Test 1...")
        seed_ielts_mock_1(self.stdout, self.style)
