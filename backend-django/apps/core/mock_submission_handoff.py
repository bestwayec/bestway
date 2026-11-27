"""After a hand-in is stored: assessment snapshots, jobs and notifications, once.

`submit` only scores the deterministic parts and writes a `SubmissionHandoff` row in the
same transaction. Everything slow runs here after the response: building the snapshots
reads and hashes every speaking recording, and the AI worker tick and the Telegram channel
post call external services. Nothing here may decide the student's stored result.

Exactly once: the row is locked (`SKIP LOCKED`) and `done_at` is written in the same
transaction as the jobs and notification rows, so two runners never both do the work and
a failure leaves the row pending for the next run. The assessment worker retries pending
rows, so a web process that died after answering does not lose the hand-off.
"""
import logging
import os
import threading
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.legacy_schema.models import MockAttempt

from .models import SubmissionHandoff

logger = logging.getLogger(__name__)

# A fresh row belongs to the thread its own request started; the worker waits this long.
RETRY_AFTER = timedelta(seconds=30)
MAX_TRIES = 10
_slots = threading.BoundedSemaphore(int(os.environ.get('FINISH_HANDOFF_THREADS', '2')))


def record(attempt_id, skills=None):
    """Inside the hand-in transaction: remember the work and start it after commit."""
    _, created = SubmissionHandoff.objects.get_or_create(
        attempt_id=attempt_id, defaults=dict(skills=list(skills) if skills else None, created_at=timezone.now()))
    if created:
        transaction.on_commit(lambda: schedule(attempt_id))
    return created


def _bounded(attempt_id):
    # A whole group finishing together must not start dozens of threads that read every
    # recording at once next to the request threads of the same web process.
    with _slots:
        process(attempt_id)


def schedule(attempt_id):
    from common.background import start_thread
    return start_thread(_bounded, attempt_id, name='bestway-finish-handoff')


def pending(attempt_id):
    return SubmissionHandoff.objects.filter(attempt_id=attempt_id, done_at__isnull=True).exists()


def process(attempt_id, tick=True):
    """Run one pending hand-off. True when this call did the work."""
    from .homework_scoring import ASSIGNMENT_KEY, propagate_attempt_finalization
    from .mock_submission_snapshots import enqueue, notify
    with transaction.atomic():
        row = (SubmissionHandoff.objects.select_for_update(skip_locked=True)
               .filter(attempt_id=attempt_id, done_at__isnull=True).first())
        if row is None:
            return False
        attempt = MockAttempt.objects.select_related('exam').filter(id=attempt_id).first()
        if attempt is None or attempt.status == 'in_progress':
            # Nothing was handed in (attempt removed, or the hand-in rolled back elsewhere).
            row.done_at, row.last_error = timezone.now(), 'NO_SUBMITTED_ATTEMPT'
            row.save(update_fields=['done_at', 'last_error'])
            return False
        try:
            with transaction.atomic():
                enqueue(attempt, row.skills)
                notify(attempt)
                if ASSIGNMENT_KEY in (attempt.media_state or {}):
                    propagate_attempt_finalization(attempt)
        except Exception as error:
            row.tries += 1
            row.last_error = repr(error)[:1000]
            row.save(update_fields=['tries', 'last_error'])
            logger.exception('Finish hand-off for attempt %s failed (try %s)', attempt_id, row.tries)
            return False
        row.done_at, row.last_error = timezone.now(), None
        row.save(update_fields=['done_at', 'last_error'])
    if tick and os.environ.get('ASSESSMENT_INLINE_TICK', 'true').lower() != 'false':
        from . import assessment_worker
        assessment_worker.tick()
    return True


def process_pending(limit=20):
    """Worker loop: hand-offs whose own thread never finished them."""
    cutoff = timezone.now() - RETRY_AFTER
    ids = list(SubmissionHandoff.objects.filter(done_at__isnull=True, created_at__lte=cutoff, tries__lt=MAX_TRIES)
               .order_by('created_at').values_list('attempt_id', flat=True)[:limit])
    done = 0
    for attempt_id in ids:
        try:
            done += bool(process(attempt_id, tick=False))
        except Exception:
            logger.exception('Pending finish hand-off %s failed', attempt_id)
    return done


def wait(attempt_id, timeout=30.0):
    """Block until the hand-off of one attempt is done (checks and tooling, not requests)."""
    import time
    deadline = time.monotonic() + timeout
    while pending(attempt_id):
        process(attempt_id, tick=False)
        if time.monotonic() > deadline:
            return False
        time.sleep(0.05)
    return True
