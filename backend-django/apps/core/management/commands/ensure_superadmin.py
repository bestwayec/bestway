"""Ensure an operator-named super_admin account exists (no built-in Telegram id or password)."""
from __future__ import annotations

from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.legacy_schema.models import StudentProfile, User
from common.auth.passwords import hash_password


class Command(BaseCommand):
    help = ("Ensure an operator-named super_admin account exists. No built-in Telegram id or password: pass --telegram-id to link "
            "Telegram (optional) and --password to set/reset the password (a random one is generated and shown once on creation).")

    def add_arguments(self, parser):
        parser.add_argument(
            "--telegram-id",
            dest="telegram_id",
            default=None,
            help="Telegram chat ID to link to this account (optional; never defaulted)",
        )
        parser.add_argument(
            "--email",
            dest="email",
            default="superadmin@bestwayec.uz",
            help="Email address for the superadmin account",
        )
        parser.add_argument(
            "--phone",
            dest="phone",
            default="+998900000001",
            help="Phone number for the superadmin account if created from scratch",
        )
        parser.add_argument(
            "--name",
            dest="name",
            default="Komiljon Roziyev (SuperAdmin)",
            help="Full name for the superadmin account",
        )
        parser.add_argument(
            "--password",
            dest="password",
            default=None,
            help="Explicit password to set for the superadmin account",
        )

    def handle(self, *args, **options):
        telegram_id = str(options.get("telegram_id") or "").strip() or None
        email = str(options.get("email") or "superadmin@bestwayec.uz").strip()
        phone = str(options.get("phone") or "+998900000001").strip()
        name = str(options.get("name") or "Komiljon Roziyev (SuperAdmin)").strip()
        explicit_password = options.get("password") or None
        import secrets
        raw_password = explicit_password or secrets.token_urlsafe(18)
        generated = explicit_password is None
        now = timezone.now()

        # Priority 1: User already linked to this telegram_id
        user = User.objects.filter(telegram_chat_id=telegram_id).first() if telegram_id else None
        if user is None:
            # Priority 2: User with the specified email
            user = User.objects.filter(email=email).first()
        if user is None:
            # Priority 3: Existing super_admin without conflicting telegram_id
            user = User.objects.filter(role="super_admin", telegram_chat_id__isnull=True).order_by("created_at").first()

        if user is not None:
            # Ensure telegram_chat_id is set to target telegram_id
            update_fields = {
                "role": "super_admin",
                "is_active": True,
                "updated_at": now,
            }
            if telegram_id:
                update_fields["telegram_chat_id"] = telegram_id
            if explicit_password:  # an existing account's password changes only when the operator asks
                update_fields["password_hash"] = hash_password(explicit_password)
            if not user.email:
                update_fields["email"] = email
            User.objects.filter(id=user.id).update(**update_fields)
            user.role = "super_admin"
            user.is_active = True
            if telegram_id:
                user.telegram_chat_id = telegram_id
            action = "Updated"
        else:
            user_id = str(uuid4())
            user = User.objects.create(
                id=user_id,
                name=name,
                phone=phone,
                email=email,
                password_hash=hash_password(raw_password),
                role="super_admin",
                is_active=True,
                telegram_chat_id=telegram_id,
                created_at=now,
                updated_at=now,
            )
            action = "Created"

        # Sync Django Admin auth mirror
        try:
            from django.contrib.auth import get_user_model
            user_model = get_user_model()
            username = str(user.id)[:150]
            mirror, _ = user_model.objects.get_or_create(
                username=username,
                defaults={
                    "is_staff": True,
                    "is_superuser": True,
                    "is_active": True,
                    "first_name": (user.phone or "")[:150],
                    "last_name": (user.name or "")[:150],
                    "email": (user.email or "")[:254],
                },
            )
            mirror.is_staff = True
            mirror.is_superuser = True
            mirror.is_active = True
            mirror.set_unusable_password()
            mirror.save(update_fields=["is_staff", "is_superuser", "is_active", "password"])
        except Exception:
            pass

        try:
            profile = StudentProfile.objects.filter(user_id=user.id).first()
            if profile is None:
                StudentProfile.objects.create(
                    id=str(uuid4()),
                    user_id=user.id,
                    is_approved=True,
                    target_score=8.5,
                    created_at=now,
                    updated_at=now,
                )
            else:
                StudentProfile.objects.filter(id=profile.id).update(is_approved=True, updated_at=now)
        except Exception:
            pass

        msg = (
            f"{action} super_admin user id={user.id} phone={user.phone} email={user.email} "
            f"telegram_chat_id={telegram_id} role=super_admin is_active=True is_superuser=True"
        )
        self.stdout.write(self.style.SUCCESS(msg))
        if action == "Created" and generated:
            self.stdout.write(self.style.WARNING(f"Generated password (shown once, change it after the first login): {raw_password}"))
        return msg
