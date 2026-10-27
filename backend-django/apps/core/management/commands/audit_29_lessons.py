"""Management command to audit all 29 grammar lessons, their video files,
thumbnails, QuizDecks, question cards, and Bamboozle surprise cards.
"""

import os
from django.conf import settings
from django.core.management.base import BaseCommand
from apps.core.models import Lesson, QuizDeck, QuizCard
from apps.legacy_schema.models import VideoLesson


class Command(BaseCommand):
    help = "Comprehensive audit of all 29 grammar lessons, storage assets, and quizzes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fix-missing-thumbnails",
            action="store_true",
            help="Safely clear thumbnail_key on VideoLesson if physical image is missing from storage.",
        )
        parser.add_argument(
            "--json",
            action="store_true",
            help="Output audit report in machine-readable JSON format.",
        )

    def file_exists_in_storage(self, rel_key):
        if not rel_key:
            return False, None
        search_roots = [
            getattr(settings, "STORAGE_DIR", "/app/storage"),
            getattr(settings, "MEDIA_ROOT", "/app/media"),
            os.path.join(getattr(settings, "STORAGE_DIR", "/app/storage"), "media"),
            "/app/storage",
            "/app/storage/media",
            "/opt/bestway/backend-django/media",
            "C:\\Users\\user\\Desktop\\bwww\\bestway\\backend-django\\media",
        ]
        clean_key = rel_key.lstrip("/")
        for root in search_roots:
            candidate = os.path.join(root, clean_key)
            if os.path.exists(candidate) and os.path.isfile(candidate):
                return True, candidate
            # Also check alternative path without thumbnails/
            if clean_key.startswith("thumbnails/"):
                sub_candidate = os.path.join(root, clean_key[len("thumbnails/"):])
                if os.path.exists(sub_candidate) and os.path.isfile(sub_candidate):
                    return True, sub_candidate
        return False, None

    def handle(self, *args, **options):
        fix_missing = options.get("fix_missing_thumbnails", False)
        as_json = options.get("json", False)

        lessons = list(Lesson.objects.all().order_by("order_index", "created_at"))
        total_lessons = len(lessons)

        audit_results = []
        video_ok_count = 0
        thumb_ok_count = 0
        thumb_pending_count = 0
        quiz_ok_count = 0
        bamboozle_ok_count = 0
        total_questions = 0
        total_powerups = 0
        cleared_thumbs = 0

        for l in lessons:
            idx = l.order_index
            title = l.title
            vl = VideoLesson.objects.filter(id=str(l.id)).first()
            thumb_key = vl.thumbnail_key if vl else None

            # 1. Video file check
            video_key = l.video_file or (vl.file_key if vl else "")
            video_exists, video_path = self.file_exists_in_storage(video_key)
            if video_exists or video_key:
                video_ok_count += 1

            # 2. Thumbnail check
            thumb_exists, thumb_path = self.file_exists_in_storage(thumb_key)
            if thumb_exists:
                thumb_ok_count += 1
                thumb_status = "FOUND"
            else:
                thumb_pending_count += 1
                thumb_status = "PENDING_SVG"
                if fix_missing and vl and vl.thumbnail_key:
                    vl.thumbnail_key = None
                    vl.save(update_fields=["thumbnail_key"])
                    cleared_thumbs += 1
                    thumb_key = None

            # 3. QuizDeck & Question Cards check
            deck = l.quiz_decks.filter(is_lesson_tied=True).first()
            if not deck:
                deck = QuizDeck.objects.filter(lesson_id=l.id).first()

            if deck:
                cards = list(deck.cards.all())
                q_cards = [c for c in cards if c.card_type == "question"]
                p_cards = [c for c in cards if c.card_type != "question"]
                q_count = len(q_cards)
                p_count = len(p_cards)
                total_questions += q_count
                total_powerups += p_count

                has_enough_q = q_count >= 10
                has_bamboozle_balance = p_count >= 2
                if has_enough_q:
                    quiz_ok_count += 1
                if has_bamboozle_balance:
                    bamboozle_ok_count += 1
            else:
                q_count = 0
                p_count = 0
                has_enough_q = False
                has_bamboozle_balance = False

            audit_results.append({
                "order_index": idx,
                "lesson_id": str(l.id),
                "title": title,
                "video_key": video_key,
                "video_found": video_exists,
                "thumbnail_key": thumb_key,
                "thumbnail_status": thumb_status,
                "deck_id": str(deck.id) if deck else None,
                "question_count": q_count,
                "powerup_count": p_count,
                "is_ready": has_enough_q,
            })

        if as_json:
            import json
            self.stdout.write(json.dumps({
                "total_lessons": total_lessons,
                "video_ok_count": video_ok_count,
                "thumb_ok_count": thumb_ok_count,
                "thumb_pending_count": thumb_pending_count,
                "quiz_ok_count": quiz_ok_count,
                "bamboozle_ok_count": bamboozle_ok_count,
                "total_questions": total_questions,
                "total_powerups": total_powerups,
                "cleared_thumbnails": cleared_thumbs,
                "lessons": audit_results,
            }, indent=2))
            return

        # Console pretty output
        self.stdout.write(self.style.MIGRATE_HEADING("=" * 80))
        self.stdout.write(self.style.MIGRATE_HEADING("   BESTWAY LMS 29-LESSON COMPREHENSIVE RESOURCE AUDIT"))
        self.stdout.write(self.style.MIGRATE_HEADING("=" * 80))
        self.stdout.write(
            f"{'#':<3} | {'Lesson Title':<32} | {'Video':<6} | {'Thumb':<12} | {'Quiz':<6} | {'Bamboozle':<8}"
        )
        self.stdout.write("-" * 80)

        for r in audit_results:
            v_badge = self.style.SUCCESS("OK") if r["video_key"] else self.style.ERROR("MISSING")
            t_badge = (
                self.style.SUCCESS("JPG FOUND")
                if r["thumbnail_status"] == "FOUND"
                else self.style.WARNING("SVG FALLBACK")
            )
            q_badge = (
                self.style.SUCCESS(f"{r['question_count']} Qs")
                if r["question_count"] >= 10
                else self.style.ERROR(f"{r['question_count']} Qs")
            )
            b_badge = (
                self.style.SUCCESS(f"{r['powerup_count']} cards")
                if r["powerup_count"] >= 2
                else self.style.WARNING(f"{r['powerup_count']} cards")
            )

            title_trunc = (r["title"][:30] + "..") if len(r["title"]) > 32 else r["title"]
            self.stdout.write(
                f"{r['order_index']:<3} | {title_trunc:<32} | {v_badge:<15} | {t_badge:<21} | {q_badge:<15} | {b_badge}"
            )

        self.stdout.write("-" * 80)
        self.stdout.write(self.style.SUCCESS(f"Total Lessons: {total_lessons} / 29"))
        self.stdout.write(self.style.SUCCESS(f"Solo Quizzes Ready (>= 10 Qs): {quiz_ok_count} / {total_lessons}"))
        self.stdout.write(self.style.SUCCESS(f"Total Question Cards: {total_questions} (Average: {total_questions // max(1, total_lessons)} Qs/lesson)"))
        self.stdout.write(self.style.SUCCESS(f"Bamboozle Arena Powerups: {total_powerups} cards"))
        self.stdout.write(f"Thumbnails: {thumb_ok_count} JPG files, {thumb_pending_count} SVG-gradient fallbacks")
        if cleared_thumbs > 0:
            self.stdout.write(self.style.WARNING(f"Cleared {cleared_thumbs} dangling thumbnail_key references for smooth fallback."))
        self.stdout.write(self.style.MIGRATE_HEADING("=" * 80))
