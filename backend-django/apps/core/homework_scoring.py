"""Server-side homework results. The client never supplies a score.

- Exam-linked homework: the score is the student's own attempt on that exam,
  started after the homework was set: sum(raw score) / sum(raw max) over the
  attempt's stored ``raw_scores``. While the attempt is being graded the
  submission waits for the result; a completed attempt without an objective
  result waits for the teacher.
- Other homework: the submission waits for the teacher, who sets the score.
"""
from __future__ import annotations

from django.db.models.fields.json import KeyTextTransform
from django.utils import timezone

from apps.legacy_schema.models import MockAttempt, MockExam

from .models import HomeworkAssignment, HomeworkSubmission

GRADED = "graded"
AWAITING_RESULT = "awaiting_result"
AWAITING_REVIEW = "awaiting_review"
ASSIGNMENT_KEY = "__homework_assignment"


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
    rows = MockAttempt.objects.filter(exam_id=assignment.exam_id, student_id=student_id,
                                     started_at__gte=assignment.created_at, status__in=("completed", "grading"))
    linked = rows.alias(assignment=KeyTextTransform(ASSIGNMENT_KEY, "media_state")).filter(
        assignment=assignment.id,
    ).order_by("-started_at").first()
    if linked is not None:
        return linked
    from .classrooms import is_linked

    if is_linked(assignment.cohort):
        return None
    return rows.exclude(media_state__has_key=ASSIGNMENT_KEY).order_by("-started_at").first()


def finalized_attempt_percent(attempt) -> int | None:
    if attempt.status != "completed":
        return None
    if attempt.exam_id:
        exam = getattr(attempt, "exam", None) or MockExam.objects.filter(pk=attempt.exam_id).first()
        if exam and exam.type == "multilevel" and attempt.overall_score is not None:
            return round(min(100, max(0, float(attempt.overall_score) * 100.0 / 75.0)))
    if attempt.overall_band is not None:
        return round(min(100, max(0, float(attempt.overall_band) * 100.0 / 9.0)))
    return attempt_percent(attempt)


def sync_from_exam(assignment, student_id, *, attempt=None, graded_by_id=None):
    """Create or refresh the submission from the student's real attempt.
    Returns the submission, or None when the student has no attempt yet.
    A manual non-exam teacher grade is never overwritten."""
    existing = HomeworkSubmission.objects.filter(assignment=assignment, student_id=student_id).first()
    if existing is not None and existing.source == "teacher":
        return existing
    if attempt is None:
        attempt = latest_attempt(assignment, student_id)
    if attempt is None:
        return existing if existing is not None and existing.source == "exam_attempt" else None
    is_reviewed = bool((attempt.media_state or {}).get("is_teacher_reviewed"))
    percent = finalized_attempt_percent(attempt) if is_reviewed else (attempt_percent(attempt) if attempt.status == "completed" else None)
    if attempt.status != "completed":
        status = AWAITING_RESULT
    elif percent is None:
        status = AWAITING_REVIEW
    else:
        status = GRADED
    reviewer_id = graded_by_id or (existing.graded_by_id if existing else None)
    values = dict(
        score_percent=percent or 0,
        is_passed=status == GRADED and percent >= assignment.min_pass_percent,
        status=status,
        source="exam_attempt",
        attempt_id=attempt.id,
        graded_at=timezone.now() if status == GRADED else None,
        graded_by_id=reviewer_id if status == GRADED else None,
    )
    if existing is not None and all(getattr(existing, k) == v for k, v in values.items() if k != "graded_at"):
        return existing
    submission, _ = HomeworkSubmission.objects.update_or_create(
        assignment=assignment, student_id=student_id, defaults=values)
    return submission


def propagate_attempt_finalization(attempt, actor=None, *, now=None) -> list:
    """Propagate finalized teacher/exam grades to linked HomeworkSubmission and private Telegram notifications."""
    from html import escape as html_escape

    from . import telegram_notify as tg_notify
    from . import telegram_outbox as outbox
    from . import telegram_state as tg_state

    now = now or timezone.now()
    actor_id = getattr(actor, "id", None)
    assignment_ids = set(
        HomeworkSubmission.objects.filter(attempt_id=attempt.id, student_id=attempt.student_id)
        .values_list("assignment_id", flat=True)
    )
    linked_id = (attempt.media_state or {}).get(ASSIGNMENT_KEY)
    if linked_id:
        assignment_ids.add(linked_id)

    synced = []
    if assignment_ids:
        for assignment in HomeworkAssignment.objects.filter(id__in=assignment_ids):
            sub = sync_from_exam(assignment, attempt.student_id, attempt=attempt, graded_by_id=actor_id)
            if sub is not None:
                synced.append(sub)

    if attempt.status == "completed":
        exam = getattr(attempt, "exam", None) or MockExam.objects.filter(pk=attempt.exam_id).first()
        exam_title = exam.title if exam else "Mock Exam"
        if exam and exam.type == "multilevel" and attempt.overall_score is not None:
            headline = f"{attempt.overall_score:g}/75 ({attempt.cefr_level or '—'})"
        elif attempt.overall_band is not None:
            headline = f"Band {attempt.overall_band:g}"
        else:
            pct = finalized_attempt_percent(attempt)
            headline = f"{pct}%" if pct is not None else "—"
        rev = str((attempt.media_state or {}).get("teacher_reviewed_at") or int(now.timestamp()))
        lang = tg_state.language_of(attempt.student_id)
        text = {
            "uz": f"🎓 <b>{html_escape(exam_title)}</b> yakuniy natijangiz tasdiqlandi: <b>{html_escape(headline)}</b>.",
            "en": f"🎓 Your final result for <b>{html_escape(exam_title)}</b> is confirmed: <b>{html_escape(headline)}</b>.",
        }[lang]
        outbox.enqueue(
            attempt.student_id,
            "results",
            f"attempt_final:{attempt.id}:{rev}"[:250],
            text,
            now=now,
        )
    return synced


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
