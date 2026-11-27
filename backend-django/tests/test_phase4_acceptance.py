from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import assessment, classroom_invitations, classroom_results, groups, live_exam_guard as guard
from apps.core import telegram_notify as notify
from apps.core.homework_scoring import ASSIGNMENT_KEY
from apps.core.models import (
    ClassroomEnrollment,
    Cohort,
    ExamIntegrityIncident,
    HomeworkAssignment,
    HomeworkSubmission,
    TelegramClassroomBinding,
    TelegramOutbox,
)
from apps.legacy_schema.models import (
    AssessmentEvaluation,
    AssessmentJob,
    Attendance,
    AuditLog,
    Group,
    MockAnswer,
    MockAttempt,
    MockExam,
    MockExamImport,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    Notification,
    SpeechTranscript,
    StudentProfile,
    User,
)

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def pg_phase4_tables():
    models = (
        User,
        Group,
        StudentProfile,
        Notification,
        AuditLog,
        MockExam,
        MockExamImport,
        MockSection,
        MockQuestionGroup,
        MockQuestion,
        MockAttempt,
        MockAnswer,
        AssessmentJob,
        AssessmentEvaluation,
        Attendance,
        SpeechTranscript,
    )
    existing = set(connection.introspection.table_names())
    created = []
    for model in models:
        if model._meta.db_table not in existing:
            with connection.schema_editor() as editor:
                editor.create_model(model)
            created.append(model)
    try:
        with transaction.atomic():
            yield
            transaction.set_rollback(True)
    finally:
        for model in reversed(created):
            with connection.schema_editor() as editor:
                editor.delete_model(model)


def make_user(role="student", name="User", tg_chat=None):
    uid = str(uuid4())
    digits = "".join(ch for ch in uid if ch.isdigit())[:7].ljust(7, "1")
    now = timezone.now()
    u = User.objects.create(
        id=uid,
        name=name,
        phone=f"+99893{digits}",
        email=f"{uid[:8]}@bestway.local",
        role=role,
        password_hash="x",
        is_active=True,
        telegram_chat_id=tg_chat,
        created_at=now,
        updated_at=now,
    )
    if role == "student":
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO "StudentProfile"
                    ("userId", "availablePrograms", "activeProgram", "isApproved",
                     "currentPoints", "gameQualified", "linkCode", "createdAt")
                   VALUES (%s, '{IELTS,MULTILEVEL}', 'IELTS', true, 0, false, %s, NOW())""",
                [uid, uid[:8].upper()],
            )
    return u


def test_full_bestway_5_end_to_end_journey(pg_phase4_tables):
    """Acceptance test: multi-group join, invitation, live guard isolation, answer disclosure, grading, analytics, Telegram."""
    now = timezone.now()
    admin = make_user("admin", "Admin Boss")
    teacher_a = make_user("teacher", "Teacher IELTS", tg_chat="77001")
    teacher_b = make_user("teacher", "Teacher Multilevel", tg_chat="77002")
    student = make_user("student", "Dilshod Student", tg_chat="88001")

    group_ielts = Group.objects.create(id=str(uuid4()), name="IELTS Advanced", teacher=teacher_a, created_at=now)
    group_multi = Group.objects.create(id=str(uuid4()), name="Multilevel B2", teacher=teacher_b, created_at=now)
    cohort_ielts = Cohort.objects.create(
        id=str(uuid4()), classroom=group_ielts, name=group_ielts.name, teacher=teacher_a, invite_code=uuid4().hex[:8].upper()
    )

    # 1. Student joins Teacher A via invitation code and Admin adds Teacher B membership simultaneously
    admin_actor = SimpleNamespace(id=admin.id, role="admin", name=admin.name, is_active=True, is_authenticated=True)
    invite = classroom_invitations.issue(
        admin_actor, group_ielts.id, requires_approval=False, expires_in_hours=24, max_uses=5
    )
    student_actor = SimpleNamespace(id=student.id, role="student", name=student.name, is_active=True, is_authenticated=True)
    joined = classroom_invitations.redeem(student_actor, invite["code"], source="telegram")
    assert joined["status"] == "active"

    groups.add_student(admin_actor, group_multi.id, student.id)
    active_group_ids = set(
        ClassroomEnrollment.objects.filter(student_id=student.id, ended_at__isnull=True).values_list("group_id", flat=True)
    )
    assert active_group_ids == {group_ielts.id, group_multi.id}

    # 2. Teacher A binds Telegram classroom chat and assigns exam
    TelegramClassroomBinding.objects.create(
        group=group_ielts,
        chat_id="-100888999",
        chat_title="IELTS Advanced Chat",
        bound_by_id=teacher_a.id,
        is_active=True,
        bot_can_post=True,
        verified_at=now,
    )
    exam = MockExam.objects.create(
        id=str(uuid4()),
        type="ielts_academic",
        title="IELTS Acceptance Mock",
        is_published=True,
        is_demo=False,
        price=0,
        is_free_for_approved=True,
        created_at=now,
        updated_at=now,
        profile="full_mock",
        content_version=1,
    )
    sec_r = MockSection.objects.create(
        id=str(uuid4()), exam=exam, skill="reading", title="Reading", sort_order=1, duration_minutes=60
    )
    qgrp = MockQuestionGroup.objects.create(
        id=str(uuid4()), section=sec_r, sort_order=1, title="P1", audio_play_limit=1, created_at=now
    )
    MockQuestion.objects.create(
        id=str(uuid4()), group=qgrp, number=1, sort_order=1, type="fill_blank", prompt="Q1", correct_answers=["accept"], points=1, created_at=now
    )
    assignment = HomeworkAssignment.objects.create(
        id=str(uuid4()),
        cohort=cohort_ielts,
        title="Acceptance IELTS HW",
        exam=exam,
        deadline=now + timedelta(hours=12),
    )
    notify.homework_assigned(assignment.id)
    assert TelegramOutbox.objects.filter(group_id=group_ielts.id, chat_id_override="-100888999").exists()

    # 3. Student starts exam -> focus loss triggers alert ONLY for Teacher A
    attempt = MockAttempt.objects.create(
        id=str(uuid4()),
        exam=exam,
        student_id=student.id,
        status="in_progress",
        mode="exam",
        flow_mode="full_test",
        anti_cheat_count=0,
        started_at=now,
        media_state={ASSIGNMENT_KEY: assignment.id},
    )
    incident = guard.record_event(student_actor, attempt, "window_blur", skill="reading", question_ref="Q1")
    inc_id = incident["incidentId"]
    assert ExamIntegrityIncident.objects.get(id=inc_id).supervisor_id == teacher_a.id
    assert TelegramOutbox.objects.filter(recipient_id=teacher_a.id, kind="teacher", dedupe_key__startswith="guard_alert:").exists()
    assert not TelegramOutbox.objects.filter(recipient_id=teacher_b.id, kind="teacher").exists()

    client_a = APIClient()
    client_a.force_authenticate(user=SimpleNamespace(id=teacher_a.id, role="teacher", name=teacher_a.name, is_authenticated=True))
    client_b = APIClient()
    client_b.force_authenticate(user=SimpleNamespace(id=teacher_b.id, role="teacher", name=teacher_b.name, is_authenticated=True))
    assert client_b.get("/v1/teacher/guard-alerts").json()["data"]["unreadCount"] == 0
    assert client_b.post(f"/v1/teacher/guard-alerts/{inc_id}/review", {"status": "acknowledged"}, format="json").status_code == 403
    assert client_a.post(f"/v1/teacher/guard-alerts/{inc_id}/review", {"status": "acknowledged"}, format="json").status_code == 200

    # 4. Student submits attempt -> answer key withheld before deadline -> Teacher A grades -> propagates cleanly
    attempt.status = "grading"
    attempt.raw_scores = {"reading": {"score": 30, "max": 40}}
    attempt.save(update_fields=["status", "raw_scores"])

    peer = make_user("student", "Peer Student")
    groups.add_student(admin_actor, group_ielts.id, peer.id)
    disclosure_before = classroom_results.answer_disclosure_status(student_actor, attempt)
    assert disclosure_before["disclosed"] is False

    teacher_a_actor = SimpleNamespace(id=teacher_a.id, role="teacher", name=teacher_a.name, is_authenticated=True)
    graded = assessment.teacher_grade_attempt(
        teacher_a_actor, attempt.id, {"finalScore": 7.0, "writingScore": 6.5, "speakingScore": 7.5}
    )
    assert graded["finalScore"] == 7.0
    sub = HomeworkSubmission.objects.get(assignment=assignment, student=student)
    assert sub.status == "graded"
    assert TelegramOutbox.objects.filter(recipient_id=student.id, kind="results", dedupe_key__startswith=f"attempt_final:{attempt.id}:").exists()

    # 5. Analytics & Telegram closed report
    analytics_resp = client_a.get(f"/v1/groups/{group_ielts.id}/analytics?assignmentId={assignment.id}")
    assert analytics_resp.status_code == 200
    analytics = analytics_resp.json()["data"]
    assert any(r["studentId"] == student.id for r in analytics["students"])
    assert any(r["studentId"] == student.id for r in analytics["ranking"])

    rep = notify.homework_group_report(assignment.id, reason="manual")
    assert rep["smallGroupSuppressed"] is True
    assert rep["queuedGroup"] is True
    assert rep["queuedTeacher"] is True
