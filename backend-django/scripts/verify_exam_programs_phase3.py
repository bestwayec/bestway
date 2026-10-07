"""Rollback-only verification of the ported exam-program endpoints."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
import django
django.setup()

from django.conf import settings
from django.db import connection, transaction
from rest_framework.test import APIClient
from common.auth.jwt import issue_access
from apps.core import exam_programs


def expect(response, status, label):
    if response.status_code != status or not response.json().get("success"):
        raise RuntimeError(f"{label}: {response.status_code} {response.content[:300]!r}")
    return response.json()["data"]


def login(phone, password):
    client = APIClient(); data = expect(client.post("/v1/auth/login", {"phone": phone, "password": password}, format="json"), 200, "login")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {data['accessToken']}")
    return client


def client_for(user_id, role):
    client = APIClient(); client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_access(user_id, role)}")
    return client


def main():
    settings.ALLOWED_HOSTS = [*settings.ALLOWED_HOSTS, "testserver"]
    super_phone = os.environ.get("SEED_SUPER_ADMIN_PHONE", "+998900000001")
    super_password = os.environ.get("SEED_SUPER_ADMIN_PASSWORD", "Super123!")
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT u."id" FROM "User" u JOIN "StudentProfile" s ON s."userId"=u."id" WHERE u."isActive"=true LIMIT 1')
        student_id = cursor.fetchone()[0]
        student = client_for(student_id, "student")
        mine = expect(student.get("/v1/exam-programs/mine"), 200, "student program state")
        if mine["activeProgram"] not in mine["availablePrograms"]: raise RuntimeError("invalid active program state")
        # Exercise the same transactional service directly first so a SQL
        # contract failure produces a useful traceback in this local harness.
        exam_programs.select(student_id, mine["activeProgram"])
        expect(student.patch("/v1/exam-programs/mine", {"program": mine["activeProgram"]}, format="json"), 200, "student keeps active program")
        staff = login(super_phone, super_password)
        users = expect(staff.get("/v1/users?role=student&limit=1"), 200, "student lookup")
        target = users[0]["id"]
        managed = expect(staff.get(f"/v1/exam-programs/students/{target}"), 200, "staff program state")
        expect(staff.put(f"/v1/exam-programs/students/{target}", {"availablePrograms": managed["availablePrograms"], "activeProgram": managed["activeProgram"]}, format="json"), 200, "staff preserves program assignment")
        transaction.set_rollback(True)
    print("PASS: student/self and super-admin program-track contract checks (all writes rolled back)")


if __name__ == "__main__": main()
