"""Audit and (re)build validated HLS streams for LMS lessons.

Usage:
  python manage.py transcode_all_lessons_hls --audit              # read-only report
  python manage.py transcode_all_lessons_hls --lesson-id <id>     # build one lesson
  python manage.py transcode_all_lessons_hls                      # build lessons without a valid stream
  python manage.py transcode_all_lessons_hls --force              # rebuild every lesson
"""

from __future__ import annotations

import os

from django.core.management.base import BaseCommand

from apps.core.lms_services import (
    HLS_COMPLETE_MARKER,
    execute_hls_transcode_for_lesson,
    hls_directory_path,
    hls_is_ready,
    probe_media_duration,
    resolve_lesson_video_path,
    validate_hls_directory,
)
from apps.core.models import Lesson


class Command(BaseCommand):
    help = "Audit lesson videos against HLS output and rebuild invalid streams."

    def add_arguments(self, parser):
        parser.add_argument("--audit", action="store_true", help="Report only; change nothing.")
        parser.add_argument("--lesson-id", dest="lesson_id", default=None)
        parser.add_argument("--force", action="store_true", help="Rebuild even when a valid stream exists.")

    def _status(self, lesson: Lesson, source_duration: float) -> str:
        hls_dir = hls_directory_path(lesson.id)
        if not os.path.isdir(hls_dir):
            return "no-hls"
        check = validate_hls_directory(hls_dir, expected_duration=source_duration)
        if not check["valid"]:
            return f"INVALID ({check['reason']})"
        if not os.path.isfile(os.path.join(hls_dir, HLS_COMPLETE_MARKER)):
            return "valid-but-unmarked"
        return "ready"

    def handle(self, *args, **options):
        lessons = Lesson.objects.all().order_by("order_index", "created_at")
        if options["lesson_id"]:
            lessons = lessons.filter(id=options["lesson_id"])

        rebuilt = failed = 0
        for lesson in lessons:
            source = resolve_lesson_video_path(lesson.id)
            source_duration = probe_media_duration(source) if source else 0.0
            status = self._status(lesson, source_duration)
            self.stdout.write(
                f"{lesson.id} | {lesson.title[:48]:<48} | source={'yes' if source else 'MISSING'} "
                f"{source_duration:7.1f}s | db={lesson.duration or 0}s | hls={status}"
            )
            if options["audit"]:
                continue
            if not source:
                failed += 1
                continue
            if status == "ready" and not options["force"] and hls_is_ready(lesson.id):
                continue
            result = execute_hls_transcode_for_lesson(lesson.id)
            if result.get("success"):
                rebuilt += 1
                self.stdout.write(self.style.SUCCESS(f"   rebuilt: {result['variants']} {result['duration']:.1f}s"))
            else:
                failed += 1
                self.stdout.write(self.style.ERROR(f"   failed: {result.get('error')} {result.get('reason', '')}"))

        if not options["audit"]:
            self.stdout.write(f"done: rebuilt={rebuilt} failed={failed}")
