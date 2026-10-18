"""End-to-end Django Admin verification against a real local server.

The script starts ``manage.py runserver`` on a loopback port, drives the real
admin login flow over HTTP (cookies + CSRF included) with a disposable
super-admin fixture, and asserts:

* anonymous ``/admin/`` redirects to the login form,
* an existing Prisma account (phone + bcrypt password) opens the dashboard,
* a non-administrator account is refused,
* registered Prisma models are visible but offer no add/change/delete surface,
* the ``/v1`` API still answers and still accepts POSTs without a CSRF token
  (DRF views stay csrf-exempt), i.e. enabling Admin did not break the API.

It uses the configured local DATABASE_URL only, creates one uniquely named
user, and removes that user again in ``finally``. It never touches production
and refuses non-local database hosts.

Usage:
    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/education_center \\
        .venv/Scripts/python.exe scripts/verify_django_admin_local.py
"""
from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

database_url = os.environ.get("DATABASE_URL", "")
database_host = urlparse(database_url).hostname
if database_host not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit(f"Refusing non-local DATABASE_URL host: {database_host!r}")

import django

django.setup()

from common.auth.passwords import hash_password

PORT = int(os.environ.get("BESTWAY_ADMIN_VERIFY_PORT", "8123"))
BASE = f"http://127.0.0.1:{PORT}"
run_id = uuid4().hex[:12]
checks: list[str] = []


def check(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print(f"PASS  {label}")


# ── Disposable fixtures ────────────────────────────────────────────────────
from apps.legacy_schema.models import User

admin_password = secrets.token_urlsafe(18)
student_password = secrets.token_urlsafe(18)
admin_id = f"django-admin-verify-{run_id}"
student_id = f"django-student-verify-{run_id}"
admin_phone = f"+99890{secrets.randbelow(10 ** 7):07d}"
student_phone = f"+99891{secrets.randbelow(10 ** 7):07d}"
created_ids: list[str] = []


def create_fixtures() -> None:
    from django.utils import timezone

    now = timezone.now()
    User.objects.create(id=admin_id, name="Django Admin Verify", phone=admin_phone,
                        email=None, password_hash=hash_password(admin_password),
                        role="super_admin", is_active=True, telegram_chat_id=None,
                        created_at=now, updated_at=now)
    created_ids.append(admin_id)
    User.objects.create(id=student_id, name="Django Student Verify", phone=student_phone,
                        email=None, password_hash=hash_password(student_password),
                        role="student", is_active=True, telegram_chat_id=None,
                        created_at=now, updated_at=now)
    created_ids.append(student_id)


def remove_fixtures() -> None:
    from django.contrib.auth import get_user_model

    for user_id in created_ids:
        User.objects.filter(id=user_id).delete()
        # The Admin session mirror row is keyed by the Prisma account id.
        get_user_model()._default_manager.filter(username=user_id).delete()
    created_ids.clear()


# ── Tiny cookie-aware HTTP client ─────────────────────────────────────────
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Return 3xx responses instead of following them, so redirects can be asserted."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Session:
    def __init__(self) -> None:
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            _NoRedirect, urllib.request.HTTPCookieProcessor(self.jar)
        )

    def request(self, method: str, path: str, data: dict[str, str] | str | None = None,
                headers: dict[str, str] | None = None):
        body = None
        request_headers = {"User-Agent": "bestway-admin-verify"} if headers is None else dict(headers)
        if isinstance(data, str):
            body = data.encode()
            request_headers.setdefault("Content-Type", "application/json")
        elif data is not None:
            body = urllib.parse.urlencode(data).encode()
            request_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        request = urllib.request.Request(f"{BASE}{path}", data=body, method=method,
                                         headers=request_headers)
        try:
            response = self.opener.open(request, timeout=20)
            return response.status, response.read().decode("utf-8", "replace"), response.geturl()
        except urllib.error.HTTPError as error:
            location = error.headers.get("Location") or error.geturl()
            return error.code, error.read().decode("utf-8", "replace"), location

    def csrf_token(self, path: str) -> str:
        for cookie in self.jar:
            if cookie.name == "csrftoken":
                return cookie.value
        status, html, _ = self.request("GET", path)
        if status != 200:
            raise AssertionError(f"GET {path} -> {status}")
        match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
        if not match:
            raise AssertionError(f"No CSRF token on {path}")
        return match.group(1)


def start_server() -> subprocess.Popen:
    log = Path(__file__).resolve().parents[1] / "tmp" / f"admin-verify-{run_id}.log"
    log.parent.mkdir(exist_ok=True)
    process = subprocess.Popen(
        [sys.executable, "manage.py", "runserver", f"127.0.0.1:{PORT}", "--noreload"],
        cwd=str(Path(__file__).resolve().parents[1]),
        stdout=log.open("w", encoding="utf-8"),
        stderr=subprocess.STDOUT,
        env={**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings.local"},
    )
    deadline = time.time() + 60
    while time.time() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"runserver exited early:\n{log.read_text(encoding='utf-8')[-2000:]}")
        try:
            status, _, _ = Session().request("GET", "/v1/health")
            if status in (200, 404):
                return process
        except OSError:
            time.sleep(0.4)
    process.terminate()
    raise AssertionError("runserver did not become ready within 60s")


def login(session: Session, phone: str, password: str) -> tuple[int, str, str]:
    token = session.csrf_token("/admin/login/")
    return session.request(
        "POST",
        "/admin/login/",
        data={"username": phone, "password": password, "csrfmiddlewaretoken": token,
              "next": "/admin/"},
        headers={"Referer": f"{BASE}/admin/login/"},
    )


def main() -> None:
    create_fixtures()
    server = start_server()
    try:
        guest = Session()
        status, html, location = guest.request("GET", "/admin/")
        check(status in (302, 301) and "/admin/login/" in location,
              f"anonymous /admin/ redirects to login ({status} -> {location})")

        status, html, _ = guest.request("GET", "/admin/login/")
        check(status == 200 and "Phone number" in html and "csrfmiddlewaretoken" in html,
              "login page renders with phone field and CSRF token")

        # 1) Admin login with the existing authorized account.
        admin_session = Session()
        status, html, location = login(admin_session, admin_phone, admin_password)
        check(status == 302 and location.rstrip("/").endswith("/admin"),
              f"super-admin login redirects to the dashboard ({status})")

        status, html, _ = admin_session.request("GET", "/admin/")
        check(status == 200 and "BESTWAY Administration" in html,
              "admin dashboard renders for a super-admin session")
        check("Mock exams" in html and "Users" in html,
              "dashboard lists registered Prisma models")

        # 2) Model access: changelist works, write surface does not exist.
        status, html, _ = admin_session.request("GET", "/admin/legacy_schema/mockexam/")
        check(status == 200 and "Mock exams" in html,
              "MockExam changelist is readable")
        status, html, _ = admin_session.request("GET", "/admin/legacy_schema/user/")
        check(status == 200 and admin_phone in html,
              "User changelist shows the Prisma account")
        check("/admin/legacy_schema/mockexam/add/" not in html,
              "no add links are offered for Prisma-owned models")

        status, html, _ = admin_session.request("GET", "/admin/legacy_schema/mockexam/add/")
        check(status in (403, 404), f"add view is refused ({status})")

        token = admin_session.csrf_token("/admin/legacy_schema/mockexam/")
        status, html, _ = admin_session.request(
            "POST", "/admin/legacy_schema/mockexam/",
            data={"action": "delete_selected", "index": 0, "_selected_action": [],
                  "csrfmiddlewaretoken": token},
            headers={"Referer": f"{BASE}/admin/legacy_schema/mockexam/"},
        )
        check(status in (403, 405, 200) and "deleted" not in html.lower(),
              f"bulk delete action is unavailable ({status})")

        # 3) A non-administrator account is refused by the staff gate.
        denied = Session()
        status, html, location = login(denied, student_phone, student_password)
        check(status == 200 and "Please enter the correct" in html,
              "student account is rejected by the admin staff gate")
        status, _, location = denied.request("GET", "/admin/")
        check(status in (302, 301) and "/admin/login/" in location,
              "student session never reaches the dashboard")

        # 4) The API is untouched: no CSRF token needed for DRF mutations.
        api = Session()
        status, html, _ = api.request("GET", "/v1/health")
        check(status == 200, f"GET /v1/health stays healthy ({status})")
        status, html, _ = api.request(
            "POST", "/v1/auth/login",
            data=json.dumps({"phone": admin_phone, "password": "wrong-password-on-purpose"}),
            headers={"Content-Type": "application/json"},
        )
        check(status in (400, 401, 429),
              f"POST /v1/auth/login is answered without a CSRF token ({status})")

        print(f"\nALL {len(checks)} CHECKS PASSED")
    finally:
        server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()
        remove_fixtures()


if __name__ == "__main__":
    main()
