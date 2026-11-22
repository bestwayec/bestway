"""Verify the Group roster, attendance and existing homework workflow on local PostgreSQL."""
from datetime import timedelta
from uuid import uuid4

from verify_group_contract_postgres import actor, transaction

from django.utils import timezone

from apps.core.models import HomeworkAssignment, ClassroomEnrollment, Cohort, HomeworkSubmission
from apps.legacy_schema.models import AssessmentJob, Attendance, MockAttempt, MockExam


@transaction.atomic
def verify():
    teacher_id, teacher = actor("teacher")
    other_id, other = actor("teacher")
    _, admin = actor("admin")
    student_id, student = actor("student")
    second_id, second_client = actor("student")
    assert teacher.post("/v1/groups", {"name": "Classroom journey"}, format="json").status_code == 201
    group_id = teacher.get("/v1/groups").json()["data"][0]["id"]
    group_url = f"/v1/groups/{group_id}"
    task_url = group_url + "/assignments"
    assert teacher.patch(group_url, {"teacherId": other_id}, format="json").status_code == 403
    assert admin.patch(group_url, {"teacherId": other_id}, format="json").status_code == 200
    assert other.get(group_url).status_code == 200 and teacher.get(group_url).status_code == 403
    assert admin.patch(group_url, {"teacherId": teacher_id}, format="json").status_code == 200
    schedule = [
        {"day": "wed", "startTime": "10:00", "endTime": "11:00"},
        {"day": "wed", "startTime": "13:00", "endTime": "14:00"},
    ]
    assert teacher.patch(group_url, {"schedule": schedule}, format="json").status_code == 200
    assert teacher.get(group_url).json()["data"]["schedule"] == schedule
    overlap = schedule + [{"day": "wed", "startTime": "10:30", "endTime": "11:30"}]
    assert teacher.patch(group_url, {"schedule": overlap}, format="json").status_code == 400
    assert teacher.get("/v1/groups", {"search": "Classroom journey"}).json()["data"][0]["id"] == group_id
    assert teacher.post(group_url + "/students/bulk", {"action": "add", "studentIds": [second_id, "z-missing"]}, format="json").status_code == 404
    assert teacher.get(group_url).json()["data"]["students"] == []
    assert teacher.get(task_url).json()["data"] == []
    assert other.get(task_url).status_code == 403
    member_url = group_url + "/students"
    assert teacher.post(member_url, {"studentId": student_id}, format="json").status_code == 201
    assert teacher.post(member_url, {"studentId": student_id}, format="json").status_code == 201
    assert student.get("/v1/groups").json()["data"][0]["id"] == group_id
    # Another teacher cannot pull a student out of this teacher's classroom.
    assert other.post("/v1/groups", {"name": "Foreign classroom"}, format="json").status_code == 201
    foreign_id = other.get("/v1/groups").json()["data"][0]["id"]
    hijack = other.post(f"/v1/groups/{foreign_id}/students", {"studentId": student_id}, format="json")
    assert hijack.status_code == 403, hijack.status_code
    assert ClassroomEnrollment.objects.get(student_id=student_id, ended_at__isnull=True).group_id == group_id
    # Moving between the teacher's own classrooms closes exactly one interval and opens one.
    assert teacher.post("/v1/groups", {"name": "Classroom journey sibling"}, format="json").status_code == 201
    sibling_id = next(g["id"] for g in teacher.get("/v1/groups").json()["data"] if g["id"] != group_id)
    assert teacher.post(f"/v1/groups/{sibling_id}/students", {"studentId": student_id}, format="json").status_code == 201
    assert ClassroomEnrollment.objects.get(student_id=student_id, ended_at__isnull=True).group_id == sibling_id
    assert ClassroomEnrollment.objects.filter(student_id=student_id, group_id=group_id, ended_at__isnull=False).count() == 1
    assert teacher.post(member_url, {"studentId": student_id}, format="json").status_code == 201
    assert ClassroomEnrollment.objects.filter(student_id=student_id, ended_at__isnull=True).count() == 1
    # Archive (not delete) the sibling: enrollment history must remain on record.
    assert teacher.put(f"/v1/groups/{sibling_id}/archive", {"archived": True}, format="json").json()["data"]["archived"]

    day = timezone.localdate()
    attendance = {"groupId": group_id, "date": day.isoformat(), "records": [{"studentId": student_id, "state": "late"}]}
    assert teacher.put("/v1/attendance/bulk", attendance, format="json").status_code == 200
    assert teacher.put("/v1/attendance/bulk", attendance, format="json").status_code == 200
    assert Attendance.objects.filter(group_id=group_id, student_id=student_id, date=day, state="late").count() == 1
    totals = "/v1/attendance/teacher-today"
    assert teacher.get(totals).json()["data"] == {"presentCount": 0, "lateCount": 1, "absentCount": 0}
    assert other.get(totals).json()["data"] == {"presentCount": 0, "lateCount": 0, "absentCount": 0}
    assert student.get(totals).status_code == 403
    items = student.get("/v1/attendance", {"month": day.strftime("%Y-%m")}).json()["data"]
    assert any(row["state"] == "late" for row in items)

    task = teacher.post(task_url, {"title": "Review vocabulary notes"}, format="json")
    assert task.status_code == 201, task.data
    assignment_id = task.json()["data"]["id"]
    assert teacher.get(task_url).json()["data"][0]["id"] == assignment_id
    assert Cohort.objects.filter(classroom_id=group_id).count() == 1
    assert student.get("/v1/student/my-assignments").json()["data"][0]["id"] == assignment_id
    submission = student.post(f"/v1/student/assignments/{assignment_id}/submit", {}, format="json")
    assert submission.status_code == 200 and submission.json()["data"]["status"] == "awaiting_review"
    grade = teacher.post(
        f"/v1/teacher/assignments/{assignment_id}/grade",
        {"student_id": student_id, "score_percent": 90}, format="json",
    )
    assert grade.status_code == 200 and grade.json()["data"]["score_percent"] == 90

    now = timezone.now()
    exams = [MockExam.objects.create(
        id=str(uuid4()), title=f"History fixture {published} {price}", type="ielts_academic",
        profile="IELTS", content_version=1, is_published=published, price=price, is_demo=False,
        is_free_for_approved=False, created_at=now, updated_at=now,
    ) for published, price in ((True, 0), (True, 50), (False, 0))]
    exam_choices = group_url + "/assignable-exams"
    assert other.get(exam_choices).status_code == 403
    assert [row["id"] for row in teacher.get(exam_choices, {"search": "History fixture"}).json()["data"]] == [exams[0].id]
    for exam, expected in zip(exams, (201, 400, 400), strict=True):
        assert teacher.post(task_url, {"title": exam.title, "exam_id": exam.id}, format="json").status_code == expected

    duplicate_title = MockExam.objects.create(
        id=str(uuid4()), title=exams[0].title, type="multilevel", profile="practice",
        content_version=1, is_published=True, price=0, is_demo=False,
        is_free_for_approved=False, created_at=now, updated_at=now,
    )
    for assigned in (exams[0], duplicate_title):
        existing = HomeworkAssignment.objects.filter(exam=assigned).first()
        if existing is None:
            response = teacher.post(task_url, {"title": assigned.title, "exam_id": assigned.pk}, format="json")
            assert response.status_code == 201, response.data
            existing = HomeworkAssignment.objects.get(pk=response.json()["data"]["id"])
        exam_path = f"/v1/student/assignments/{existing.pk}/exam"
        assert student.get(exam_path).json()["data"] == {"id": assigned.pk, "type": assigned.type}
        assert second_client.get(exam_path).status_code == 404
        assert teacher.get(exam_path).status_code == 403
        MockExam.objects.filter(pk=assigned.pk).update(is_published=False)
        assert student.get(exam_path).status_code == 404
        MockExam.objects.filter(pk=assigned.pk).update(is_published=True)
        HomeworkAssignment.objects.filter(pk=existing.pk).update(deadline=now - timedelta(minutes=1))
        assert student.get(exam_path).status_code == 409
        HomeworkAssignment.objects.filter(pk=existing.pk).update(deadline=now + timedelta(days=1))

    attempts = [MockAttempt.objects.create(
        id=str(uuid4()), exam=exams[0], student_id=student_id, status="completed",
        started_at=started, finished_at=started, overall_band=6.5, anti_cheat_count=0, mode="practice",
    ) for started in (now, now - timedelta(days=7))]
    for attempt in attempts:
        AssessmentJob.objects.create(
            id=str(uuid4()), attempt=attempt, student_id=student_id, program="IELTS", skill="writing", input_hash="fixture",
            input_snapshot={}, generation=0, rubric_version="fixture", prompt_version="fixture", policy_mode="MANUAL_ONLY",
            status="SUCCEEDED", version=1, attempt_count=1, approved_feedback={"summary": "Approved fixture"},
            final_score=6.5, final_score_source="TEACHER", completed_at=now, created_at=now, updated_at=now,
        )
    assert teacher.post(member_url + "/bulk", {"action": "add", "studentIds": [student_id, second_id]}, format="json").status_code == 200
    assert teacher.post(member_url + "/bulk", {"action": "remove", "studentIds": [student_id, second_id]}, format="json").status_code == 200
    assert student.get("/v1/groups").json()["data"] == []
    assert student.get("/v1/student/my-assignments").json()["data"] == []
    assert Attendance.objects.filter(group_id=group_id, student_id=student_id).exists()
    assert HomeworkSubmission.objects.filter(assignment_id=assignment_id, student_id=student_id, score_percent=90).exists()
    archive = group_url + "/archive"
    history = group_url + "/member-history"
    assert other.get(f"{history}/{student_id}").status_code == 403
    assert teacher.put(archive, {"archived": True}, format="json").json()["data"]["archived"]
    assert teacher.get(totals).json()["data"] == {"presentCount": 0, "lateCount": 0, "absentCount": 0}
    assert teacher.get("/v1/groups").json()["data"] == []
    assert teacher.get("/v1/groups", {"archived": "true"}).json()["data"][0]["id"] == group_id
    assert teacher.post(member_url, {"studentId": student_id}, format="json").status_code == 409
    student_url = f"/v1/users/{student_id}"
    assert admin.patch(student_url, {"groupId": group_id}, format="json").status_code == 409
    assert teacher.post(task_url, {"title": "Closed"}, format="json").status_code == 409
    former = teacher.get(f"{history}/{student_id}").json()["data"]
    assert not former["currentlyEnrolled"] and former["membership"][0]["endedAt"]
    assert former["attendance"][0]["state"] == "late"
    assert former["homework"][0]["score_percent"] == 90
    assert [row["id"] for row in former["mockExams"]] == [attempts[0].id]
    assert former["feedback"] == [{"attempt_id": attempts[0].id, "skill": "writing", "approved_feedback": {"summary": "Approved fixture"},
                                   "feedback_text": "Approved fixture", "final_score": 6.5}]
    assert len(teacher.get(history).json()["data"]["members"]) == 2
    destination = admin.post("/v1/groups", {"name": "Admin transfer destination"}, format="json").json()["data"]["id"]
    assert admin.patch(student_url, {"groupId": destination}, format="json").status_code == 200
    assert ClassroomEnrollment.objects.filter(group_id=destination, student_id=student_id, ended_at__isnull=True).exists()
    assert admin.patch(student_url, {"groupId": None}, format="json").status_code == 200
    assert ClassroomEnrollment.objects.filter(group_id=destination, student_id=student_id, ended_at__isnull=False).exists()
    assert not teacher.put(archive, {"archived": False}, format="json").json()["data"]["archived"]
    assert teacher.get("/v1/groups").json()["data"][0]["id"] == group_id
    print("PASS classroom lifecycle, teacher and exam assignments, retained scores and approved feedback scoped to enrollment")
    transaction.set_rollback(True)


if __name__ == "__main__":
    verify()
