"""Local-only disposable API check of S4 practice mode on the real PostgreSQL schema.

Start one section or one part, choose no timer / the section's time / the part's share
(server deadline), the audioscript and answer reveal in practice only, a timed exam left
exactly as it was (no audioscript, no reveal, single play), and the revealed answers
recorded on the attempt. Everything created is removed.
"""
import os
import sys
import wave
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in {'127.0.0.1', 'localhost', '::1'}:
    raise SystemExit('Refusing non-local DATABASE_URL')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
import django

django.setup()

from django.conf import settings
from django.db import connection
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from apps.legacy_schema.models import AuditLog, MockAnswer, MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection, User

run_id = uuid4().hex[:12]
student = SimpleNamespace(id=str(uuid4()), role='student', is_authenticated=True)
exam_id = str(uuid4())
client = APIClient()
checks = []
audio_path = Path(settings.MEDIA_ROOT) / 'fixture' / f'practice-{run_id}.wav'
SCRIPT = '<p>Woman: The museum opens at nine on weekdays.</p>'


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS ' + label)


def data(response, status=200, code=None):
    if response.status_code != status:
        raise AssertionError(f"{response.request.get('PATH_INFO')} HTTP {response.status_code}: {getattr(response, 'data', '')}")
    if code:
        check(response.data['error']['code'] == code, f'HTTP {status} {code}')
        return response.data['error']
    return response.data['data']


def start(body, status=201, code=None):
    return data(client.post(f'/v1/mock/exams/{exam_id}/start', body, format='json'), status, code)


def minutes_left(started):
    deadline = parse_datetime(started['sectionDeadlines'][started['currentSkill']])
    return round((deadline - parse_datetime(started['serverTime'])).total_seconds() / 60)


try:
    now = timezone.now()
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(audio_path), 'wb') as file:
        file.setnchannels(1); file.setsampwidth(2); file.setframerate(8000); file.writeframes(b'\0\0' * 8000 * 20)
    User.objects.create(id=student.id, name='Practice Fixture', phone=f'+99879{run_id[:6]}0', role='student',
                        password_hash='unused', is_active=True, created_at=now, updated_at=now)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, NULL, 0, %s, %s, NULL, false, NULL)",
                       [student.id, f'PM{run_id[:8].upper()}', now])
    MockExam.objects.create(id=exam_id, title='Local practice mode ' + run_id, type='ielts_academic', profile='practice',
                            is_published=False, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                            created_by_id=student.id, created_at=now, updated_at=now)
    listening = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='listening', title='Listening', sort_order=0, duration_minutes=30)
    reading = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='reading', title='Reading', sort_order=1, duration_minutes=60)
    l_group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=listening.id, sort_order=0, title='Part 1', audio_script=SCRIPT,
                                               audio_key=f'fixture/practice-{run_id}.wav', audio_duration_sec=20, audio_play_limit=1, part_number=1, created_at=now)
    passages = [MockQuestionGroup.objects.create(id=str(uuid4()), section_id=reading.id, sort_order=i, title=f'Passage {i + 1}',
                                                 passage_text=f'Passage {i + 1}. The bridge was built in 1890.', audio_play_limit=1, created_at=now)
                for i in range(2)]
    mc = dict(type='multiple_choice', points=1, accepted_variants=[], created_at=now)
    lq = MockQuestion.objects.create(id=str(uuid4()), group_id=l_group.id, number=1, sort_order=0, prompt='When?', options=['At nine', 'At ten'],
                                     correct_answers=['At nine'], evidence_text='opens at nine', **mc)
    reading_q = []
    for number in range(1, 5):   # passage 1: questions 1-3, passage 2: question 4
        group = passages[0] if number <= 3 else passages[1]
        reading_q.append(MockQuestion.objects.create(id=str(uuid4()), group_id=group.id, number=number, sort_order=number, prompt=f'Q{number}',
                                                     options=['In 1890', 'In 1920'], correct_answers=['In 1890'], evidence_text='built in 1890', **mc))
    client.force_authenticate(student)

    # ── options only for practice, and well formed ──
    start({'mode': 'timed', 'skills': ['reading'], 'timer': 'section'}, 400, 'VALIDATION_ERROR')
    start({'mode': 'practice', 'skills': ['reading', 'listening'], 'groupIds': [passages[0].id]}, 400, 'VALIDATION_ERROR')
    start({'mode': 'practice', 'skills': ['reading'], 'timer': 'part'}, 400, 'VALIDATION_ERROR')
    start({'mode': 'practice', 'skills': ['reading'], 'groupIds': [l_group.id]}, 400, 'VALIDATION_ERROR')

    # ── one part, part timer ──
    part = start({'mode': 'practice', 'skills': ['reading'], 'groupIds': [passages[1].id], 'timer': 'part'})
    ids = [q['id'] for s in part['exam']['sections'] for g in s['groups'] for q in g['questions']]
    check(ids == [reading_q[3].id] and part['practiceOptions'] == {'groupIds': [passages[1].id], 'timer': 'part'},
          'Practice of one part holds only that part and remembers the choice')
    check(minutes_left(part) == 15, f'The part timer is its share of the section (1 of 4 questions of 60 min = {minutes_left(part)} min) and kept by the server')
    other_q = reading_q[0].id
    data(client.post(f"/v1/mock/attempts/{part['attemptId']}/answers", {'answers': [{'questionId': other_q, 'response': 'In 1890'}]}, format='json'), 400, 'QUESTION_NOT_IN_EXAM')

    # ── whole section, section timer / no timer ──
    section = start({'mode': 'practice', 'skills': ['reading'], 'groupIds': [passages[0].id, passages[1].id], 'timer': 'section'})
    check(section['attemptId'] != part['attemptId'] and minutes_left(section) == 60, 'Another part or timer is a new practice; the section timer is the section time')
    free = start({'mode': 'practice', 'skills': ['reading'], 'groupIds': [passages[0].id], 'timer': 'none'})
    check(not free.get('sectionDeadlines'), 'Practice without a timer has no deadline')

    # ── practice help: audioscript and reveal ──
    listen = start({'mode': 'practice', 'skills': ['listening'], 'groupIds': [l_group.id], 'timer': 'none'})
    detail = data(client.get(f"/v1/mock/attempts/{listen['attemptId']}"))
    group = detail['sections'][0]['groups'][0]
    check(group.get('audioScript', '').startswith('Woman: The museum opens at nine') and 'reviewAudioUrl' not in group
          and 'correctAnswers' not in group['questions'][0], 'Practice shows the audioscript while practising, never the key')
    shown = data(client.post(f"/v1/mock/attempts/{listen['attemptId']}/reveal", {'questionId': lq.id}, format='json'))
    check(shown['correctAnswers'] == ['At nine'] and shown['evidence']['text'] == 'opens at nine', 'Reveal gives the key and where it is')
    again = data(client.get(f"/v1/mock/attempts/{listen['attemptId']}"))
    check(again['sections'][0]['groups'][0]['questions'][0].get('revealed') is True, 'A revealed answer is recorded on the attempt')
    data(client.post(f"/v1/mock/attempts/{listen['attemptId']}/reveal", {'questionId': reading_q[0].id}, format='json'), 400, 'QUESTION_NOT_IN_EXAM')

    # ── exam mode unchanged ──
    exam = start({'mode': 'timed', 'skills': ['listening']})
    check(exam['mode'] == 'timed' and exam['sectionDeadlines'], 'A timed section keeps its server deadline')
    timed_detail = data(client.get(f"/v1/mock/attempts/{exam['attemptId']}"))
    check('audioScript' not in timed_detail['sections'][0]['groups'][0], 'A timed exam never shows the audioscript')
    data(client.post(f"/v1/mock/attempts/{exam['attemptId']}/reveal", {'questionId': lq.id}, format='json'), 403, 'PRACTICE_ONLY')
    print(f'\n{len(checks)} PASS')
finally:
    MockAnswer.objects.filter(attempt__exam_id=exam_id).delete()
    MockAttempt.objects.filter(exam_id=exam_id).delete()
    MockQuestion.objects.filter(group__section__exam_id=exam_id).delete()
    MockQuestionGroup.objects.filter(section__exam_id=exam_id).delete()
    MockSection.objects.filter(exam_id=exam_id).delete()
    MockExam.objects.filter(id=exam_id).delete()
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = %s', [student.id])
    AuditLog.objects.filter(user_id=student.id).delete()
    User.objects.filter(id=student.id).delete()
    audio_path.unlink(missing_ok=True)
