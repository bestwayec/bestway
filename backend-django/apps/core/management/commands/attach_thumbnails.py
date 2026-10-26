"""Management command to attach and synchronize lesson thumbnails idempotently."""

import os
import re
from django.conf import settings
from django.core.management.base import BaseCommand
from apps.core.models import Lesson
from apps.legacy_schema.models import VideoLesson

# Exact mapping by order_index for guaranteed 100% precision
ORDER_INDEX_MAPPINGS = {
    # 6 initial lessons
    1: "thumbnails/grammar/noun.jpg",
    2: "thumbnails/grammar/noun_test.jpg",
    3: "thumbnails/grammar/adjective.jpg",
    4: "thumbnails/grammar/adverb.jpg",
    5: "thumbnails/grammar/numeral.jpg",
    6: "thumbnails/grammar/article.jpg",
    # 15 remaining grammar lessons with images
    8: "thumbnails/grammar/futureperfectconteniues.jpg",
    9: "thumbnails/grammar/futureperfect.jpg",
    10: "thumbnails/grammar/futuresimple.jpg",
    11: "thumbnails/grammar/geroundvainfinitive.jpg",
    12: "thumbnails/grammar/if.jpg",
    13: "thumbnails/grammar/indirectspeech.jpg",
    14: "thumbnails/grammar/modalverbs.jpg",
    15: "thumbnails/grammar/numeralspart2.jpg",
    16: "thumbnails/grammar/passivevoice.jpg",
    17: "thumbnails/grammar/pastconteniues.jpg",
    18: "thumbnails/grammar/pastperfectconteniues.jpg",
    19: "thumbnails/grammar/pastperfect.jpg",
    20: "thumbnails/grammar/pastsimple.jpg",
    21: "thumbnails/grammar/personalpossesivepronouns.jpg",
    22: "thumbnails/grammar/prepositions.jpg",
    # 8 lessons pending upcoming thumbnail upload
    7: "thumbnails/grammar/futurecontinuous.jpg",
    23: "thumbnails/grammar/presentcontinuous.jpg",
    24: "thumbnails/grammar/presentperfectcontinuous.jpg",
    25: "thumbnails/grammar/presentperfect.jpg",
    26: "thumbnails/grammar/presentsimple.jpg",
    27: "thumbnails/grammar/so_such_enough_too.jpg",
    28: "thumbnails/grammar/some_any.jpg",
    29: "thumbnails/grammar/tag_questions.jpg",
}

TITLE_KEYWORD_MAPPINGS = {
    "Future Perfect Continuous": "thumbnails/grammar/futureperfectconteniues.jpg",
    "Future Perfect": "thumbnails/grammar/futureperfect.jpg",
    "Future Continuous": "thumbnails/grammar/futurecontinuous.jpg",
    "Future Simple": "thumbnails/grammar/futuresimple.jpg",
    "Gerund": "thumbnails/grammar/geroundvainfinitive.jpg",
    "Conditionals": "thumbnails/grammar/if.jpg",
    "Reported / Indirect Speech": "thumbnails/grammar/indirectspeech.jpg",
    "Modal": "thumbnails/grammar/modalverbs.jpg",
    "Numerals: Fractions": "thumbnails/grammar/numeralspart2.jpg",
    "Passive Voice": "thumbnails/grammar/passivevoice.jpg",
    "Past Perfect Continuous": "thumbnails/grammar/pastperfectconteniues.jpg",
    "Past Perfect": "thumbnails/grammar/pastperfect.jpg",
    "Past Continuous": "thumbnails/grammar/pastconteniues.jpg",
    "Past Simple": "thumbnails/grammar/pastsimple.jpg",
    "Personal & Possessive Pronouns": "thumbnails/grammar/personalpossesivepronouns.jpg",
    "Prepositions": "thumbnails/grammar/prepositions.jpg",
    "Present Perfect Continuous": "thumbnails/grammar/presentperfectcontinuous.jpg",
    "Present Perfect": "thumbnails/grammar/presentperfect.jpg",
    "Present Continuous": "thumbnails/grammar/presentcontinuous.jpg",
    "Present Simple": "thumbnails/grammar/presentsimple.jpg",
    "Confusing Words": "thumbnails/grammar/so_such_enough_too.jpg",
    "Some, Any": "thumbnails/grammar/some_any.jpg",
    "Question Tags": "thumbnails/grammar/tag_questions.jpg",
}

CANONICAL_MAPPINGS = {**TITLE_KEYWORD_MAPPINGS}


class Command(BaseCommand):
    help = "Attach thumbnail images to VideoLesson and Lesson records idempotently."

    def add_arguments(self, parser):
        parser.add_argument(
            "--lesson",
            type=str,
            default=None,
            help="Specific lesson title or order_index to attach thumbnail for.",
        )
        parser.add_argument(
            "--file",
            type=str,
            default=None,
            help="Thumbnail file key or relative path.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Attach even if physical file is not found on disk.",
        )

    def file_exists_in_storage(self, rel_key):
        if not rel_key:
            return False
        search_roots = [
            getattr(settings, "STORAGE_DIR", "/app/storage"),
            getattr(settings, "MEDIA_ROOT", "/app/media"),
            os.path.join(getattr(settings, "STORAGE_DIR", "/app/storage"), "media"),
            "/app/storage",
            "/app/storage/media",
            "/opt/bestway/backend-django/media",
        ]
        for root in search_roots:
            candidate = os.path.join(root, rel_key.lstrip("/"))
            if os.path.exists(candidate) and os.path.isfile(candidate):
                return True
        return False

    def handle(self, *args, **options):
        specific_lesson = options.get("lesson")
        specific_file = options.get("file")
        force = options.get("force", False)

        if specific_lesson and specific_file:
            if specific_lesson.isdigit():
                lessons = Lesson.objects.filter(order_index=int(specific_lesson))
            else:
                lessons = Lesson.objects.filter(title__icontains=specific_lesson)
            if not lessons.exists():
                self.stderr.write(self.style.ERROR(f"No lesson found matching '{specific_lesson}'"))
                return
            for l in lessons:
                self.attach_to_lesson(l, specific_file, force)
            return

        self.stdout.write("Scanning lessons and synchronizing canonical thumbnails...")
        updated_count = 0
        skipped_count = 0

        # Primary pass: by order_index
        all_lessons = Lesson.objects.all().order_index_asc() if hasattr(Lesson.objects, "order_index_asc") else Lesson.objects.all().order_by("order_index")

        for lesson in all_lessons:
            idx = lesson.order_index
            rel_key = ORDER_INDEX_MAPPINGS.get(idx)
            if not rel_key:
                continue

            exists = self.file_exists_in_storage(rel_key)
            if exists or force:
                updated = self.attach_to_lesson(lesson, rel_key, force)
                if updated:
                    updated_count += 1
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"Pending: Physical file '{rel_key}' not found on disk yet for [{idx}] '{lesson.title}'."
                    )
                )
                skipped_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Thumbnail synchronization complete: {updated_count} updated/verified, {skipped_count} pending files."
            )
        )

    def attach_to_lesson(self, lesson, rel_key, force):
        video_lesson, _ = VideoLesson.objects.get_or_create(
            id=str(lesson.id),
            defaults={
                "title": lesson.title,
                "description": lesson.description or "",
                "file_key": lesson.video_file or "",
            },
        )
        if video_lesson.thumbnail_key != rel_key:
            video_lesson.thumbnail_key = rel_key
            video_lesson.save(update_fields=["thumbnail_key"])
            self.stdout.write(
                self.style.SUCCESS(
                    f" Attached '{rel_key}' to VideoLesson [{lesson.order_index}] {lesson.title}"
                )
            )
            return True
        return False
