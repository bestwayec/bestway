"""Local, rollback-only smoke test for the Phase 2 authentication contract.

It deliberately uses an existing account written by the Nest/Prisma seed.  Every
refresh-token write is enclosed in one database transaction and rolled back.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
import django
django.setup()

from django.db import transaction
from django.conf import settings
from rest_framework.test import APIClient


def expect(response, status: int, label: str):
    if response.status_code != status:
        raise RuntimeError(f"{label}: expected {status}, got {response.status_code}: {response.content[:300]!r}")
    body = response.json()
    if not body.get("success"):
        raise RuntimeError(f"{label}: expected success envelope")
    return body["data"]


def main():
    settings.ALLOWED_HOSTS = [*settings.ALLOWED_HOSTS, "testserver"]
    phone = os.environ.get("AUTH_TEST_PHONE", os.environ.get("SEED_SUPER_ADMIN_PHONE", "+998900000001"))
    password = os.environ.get("AUTH_TEST_PASSWORD", os.environ.get("SEED_SUPER_ADMIN_PASSWORD", "Super123!"))
    client = APIClient()
    with transaction.atomic():
        login = expect(client.post("/v1/auth/login", {"phone": phone, "password": password}, format="json"), 200, "legacy bcrypt login")
        if login["user"]["phone"] != phone or login["user"]["role"] != "super_admin":
            raise RuntimeError("login returned the wrong user identity")
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login['accessToken']}")
        expect(client.get("/v1/auth/me"), 200, "JWT /auth/me")
        users = expect(client.get("/v1/users?limit=100"), 200, "super-admin users list")
        target = next((item for item in users if item["role"] != "super_admin"), None)
        if target is None:
            raise RuntimeError("local database has no non-super-admin user for rollback password verification")
        temporary_password = "Phase2Rollback!9"
        expect(client.patch(f"/v1/users/{target['id']}", {"password": temporary_password}, format="json"), 200, "admin password reset")
        password_login = expect(client.post("/v1/auth/login", {"phone": target["phone"], "password": temporary_password}, format="json"), 200, "bcrypt password reset login")
        if password_login["user"]["id"] != target["id"]:
            raise RuntimeError("password reset login returned the wrong user")
        refreshed = expect(client.post("/v1/auth/refresh", {"refreshToken": login["refreshToken"]}, format="json"), 200, "refresh rotation")
        expect(client.post("/v1/auth/logout", {"refreshToken": refreshed["refreshToken"]}, format="json"), 200, "logout")
        transaction.set_rollback(True)
    print("PASS: existing Nest bcrypt account, JWT authentication, admin password reset/login, refresh rotation, logout, and user list (all writes rolled back)")


if __name__ == "__main__":
    main()
