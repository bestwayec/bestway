"""Verify the authorized grading queue against disposable PostgreSQL with signed sessions."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from verify_group_contract_postgres import actor, bearer

from django.db import close_old_connections, connection, transaction
from django.utils import timezone

from apps.core.models import ClassroomEnrollment
from apps.legacy_schema.models import (
    AuditLog, Group, MockAnswer, MockAttempt, MockExam, MockQuestion, MockQuestionGroup,
    MockSection, StudentProfile, User,
)
from common.auth.jwt import issue_access


def identifier():
    return str(uuid4())


def data(response, expected=200):
    assert response.status_code == expected, (response.status_code, response.content)
    return response.json().get("data")


def main():
    now = timezone.now()
    root = "/v1/teacher/submissions"
    users, groups, attempts, questions, sections, question_groups = ([] for _ in range(6))
    exam_id = identifier()
    try:
        with transaction.atomic():
            teacher_id, teacher = actor("teacher")
            other_id, other = actor("teacher")
            admin_id, admin = actor("admin")
            student_id, student = actor("student")
            parent_id, parent = actor("parent")
            users.extend((teacher_id, other_id, admin_id, student_id, parent_id))
            for owner in (teacher_id, other_id):
                groups.append(data(bearer(issue_access(owner, "teacher")).post("/v1/groups", {
                    "name": "Grading queue fixture",
                    "schedule": [{"day": "wed", "startTime": "12:00", "endTime": "13:00"}],
                }, format="json"), 201)["id"])
            with connection.cursor() as cursor:
                cursor.execute(
                    'INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved",'
                    '"groupId","currentPoints","linkCode","createdAt","gameQualified") '
                    "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, %s, false)",
                    [student_id, groups[0], identifier(), now],
                )
            ClassroomEnrollment.objects.create(
                student_id=student_id, group_id=groups[0], started_at=now - timedelta(days=1),
            )
            MockExam.objects.create(
                id=exam_id, title="Grading queue fixture", type="ielts_academic", profile="full_mock",
                is_published=True, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                created_by_id=admin_id, created_at=now, updated_at=now,
            )
            for i, skill in enumerate(("writing", "writing", "speaking", "reading")):
                section = MockSection.objects.create(
                    id=identifier(), exam_id=exam_id, skill=skill, title=skill, sort_order=i,
                ) if i != 1 else MockSection.objects.get(pk=sections[0])
                if i != 1:
                    sections.append(section.pk)
                group = MockQuestionGroup.objects.create(
                    id=identifier(), section_id=section.pk, sort_order=i, title=skill,
                    audio_play_limit=1, created_at=now,
                )
                question_groups.append(group.pk)
                questions.append(MockQuestion.objects.create(
                    id=identifier(), group_id=group.pk, number=i+1, sort_order=i,
                    type={"writing":"essay_task2", "speaking":"speaking_task", "reading":"multiple_choice"}[skill],
                    prompt=skill, points=9, correct_answers=[], accepted_variants=[], created_at=now,
                ).pk)
            for _ in range(2):
                attempts.append(MockAttempt.objects.create(
                    id="fixture_" + identifier(), exam_id=exam_id, student_id=student_id, status="grading",
                    mode="timed", flow_mode="full_test", started_at=now - timedelta(hours=1), submitted_at=now,
                    anti_cheat_count=0, submitted_sections=["writing", "speaking"],
                ).pk)
            for question, response in zip(questions, ("First essay", "Second essay", "", "choice")):
                MockAnswer.objects.create(
                    id=identifier(), attempt_id=attempts[0], question_id=question, response=response,
                    is_graded=False, audio_key="confidential/storage/key" if question == questions[2] else None,
                    feedback="unapproved feedback", updated_at=now,
                )
            MockAnswer.objects.create(
                id=identifier(), attempt_id=attempts[1], question_id=questions[0], response=" \t\n",
                is_graded=False, updated_at=now,
            )
        page = data(teacher.get(root, {"withTotal": 1, "limit": 1}))
        assert page["total"] == 2 and len(page["items"]) == 1, page
        assert not data(other.get(root))
        assert data(admin.get(root, {"limit": 100})), "global admin scope"
        data(student.get(root), 403)
        data(parent.get(root), 403)
        writing, = data(teacher.get(root, {"skill": "writing"}))
        speaking, = data(teacher.get(root, {"skill": "speaking"}))
        assert writing["id"] == attempts[0] + "_writing" and speaking["id"] == attempts[0] + "_speaking"
        assert speaking["hasRecording"] and "audioUrl" not in speaking
        assert "teacherFeedback" not in writing and "studentPhone" not in writing

        path = root + "/" + writing["id"] + "/grade"
        input_data = {"questionId": writing["questionId"], "score": 5.5, "feedback": "Reviewed essay"}
        data(other.post(path, input_data, format="json"), 404)
        data(student.post(path, input_data, format="json"), 403)
        data(teacher.post(root + "/" + attempts[0] + "/grade", input_data, format="json"), 400)
        data(teacher.post(path, {**input_data, "questionId": questions[2]}, format="json"), 404)
        data(teacher.post(root + "/" + speaking["id"] + "/grade", {**input_data, "questionId": questions[2]}, format="json"), 409)

        start = Barrier(2)

        def competing_grade():
            close_old_connections()
            try:
                client = bearer(issue_access(teacher_id, "teacher"))
                start.wait(timeout=10)
                return client.post(path, input_data, format="json").status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: competing_grade(), range(2)))
        assert sorted(results) == [200, 409], results
        answers = {answer.question_id: answer for answer in MockAnswer.objects.filter(attempt_id=attempts[0])}
        assert answers[writing["questionId"]].score == 5.5
        assert not answers[questions[2]].is_graded and answers[questions[2]].feedback == "unapproved feedback"
        assert MockAttempt.objects.get(pk=attempts[0]).status == "grading"
        next_writing, = data(teacher.get(root, {"skill": "writing"}))
        assert next_writing["id"] == writing["id"] and next_writing["questionId"] != writing["questionId"]
        saved = data(admin.post(path, {"questionId": next_writing["questionId"], "score": 6}, format="json"))
        assert saved["submissionStatus"] == "graded" and saved["status"] == "grading"
        assert len(data(teacher.get(root, {"status": "graded", "skill": "writing"}))) == 1

        StudentProfile.objects.filter(pk=student_id).update(group_id=groups[1])
        ClassroomEnrollment.objects.filter(student_id=student_id, ended_at__isnull=True).update(ended_at=now)
        ClassroomEnrollment.objects.create(student_id=student_id, group_id=groups[1], started_at=now)
        assert not data(teacher.get(root)) and not data(other.get(root))
        path = root + "/" + speaking["id"] + "/grade"
        data(other.post(path, {"questionId": questions[2], "score": 4}, format="json"), 404)
        overview = "/v1/assessment/attempts/" + attempts[0]
        data(other.get(overview), 403)
        data(other.post(overview + "/teacher-grade", {"final_score": 9}, format="json"), 403)
        print("PASS: PostgreSQL grading evidence, pagination, role and enrollment scope, embargoed fields, review isolation and concurrent replay")
    finally:
        with transaction.atomic():
            AuditLog.objects.filter(user_id__in=users).delete()
            MockAnswer.objects.filter(attempt_id__in=attempts).delete()
            MockAttempt.objects.filter(pk__in=attempts).delete()
            MockQuestion.objects.filter(pk__in=questions).delete()
            MockQuestionGroup.objects.filter(pk__in=question_groups).delete()
            MockSection.objects.filter(pk__in=sections).delete()
            MockExam.objects.filter(pk=exam_id).delete()
            ClassroomEnrollment.objects.filter(group_id__in=groups).delete()
            StudentProfile.objects.filter(pk__in=users).delete()
            Group.objects.filter(pk__in=groups).delete()
            User.objects.filter(pk__in=users).delete()


if __name__ == "__main__":
    main()
