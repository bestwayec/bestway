from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import groups, live_exam_guard as guard
from apps.core.homework_scoring import ASSIGNMENT_KEY
from apps.core.models import (
    Cohort,
    ExamIntegrityIncident,
    HomeworkAssignment,
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
    SpeechTranscript,
    StudentProfile,
    User,
)

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def pg_guard_tables():
    models = (
        User, Group, StudentProfile, Notification, AuditLog,
        MockExam, MockExamImport, MockSection, MockQuestionGroup, MockQuestion,
        MockAttempt, MockAnswer, AssessmentJob, AssessmentEvaluation, SpeechTranscript,
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


def make_user(role="student", name="User"):
    uid = str(uuid4())
    digits = "".join(ch for ch in uid if ch.isdigit())[:7].ljust(7, "1")
    user = User.objects.create(
        id=uid,
        name=name,
        phone=f"+99891{digits}",
        password_hash="hashed",
        role=role,
        is_active=True,
        created_at=timezone.now(),
        updated_at=timezone.now(),
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
    return user


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=SimpleNamespace(id=user.id, role=user.role, name=user.name, is_authenticated=True))
    return client


def test_answer_disclosure_withholds_keys_until_all_submit_or_deadline(pg_guard_tables):
    admin = make_user("admin", "Admin")
    teacher = make_user("teacher", "Teacher A")
    s1 = make_user("student", "Student 1")
    s2 = make_user("student", "Student 2")
    group = Group.objects.create(id=str(uuid4()), name="IELTS G1", teacher=teacher, created_at=timezone.now())
    groups.add_student(admin, group.id, s1.id)
    groups.add_student(admin, group.id, s2.id)

    exam = MockExam.objects.create(
        id=str(uuid4()), type="ielts_academic", title="IELTS Academic 1",
        is_published=True, is_demo=False, price=0, is_free_for_approved=True,
        created_at=timezone.now(), updated_at=timezone.now(), profile="full_mock", content_version=1,
    )
    sec = MockSection.objects.create(id=str(uuid4()), exam=exam, skill="reading", title="Reading", sort_order=1, duration_minutes=60)
    qg = MockQuestionGroup.objects.create(
        id=str(uuid4()), section=sec, sort_order=1, title="Passage 1",
        passage_text="Sample passage.", audio_play_limit=1, created_at=timezone.now(),
    )
    q = MockQuestion.objects.create(
        id=str(uuid4()), group=qg, number=1, sort_order=1, type="short_answer",
        prompt="What?", correct_answers=["SECRET_KEY"], points=1, created_at=timezone.now(),
    )

    cohort = Cohort.objects.create(id=str(uuid4()), classroom=group, teacher=teacher, name="G1", invite_code="G1CODE")
    assignment = HomeworkAssignment.objects.create(
        id=str(uuid4()), cohort=cohort, title="Assign 1", exam=exam,
        deadline=timezone.now() + timedelta(hours=4),
        participant_ids=[s1.id, s2.id],
    )

    att1 = MockAttempt.objects.create(
        id=str(uuid4()), exam=exam, student_id=s1.id, status="completed",
        mode="timed", flow_mode="full_test", started_at=timezone.now(),
        submitted_at=timezone.now(), finished_at=timezone.now(), anti_cheat_count=0,
        media_state={ASSIGNMENT_KEY: assignment.id},
    )
    MockAnswer.objects.create(
        id=str(uuid4()), attempt=att1, question=q, response="wrong", is_correct=False,
        score=0, is_graded=True, updated_at=timezone.now(),
    )

    c1 = auth_client(s1)
    res1 = c1.get(f"/v1/mock/attempts/{att1.id}").json()["data"]
    assert res1["answerDisclosure"]["disclosed"] is False
    assert "correctAnswers" not in res1["sections"][0]["groups"][0]["questions"][0]

    # Once student 2 also submits, answers unlock even before deadline
    MockAttempt.objects.create(
        id=str(uuid4()), exam=exam, student_id=s2.id, status="completed",
        mode="timed", flow_mode="full_test", started_at=timezone.now(),
        submitted_at=timezone.now(), finished_at=timezone.now(), anti_cheat_count=0,
        media_state={ASSIGNMENT_KEY: assignment.id},
    )
    res2 = c1.get(f"/v1/mock/attempts/{att1.id}").json()["data"]
    assert res2["answerDisclosure"]["disclosed"] is True
    assert res2["sections"][0]["groups"][0]["questions"][0]["correctAnswers"] == ["SECRET_KEY"]


def test_live_exam_guard_routing_correlation_ack_and_unauthorized_rejection(pg_guard_tables):
    admin = make_user("admin", "Admin")
    teacher_a = make_user("teacher", "Teacher A")
    teacher_b = make_user("teacher", "Teacher B")
    student = make_user("student", "Student 01")

    group_a = Group.objects.create(id=str(uuid4()), name="IELTS Advanced", teacher=teacher_a, created_at=timezone.now())
    group_b = Group.objects.create(id=str(uuid4()), name="Multilevel B", teacher=teacher_b, created_at=timezone.now())
    groups.add_student(admin, group_a.id, student.id)
    groups.add_student(admin, group_b.id, student.id)

    exam = MockExam.objects.create(
        id=str(uuid4()), type="ielts_academic", title="Academic Mock 05",
        is_published=True, is_demo=False, price=0, is_free_for_approved=True,
        created_at=timezone.now(), updated_at=timezone.now(), profile="full_mock", content_version=1,
    )
    cohort_a = Cohort.objects.create(id=str(uuid4()), classroom=group_a, teacher=teacher_a, name="A", invite_code="ACODE1")
    assign_a = HomeworkAssignment.objects.create(
        id=str(uuid4()), cohort=cohort_a, title="Mock 05", exam=exam,
        deadline=timezone.now() + timedelta(hours=6),
    )
    attempt = MockAttempt.objects.create(
        id=str(uuid4()), exam=exam, student_id=student.id, status="in_progress",
        mode="timed", flow_mode="full_test", current_skill="reading", started_at=timezone.now() - timedelta(minutes=5),
        anti_cheat_count=0, media_state={ASSIGNMENT_KEY: assign_a.id},
    )

    sc = auth_client(student)
    # Rapid blur + page_hidden within 5s must correlate into 1 incident with occurrenceCount=2
    r_blur = sc.post(f"/v1/mock/attempts/{attempt.id}/guard-events", {"event": "window_blur", "skill": "reading", "integrityMode": "practice"}, format="json")
    assert r_blur.status_code == 201
    r_hide = sc.post(f"/v1/mock/attempts/{attempt.id}/guard-events", {"event": "page_hidden", "skill": "reading"}, format="json")
    assert r_hide.status_code == 201
    assert r_hide.json()["data"]["occurrenceCount"] == 2
    assert ExamIntegrityIncident.objects.filter(attempt_id=attempt.id).count() == 1

    # Teacher A sees the alert + notification; Teacher B (unrelated to this assignment) sees NOTHING
    ta_client = auth_client(teacher_a)
    tb_client = auth_client(teacher_b)

    alerts_a = ta_client.get("/v1/teacher/guard-alerts").json()["data"]
    alerts_b = tb_client.get("/v1/teacher/guard-alerts").json()["data"]
    assert alerts_a["unreadCount"] == 1
    assert alerts_a["incidents"][0]["studentName"] == "Student 01"
    assert alerts_a["incidents"][0]["groupName"] == "IELTS Advanced"
    assert alerts_b["unreadCount"] == 0
    assert alerts_b["incidents"] == []

    # Private Telegram outbox queued ONLY for teacher A (not teacher B)
    assert TelegramOutbox.objects.filter(recipient_id=teacher_a.id, kind="teacher").count() == 1
    assert TelegramOutbox.objects.filter(recipient_id=teacher_b.id).count() == 0

    incident_id = alerts_a["incidents"][0]["id"]
    # Unauthorized Teacher B cannot acknowledge Teacher A's incident
    r_unauth = tb_client.post(f"/v1/teacher/guard-alerts/{incident_id}/review", {"status": "acknowledged", "note": "x"}, format="json")
    assert r_unauth.status_code == 403

    # Authorized Teacher A acknowledges incident
    r_ack = ta_client.post(f"/v1/teacher/guard-alerts/{incident_id}/review", {"status": "acknowledged", "note": "Checked student"}, format="json")
    assert r_ack.status_code == 200
    assert r_ack.json()["data"]["status"] == "acknowledged"
    assert ta_client.get("/v1/teacher/guard-alerts").json()["data"]["unreadCount"] == 0

    # Offline batch recovery preserves observedAt
    past = (timezone.now() - timedelta(minutes=3)).isoformat()
    recovered = {
        "events": [{
            "event": "network_disconnected", "observedAt": past, "skill": "reading",
            "offlineSynced": True, "eventId": str(uuid4()),
        }],
    }
    path = f"/v1/mock/attempts/{attempt.id}/guard-events"
    assert sc.post(path, recovered, format="json").status_code == 409
    headers = {"HTTP_X_EXAM_SESSION": "guard-test-session"}
    r_batch = sc.post(path, recovered, format="json", **headers)
    assert r_batch.status_code == 201
    assert r_batch.json()["data"]["recorded"] == 1
    assert sc.post(path, recovered, format="json", **headers).json()["data"]["items"][0]["created"] is False
    assert sc.post(path, {"event": "made_up"}, format="json", **headers).status_code == 400
    assert sc.post(path, {"event": "page_hidden"}, format="json", HTTP_X_EXAM_SESSION="other-session").status_code == 409
    Group.objects.filter(pk=group_a.id).update(teacher=teacher_b)
    assert ta_client.get("/v1/teacher/guard-alerts").json()["data"]["incidents"] == []
    assert ta_client.post(
        f"/v1/teacher/guard-alerts/{incident_id}/review", {"status": "acknowledged"}, format="json",
    ).status_code == 403
