"""Load original synthetic Reading and Listening content in a disposable local DB.

Run from backend-django with manage.py shell < ../scripts/e2e-local/seed-exam4-phase2.py.
"""
import wave
from pathlib import Path

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup, MockSection


@transaction.atomic
def seed():
    database = connection.settings_dict
    if database['HOST'] not in ('127.0.0.1', 'localhost', '::1') or not database['NAME'].endswith('_local'):
        raise RuntimeError('Use a disposable loopback database named *_local')
    exam_id = 'exam4-phase2-local'
    if MockExam.objects.filter(pk=exam_id).exists():
        return
    now = timezone.now()
    exam = MockExam.objects.create(id=exam_id, title='Synthetic Exam 4 Phase 2', type='ielts_academic',
        profile='practice', price=0, is_demo=True, is_published=True, is_free_for_approved=True,
        created_at=now, updated_at=now, content_version=1)

    def section(skill, order):
        return MockSection.objects.create(id=f'{exam_id}-{skill}', exam=exam, skill=skill,
            sort_order=order, duration_minutes=60, title=skill.title())

    def group(section, first, last, kind, *, ref=None, part=None, source=None, audio=None):
        document = None
        if kind in ('table_completion', 'summary_completion'):
            document = '<p>Field <span data-gap="' + str(first) + '"></span></p>'
            document += ''.join(f'<p>Field <span data-gap="{number}"></span></p>' for number in range(first+1, last+1))
        row = MockQuestionGroup.objects.create(id=f'{section.id}-g{first}', section=section,
            title=f'Task {first} to {last}', sort_order=first, stimulus_ref=ref, part_number=part,
            passage_text=source, content_html=document, content_layout='document',
            audio_key=audio, audio_duration_sec=2 if audio else None, audio_play_limit=1, created_at=now)
        questions = []
        for number in range(first, last + 1):
            choices = {'true_false_notgiven': ['TRUE', 'FALSE', 'NOT GIVEN'],
                       'multiple_choice': ['Alpha', 'Beta', 'Gamma'],
                       'matching_headings': ['One', 'Two', 'Three']}.get(kind)
            key = {'true_false_notgiven': 'TRUE', 'matching_headings': 'A',
                   'multiple_choice': 'A'}.get(kind, 'alpha')
            questions.append(MockQuestion(id=f'{section.id}-q{number}', group=row,
                number=number, sort_order=number, type=kind, options=choices, correct_answers=[key],
                prompt=f'Synthetic task question {number}', points=1, created_at=now))
        for question in questions:
            question.save(force_insert=True)

    reading = section('reading', 1)
    group(reading, 1, 5, 'table_completion', ref='synthetic-lamps',
          source='Synthetic source about lamps. A town council documented its first electric street.')
    group(reading, 6, 10, 'true_false_notgiven', ref='synthetic-lamps')
    group(reading, 11, 13, 'multiple_choice', ref='synthetic-lamps')
    group(reading, 14, 20, 'matching_headings', ref='synthetic-gardens',
          source='Synthetic source about gardens. A botanist compared roots in two soils.')
    group(reading, 21, 24, 'summary_completion', ref='synthetic-gardens')
    group(reading, 25, 40, 'short_answer', ref='synthetic-stations',
          source='Synthetic source about stations. A survey measured passenger arrivals.')

    listening = section('listening', 0)
    key = 'exam4-phase2/synthetic-tone.wav'
    path = Path(settings.MEDIA_ROOT) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as stream:
        stream.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
        stream.writeframes(b'\x00\x00' * 16000)
    for part in range(1, 5):
        first = (part - 1) * 10 + 1
        group(listening, first, first + 4, 'table_completion', part=part, audio=key)
        group(listening, first + 5, first + 9, 'short_answer', part=part)


seed()
