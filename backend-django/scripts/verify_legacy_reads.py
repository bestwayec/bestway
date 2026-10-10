"""Read-only parity probe for the local Prisma-owned PostgreSQL schema."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

import django

django.setup()

from django.db import connection
from apps.legacy_schema import models

CHECKED_MODELS = [
    ("User", models.User),
    ("StudentProfile", models.StudentProfile),
    ("MockExam", models.MockExam),
    ("MockSection", models.MockSection),
    ("MockQuestionGroup", models.MockQuestionGroup),
    ("MockQuestion", models.MockQuestion),
    ("MockAttempt", models.MockAttempt),
    ("MockAnswer", models.MockAnswer),
    ("AssessmentJob", models.AssessmentJob),
    ("AssessmentEvaluation", models.AssessmentEvaluation),
    ("Notification", models.Notification),
]


def main() -> None:
    results: dict[str, dict[str, int]] = {}
    with connection.cursor() as cursor:
        for table, model in CHECKED_MODELS:
            orm_count = model.objects.count()
            cursor.execute(f'SELECT COUNT(*) FROM "{table}"')
            sql_count = cursor.fetchone()[0]
            if orm_count != sql_count:
                raise RuntimeError(f"Count mismatch for {table}: ORM={orm_count}, SQL={sql_count}")
            results[table] = {"django": orm_count, "sql": sql_count}
    print(results)


if __name__ == "__main__":
    main()
