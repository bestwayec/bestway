"""Server-authoritative exam closure (BESTWAY 5.1).

An attempt whose server deadline has passed is handed in by the worker, so a student who
closed the browser (or lost power) is finalized without visiting the page again.

* Eligible: ``status='in_progress'`` and ``mode='timed'`` whose own overall deadline passed
  more than ``GRACE`` ago. The grace covers the existing Speaking upload recovery window
  (phase end + 5 minutes) and a client Finish racing the deadline, so a recording accepted
  inside its permitted window is never cut off by the sweep.
* An attempt without its own deadline that belongs to an exam assignment (legacy full tests
  clear the timer while Speaking task timers run) closes ``NO_DEADLINE_CAP`` after the
  assignment deadline: an expired classroom exam never stays open indefinitely.
* The hand-in reuses ``mock_submissions.submit`` (same lock, validation, deterministic
  scoring and SubmissionHandoff for assessment jobs, notifications and homework sync). No
  second scoring path exists. Answers already confirmed by the server are kept; nothing that
  did not reach the server is claimed as received.
* Exactly-once: the attempt row is claimed with ``SELECT ... FOR UPDATE SKIP LOCKED`` and its
  status is re-checked inside the transaction; ``submit`` itself is idempotent. Two workers,
  a duplicate sweep, a worker restart or a simultaneous manual Finish produce one result.
* Catch-up: the query has no lower time bound, so attempts that expired while every worker
  was down are finalized on the next sweep.
"""
from __future__ import annotations

import logging
import os
from datetime import timedelta
from types import SimpleNamespace

from django.db import connection, transaction
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.legacy_schema.models import MockAttempt

from .homework_scoring import ASSIGNMENT_KEY
from .mock_attempts import AUTO_SUBMIT_KEY, aware, iso

logger = logging.getLogger(__name__)


def grace():
    try:
        return timedelta(seconds=max(0, int(os.environ.get('EXAM_AUTO_SUBMIT_GRACE_SECONDS', '360'))))
    except ValueError:
        return timedelta(seconds=360)


def objective_grace():
    """Grace for attempts with no Speaking in scope: only a racing Finish needs time (answers
    after the deadline are already rejected), so these close sooner than Speaking attempts."""
    try:
        return min(grace(), timedelta(seconds=max(0, int(os.environ.get('EXAM_AUTO_SUBMIT_OBJECTIVE_GRACE_SECONDS', '60')))))
    except ValueError:
        return min(grace(), timedelta(seconds=60))


def has_speaking(attempt):
    """Speaking in this attempt's scope keeps the full upload-recovery grace."""
    from apps.legacy_schema.models import MockSection
    from .mock_practice import is_partial, scope
    if is_partial(attempt):
        return 'speaking' in ((scope(attempt) or {}).get('skills') or [])
    return MockSection.objects.filter(exam_id=attempt.exam_id, skill='speaking').exists()


def attempt_grace(attempt):
    return grace() if has_speaking(attempt) else objective_grace()


NO_DEADLINE_CAP = timedelta(hours=3)
BATCH = 50


def own_deadline(attempt):
    value = attempt.overall_deadline_at or attempt.deadline_at
    return aware(value) if value else None


def closing_time(attempt, assignments=None):
    """When the server may hand the attempt in, or None while it may still run."""
    deadline = own_deadline(attempt)
    if deadline is not None:
        return deadline + attempt_grace(attempt) if attempt.mode == 'timed' else None
    assignment_id = (attempt.media_state or {}).get(ASSIGNMENT_KEY)
    if not assignment_id:
        return None
    from .models import HomeworkAssignment
    close = (assignments or {}).get(assignment_id)
    if close is None:
        close = HomeworkAssignment.objects.filter(pk=assignment_id).values_list('deadline', flat=True).first()
    return aware(close) + NO_DEADLINE_CAP if close else None


def candidates(now, limit=BATCH):
    """Bounded list of expired in-progress attempt ids, oldest deadline first."""
    cutoff = now - objective_grace()   # finalize() re-checks the attempt's own grace
    timed = list(MockAttempt.objects.filter(status='in_progress', mode='timed')
                 .annotate(close=Coalesce('overall_deadline_at', 'deadline_at'))
                 .filter(close__lt=cutoff).order_by('close').values_list('id', flat=True)[:limit])
    if len(timed) >= limit:
        return timed
    from .models import HomeworkAssignment
    untimed = list(MockAttempt.objects.filter(status='in_progress', overall_deadline_at__isnull=True,
                                              deadline_at__isnull=True, media_state__has_key=ASSIGNMENT_KEY)
                   .values_list('id', 'media_state')[:500])
    ids = {(state or {}).get(ASSIGNMENT_KEY) for _, state in untimed}
    closed = set(HomeworkAssignment.objects.filter(pk__in=ids, deadline__lt=now - NO_DEADLINE_CAP).values_list('pk', flat=True))
    timed += [aid for aid, state in untimed if (state or {}).get(ASSIGNMENT_KEY) in closed][:limit - len(timed)]
    return timed


def finalize(attempt_id, now=None):
    """Hand in one expired attempt. Returns the stored result dict, or None when not eligible."""
    from . import mock_submissions
    from .auth_service import audit
    now = now or timezone.now()
    with transaction.atomic():
        attempt = (MockAttempt.objects.select_for_update(skip_locked=True)
                   .filter(id=attempt_id, status='in_progress').first())
        if attempt is None:
            return None  # finished meanwhile, or another worker holds it
        close = closing_time(attempt)
        if close is None or now < close:
            return None
        deadline = own_deadline(attempt)
        student = SimpleNamespace(id=attempt.student_id, role='student', is_authenticated=True)
        # The student's own boundary: the same lock, validation and scoring as Finish.
        result = mock_submissions.submit(student, attempt.id, require_expired=deadline is not None)
        state = dict(MockAttempt.objects.filter(id=attempt.id).values_list('media_state', flat=True).first() or {})
        state[AUTO_SUBMIT_KEY] = dict(at=iso(now), deadline=iso(deadline) if deadline else None,
                                      reason='deadline' if deadline else 'assignment_closed')
        MockAttempt.objects.filter(id=attempt.id).update(media_state=state)
        with connection.cursor() as cursor:
            audit(cursor, None, 'mock.attempt.auto_submit', 'mockAttempt', attempt.id,
                  new=dict(status=result['status'], deadline=state[AUTO_SUBMIT_KEY]['deadline'],
                           reason=state[AUTO_SUBMIT_KEY]['reason']))
        transaction.on_commit(lambda: notify_student(attempt, now), robust=True)
    logger.info('Auto-submitted expired attempt %s (%s)', attempt_id, result['status'])
    return result


def sweep(now=None, limit=BATCH):
    """One bounded pass. Returns the number of attempts handed in by this call."""
    now = now or timezone.now()
    done = 0
    for attempt_id in candidates(now, limit):
        try:
            done += finalize(attempt_id, now) is not None
        except Exception:  # noqa: BLE001 - one broken attempt must not stop the others
            logger.exception('Automatic hand-in of attempt %s failed', attempt_id)
    return done


def notify_student(attempt, now):
    """Private notice to the student only: the server handed the exam in at the deadline."""
    from html import escape
    from apps.legacy_schema.models import MockExam
    from . import telegram_outbox as outbox, telegram_state as state
    title = MockExam.objects.filter(id=attempt.exam_id).values_list('title', flat=True).first() or 'Exam'
    lang = state.language_of(attempt.student_id)
    text = {'uz': f"⏰ <b>{escape(title)}</b> vaqti tugadi. Server saqlangan javoblaringizni avtomatik topshirdi.",
            'en': f"⏰ Time is up for <b>{escape(title)}</b>. The server handed in your saved answers automatically."}[lang]
    outbox.enqueue(attempt.student_id, 'results', f'auto_submit:{attempt.id}', text, now=now)
