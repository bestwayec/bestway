from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """BESTWAY 5.1: additive only. Existing assignments keep the individual-duration policy."""

    dependencies = [
        ('core', '0034_snapshot_exam_participants'),
    ]

    operations = [
        migrations.AddField(
            model_name='homeworkassignment',
            name='timing_policy',
            field=models.CharField(default='individual', max_length=20),
        ),
        migrations.AddField(
            model_name='homeworkassignment',
            name='opens_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='ExamReportState',
            fields=[
                ('assignment', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name='report_state', serialize=False, to='core.homeworkassignment')),
                ('preliminary_revision', models.CharField(blank=True, default='', max_length=64)),
                ('preliminary_at', models.DateTimeField(blank=True, null=True)),
                ('final_revision', models.CharField(blank=True, default='', max_length=64)),
                ('final_at', models.DateTimeField(blank=True, null=True)),
                ('final_version', models.PositiveIntegerField(default=0)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'db_table': 'ExamReportState'},
        ),
    ]
