from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.core.management.commands.seed_multilevel_test1_gym_diet import (
    seed_mock_test_1,
)


class Command(BaseCommand):
    help = (
        "Seeds all 4 CEFR skills (Listening Parts 1-6, Reading Parts 1-5, Writing Task 1 & 2, "
        "Speaking Parts 1-3) for Multi-Level (CEFR) Mock Test 1: Gym Membership & Vegetarian Diet."
    )

    def handle(self, *args, **options):
        self.stdout.write("Seeding full authored tasks for Multi-Level (CEFR) Mock Test 1...")
        seed_mock_test_1(self.stdout, self.style)
