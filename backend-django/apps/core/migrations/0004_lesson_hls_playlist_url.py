from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0003_course_lesson_quizdeck_quizcard_userlessonprogress'),
    ]

    operations = [
        migrations.AddField(
            model_name='lesson',
            name='hls_playlist_url',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
    ]
