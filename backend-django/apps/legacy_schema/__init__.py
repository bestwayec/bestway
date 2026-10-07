
from django.apps import AppConfig


class LegacySchemaConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.legacy_schema"
    verbose_name = "BESTWAY Prisma compatibility schema"
