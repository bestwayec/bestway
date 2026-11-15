from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0009_vocab_battle_winners"),
    ]

    operations = [
        migrations.CreateModel(
            name="SubmissionHandoff",
            fields=[
                ("attempt_id", models.CharField(max_length=255, primary_key=True, serialize=False)),
                ("skills", models.JSONField(blank=True, null=True)),
                ("created_at", models.DateTimeField()),
                ("done_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("tries", models.IntegerField(default=0)),
                ("last_error", models.TextField(blank=True, null=True)),
            ],
            options={
                "db_table": "SubmissionHandoff",
            },
        ),
    ]
