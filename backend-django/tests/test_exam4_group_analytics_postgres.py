"""Exercise report eligibility, scores, evidence and exports against PostgreSQL."""
from datetime import timedelta
from io import BytesIO
from types import SimpleNamespace

import pytest
from django.db import connection, transaction
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.test import APIClient

from apps.core.homework_scoring import ASSIGNMENT_KEY
from apps.core.models import ClassroomEnrollment, Cohort, HomeworkAssignment
from apps.legacy_schema.models import (
    Attendance, Group, MockAnswer, MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection,
    StudentProfile, User,
)

pytestmark = pytest.mark.django_db(transaction=True)
REPORT = "/v1/groups/exam4-p3-group"


@pytest.fixture
def classroom():
    models = (User, Group, StudentProfile, Attendance, MockExam, MockSection, MockQuestionGroup,
              MockQuestion, MockAttempt, MockAnswer)
    existing = set(connection.introspection.table_names())
    created = []
    for model in models:
        if model._meta.db_table not in existing:
            with connection.schema_editor() as editor:
                editor.create_model(model)
            created.append(model)
    try:
        with transaction.atomic():
            yield seed_classroom()
            transaction.set_rollback(True)
    finally:
        for model in reversed(created):
            with connection.schema_editor() as editor:
                editor.delete_model(model)


def seed_classroom():
    now = timezone.now()

    def user(who, role):
        return User.objects.create(id=f"exam4-p3-{who}", name=who, role=role, is_active=True,
                                   phone=f"synthetic-{who}", password_hash="", created_at=now, updated_at=now)

    owner = user("Owner", "teacher")
    other_teacher = user("Other teacher", "teacher")
    admin = user("Administrator", "admin")
    group = Group.objects.create(id="exam4-p3-group", name="Phase 3 classroom", teacher=owner, created_at=now)
    other = Group.objects.create(id="exam4-p3-other", name="Different classroom", teacher=other_teacher, created_at=now)
    people = {}
    for name, current in (("Ari", other), ("Beth", group), ("Casey", group), ("Drew", group), ("Ellis", other)):
        learner = user(name, "student")
        people[name] = StudentProfile.objects.create(user=learner, group=current, available_programs=[],
                                                     is_approved=True, current_points=0, game_qualified=False,
                                                     link_code=f"exam4-p3-{name}", created_at=now)
        if name != "Ellis":
            ClassroomEnrollment.objects.create(
                group=group, student=learner, started_at=now - timedelta(days=20) if name != "Drew" else None,
                ended_at=now - timedelta(days=2) if name == "Ari" else None,
            )
    ielts, multilevel = [
        MockExam.objects.create(id=f"exam4-p3-{track}", type=track, title=track, is_published=True, is_demo=True,
                                is_free_for_approved=True, price=0, content_version=1, created_at=now, updated_at=now)
        for track in ("ielts_academic", "multilevel")
    ]
    cohort = Cohort.objects.create(classroom=group, name=group.name, teacher=owner, invite_code="exam4-p3")
    assignment = HomeworkAssignment.objects.create(cohort=cohort, exam=ielts, title="Assigned mock", deadline=now)
    HomeworkAssignment.objects.filter(pk=assignment.pk).update(created_at=now - timedelta(days=10))
    section = MockSection.objects.create(id="exam4-p3-reading", exam=ielts, skill="reading", sort_order=0)
    stimulus = MockQuestionGroup.objects.create(id="exam4-p3-passage", section=section, sort_order=0, created_at=now,
                                                audio_play_limit=1)
    questions = [
        MockQuestion.objects.create(id=f"exam4-p3-question-{i}", group=stimulus, number=i, sort_order=i,
                                    prompt="Synthetic question", type="short_answer", points=1, created_at=now)
        for i in range(1, 4)
    ]

    def attempt(label, learner, day, band=None, exam=ielts, score=None, status="completed", assigned=False):
        started = now - timedelta(days=day)
        return MockAttempt.objects.create(
            id=f"exam4-p3-{label}", student=people[learner], exam=exam, status=status, started_at=started,
            submitted_at=started if status != "in_progress" else None, flow_mode="full_test", mode="timed",
            overall_band=band, overall_score=score, anti_cheat_count=0, specification_version="fixture-v1",
            score_version="fixture-v1", section_bands={"reading": band},
            raw_scores={"reading": {"score": 1, "max": 3}} if label == "assigned" else None,
            media_state={ASSIGNMENT_KEY: assignment.id} if assigned else {},
        )

    assigned = attempt("assigned", "Ari", 5, band=7, assigned=True)
    for index, (correct, response) in enumerate(((True, "alpha"), (False, "wrong"))):
        MockAnswer.objects.create(id=f"exam4-p3-answer-{index}", question=questions[index], attempt=assigned,
                                  response=response, is_correct=correct, is_graded=True, updated_at=now)
    attempt("outside-period", "Ari", 1, band=9)
    attempt("untimestamped-enrollment", "Drew", 1, band=8)
    attempt("unrelated", "Ellis", 3, band=9)
    attempt("best-retake", "Beth", 9, band=7)
    attempt("latest-zero", "Beth", 6, band=0)
    attempt("pending", "Casey", 4, band=9, status="grading", assigned=True)
    attempt("multilevel-score", "Beth", 5, band=7, exam=multilevel, score=65)
    for day, state in ((1, "present"), (2, "absent")):
        Attendance.objects.create(id=f"exam4-p3-attendance-{day}", group=group, student=people["Beth"],
                                  date=timezone.localdate() - timedelta(days=day), state=state,
                                  marked_by_id=owner.id, created_at=now, updated_at=now)
    return owner, other_teacher, admin, people["Beth"].user, ielts, assignment


def request(actor, path, **params):
    client = APIClient()
    client.force_authenticate(SimpleNamespace(id=actor.id, role=actor.role, is_authenticated=True))
    return client.get(f"{REPORT}/{path}", params)


def analysis(actor, **params):
    result = request(actor, "analytics", **params)
    assert result.status_code == 200, result.content
    return result.json()["data"]


def test_report_scope_scales_best_ties_and_zero(classroom):
    owner, outsider, admin, learner, exam, assignment = classroom
    mixed = analysis(owner)
    assert mixed["totalMockAttempts"] == 5
    assert mixed["groupAveragesByScale"] == {"ielts_academic": 3.5, "multilevel": 65}
    assert mixed["groupAverageScore"] is None
    assert mixed["scaleSummary"]["ielts_academic"] == {"median": 3.5, "students": 2, "best": 7}
    assert mixed["groupAverageAttendance"] == 50
    assert mixed["ranking"] == []
    assert all("phone" not in row for row in mixed["students"])
    latest = analysis(owner, examId=exam.id)
    assert [(row["name"], row["score"], row["attemptId"]) for row in latest["ranking"]] == [
        ("Ari", 7, None), ("Beth", 0, "exam4-p3-latest-zero"),
    ]
    best = analysis(admin, examId=exam.id, policy="best")
    assert [(row["rank"], row["score"], row["attemptId"]) for row in best["ranking"]] == [
        (1, 7, "exam4-p3-assigned"), (1, 7, "exam4-p3-best-retake"),
    ]
    for forbidden in (outsider, learner):
        for path in ("analytics", "report/pdf", "report/excel"):
            assert request(forbidden, path, assignmentId=assignment.id).status_code == 403


def test_assignment_objective_counts_and_export_agree(classroom):
    owner, _, _, _, _, assignment = classroom
    data = analysis(owner, assignmentId=assignment.id)
    assert (data["assignedStudents"], data["startedStudents"], data["submittedStudents"]) == (3, 2, 2)
    assert (data["gradedStudents"], data["pendingStudents"], data["completionRate"]) == (1, 1, 67)
    assert data["ranking"][0]["name"] == "Ari"
    metric, = data["weakTopicsHeatmap"]
    assert [metric[key] for key in ("correct", "incorrect", "unanswered", "accuracy", "affectedStudentsCount")] == [1, 1, 1, 50, 1]
    xlsx = request(owner, "report/excel", assignmentId=assignment.id)
    assert xlsx.status_code == 200, xlsx.content
    workbook = load_workbook(BytesIO(xlsx.content))
    assert workbook["Reyting"]["B2"].value == "Ari"
    assert workbook["Reyting"]["D2"].value == 7
    assert workbook["Savol turlari"]["G2"].value == 50
    pdf = request(owner, "report/pdf", assignmentId=assignment.id)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF"), pdf.content


def test_question_difficulty_aggregates_only_repeated_authored_choices(classroom):
    owner, _, _, _, exam, assignment = classroom
    question = MockQuestion.objects.get(pk="exam4-p3-question-2")
    MockQuestion.objects.filter(pk=question.id).update(type="multiple_choice", options=["Alpha", "Beta", "Gamma"])
    MockAnswer.objects.filter(attempt_id="exam4-p3-assigned", question=question).update(response="B")
    MockAttempt.objects.filter(pk="exam4-p3-best-retake").update(raw_scores={"reading": {"score": 0, "max": 3}})
    MockAnswer.objects.create(id="exam4-p3-extra-wrong", question=question, attempt_id="exam4-p3-best-retake",
                              response="Beta", is_correct=False, is_graded=True, updated_at=timezone.now())
    exam_data = analysis(owner, examId=exam.id)
    question_data = next(row for row in exam_data["questionDifficulty"] if row["questionId"] == question.id)
    assert question_data["commonIncorrectChoices"] == [{"option": "Beta", "students": 2}]
    assigned_data = analysis(owner, assignmentId=assignment.id)
    question_data = next(row for row in assigned_data["questionDifficulty"] if row["questionId"] == question.id)
    assert "commonIncorrectChoices" not in question_data


def test_review_is_blocked_only_during_a_live_timed_attempt(classroom):
    from apps.core.mock_attempts import review_blocked

    historical = MockAttempt.objects.get(pk="exam4-p3-best-retake")
    active = MockAttempt.objects.get(pk="exam4-p3-latest-zero")
    MockAttempt.objects.filter(pk=active.id).update(status="in_progress", deadline_at=timezone.now() + timedelta(minutes=5))
    assert review_blocked(historical)
    MockAttempt.objects.filter(pk=active.id).update(deadline_at=timezone.now() - timedelta(minutes=5))
    assert not review_blocked(historical)
    MockAttempt.objects.filter(pk=active.id).update(mode="practice", deadline_at=None)
    assert not review_blocked(historical)


def test_calendar_day_filter_includes_local_midnight(classroom):
    from datetime import UTC, datetime

    owner, _, _, _, exam, _ = classroom
    with timezone.override("Asia/Tashkent"):
        day = timezone.localdate() - timedelta(days=3)
        midnight = datetime.combine(day, datetime.min.time(), tzinfo=timezone.get_current_timezone()).astimezone(UTC)
        MockAttempt.objects.filter(pk="exam4-p3-best-retake").update(started_at=midnight - timedelta(seconds=1))
        MockAttempt.objects.filter(pk="exam4-p3-latest-zero").update(started_at=midnight)
        data = analysis(owner, examId=exam.id, **{"from": day.isoformat(), "to": day.isoformat()})
    assert [row["attemptId"] for row in data["ranking"]] == ["exam4-p3-latest-zero"]
