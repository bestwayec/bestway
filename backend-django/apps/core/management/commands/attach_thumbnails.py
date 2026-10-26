"""Management command to attach and synchronize lesson thumbnails idempotently."""

import os
from django.conf import settings
from django.core.management.base import BaseCommand
from apps.core.models import Lesson
from apps.legacy_schema.models import VideoLesson

CANONICAL_MAPPINGS = {
    # 15 remaining grammar lessons with images
    "Future Perfect Continuous": "thumbnails/grammar/futureperfectconteniues.jpg",
    "Future Perfect": "thumbnails/grammar/futureperfect.jpg",
    "Future Simple": "thumbnails/grammar/futuresimple.jpg",
    "Gerund va Infinitive": "thumbnails/grammar/geroundvainfinitive.jpg",
    "If Conditionals": "thumbnails/grammar/if.jpg",
    "Indirect Speech": "thumbnails/grammar/indirectspeech.jpg",
    "Modal verbs": "thumbnails/grammar/modalverbs.jpg",
    "Numerals part 2": "thumbnails/grammar/numeralspart2.jpg",
    "Passive Voice": "thumbnails/grammar/passivevoice.jpg",
    "Past Continuous": "thumbnails/grammar/pastconteniues.jpg",
    "Past Perfect Continuous": "thumbnails/grammar/pastperfectconteniues.jpg",
    "Past Perfect": "thumbnails/grammar/pastperfect.jpg",
    "Past Simple": "thumbnails/grammar/pastsimple.jpg",
    "Personal and Possessive Pronouns": "thumbnails/grammar/personalpossesivepronouns.jpg",
    "Prepositions": "thumbnails/grammar/prepositions.jpg",
    # Initial 6 grammar lessons
    "Nouns": "thumbnails/grammar/noun.jpg",
    "Noun Test": "thumbnails/grammar/noun_test.jpg",
    "Adjectives": "thumbnails/grammar/adjective.jpg",
    "Adverbs": "thumbnails/grammar/adverb.jpg",
    "Numerals": "thumbnails/grammar/numeral.jpg",
    "Articles": "thumbnails/grammar/article.jpg",
    # 8 lessons pending upcoming thumbnail upload
    "Future Continuous": "thumbnails/grammar/futurecontinuous.jpg",
    "Present Continuous": "thumbnails/grammar/presentcontinuous.jpg",
    "Present Perfect Continuous": "thumbnails/grammar/presentperfectcontinuous.jpg",
    "Present Perfect": "thumbnails/grammar/presentperfect.jpg",
    "Present Simple": "thumbnails/grammar/presentsimple.jpg",
    "so,such,enough,too,elder,high,tall": "thumbnails/grammar/so_such_enough_too.jpg",
    "Some va Any": "thumbnails/grammar/some_any.jpg",
    "Tag questions va Short Answers": "thumbnails/grammar/tag_questions.jpg",
}


class Command(BaseCommand):
    help = "Attach thumbnail images to VideoLesson and Lesson records idempotently."

    def add_arguments(self, parser):
        parser.add_argument(
            "--lesson",
            type=str,
            default=None,
            help="Specific lesson title or substring to attach thumbnail for.",
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
            lessons = Lesson.objects.filter(title__icontains=specific_lesson)
            if not lessons.exists():
                self.stderr.write(self.style.ERROR(f"No lesson found matching '{specific_lesson}'"))
                return
            for l in lessons:
                self.attach_to_lesson(l, specific_file, force)
            return

        self.stdout.write("Scanning lessons and canonical thumbnail mappings...")
        updated_count = 0
        skipped_count = 0

        for keyword, rel_key in CANONICAL_MAPPINGS.items():
            matched_lessons = Lesson.objects.filter(title__icontains=keyword)
            for lesson in matched_lessons:
                exists = self.file_exists_in_storage(rel_key)
                if exists or force:
                    updated = self.attach_to_lesson(lesson, rel_key, force)
                    if updated:
                        updated_count += 1
                else:
                    self.stdout.write(
                        self.style.WARNING(
                            f"Pending: Physical file '{rel_key}' not found on disk yet for '{lesson.title}'."
                        )
                    )
                    skipped_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Thumbnail synchronization complete: {updated_count} updated, {skipped_count} pending files."
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
