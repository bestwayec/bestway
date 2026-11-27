from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import assessment, groups
from apps.core import telegram_classroom_service as bindings
from apps.core import telegram_notify as notify
from apps.core import telegram_outbox as outbox
from apps.core import telegram_teacher as bot_teacher
from apps.core.homework_scoring import ASSIGNMENT_KEY
from apps.core.models import (
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
    ParentStudent,
    SpeechTranscript,
    StudentProfile,
    User,
)

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def pg_phase3_tables():
    models = (
        User,
        Group,
        StudentProfile,
        Notification,
        ParentStudent,
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
        phone=f"+99891{digits}",
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


def make_exam(title="Mock Exam", exam_type="ielts_academic"):
    now = timezone.now()
    return MockExam.objects.create(
        id=str(uuid4()),
        type=exam_type,
        title=title,
        is_published=True,
        is_demo=False,
        price=0,
        is_free_for_approved=True,
        created_at=now,
        updated_at=now,
        profile="full_mock",
        content_version=1,
    )


def test_binding_and_disconnect_invalidates_outbox(pg_phase3_tables, monkeypatch):
    teacher_a = make_user("teacher", "Teacher A", tg_chat="70001")
    teacher_b = make_user("teacher", "Teacher B", tg_chat="70002")
    student = make_user("student", "Student One", tg_chat="80001")
    group_a = Group.objects.create(id=str(uuid4()), name="IELTS Binding A", teacher=teacher_a, created_at=timezone.now())
    groups.add_student(teacher_a, group_a.id, student.id)
    cohort_a = Cohort.objects.create(id=str(uuid4()), classroom=group_a, name=group_a.name, teacher=teacher_a, invite_code=uuid4().hex[:8].upper())

    exam = make_exam("IELTS Test Bind", "ielts_academic")
    assignment = HomeworkAssignment.objects.create(
        id=str(uuid4()),
        cohort=cohort_a,
        title="Bind Homework",
        exam=exam,
        deadline=timezone.now() + timedelta(days=2),
    )

    client_b = APIClient()
    client_b.force_authenticate(user=SimpleNamespace(id=teacher_b.id, role="teacher", name=teacher_b.name, is_authenticated=True))
    denied = client_b.post(f"/v1/groups/{group_a.id}/telegram-binding", {"chatId": "-100999888"}, format="json")
    assert denied.status_code == 403

    client_a = APIClient()
    client_a.force_authenticate(user=SimpleNamespace(id=teacher_a.id, role="teacher", name=teacher_a.name, is_authenticated=True))
    path = f"/v1/groups/{group_a.id}/telegram-binding"
    chat_id = "-100999888"
    assert client_a.post(path, {"chatId": chat_id}, format="json").status_code == 403

    from common.api.exceptions import ContractAPIException

    with patch.object(bindings.api, "call", return_value=None), pytest.raises(ContractAPIException) as unavailable:
        bindings.request_binding(teacher_a, group_a.id, chat_id, sender_id="70001")
    assert unavailable.value.status_code == 503

    manager = {"status": "member"}

    def telegram(method, payload):
        if method == "getChat":
            return {"id": int(chat_id), "type": "supergroup", "title": "IELTS Group Chat"}
        if method == "getMe":
            return {"id": 42}
        return {"status": "administrator"} if payload["user_id"] == 42 else manager

    monkeypatch.setattr(bindings.api, "call", telegram)
    with pytest.raises(ContractAPIException) as unauthorized:
        bindings.request_binding(teacher_a, group_a.id, chat_id, sender_id="70001")
    assert unauthorized.value.status_code == 403
    manager["status"] = "administrator"
    token = bindings.request_binding(teacher_a, group_a.id, chat_id, sender_id="70001")
    assert client_a.post(path, {"chatId": "-1000000", "confirmation": token}, format="json").status_code == 403
    bound = client_a.post(path, {"chatId": chat_id, "confirmation": token}, format="json")
    assert client_a.post(path, {"chatId": chat_id, "confirmation": token}, format="json").status_code == 409
    assert bound.status_code == 200
    assert bound.json()["data"]["bound"] is True

    queued = notify.homework_assigned(assignment.id)
    assert queued >= 2
    group_msg = TelegramOutbox.objects.filter(group_id=group_a.id, chat_id_override="-100999888").first()
    assert group_msg is not None
    assert group_msg.status == "pending"

    manager["status"] = "member"
    with patch.object(outbox.api, "send_detailed") as sender:
        assert outbox._send_group(group_msg, timezone.now()) == ("skipped", "group_authority_revoked")
        sender.assert_not_called()

    disc = client_a.delete(f"/v1/groups/{group_a.id}/telegram-binding")
    assert disc.status_code == 200
    assert disc.json()["data"]["disconnected"] is True
    assert disc.json()["data"]["invalidatedCount"] >= 1

    group_msg.refresh_from_db()
    assert group_msg.status == "skipped"
    assert group_msg.last_error == "group_disconnected"


def test_small_group_privacy_and_provisional_group_report(pg_phase3_tables):
    teacher = make_user("teacher", "Teacher Report", tg_chat="70010")
    student = make_user("student", "Student Report", tg_chat="80010")
    group = Group.objects.create(id=str(uuid4()), name="Small Cohort", teacher=teacher, created_at=timezone.now())
    groups.add_student(teacher, group.id, student.id)
    cohort = Cohort.objects.create(id=str(uuid4()), classroom=group, name=group.name, teacher=teacher, invite_code=uuid4().hex[:8].upper())
    TelegramClassroomBinding.objects.create(
        group=group,
        chat_id="-100555111",
        chat_title="Small Group",
        bound_by_id=teacher.id,
        verified_telegram_id=teacher.telegram_chat_id,
        is_active=True,
        bot_can_post=True,
        verified_at=timezone.now(),
    )
    exam = make_exam("Multilevel Mock 9", "multilevel")
    assignment = HomeworkAssignment.objects.create(
        id=str(uuid4()),
        cohort=cohort,
        title="Small Privacy Exam",
        exam=exam,
        deadline=timezone.now() - timedelta(hours=1),
    )
    attempt = MockAttempt.objects.create(
        id=str(uuid4()),
        exam=exam,
        student_id=student.id,
        status="completed",
        mode="exam",
        overall_score=58.0,
        cefr_level="C1",
        started_at=assignment.created_at + timedelta(seconds=1),
        finished_at=timezone.now(),
        anti_cheat_count=0,
        media_state={ASSIGNMENT_KEY: assignment.id},
    )
    AssessmentJob.objects.create(
        id=str(uuid4()),
        attempt=attempt,
        student_id=student.id,
        program="MULTILEVEL",
        skill="writing",
        input_hash="h1",
        input_snapshot={"program": "MULTILEVEL", "skill": "writing", "parts": []},
        generation=1,
        attempt_count=1,
        version=1,
        rubric_version="MULTILEVEL_WRITING_V1",
        prompt_version="V1",
        status="NEEDS_REVIEW",
        ai_score=19.0,
        final_score=19.0,
        final_score_source="AI",
        created_at=timezone.now(),
        updated_at=timezone.now(),
    )

    rep = notify.homework_group_report(assignment.id, reason="closed")
    assert rep["smallGroupSuppressed"] is True
    assert rep["provisional"] is True
    assert rep["queuedGroup"] is True
    assert rep["queuedTeacher"] is True

    group_row = TelegramOutbox.objects.filter(group_id=group.id, kind="announcements").latest("id")
    assert "maxfiyligi" in group_row.text.lower() or "privacy" in group_row.text.lower()
    assert "Provisional" in group_row.text or "Taxminiy" in group_row.text

    teacher_row = TelegramOutbox.objects.filter(recipient_id=teacher.id, kind="teacher").latest("id")
    assert "Small Privacy Exam" in teacher_row.text


def test_configurable_tashkent_reminders_and_deadline_change(pg_phase3_tables):
    teacher = make_user("teacher", "Teacher Rem", tg_chat="70020")
    pending_student = make_user("student", "Pending Stu", tg_chat="80020")
    done_student = make_user("student", "Done Stu", tg_chat="80021")
    group = Group.objects.create(id=str(uuid4()), name="Reminders Group", teacher=teacher, created_at=timezone.now())
    groups.add_student(teacher, group.id, pending_student.id)
    groups.add_student(teacher, group.id, done_student.id)
    cohort = Cohort.objects.create(id=str(uuid4()), classroom=group, name=group.name, teacher=teacher, invite_code=uuid4().hex[:8].upper())

    now = timezone.now()
    assignment = HomeworkAssignment.objects.create(
        id=str(uuid4()),
        cohort=cohort,
        title="Vocabulary HW",
        deadline=now + timedelta(hours=12),
    )
    HomeworkSubmission.objects.create(
        assignment=assignment,
        student=done_student,
        score_percent=95,
        is_passed=True,
        status="graded",
        source="student",
    )

    sent = notify.homework_deadline_sweep(now=now, windows=(24, 2))
    assert sent == 1
    assert TelegramOutbox.objects.filter(recipient_id=pending_student.id, kind="deadlines").count() == 1
    assert TelegramOutbox.objects.filter(recipient_id=done_student.id, kind="deadlines").count() == 0

    assignment.deadline = now + timedelta(hours=20)
    assignment.save(update_fields=["deadline"])
    sent_after_move = notify.homework_deadline_sweep(now=now, windows=(24, 2))
    assert sent_after_move == 1
    assert TelegramOutbox.objects.filter(recipient_id=pending_student.id, kind="deadlines").count() == 2


def test_teacher_grade_propagates_to_homework_and_telegram(pg_phase3_tables):
    teacher = make_user("teacher", "Teacher Grade", tg_chat="70030")
    student = make_user("student", "Student Grade", tg_chat="80030")
    group = Group.objects.create(id=str(uuid4()), name="Grade Prop", teacher=teacher, created_at=timezone.now())
    groups.add_student(teacher, group.id, student.id)
    cohort = Cohort.objects.create(id=str(uuid4()), classroom=group, name=group.name, teacher=teacher, invite_code=uuid4().hex[:8].upper())
    exam = make_exam("IELTS Prop Exam", "ielts_academic")
    assignment = HomeworkAssignment.objects.create(
        id=str(uuid4()),
        cohort=cohort,
        title="IELTS HW",
        exam=exam,
        deadline=timezone.now() + timedelta(days=1),
        min_pass_percent=60,
    )
    attempt = MockAttempt.objects.create(
        id=str(uuid4()),
        exam=exam,
        student_id=student.id,
        status="grading",
        mode="exam",
        raw_scores={"listening": {"score": 30, "max": 40}},
        started_at=timezone.now() - timedelta(minutes=20),
        anti_cheat_count=0,
        media_state={ASSIGNMENT_KEY: assignment.id},
    )
    HomeworkSubmission.objects.create(
        assignment=assignment,
        student=student,
        score_percent=0,
        is_passed=False,
        status="awaiting_review",
        source="exam_attempt",
        attempt_id=attempt.id,
    )

    actor = SimpleNamespace(id=teacher.id, role="teacher", name=teacher.name, is_authenticated=True)
    res = assessment.teacher_grade_attempt(
        actor,
        attempt.id,
        {"finalScore": 7.5, "writingScore": 7.0, "speakingScore": 7.5, "teacherComment": "Well done"},
    )
    assert res["finalScore"] == 7.5

    sub = HomeworkSubmission.objects.get(assignment=assignment, student=student)
    assert sub.status == "graded"
    assert sub.score_percent == 83
    assert sub.is_passed is True

    tg_res = TelegramOutbox.objects.filter(
        recipient_id=student.id, kind="results", dedupe_key__startswith=f"attempt_final:{attempt.id}:"
    ).first()
    assert tg_res is not None
    assert "7.5" in tg_res.text


def test_teacher_bot_menu_includes_binding_and_monitoring(pg_phase3_tables):
    teacher = make_user("teacher", "Bot Teacher", tg_chat="70040")
    student = make_user("student", "Bot Student", tg_chat="80040")
    group = Group.objects.create(id=str(uuid4()), name="Bot Cohort", teacher=teacher, created_at=timezone.now())
    groups.add_student(teacher, group.id, student.id)
    TelegramClassroomBinding.objects.create(
        group=group,
        chat_id="-100777888",
        chat_title="Bot Group",
        bound_by_id=teacher.id,
        verified_telegram_id=teacher.telegram_chat_id,
        is_active=True,
        bot_can_post=True,
        verified_at=timezone.now(),
    )
    exam = make_exam("Bot Exam", "ielts_academic")
    attempt = MockAttempt.objects.create(
        id=str(uuid4()),
        exam=exam,
        student_id=student.id,
        status="in_progress",
        mode="exam",
        anti_cheat_count=0,
        started_at=timezone.now(),
    )
    ExamIntegrityIncident.objects.create(
        attempt=attempt,
        student=student,
        exam=exam,
        group=group,
        supervisor=teacher,
        event_type="WINDOW_FOCUS_LOST",
        skill="reading",
        observed_at=timezone.now(),
        status="open",
    )

    sent_payloads = []
    with patch("apps.core.telegram_teacher.api.call", return_value=None), patch(
        "apps.core.telegram_teacher.api.send",
        side_effect=lambda cid, text, reply_markup=None: sent_payloads.append((cid, text, reply_markup)),
    ):
        actor = SimpleNamespace(id=teacher.id, role="teacher", name=teacher.name, is_authenticated=True)
        bot_teacher.group_card("70040", None, actor, "en", group.id)
        bot_teacher.group_monitoring_card("70040", None, actor, "en", group.id)

    assert len(sent_payloads) == 2
    assert "Connected" in sent_payloads[0][1]
    assert "Unreviewed guard alerts: 1" in sent_payloads[0][1]
    assert "Bot Student" in sent_payloads[1][1]
    assert "WINDOW_FOCUS_LOST" in sent_payloads[1][1]


def test_exam_notifications_follow_submission_and_deadline(pg_phase3_tables):
    from django.test import TestCase

    from apps.core import homework_scoring
    from apps.core.mock_submission_snapshots import notify as notify_hand_in

    teacher = make_user("teacher", "Lifecycle Teacher", tg_chat="70051")
    student = make_user("student", "Lifecycle Student", tg_chat="80051")
    peer = make_user("student", "Lifecycle Peer", tg_chat="80052")
    group = Group.objects.create(id=str(uuid4()), name="Lifecycle Cohort", teacher=teacher, created_at=timezone.now())
    for member in (student, peer):
        groups.add_student(teacher, group.id, member.id)
    TelegramClassroomBinding.objects.create(
        group=group, chat_id="-100880551", bound_by_id=teacher.id,
        verified_telegram_id=teacher.telegram_chat_id, verified_at=timezone.now(),
    )
    exam = make_exam("Lifecycle IELTS")
    client = APIClient()
    client.force_authenticate(SimpleNamespace(id=teacher.id, name=teacher.name, role="teacher", is_authenticated=True))
    deadline = timezone.now() + timedelta(minutes=45)
    with TestCase.captureOnCommitCallbacks(execute=True):
        result = client.post(f"/v1/groups/{group.id}/assignments", {
            "title": "Lifecycle IELTS", "exam_id": exam.id, "deadline": deadline.isoformat(),
        }, format="json")
        assert result.status_code == 201, result.data
    assignment_id = result.data["data"]["id"]
    assert TelegramOutbox.objects.filter(dedupe_key__startswith=f"homework_assigned:{assignment_id}:").count() == 2
    assert TelegramOutbox.objects.filter(group_id=group.id, dedupe_key__startswith=f"group_homework:{assignment_id}:").count() == 1

    def hand_in(member, status):
        now = timezone.now()
        attempt = MockAttempt.objects.create(
            id=str(uuid4()), exam=exam, student_id=member.id, status=status,
            mode="timed", started_at=now, submitted_at=now, anti_cheat_count=0,
            finished_at=now if status == "completed" else None,
            raw_scores={"reading": {"score": 7, "max": 10}},
            media_state={ASSIGNMENT_KEY: assignment_id},
        )
        notify_hand_in(attempt)
        homework_scoring.propagate_attempt_finalization(attempt)
        return attempt

    pending = hand_in(student, "grading")
    assert TelegramOutbox.objects.filter(dedupe_key__startswith=f"exam_grading:{pending.id}:").get().recipient_id == teacher.id
    assert not TelegramOutbox.objects.filter(dedupe_key__startswith=f"hw_group_report:{assignment_id}:").exists()
    notify.homework_deadline_sweep()
    reminders = TelegramOutbox.objects.filter(dedupe_key__startswith=f"hw_deadline:{assignment_id}:")
    assert list(reminders.values_list("recipient_id", flat=True)) == [peer.id]
    notify.homework_deadline_sweep()
    assert reminders.count() == 1

    hand_in(peer, "completed")
    reports = TelegramOutbox.objects.filter(group_id=group.id, dedupe_key__startswith=f"hw_group_report:{assignment_id}:")
    assert reports.count() == 1
    assert reports.get().dedupe_key.endswith(":provisional")
    assert student.name not in reports.get().text and peer.name not in reports.get().text

    pending.status = "completed"
    pending.finished_at = timezone.now()
    pending.save(update_fields=["status", "finished_at"])
    homework_scoring.propagate_attempt_finalization(pending)
    homework_scoring.propagate_attempt_finalization(pending)
    assert reports.count() == 2
    assert reports.filter(dedupe_key__endswith=":final").exists()
    notify.homework_report_sweep(deadline + timedelta(seconds=1))
    assert reports.count() == 2
