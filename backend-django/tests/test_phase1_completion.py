from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import account_reconciliation as recon
from apps.core import assessment, groups, payments, points
from apps.core.homework_scoring import ASSIGNMENT_KEY
from apps.core.models import (
    AccountReconciliationLog,
    ClassroomEnrollment,
    Cohort,
    HomeworkAssignment,
    PracticeResultShare,
)
from apps.legacy_schema.models import (
    AssessmentJob,
    Attendance,
    AuditLog,
    Group,
    MockAnswer,
    MockAttempt,
    MockExam,
    MockPurchase,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    Notification,
    ParentStudent,
    Payment,
    PointsLog,
    RefreshToken,
    StudentProfile,
    TestAttempt,
    User,
    VideoPurchase,
)

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def pg_tables():
    models = (
        User, Group, StudentProfile, Attendance, Payment, PointsLog, ParentStudent,
        RefreshToken, Notification, MockExam, MockSection, MockQuestionGroup, MockQuestion,
        MockAttempt, MockAnswer, MockPurchase, VideoPurchase,
        TestAttempt, AssessmentJob, AuditLog,
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


def make_user(role="student", name="User", phone=None, email=None, telegram=None):
    uid = str(uuid4())
    digits = "".join(ch for ch in uid if ch.isdigit())[:7].ljust(7, "1")
    phone = phone or f"+99890{digits}"
    user = User.objects.create(
        id=uid,
        name=name,
        phone=phone,
        email=email,
        password_hash="hashed",
        role=role,
        is_active=True,
        telegram_chat_id=telegram,
        created_at=timezone.now(),
        updated_at=timezone.now(),
    )
    if role == "student":
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO "StudentProfile"
                    ("userId", "availablePrograms", "activeProgram", "isApproved",
                     "currentPoints", "gameQualified", "linkCode", "createdAt")
                   VALUES (%s, '{IELTS,MULTILEVEL}', 'IELTS', true, 50, false, %s, NOW())""",
                [uid, uid[:8].upper()],
            )
    return user


def auth_client(user):
    client = APIClient()
    actor = SimpleNamespace(id=user.id, role=user.role, name=user.name, is_authenticated=True)
    client.force_authenticate(user=actor)
    return client


def test_multi_group_teacher_permissions_payments_points_and_grading(pg_tables):
    admin = make_user("admin", "Admin")
    teacher_a = make_user("teacher", "Teacher A")
    teacher_b = make_user("teacher", "Teacher B")
    student = make_user("student", "Student One")
    group_a = Group.objects.create(id=str(uuid4()), name="IELTS A", teacher=teacher_a, created_at=timezone.now())
    group_b = Group.objects.create(id=str(uuid4()), name="Multilevel B", teacher=teacher_b, created_at=timezone.now())

    groups.add_student(admin, group_a.id, student.id)
    groups.add_student(admin, group_b.id, student.id)

    assert ClassroomEnrollment.objects.filter(student_id=student.id, ended_at__isnull=True).count() == 2
    assert student.id in payments.teacher_students(teacher_a)
    assert student.id in payments.teacher_students(teacher_b)
    points.assert_can_view(teacher_b, student.id)

    exam = MockExam.objects.create(
        id=str(uuid4()), type="ielts_academic", title="IELTS Mock 1",
        is_published=True, is_demo=False, price=0, is_free_for_approved=True,
        created_at=timezone.now(), updated_at=timezone.now(), profile="full_mock", content_version=1,
    )
    cohort_b = Cohort.objects.create(id=str(uuid4()), classroom=group_b, teacher=teacher_b, name="B", invite_code="B12345")
    assign_b = HomeworkAssignment.objects.create(
        id=str(uuid4()), cohort=cohort_b, title="Mock B", exam=exam,
        deadline=timezone.now() + timedelta(days=2),
    )
    attempt = MockAttempt.objects.create(
        id=str(uuid4()), exam=exam, student_id=student.id, status="grading",
        mode="timed", flow_mode="full_test", started_at=timezone.now(),
        submitted_at=timezone.now(), anti_cheat_count=0,
        media_state={ASSIGNMENT_KEY: assign_b.id},
    )
    res = assessment.teacher_grade_attempt(teacher_b, attempt.id, {"finalScore": 7.5, "comment": "Good"})
    assert res["success"] is True
    with pytest.raises(Exception):
        assessment.teacher_grade_attempt(teacher_a, attempt.id, {"finalScore": 7.0})

    groups.remove_student(admin, group_b.id, student.id)
    assessment.authorize_attempt(teacher_b, attempt, grade=True)

    practice = MockAttempt.objects.create(
        id=str(uuid4()), exam=exam, student_id=student.id, status="completed",
        mode="practice", flow_mode="full_test", started_at=timezone.now(),
        finished_at=timezone.now(), anti_cheat_count=0,
    )
    PracticeResultShare.objects.create(attempt=practice, teacher=teacher_a)
    assessment.authorize_attempt(teacher_a, practice, grade=False)
    with pytest.raises(Exception):
        assessment.authorize_attempt(teacher_a, practice, grade=True)


def test_admin_bulk_actions_and_student_overview(pg_tables):
    admin = make_user("admin", "Admin")
    teacher_a = make_user("teacher", "Teacher A")
    student = make_user("student", "Student One")
    s2 = make_user("student", "Student Two")
    group_a = Group.objects.create(id=str(uuid4()), name="IELTS A", teacher=teacher_a, created_at=timezone.now())
    StudentProfile.objects.filter(user_id=s2.id).update(is_approved=False)
    client = auth_client(admin)

    r1 = client.post("/v1/users/bulk", {"action": "approve", "studentIds": [s2.id]}, format="json")
    assert r1.status_code == 200
    assert StudentProfile.objects.get(user_id=s2.id).is_approved is True

    r2 = client.post("/v1/users/bulk", {"action": "add_to_group", "studentIds": [student.id, s2.id], "groupId": group_a.id}, format="json")
    assert r2.status_code == 200
    assert ClassroomEnrollment.objects.filter(group_id=group_a.id, ended_at__isnull=True).count() == 2

    r3 = client.get(f"/v1/users/{student.id}/overview")
    assert r3.status_code == 200
    assert len(r3.json()["data"]["memberships"]) == 1
    assert r3.json()["data"]["teachers"][0]["id"] == teacher_a.id


def test_safe_account_reconciliation_blocks_conflicts_and_merges_cleanly(pg_tables):
    admin = make_user("admin", "Admin")
    teacher_b = make_user("teacher", "Teacher B")
    student = make_user("student", "Student One")
    group_b = Group.objects.create(id=str(uuid4()), name="Multilevel B", teacher=teacher_b, created_at=timezone.now())

    dup_unverified = make_user("student", "Student One", phone="+998909998877")
    preview_bad = recon.preview_merge(admin, dup_unverified.id, student.id)
    assert preview_bad["canMerge"] is False
    assert any(b["code"] == "IDENTITY_UNVERIFIED" for b in preview_bad["blockers"])

    dup_phone = make_user("student", "Student One Alt", phone="998901234567", email="s1@example.com")
    User.objects.filter(id=student.id).update(phone="+998901234567")
    dups = recon.discover_duplicates(admin)
    assert any({d["accounts"][0]["id"], d["accounts"][1]["id"]} == {student.id, dup_phone.id} for d in dups)

    Payment.objects.create(
        id=str(uuid4()), student_id=student.id, month=11, year=2026,
        state="paid", amount=500000, method="manual", created_at=timezone.now(), updated_at=timezone.now(),
    )
    Payment.objects.create(
        id=str(uuid4()), student_id=dup_phone.id, month=11, year=2026,
        state="unpaid", amount=0, method="manual", created_at=timezone.now(), updated_at=timezone.now(),
    )
    preview_pay = recon.preview_merge(admin, dup_phone.id, student.id)
    assert preview_pay["canMerge"] is False
    assert any(b["code"] == "PAYMENT_CONFLICT" for b in preview_pay["blockers"])

    Payment.objects.filter(student_id=dup_phone.id).delete()
    groups.add_student(admin, group_b.id, dup_phone.id)
    Attendance.objects.create(
        id=str(uuid4()), student_id=dup_phone.id, group=group_b,
        date=date(2026, 11, 20), state="present", marked_by_id=teacher_b.id,
        created_at=timezone.now(), updated_at=timezone.now(),
    )

    preview_ok = recon.preview_merge(admin, dup_phone.id, student.id)
    assert preview_ok["canMerge"] is True
    merged = recon.execute_merge(
        admin,
        dup_phone.id,
        student.id,
        reason="Verified duplicate phone registration",
        confirm_text="MERGE",
        preview_token=preview_ok["previewToken"],
    )
    assert merged["merged"] is True
    assert User.objects.get(id=dup_phone.id).is_active is False
    assert StudentProfile.objects.get(user_id=student.id).current_points == 100
    assert ClassroomEnrollment.objects.filter(student_id=student.id, group_id=group_b.id, ended_at__isnull=True).exists()
    assert AccountReconciliationLog.objects.filter(canonical_user_id=student.id).count() == 1
