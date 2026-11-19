"""Verify the Group roster, attendance and existing homework workflow on local PostgreSQL."""
from verify_group_contract_postgres import actor, transaction

from django.utils import timezone

from apps.core.models import Cohort, HomeworkSubmission
from apps.legacy_schema.models import Attendance


@transaction.atomic
def verify():
    _, teacher = actor("teacher")
    _, other = actor("teacher")
    student_id, student = actor("student")
    assert teacher.post("/v1/groups", {"name": "Classroom journey"}, format="json").status_code == 201
    group_id = teacher.get("/v1/groups").json()["data"][0]["id"]
    group_url = f"/v1/groups/{group_id}"
    task_url = group_url + "/assignments"
    assert teacher.get(task_url).json()["data"] == []
    assert other.get(task_url).status_code == 403
    member_url = group_url + "/students"
    assert teacher.post(member_url, {"studentId": student_id}, format="json").status_code == 201
    assert teacher.post(member_url, {"studentId": student_id}, format="json").status_code == 201
    assert student.get("/v1/groups").json()["data"][0]["id"] == group_id

    day = timezone.localdate()
    attendance = {"groupId": group_id, "date": day.isoformat(), "records": [{"studentId": student_id, "state": "late"}]}
    assert teacher.put("/v1/attendance/bulk", attendance, format="json").status_code == 200
    assert teacher.put("/v1/attendance/bulk", attendance, format="json").status_code == 200
    assert Attendance.objects.filter(group_id=group_id, student_id=student_id, date=day, state="late").count() == 1
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
    assert teacher.delete(f"{member_url}/{student_id}").status_code == 200
    assert student.get("/v1/groups").json()["data"] == []
    assert student.get("/v1/student/my-assignments").json()["data"] == []
    assert Attendance.objects.filter(group_id=group_id, student_id=student_id).exists()
    assert HomeworkSubmission.objects.filter(assignment_id=assignment_id, student_id=student_id, score_percent=90).exists()
    print("PASS classroom create, enroll, idempotent attendance, assignment, review, removal and preserved history")
    transaction.set_rollback(True)


if __name__ == "__main__":
    verify()
