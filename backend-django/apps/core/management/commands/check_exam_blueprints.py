"""Report every mock exam that does not match its versioned blueprint. Read-only.

    python manage.py check_exam_blueprints           # table
    python manage.py check_exam_blueprints --json    # machine-readable

A full mock must match the official structure. A practice set may be shorter, so for
it only question types that do not belong to the section are reported. Nothing is
changed and nothing is unpublished.
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from apps.core import exam_blueprint
from apps.core.mock_authoring import _exam_tree
from apps.legacy_schema.models import MockExam


def report() -> list[dict]:
    rows = []
    for exam in MockExam.objects.order_by("created_at", "id"):
        tree = _exam_tree(exam)
        result = exam_blueprint.conformity(exam.type, tree["profile"], tree["sections"], exam.specification_version)
        rows.append({
            "id": exam.id, "title": exam.title, "type": exam.type, "profile": exam.profile,
            "isPublished": exam.is_published, "full": result["full"], "issues": result["issues"],
        })
    return rows


class Command(BaseCommand):
    help = "List mock exams that do not match the exam blueprint (read-only)."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="print JSON instead of a table")

    def handle(self, *args, **options):
        rows = report()
        if options["json"]:
            self.stdout.write(json.dumps({"blueprintVersion": exam_blueprint.BLUEPRINT_VERSION, "exams": rows}, ensure_ascii=False, indent=2))
            return
        bad = [row for row in rows if row["issues"]]
        self.stdout.write(f"{exam_blueprint.BLUEPRINT_VERSION}: {len(rows)} exam(s), {len(bad)} with differences")
        for row in rows:
            state = "published" if row["isPublished"] else "draft"
            kind = "full mock" if row["full"] else "practice"
            self.stdout.write(f"- [{'DIFF' if row['issues'] else 'OK'}] {row['title']} ({row['type']}, {kind}, {state}, {row['id']})")
            for issue in row["issues"]:
                self.stdout.write(f"    · {issue}")
