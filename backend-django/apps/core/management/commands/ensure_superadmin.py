"""Ensure the BestWay Superadmin account exists and is linked to Telegram ID 5582178765."""
from __future__ import annotations

from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from apps.legacy_schema.models import StudentProfile, User
from common.auth.passwords import hash_password


class Command(BaseCommand):
    help = "Ensure the Superadmin user exists with role='super_admin', is_active=True, and telegram_chat_id='5582178765'."

    def add_arguments(self, parser):
        default_tg = getattr(settings, "SUPERADMIN_TELEGRAM_ID", "5582178765") or "5582178765"
        parser.add_argument(
            "--telegram-id",
            dest="telegram_id",
            default=str(default_tg),
            help="Telegram chat ID for the superadmin account (default: 5582178765)",
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

    def handle(self, *args, **options):
        telegram_id = str(options.get("telegram_id") or "5582178765").strip()
        email = str(options.get("email") or "superadmin@bestwayec.uz").strip()
        phone = str(options.get("phone") or "+998900000001").strip()
        name = str(options.get("name") or "Komiljon Roziyev (SuperAdmin)").strip()
        now = timezone.now()

        # Priority 1: User already linked to this telegram_id
        user = User.objects.filter(telegram_chat_id=telegram_id).first()
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
                "telegram_chat_id": telegram_id,
                "updated_at": now,
            }
            if not user.email:
                update_fields["email"] = email
            if not user.password_hash:
                update_fields["password_hash"] = hash_password("BestWaySuperAdmin2026!")
            User.objects.filter(id=user.id).update(**update_fields)
            user.role = "super_admin"
            user.is_active = True
            user.telegram_chat_id = telegram_id
            action = "Updated"
        else:
            user_id = str(uuid4())
            user = User.objects.create(
                id=user_id,
                name=name,
                phone=phone,
                email=email,
                password_hash=hash_password("BestWaySuperAdmin2026!"),
                role="super_admin",
                is_active=True,
                telegram_chat_id=telegram_id,
                created_at=now,
                updated_at=now,
            )
            action = "Created"

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
            f"{action} super_admin user id={user.id} "
            f"telegram_chat_id={telegram_id} role=super_admin is_active=True is_approved=True"
        )
        self.stdout.write(self.style.SUCCESS(msg))
        return msg
