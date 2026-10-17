"""Django Admin access: sign-in, dashboard, gating and the read-only surface.

These tests run against the isolated PostgreSQL test database
(``test_bestway_django_phase1``). The Prisma-owned ``"User"`` table is created
on the fly through Django's schema editor and is rolled back with the test,
so no fixture row survives. The suite is skipped as a whole when the local
PostgreSQL server is unreachable.
"""
from __future__ import annotations

import bcrypt
import pytest
from django.urls import reverse

BROKEN = None
try:
    import psycopg
    from django.conf import settings as django_settings

    _db = django_settings.DATABASES["default"]
    with psycopg.connect(host=_db["HOST"] or "127.0.0.1", port=int(_db["PORT"]),
                         user=_db["USER"], password=_db["PASSWORD"],
                         dbname="postgres", connect_timeout=3):
        pass
except Exception as error:  # pragma: no cover - environment dependent
    BROKEN = str(error)

if BROKEN:
    pytest.skip(f"local PostgreSQL unavailable: {BROKEN}", allow_module_level=True)


PASSWORD = "Admin-Session-Fixture-Passw0rd"


@pytest.fixture(autouse=True)
def _close_shared_connections():
    """Leave ``django.db.connection`` closed after every test.

    Other suites (scheduler/polling tests) call ``close_old_connections()``
    and expect no open connection object; a leftover session would turn their
    ``SimpleTestCase`` run into a blocked database access.
    """
    yield
    from django.db import connections

    connections.close_all()


PRISMA_TABLES = ("User", "MockExam", "MockSection", "MockQuestionGroup", "MockQuestion")


@pytest.fixture()
def legacy_schema(db):
    """Create the Prisma-shaped tables the admin screens read (rolled back)."""
    from apps.legacy_schema import models as legacy_models
    from django.db import connection

    existing = set(connection.introspection.table_names())
    created = []
    for name in PRISMA_TABLES:
        model = getattr(legacy_models, name)
        if model._meta.db_table not in existing:
            with connection.schema_editor() as editor:
                editor.create_model(model)
            created.append(model)
    yield
    for model in reversed(created):
        with connection.schema_editor() as editor:
            editor.delete_model(model)


@pytest.fixture()
def legacy_users(legacy_schema):
    """Create two disposable accounts on the Prisma-shaped User table."""
    from apps.legacy_schema.models import User
    from django.utils import timezone

    stamp = timezone.now()
    password_hash = bcrypt.hashpw(
        PASSWORD.encode(), bcrypt.gensalt(rounds=4)
    ).decode("ascii")
    admin = User.objects.create(
        id="pytest-admin-user", name="Pytest Admin", phone="+998900000901",
        email=None, password_hash=password_hash, role="super_admin",
        is_active=True, telegram_chat_id=None, created_at=stamp, updated_at=stamp,
    )
    student = User.objects.create(
        id="pytest-student-user", phone="+998900000902", name="Pytest Student",
        email=None, password_hash=password_hash, role="student",
        is_active=True, telegram_chat_id=None, created_at=stamp, updated_at=stamp,
    )
    yield admin, student
    User.objects.all().delete()


def test_anonymous_admin_redirects_to_login(client):
    response = client.get(reverse("admin:index"))
    assert response.status_code == 302
    assert reverse("admin:login") in response.headers["Location"]


def test_admin_login_dashboard_and_readonly_models(client, legacy_users):
    admin, _student = legacy_users
    login = client.post(reverse("admin:login"), {
        "username": admin.phone, "password": PASSWORD, "next": "/admin/",
    })
    assert login.status_code == 302
    assert login.headers["Location"].rstrip("/").endswith("/admin")

    dashboard = client.get(reverse("admin:index"))
    assert dashboard.status_code == 200
    content = dashboard.content.decode()
    assert "BESTWAY Administration" in content
    assert "Mock exams" in content

    changelist = client.get(reverse("admin:legacy_schema_mockexam_changelist"))
    assert changelist.status_code == 200
    assert "legacy_schema/mockexam/add/" not in changelist.content.decode()

    assert client.get(
        reverse("admin:legacy_schema_mockexam_add")
    ).status_code == 403
    # The detail page is view-only; any attempt to persist is refused.
    assert client.get(
        reverse("admin:legacy_schema_user_change", args=[admin.id])
    ).status_code == 200
    assert client.post(
        reverse("admin:legacy_schema_user_change", args=[admin.id]),
        {"phone": admin.phone, "role": "student"},
    ).status_code == 403
    assert client.get(
        reverse("admin:legacy_schema_user_delete", args=[admin.id])
    ).status_code == 403


def test_non_admin_account_cannot_sign_in(client, legacy_users):
    _admin, student = legacy_users
    login = client.post(reverse("admin:login"), {
        "username": student.phone, "password": PASSWORD, "next": "/admin/",
    })
    assert login.status_code == 200
    assert b"staff account" in login.content
    assert client.get(reverse("admin:index")).status_code == 302


def test_wrong_password_is_refused(client, legacy_users):
    admin, _student = legacy_users
    login = client.post(reverse("admin:login"), {
        "username": admin.phone, "password": "not-the-password", "next": "/admin/",
    })
    assert login.status_code == 200
    assert client.get(reverse("admin:index")).status_code == 302


def test_revoked_role_ends_an_open_admin_session(client, legacy_users):
    from django.contrib.auth import get_user_model

    admin, _student = legacy_users
    client.post(reverse("admin:login"), {
        "username": admin.phone, "password": PASSWORD, "next": "/admin/",
    })
    assert client.get(reverse("admin:index")).status_code == 200

    # The Prisma row is authoritative: demoting the account must end the
    # already-established Admin session on the very next request.
    admin.role = "student"
    admin.save(update_fields=["role"])
    assert client.get(reverse("admin:index")).status_code == 302

    # The Django-managed mirror is still staff, but it can never sign in on
    # its own: its password is unusable.
    mirror = get_user_model().objects.get(username=admin.id)
    assert not mirror.has_usable_password()
    fallback = client.post(reverse("admin:login"), {
        "username": admin.id, "password": PASSWORD, "next": "/admin/",
    })
    assert fallback.status_code == 200


def test_v1_api_still_accepts_post_without_a_csrf_token(client):
    """Enabling the Admin stack must not CSRF-protect the DRF API."""
    response = client.post("/v1/auth/login", data={}, content_type="application/json")
    assert response.status_code in (400, 401, 429)
    assert response.status_code != 403
