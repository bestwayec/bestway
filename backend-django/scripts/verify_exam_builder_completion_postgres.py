"""Loopback-only check of the Exam Builder completion endpoints on the real Prisma schema.

Unit tests run on Django-created tables (plain varchar columns); this script runs on the schema the
application really uses (PostgreSQL enums such as MockQuestionType, the new nullable lifecycle
columns). It covers: question-bank copy into a draft, lifecycle validate / publish / archive /
restore, and the keyless template export. Every fixture row is removed.
"""
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
import django

django.setup()
from django.utils import timezone
from rest_framework.test import APIClient

from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup, MockSection, User

run_id = uuid4().hex[:10]
teacher = SimpleNamespace(id='ebc-teacher-' + run_id, role='teacher', is_authenticated=True)
other = SimpleNamespace(id='ebc-other-' + run_id, role='teacher', is_authenticated=True)
learner = SimpleNamespace(id='ebc-student-' + run_id, role='student', is_authenticated=True)
source_id, target_id = 'ebc-src-' + run_id, 'ebc-dst-' + run_id
checks = []


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def client(actor):
    c = APIClient()
    c.force_authenticate(actor)
    return c


def make_exam(exam_id, owner, numbers):
    now = timezone.now()
    MockExam.objects.create(id=exam_id, title='EBC fixture ' + run_id, type='ielts_academic', profile='practice', created_by_id=owner.id,
                            is_published=False, is_demo=False, price=0, is_free_for_approved=True, content_version=1,
                            created_at=now, updated_at=now)
    section = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='reading', title='Reading', sort_order=1, duration_minutes=20)
    group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=section.id, sort_order=0, title='Passage ' + run_id,
                                             instructions='TRUE, FALSE or NOT GIVEN.', passage_text='Rooftop gardens cool buildings.',
                                             content_layout='document', audio_play_limit=1, created_at=now)
    for i, n in enumerate(numbers):
        MockQuestion.objects.create(id=str(uuid4()), group_id=group.id, number=n, sort_order=i, type='true_false_notgiven',
                                    prompt=f'Statement {n}.', options=['TRUE', 'FALSE', 'NOT GIVEN'], correct_answers=['TRUE'],
                                    accepted_variants=[], points=1, created_at=now)
    return group


t, o, s = client(teacher), client(other), client(learner)
try:
    now = timezone.now()
    for who, digit in ((teacher, '1'), (other, '2'), (learner, '3')):
        User.objects.create(id=who.id, name='EBC fixture', phone='+9988' + digit + run_id[:7], role=who.role,
                            password_hash='unused', is_active=True, created_at=now, updated_at=now)
    source_group = make_exam(source_id, teacher, [1, 2])
    make_exam(target_id, teacher, [1, 2, 3])

    listing = t.get('/v1/mock/question-bank/groups', {'search': run_id})
    ids = [g['groupId'] for g in listing.data['data']['items']]
    check(source_group.id in ids and 'correctAnswers' not in str(listing.data), 'the bank lists the teacher\'s own groups without answer keys')
    check(source_group.id not in [g['groupId'] for g in o.get('/v1/mock/question-bank/groups', {'search': run_id}).data['data']['items']],
          'another teacher does not see these groups')
    inserted = t.post(f'/v1/mock/exams/{target_id}/bank-insert', {'groupIds': [source_group.id]}, format='json')
    check(inserted.status_code == 201, f'copying a group into a draft works on the real enum schema (HTTP {inserted.status_code})')
    numbers = sorted(MockQuestion.objects.filter(group__section__exam_id=target_id).values_list('number', flat=True))
    check(numbers == [1, 2, 3, 4, 5], f'numbering continues after the section ({numbers})')
    check(MockQuestion.objects.filter(group_id=source_group.id).count() == 2, 'the source exam is unchanged')
    check(o.post(f'/v1/mock/exams/{target_id}/bank-insert', {'groupIds': [source_group.id]}, format='json').status_code == 403,
          'another teacher cannot insert into this draft')

    validated = t.post(f'/v1/mock/exams/{target_id}/validate', {}, format='json')
    check(validated.status_code == 200 and validated.data['data']['lifecycle'] == 'validated', 'validate records the current version')
    published = t.patch(f'/v1/mock/exams/{target_id}', {'isPublished': True}, format='json')
    check(published.status_code == 200, 'a validated exam publishes')
    archived = t.post(f'/v1/mock/exams/{target_id}/archive', {}, format='json')
    row = MockExam.objects.get(id=target_id)
    check(archived.data['data']['lifecycle'] == 'archived' and not row.is_published and row.archived_at is not None,
          'archive withdraws the exam (unpublished, archivedAt set)')
    check(target_id not in [e['id'] for e in (s.get('/v1/mock/exams').data.get('data') or [])], 'students no longer see it')
    locked = t.patch(f'/v1/mock/exams/{target_id}', {'isPublished': True}, format='json')
    check(locked.status_code == 409, f'an archived exam cannot be republished without restoring (HTTP {locked.status_code})')
    restored = t.post(f'/v1/mock/exams/{target_id}/restore', {}, format='json')
    check(restored.data['data']['lifecycle'] in ('draft', 'validated') and not MockExam.objects.get(id=target_id).is_published,
          'restore returns it unpublished')

    template = t.get(f'/v1/mock/exams/{target_id}/template')
    questions = [q for sec in template.data['data']['exam']['sections'] for g in sec['groups'] for q in g['questions']]
    check(template.status_code == 200 and len(questions) == 5 and all(q['correctAnswers'] == [] for q in questions),
          'the template contains every question and no answer keys')
    check(s.get(f'/v1/mock/exams/{target_id}/template').status_code == 403, 'students cannot download templates')
finally:
    for exam_id in (source_id, target_id):
        MockQuestion.objects.filter(group__section__exam_id=exam_id).delete()
        MockQuestionGroup.objects.filter(section__exam_id=exam_id).delete()
        MockSection.objects.filter(exam_id=exam_id).delete()
        MockExam.objects.filter(id=exam_id).delete()
    User.objects.filter(id__in=[teacher.id, other.id, learner.id]).delete()
check(not MockExam.objects.filter(id__in=[source_id, target_id]).exists(), 'all fixture rows are removed')
print(f'Exam Builder completion contracts: {len(checks)}/{len(checks)} PASS')
