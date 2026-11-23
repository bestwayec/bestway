"""Exam lifecycle: DRAFT -> VALIDATED -> PUBLISHED -> ARCHIVED.

Stored on additive, nullable MockExam columns; `is_published` stays the single switch every
existing student path already checks.

* DRAFT      — not published, not archived, no current validation.
* VALIDATED  — the readiness check passed for the *current* `content_version`
               (`validated_version == content_version`). Any later edit bumps the version, so a
               stale validation silently returns the exam to DRAFT without another write.
* PUBLISHED  — `is_published`. Publishing still runs the full readiness check (unchanged).
* ARCHIVED   — `archived_at` set: withdrawn from students (unpublished, not a demo), content locked,
               attempts and results untouched. Restore returns it to DRAFT/VALIDATED.
"""
from __future__ import annotations

from django.db import connection, transaction
from django.utils import timezone

from common.api.exceptions import ContractAPIException

from .auth_service import audit
from .mock_authoring import assert_author, locked_exam, readiness

DRAFT, VALIDATED, PUBLISHED, ARCHIVED = 'draft', 'validated', 'published', 'archived'
STATES = (DRAFT, VALIDATED, PUBLISHED, ARCHIVED)


def lifecycle(exam) -> str:
    if getattr(exam, 'archived_at', None):
        return ARCHIVED
    if exam.is_published:
        return PUBLISHED
    version = getattr(exam, 'validated_version', None)
    if version is not None and version == exam.content_version:
        return VALIDATED
    return DRAFT


def payload(exam) -> dict:
    return dict(id=exam.id, lifecycle=lifecycle(exam), isPublished=exam.is_published,
                validatedAt=exam.validated_at, validatedVersion=exam.validated_version,
                contentVersion=exam.content_version, archivedAt=exam.archived_at)


def _audit(actor, action, exam_id, new):
    with connection.cursor() as cursor:
        audit(cursor, actor.id, action, 'mockExam', exam_id, new=new)


def validate_exam(actor, exam_id: str) -> dict:
    """Run the publish readiness check and record it for the current content version."""
    with transaction.atomic():
        exam = locked_exam(exam_id)
        assert_author(actor, exam)
        if exam.archived_at:
            raise ContractAPIException('MOCK_EXAM_ARCHIVED', 'Restore the archived exam before validating it', 409)
        report = readiness(actor, exam_id)
        if not report['ready']:
            failing = [dict(key=i['key'], detail=i.get('detail')) for i in report['items'] if not i['ok']]
            raise ContractAPIException('MOCK_NOT_READY', 'Exam is not ready: ' + '; '.join(i['detail'] or i['key'] for i in failing), 400,
                                       details=dict(items=failing))
        exam.validated_at, exam.validated_version, exam.updated_at = timezone.now(), exam.content_version, timezone.now()
        exam.save(update_fields=['validated_at', 'validated_version', 'updated_at'])
        _audit(actor, 'mock.exam.validate', exam.id, dict(contentVersion=exam.content_version))
    return payload(exam)


def archive_exam(actor, exam_id: str) -> dict:
    """Withdraw an exam from students. Attempts, answers and results are not modified."""
    with transaction.atomic():
        exam = locked_exam(exam_id)
        assert_author(actor, exam)
        if exam.archived_at:
            return payload(exam)  # idempotent
        was_published = exam.is_published
        exam.archived_at, exam.is_published, exam.is_demo, exam.updated_at = timezone.now(), False, False, timezone.now()
        exam.save(update_fields=['archived_at', 'is_published', 'is_demo', 'updated_at'])
        _audit(actor, 'mock.exam.archive', exam.id, dict(wasPublished=was_published))
    return payload(exam)


def restore_exam(actor, exam_id: str) -> dict:
    """Return an archived exam to the editable draft lifecycle (it is not republished)."""
    with transaction.atomic():
        exam = locked_exam(exam_id)
        assert_author(actor, exam)
        if not exam.archived_at:
            return payload(exam)
        exam.archived_at, exam.updated_at = None, timezone.now()
        exam.save(update_fields=['archived_at', 'updated_at'])
        _audit(actor, 'mock.exam.restore', exam.id, {})
    return payload(exam)


def assert_not_archived(exam) -> None:
    if getattr(exam, 'archived_at', None):
        raise ContractAPIException('MOCK_EXAM_ARCHIVED', 'This exam is archived. Restore it before editing or publishing', 409)
