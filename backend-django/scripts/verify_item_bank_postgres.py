"""Loopback-only check of the item bank metadata on the real schema.

Questions carry an optional CEFR level and skill tags (additive, nullable columns); exam,
section, part and type come from the question's rows. Existing questions read as unknown.
Staff set and filter them; invalid values are refused; students cannot read the bank, and it
never contains answer keys. Every fixture row is removed.
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
staff = SimpleNamespace(id='ib-admin-' + run_id, role='admin', is_authenticated=True)
learner = SimpleNamespace(id='ib-student-' + run_id, role='student', is_authenticated=True)
exam_id = 'ib-exam-' + run_id
checks = []


def check(value, message):
    if not value:
        raise AssertionError(message)
    checks.append(message)
    print('PASS ' + message)


admin = APIClient(); admin.force_authenticate(staff)
student = APIClient(); student.force_authenticate(learner)
try:
    now = timezone.now()
    for who in (staff, learner):
        User.objects.create(id=who.id, name='Item bank fixture', phone='+9987' + ('6' if who is staff else '5') + run_id[:7], role=who.role,
                            password_hash='unused', is_active=True, created_at=now, updated_at=now)
    MockExam.objects.create(id=exam_id, title='Item bank fixture ' + run_id, type='multilevel', profile='practice',
                            is_published=False, is_demo=False, price=0, is_free_for_approved=True, content_version=1,
                            created_at=now, updated_at=now)
    section = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='reading', title='Reading', sort_order=0, duration_minutes=60)
    group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=section.id, sort_order=0, title='Part 3', part_number=3,
                                             passage_text='Text', audio_play_limit=1, created_at=now)
    old = MockQuestion.objects.create(id=str(uuid4()), group_id=group.id, number=1, sort_order=0, type='short_answer', prompt='Q1',
                                      points=1, options=None, correct_answers=['secret-key'], accepted_variants=[], word_limit=2, created_at=now)
    check(old.cefr_level is None and old.skill_tags is None, 'an existing question keeps its data; the new columns are empty')

    listing = admin.get('/v1/mock/item-bank', {'examType': 'multilevel', 'section': 'reading', 'limit': 500})
    mine = [item for item in listing.data['data']['items'] if item['id'] == old.id]
    check(listing.status_code == 200 and mine and mine[0]['cefrLevel'] == 'unknown' and mine[0]['skillTags'] == [] and mine[0]['part'] == 3,
          'the item bank shows an existing question as unknown level, no tags, with its part from the rows')
    check('secret-key' not in str(listing.data), 'the item bank never contains answer keys')

    updated = admin.patch(f'/v1/mock/questions/{old.id}', {'cefrLevel': 'b2', 'skillTags': ['Detail', 'scanning', 'detail']}, format='json')
    check(updated.status_code == 200 and updated.data['data']['cefrLevel'] == 'B2' and updated.data['data']['skillTags'] == ['detail', 'scanning'],
          'staff set the level and tags; they are cleaned (upper level, lowercase unique tags)')
    bad = admin.patch(f'/v1/mock/questions/{old.id}', {'cefrLevel': 'B3'}, format='json')
    check(bad.status_code == 400, f'a level outside A1-C2 is refused (HTTP {bad.status_code})')
    check(MockQuestion.objects.get(id=old.id).cefr_level == 'B2', 'a refused change leaves the stored level')

    by_level = admin.get('/v1/mock/item-bank', {'cefrLevel': 'B2', 'tag': 'scanning', 'limit': 500})
    check([i['id'] for i in by_level.data['data']['items'] if i['examId'] == exam_id] == [old.id], 'the bank filters by level and tag')
    unknown = admin.get('/v1/mock/item-bank', {'cefrLevel': 'unknown', 'examType': 'multilevel', 'limit': 500})
    check(old.id not in [i['id'] for i in unknown.data['data']['items']], 'a question with a level is no longer listed as unknown')

    refused = student.get('/v1/mock/item-bank')
    check(refused.status_code == 403, f'a student cannot read the item bank (HTTP {refused.status_code})')
finally:
    MockQuestion.objects.filter(group__section__exam_id=exam_id).delete()
    MockQuestionGroup.objects.filter(section__exam_id=exam_id).delete()
    MockSection.objects.filter(exam_id=exam_id).delete()
    MockExam.objects.filter(id=exam_id).delete()
    User.objects.filter(id__in=[staff.id, learner.id]).delete()
check(not MockExam.objects.filter(id=exam_id).exists(), 'all fixture rows are removed')
print(f'Item bank contracts: {len(checks)}/{len(checks)} PASS')
