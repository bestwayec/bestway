"""Django Admin sign-in backed by the Prisma-owned ``User`` table.

BESTWAY stores account passwords as bcrypt ``passwordHash`` values (the same
hashes NestJS' ``bcryptjs`` writes) and signs in with a phone number. This
backend lets the Django Admin login form reuse those *existing* credentials:

* no password is ever stored, derived or bypassed here — only
  ``common.auth.passwords.verify_password`` decides, exactly like API login;
* only active ``admin`` / ``super_admin`` accounts are reachable, so an
  ordinary teacher/student/parent account can never open the Admin;
* the role/active gate runs again on ``get_user`` for **every** request, so
  deactivating an account or changing its role ends its Admin session at once.

Django's session machinery stores and re-reads ``AUTH_USER_MODEL`` primary
keys, which are integers, while Prisma account ids are strings. The Admin
session is therefore held by a Django-managed ``auth.User`` *mirror* row whose
username is the Prisma account id:

* the mirror always carries an unusable password, so it can never be signed
  into directly — the bcrypt password of the Prisma account is the only
  credential that works;
* nothing is ever written to a Prisma-owned table;
* removing the mirror (or the Prisma account) drops the session immediately.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import BaseBackend
from django.db import connection

from common.auth.passwords import verify_password

ADMIN_ROLES = {"admin", "super_admin"}


class BestwayLegacyUserBackend(BaseBackend):
    """Authenticate against ``"User".passwordHash`` with phone/email/id."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        identifier = (username or kwargs.get("phone") or "").strip()
        if not identifier or not password:
            return None
        row = self._lookup(identifier)
        if row is None:
            # Same dummy bcrypt hash auth_service uses so an unknown
            # identifier still pays for one password verification and does
            # not leak which accounts exist.
            from apps.core.auth_service import DUMMY_HASH

            verify_password(password, DUMMY_HASH)
            return None
        user_id, password_hash, is_active, role, name, phone, email = row
        if not verify_password(password, password_hash):
            return None
        if not is_active or role not in ADMIN_ROLES:
            return None
        return self._mirror(user_id, role=role, name=name, phone=phone, email=email)

    def get_user(self, user_id):
        """Re-validate the Prisma account behind a stored Admin session."""
        user_model = get_user_model()
        user = user_model._default_manager.filter(pk=user_id).first()
        if user is None:
            return None
        row = self._by_id(str(user.username))
        if row is None:
            return None
        is_active, role = row[2], row[3]
        if not is_active or role not in ADMIN_ROLES:
            return None
        superuser = role in ADMIN_ROLES
        if not user.is_staff or user.is_superuser != superuser:
            user.is_staff = True
            user.is_superuser = superuser
            user.save(update_fields=["is_staff", "is_superuser"])
        return user

    # ── helpers ──────────────────────────────────────────────────────────
    def _mirror(self, user_id: str, *, role: str, name: str | None,
                phone: str | None, email: str | None):
        user_model = get_user_model()
        username = str(user_id)[:150]
        user, created = user_model._default_manager.get_or_create(
            username=username,
            defaults={
                "is_staff": True,
                "is_superuser": role in ADMIN_ROLES,
                "is_active": True,
                "first_name": (phone or "")[:150],
                "last_name": (name or "")[:150],
                "email": (email or "")[:254],
            },
        )
        changed: list[str] = []
        for field, value in (("is_staff", True),
                             ("is_superuser", role in ADMIN_ROLES),
                             ("is_active", True)):
            if getattr(user, field) != value:
                setattr(user, field, value)
                changed.append(field)
        if created or user.has_usable_password():
            # A mirror is never a login target of its own.
            user.set_unusable_password()
            changed.append("password")
        if changed:
            user.save(update_fields=changed)
        return user

    @staticmethod
    def _lookup(identifier: str):
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT "id", "passwordHash", "isActive", "role", "name", "phone", "email" '
                'FROM "User" WHERE "phone" = %s OR lower("email") = lower(%s) OR lower(split_part("email", \'@\', 1)) = lower(%s) OR "id" = %s',
                [identifier, identifier, identifier, identifier],
            )
            return cursor.fetchone()

    @staticmethod
    def _by_id(user_id: str):
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT "id", "passwordHash", "isActive", "role" FROM "User" WHERE "id" = %s',
                [user_id],
            )
            return cursor.fetchone()
