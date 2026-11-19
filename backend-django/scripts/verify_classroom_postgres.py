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
    second_id, _ = actor("student")
    assert teacher.post("/v1/groups", {"name": "Classroom journey"}, format="json").status_code == 201
    group_id = teacher.get("/v1/groups").json()["data"][0]["id"]
    group_url = f"/v1/groups/{group_id}"
    task_url = group_url + "/assignments"
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
    assert teacher.get("/v1/groups").json()["data"] == []
    assert teacher.get("/v1/groups", {"archived": "true"}).json()["data"][0]["id"] == group_id
    assert teacher.post(member_url, {"studentId": student_id}, format="json").status_code == 409
    assert teacher.post(task_url, {"title": "Closed"}, format="json").status_code == 409
    former = teacher.get(f"{history}/{student_id}").json()["data"]
    assert not former["currentlyEnrolled"] and former["membership"][0]["endedAt"]
    assert former["attendance"][0]["state"] == "late"
    assert former["homework"][0]["score_percent"] == 90
    assert len(teacher.get(history).json()["data"]["members"]) == 2
    assert not teacher.put(archive, {"archived": False}, format="json").json()["data"]["archived"]
    assert teacher.get("/v1/groups").json()["data"][0]["id"] == group_id
    print("PASS multiple slots, overlap rejection, bulk rollback, enrollment, attendance, homework, archive/restore and retained history")
    transaction.set_rollback(True)


if __name__ == "__main__":
    verify()
