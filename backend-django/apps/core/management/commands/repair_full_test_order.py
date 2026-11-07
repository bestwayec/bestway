"""Report (and optionally fix) in-progress Full Mock attempts whose current section is out of order.

A full_test attempt must sit on the first section, in exam order, that has not been
submitted. Older builds let students switch back to submitted sections or skip ahead,
leaving attempts whose `currentSkill` is submitted, unknown, or not the next section.

    python manage.py repair_full_test_order --dry-run   # default: report only
    python manage.py repair_full_test_order --apply     # write the corrected currentSkill

Never runs automatically on deploy. Only `currentSkill` is changed; answers, deadlines
and submitted sections are left as they are.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.legacy_schema.models import MockAttempt, MockSection


def expected_skill(section_order: list[str], submitted: list[str] | None) -> str | None:
    done = set(submitted or [])
    return next((skill for skill in section_order if skill not in done), None)


def plan_repairs(attempts, order_by_exam: dict[str, list[str]]) -> list[dict]:
    """Pure planning step: [{attempt, exam, current, expected, reason}] for every mismatch."""
    plan = []
    for attempt in attempts:
        order = order_by_exam.get(attempt.exam_id) or []
        submitted = list(attempt.submitted_sections or [])
        want = expected_skill(order, submitted)
        have = attempt.current_skill
        if have == want:
            continue
        if have in submitted:
            reason = "current section was already submitted"
        elif have not in order:
            reason = "current section is not part of the exam"
        else:
            reason = "current section skips an unsubmitted earlier section"
        plan.append(dict(attempt=attempt.id, exam=attempt.exam_id, current=have, expected=want, reason=reason))
    return plan


class Command(BaseCommand):
    help = "Report or repair out-of-order in-progress Full Mock attempts (dry run by default)."

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--dry-run", action="store_true", help="Only report (default).")
        mode.add_argument("--apply", action="store_true", help="Write the corrected currentSkill.")

    def handle(self, *args, **options):
        apply = options["apply"]
        attempts = list(MockAttempt.objects.filter(status="in_progress", flow_mode="full_test"))
        exam_ids = {a.exam_id for a in attempts}
        order_by_exam: dict[str, list[str]] = {}
        for section in MockSection.objects.filter(exam_id__in=exam_ids).order_by("exam_id", "sort_order"):
            order_by_exam.setdefault(section.exam_id, []).append(section.skill)
        plan = plan_repairs(attempts, order_by_exam)
        self.stdout.write(f"Checked {len(attempts)} in-progress full_test attempts; {len(plan)} out of order.")
        for row in plan:
            self.stdout.write(f"  {row['attempt']} exam={row['exam']} current={row['current']} -> {row['expected']} ({row['reason']})")
        if not apply:
            self.stdout.write("Dry run: nothing changed. Re-run with --apply to write these changes.")
            return
        unfixable = [row for row in plan if row["expected"] is None]
        if unfixable:
            raise CommandError(f"{len(unfixable)} attempt(s) have every section submitted; submit them instead of reordering.")
        with transaction.atomic():
            for row in plan:
                MockAttempt.objects.filter(id=row["attempt"], status="in_progress", flow_mode="full_test",
                                           current_skill=row["current"]).update(current_skill=row["expected"])
        self.stdout.write(self.style.SUCCESS(f"Updated currentSkill on {len(plan)} attempt(s)."))
