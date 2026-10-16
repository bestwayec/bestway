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

        user = (
            User.objects.filter(Q(telegram_chat_id=telegram_id) | Q(email=email))
            .order_by("created_at")
            .first()
        )
        if user is None:
            user = User.objects.filter(role="super_admin").order_by("created_at").first()

        if user is not None:
            User.objects.filter(id=user.id).update(
                role="super_admin",
                is_active=True,
                telegram_chat_id=telegram_id,
                email=user.email or email,
                updated_at=now,
            )
            user.role = "super_admin"
            user.is_active = True
            user.is_approved = True
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
            user.is_approved = True
            action = "Created"

        try:
            StudentProfile.objects.filter(user_id=user.id).update(is_approved=True)
        except Exception:
            pass

        msg = (
            f"{action} super_admin user id={user.id} "
            f"telegram_chat_id={telegram_id} role=super_admin is_active=True is_approved=True"
        )
        self.stdout.write(self.style.SUCCESS(msg))
        return msg
