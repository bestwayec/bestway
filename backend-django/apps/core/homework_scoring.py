"""Server-side homework results. The client never supplies a score.

- Exam-linked homework: the score is the student's own attempt on that exam,
  started after the homework was set: sum(raw score) / sum(raw max) over the
  attempt's stored ``raw_scores``. While the attempt is being graded the
  submission waits for the result; a completed attempt without an objective
  result waits for the teacher.
- Other homework: the submission waits for the teacher, who sets the score.
"""
from __future__ import annotations

from django.utils import timezone

from apps.legacy_schema.models import MockAttempt

from .models import HomeworkSubmission

GRADED = "graded"
AWAITING_RESULT = "awaiting_result"
AWAITING_REVIEW = "awaiting_review"


def attempt_percent(attempt) -> int | None:
    raw = attempt.raw_scores if isinstance(attempt.raw_scores, dict) else {}
    total = score = 0
    for value in raw.values():
        if isinstance(value, dict) and isinstance(value.get("max"), (int, float)) and value["max"] > 0:
            total += value["max"]
            score += value.get("score") or 0
    return round(100 * score / total) if total else None


def latest_attempt(assignment, student_id):
    if not assignment.exam_id:
        return None
    return (MockAttempt.objects
            .filter(exam_id=assignment.exam_id, student_id=student_id,
                    started_at__gte=assignment.created_at, status__in=("completed", "grading"))
            .order_by("-started_at").first())


def sync_from_exam(assignment, student_id):
    """Create or refresh the submission from the student's real attempt.
    Returns the submission, or None when the student has no attempt yet.
    A teacher's grade is never overwritten."""
    existing = HomeworkSubmission.objects.filter(assignment=assignment, student_id=student_id).first()
    if existing is not None and existing.source == "teacher":
        return existing
    attempt = latest_attempt(assignment, student_id)
    if attempt is None:
        return existing if existing is not None and existing.source == "exam_attempt" else None
    percent = attempt_percent(attempt) if attempt.status == "completed" else None
    if attempt.status != "completed":
        status = AWAITING_RESULT
    elif percent is None:
        status = AWAITING_REVIEW
    else:
        status = GRADED
    values = dict(score_percent=percent or 0, is_passed=status == GRADED and percent >= assignment.min_pass_percent,
                  status=status, source="exam_attempt", attempt_id=attempt.id,
                  graded_at=timezone.now() if status == GRADED else None, graded_by_id=None)
    if existing is not None and all(getattr(existing, k) == v for k, v in values.items() if k != "graded_at"):
        return existing
    submission, _ = HomeworkSubmission.objects.update_or_create(
        assignment=assignment, student_id=student_id, defaults=values)
    return submission


def submit_for_review(assignment, student_id):
    """Non-exam homework: mark as handed in; only the teacher sets the score."""
    existing = HomeworkSubmission.objects.filter(assignment=assignment, student_id=student_id).first()
    if existing is not None and existing.source == "teacher":
        return existing
    submission, _ = HomeworkSubmission.objects.update_or_create(
        assignment=assignment, student_id=student_id,
        defaults=dict(score_percent=0, is_passed=False, status=AWAITING_REVIEW, source="student",
                      attempt_id=None, graded_by_id=None, graded_at=None))
    return submission


def teacher_grade(assignment, student_id, score_percent, teacher_id):
    submission, _ = HomeworkSubmission.objects.update_or_create(
        assignment=assignment, student_id=student_id,
        defaults=dict(score_percent=score_percent, is_passed=score_percent >= assignment.min_pass_percent,
                      status=GRADED, source="teacher", graded_by_id=teacher_id, graded_at=timezone.now()))
    return submission


def payload(sub):
    return {
        "id": sub.id, "assignment_id": sub.assignment_id, "student_id": str(sub.student_id),
        "score_percent": sub.score_percent if sub.status == GRADED else None,
        "is_passed": sub.is_passed, "status": sub.status, "source": sub.source,
        "attempt_id": sub.attempt_id,
        "completed_at": sub.completed_at.isoformat() if sub.completed_at else None,
    }
