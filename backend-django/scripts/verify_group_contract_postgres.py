"""Run the shared Group contract against an explicitly local PostgreSQL database."""
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
url = urlparse(os.environ.get("DATABASE_URL", ""))
if url.hostname not in {"127.0.0.1", "localhost", "::1"} or not url.path.endswith("_local"):
    raise SystemExit("Requires an explicitly disposable local database ending in _local")

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
import django

django.setup()
from django.db import transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.auth_service import fetch_user, issue_tokens
from apps.legacy_schema.models import Group, ParentStudent, User
from common.auth.jwt import issue_access


def actor(role):
    uid = str(uuid4())
    User.objects.create(
        id=uid, name=f"Local {role}", phone=uid, role=role, password_hash="unused",
        is_active=True, created_at=timezone.now(), updated_at=timezone.now(),
    )
    return uid, bearer(issue_access(uid, role))


def bearer(access_token):
    return APIClient(HTTP_HOST="localhost", HTTP_AUTHORIZATION=f"Bearer {access_token}")


@transaction.atomic
def verify():
    teacher_id, teacher = actor("teacher")
    other_id, other = actor("teacher")
    student_id, student = actor("student")
    peer_id, _ = actor("student")
    parent_id, parent = actor("parent")
    _, admin = actor("admin")
    schedule = [{"day": "wed", "startTime": "12:00", "endTime": "13:00"}]
    payload = {"name": "Contract fixture", "schedule": schedule}

    assert APIClient(HTTP_HOST="localhost").get("/v1/groups").status_code == 401
    assert student.post("/v1/groups", payload, format="json").status_code == 403
    assert teacher.post("/v1/groups", {**payload, "teacherId": other_id}, format="json").status_code == 403
    assert teacher.patch(f"/v1/users/{teacher_id}", {"role": "admin"}, format="json").status_code == 403
    assert User.objects.get(id=teacher_id).role == "teacher"
    assert teacher.post("/v1/groups", {"name": "x"}, format="json").status_code == 400
    created = teacher.post("/v1/groups", payload, format="json")
    assert created.status_code == 201, created.data
    group = created.json()["data"]
    group_id = group["id"]
    assert Group.objects.filter(id=group_id, teacher_id=teacher_id).exists()
    assert group["schedule"] == schedule and group["students"] == []
    assert group["analytics"]["averageBandScore"] is None
    assert group["analytics"]["totalCompletedAttempts"] == 0
    path = f"/v1/groups/{group_id}"
    for uid in (student_id, peer_id):
        assert teacher.post(path + "/students", {"studentId": uid}, format="json").status_code == 201
    ParentStudent.objects.create(parent_user_id=parent_id, student_id=student_id, created_at=timezone.now())

    for client in (student, parent):
        detail = client.get(path).json()["data"]
        assert [row["studentId"] for row in detail["students"]] == [student_id]
        assert "phone" not in detail["students"][0]
    assert other.get(path).status_code == 403
    assert other.patch(path, {"name": "Unauthorized"}, format="json").status_code == 403
    assert other.get(path + "/export/excel").status_code == 403
    assert student.get(path + "/export").status_code == 403
    assert admin.get(path).status_code == 200
    assert teacher.get(path + "/export/excel").status_code == 200
    assert teacher.get("/v1/groups").json() == teacher.get("/api/v1/groups").json()
    assert teacher.get(path).json() == teacher.get(path.replace("/v1", "/api/v1", 1)).json()
    with override_settings(JWT_ACCESS_TTL_MINUTES=-1):
        expired = issue_access(teacher_id, "teacher")
    invalid_claim = issue_access(peer_id, "arbitrary-role")
    for credential in (expired, invalid_claim):
        assert bearer(credential).get(path + "/export/excel").status_code in (401, 403)

    user = fetch_user(user_id=teacher_id)
    first, second = issue_tokens(user), issue_tokens(user)
    first_device, second_device = (bearer(tokens["accessToken"]) for tokens in (first, second))
    assert first_device.get(path).status_code == second_device.get(path).status_code == 200
    refreshed = first_device.post("/v1/auth/refresh", {"refreshToken": first["refreshToken"]}, format="json")
    assert refreshed.status_code == 200
    assert first_device.get(path).status_code == 200
    successor = bearer(refreshed.json()["data"]["accessToken"])
    assert first_device.post("/v1/auth/logout-refresh", {"refreshToken": first["refreshToken"]}, format="json").status_code == 200
    for revoked in (first_device, successor):
        assert revoked.get(path).status_code == revoked.get(path + "/export/excel").status_code == 401
    assert second_device.get(path).status_code == 200
    # A still-valid pre-upgrade access token remains usable until its JWT expires.
    assert teacher.get(path).status_code == 200
    assert second_device.post("/v1/auth/logout", {}, format="json").status_code == 200
    assert second_device.get(path).status_code == 401
    User.objects.filter(id=teacher_id).update(is_active=False)
    assert teacher.get(path).status_code == 401
    print("PASS Group contract, scoped roles and exports, expired and inactive users, family rotation, immediate access revocation and independent device sessions")
    transaction.set_rollback(True)


if __name__ == "__main__":
    verify()
