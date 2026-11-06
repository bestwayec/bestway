"""`manage.py migrate` now runs on every deploy. It must never alter Prisma-owned tables.

Prisma owns the legacy schema (apps.legacy_schema, all unmanaged). Django migrations may only
touch Django-owned tables; the one historic exception adds nullable columns with
`ADD COLUMN IF NOT EXISTS`, which is a no-op on a database Prisma already migrated.
"""
import re

from django.apps import apps
from django.db.migrations import operations as ops
from django.db.migrations.loader import MigrationLoader


def _legacy_tables():
    return {m._meta.db_table for m in apps.get_app_config("legacy_schema").get_models()}


def test_legacy_schema_app_has_no_django_migrations():
    loader = MigrationLoader(None, ignore_no_migrations=True)
    assert not [key for key in loader.disk_migrations if key[0] == "legacy_schema"]
    assert all(not m._meta.managed for m in apps.get_app_config("legacy_schema").get_models())


def test_no_django_migration_alters_a_prisma_owned_table():
    legacy = _legacy_tables()
    loader = MigrationLoader(None, ignore_no_migrations=True)
    problems = []
    for (app_label, name), migration in loader.disk_migrations.items():
        for op in migration.operations:
            if isinstance(op, ops.RunSQL):
                sqls = op.sql if isinstance(op.sql, (list, tuple)) else [op.sql]
                for sql in sqls:
                    text = sql if isinstance(sql, str) else str(sql[0])
                    for statement in filter(None, (s.strip() for s in text.split(";"))):
                        for table in legacy:
                            if re.search(rf'\b(ALTER|DROP|TRUNCATE)\s+TABLE\s+(IF\s+EXISTS\s+)?"?{re.escape(table)}"?\b', statement, re.I):
                                if not re.search(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS", statement, re.I) or re.search(r"\bDROP\b", statement, re.I):
                                    problems.append(f"{app_label}.{name}: {statement[:90]}")
                continue
            if isinstance(op, ops.CreateModel):
                table = (op.options or {}).get("db_table")
                if table in legacy and (op.options or {}).get("managed", True):
                    problems.append(f"{app_label}.{name}: creates Prisma table {table}")
                continue
            model_name = getattr(op, "model_name", None) or getattr(op, "name", None)
            if model_name and app_label == "legacy_schema":
                problems.append(f"{app_label}.{name}: {op.__class__.__name__} on {model_name}")
    assert problems == []
