"""Deterministic review scheduling and ownership-bound review batches."""
from datetime import timedelta

from django.db.models import Q

from .models import UserWeakWord, VocabularyReviewEvent


INTERVALS = (1, 3, 7, 14, 30)


def due(student_id, now):
    return UserWeakWord.objects.filter(student_id=student_id).filter(
        Q(next_review_at__lte=now) | Q(next_review_at__isnull=True, is_mastered=False)
    )


def record_answer(student_id, word, correct, now):
    row, _ = UserWeakWord.objects.select_for_update().get_or_create(
        student_id=student_id, word=word, defaults={"mistake_count": 0},
    )
    update_review(row, correct, now)
    return row


def update_review(row, correct, now):
    row.review_count += 1
    if correct:
        row.correct_streak += 1
        row.is_mastered = row.correct_streak >= 2
        row.interval_days = INTERVALS[min(row.correct_streak - 1, len(INTERVALS) - 1)]
        delay = timedelta(days=row.interval_days)
    else:
        row.mistake_count += 1
        row.lapses += int(row.correct_streak > 0)
        row.correct_streak = 0
        row.is_mastered = False
        row.interval_days = 0
        delay = timedelta(minutes=10)
    row.next_review_at = now + delay
    row.save(update_fields=[
        "review_count", "correct_streak", "is_mastered", "interval_days",
        "mistake_count", "lapses", "next_review_at", "last_reviewed",
    ])
    VocabularyReviewEvent.objects.create(
        review=row, reviewed_at=now, next_review_at=row.next_review_at,
        correct=correct, interval_days=row.interval_days, mastered=row.is_mastered,
    )
