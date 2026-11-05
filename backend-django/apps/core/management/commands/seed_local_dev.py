"""Seed SYNTHETIC accounts for a disposable local development database.

Refuses to run unless DEBUG is on and DATABASE_URL points at a loopback host
and a database whose name ends in ``_local``. Never use real student data.

Accounts (all passwords are LOCAL_DEV_PASSWORD below) are idempotent: running
the command twice does not create duplicates.
"""
from __future__ import annotations

from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from apps.legacy_schema.models import Group, StudentProfile, User
from common.auth.passwords import hash_password

LOCAL_DEV_PASSWORD = "LocalDev-2026!"
ACCOUNTS = [
    # (phone, name, role)
    ("+998900000001", "Local Super Admin", "super_admin"),
    ("+998900000002", "Local Admin", "admin"),
    ("+998900000003", "Local Teacher", "teacher"),
    ("+998900000010", "Local Student", "student"),
    ("+998900000011", "Local Student Two", "student"),
    ("+998900000020", "Local Parent", "parent"),
]


class Command(BaseCommand):
    help = "Create synthetic local users/group. Only for a disposable *_local database on loopback."

    def handle(self, *args, **options):
        db = connection.settings_dict
        if not settings.DEBUG:
            raise CommandError("Refusing: DEBUG is off.")
        if db["HOST"] not in ("127.0.0.1", "localhost", "::1") or not str(db["NAME"]).endswith("_local"):
            raise CommandError("Refusing: database must be loopback and named *_local.")

        now = timezone.now()
        users: dict[str, User] = {}
        for phone, name, role in ACCOUNTS:
            user = User.objects.filter(phone=phone).first()
            if user is None:
                user = User.objects.create(
                    id=str(uuid4()), name=name, phone=phone, email=f"{role}{phone[-2:]}@local.test",
                    password_hash=hash_password(LOCAL_DEV_PASSWORD), role=role, is_active=True,
                    created_at=now, updated_at=now,
                )
                self.stdout.write(f"created {role}: {phone}")
            else:
                User.objects.filter(id=user.id).update(
                    password_hash=hash_password(LOCAL_DEV_PASSWORD), is_active=True, updated_at=now)
                self.stdout.write(f"reset password {role}: {phone}")
            users[phone] = user

        teacher = users["+998900000003"]
        group = Group.objects.filter(name="Local Group A").first()
        if group is None:
            group = Group.objects.create(id=str(uuid4()), name="Local Group A", teacher_id=teacher.id, created_at=now)

        with connection.cursor() as cursor:
            for phone in ("+998900000010", "+998900000011"):
                student = users[phone]
                if not StudentProfile.objects.filter(user_id=student.id).exists():
                    cursor.execute(
                        'INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved",'
                        '"groupId","currentPoints","linkCode","createdAt","gameQualified") '
                        'VALUES (%s,ARRAY[\'IELTS\',\'MULTILEVEL\']::"ExamProgram"[],\'MULTILEVEL\'::"ExamProgram",'
                        'true,%s,100,%s,NOW(),false)',
                        [student.id, group.id, f"LOC{phone[-2:]}"],
                    )
                else:
                    StudentProfile.objects.filter(user_id=student.id).update(group_id=group.id, is_approved=True)
        self.stdout.write(self.style.SUCCESS("Synthetic local data ready."))
