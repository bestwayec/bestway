"""Local-only disposable API check of the paginated exam history (GET /v1/mock/attempts/mine) on the real PostgreSQL schema.

A student with more than 20 attempts (some with the identical start time) reads the whole history through the
keyset cursor and through the legacy page/limit parameters: no attempt is missing or repeated, the order is
deterministic, another student's attempts never appear, an invalid cursor is a 400 and an empty history is an
empty page. No external providers, production data or browser involved. Everything created is removed.
"""
import os
import sys
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

from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.legacy_schema.models import MockAttempt, MockExam, User

run_id = uuid4().hex[:12]
student = SimpleNamespace(id=str(uuid4()), role='student', is_authenticated=True)
other = SimpleNamespace(id=str(uuid4()), role='student', is_authenticated=True)
empty = SimpleNamespace(id=str(uuid4()), role='student', is_authenticated=True)
admin = SimpleNamespace(id=str(uuid4()), role='super_admin', is_authenticated=True)
exam_id = str(uuid4())
client = APIClient()
checks = []
TOTAL = 57


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS ' + label)


def get(query='', status=200, code=None):
    response = client.get('/v1/mock/attempts/mine' + query)
    if response.status_code != status:
        raise AssertionError(f'{query} HTTP {response.status_code}: {response.data}')
    if code:
        check(response.data['error']['code'] == code, f'HTTP {status} {code} for {query}')
    return response.data


try:
    now = timezone.now().replace(microsecond=0)
    for index, actor in enumerate((admin, student, other, empty)):
        User.objects.create(id=actor.id, name='History Fixture', phone=f'+99877{run_id[:6]}{index}', role=actor.role,
                            password_hash='unused', is_active=True, created_at=now, updated_at=now)
    with connection.cursor() as cursor:
        for index, actor in enumerate((student, other, empty)):
            cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                           "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, NULL, 0, %s, %s, NULL, false, NULL)",
                           [actor.id, f'HS{index}{run_id[:7].upper()}', now])
    MockExam.objects.create(id=exam_id, title='Local history ' + run_id, type='ielts_academic', profile='practice',
                            is_published=False, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                            created_by_id=admin.id, created_at=now, updated_at=now)

    expected = []
    for i in range(TOTAL):
        # Attempts 10-24 share one start time: the order inside the tie must still be deterministic.
        started = now - timedelta(minutes=(10 if 10 <= i <= 24 else i * 3))
        status = 'completed' if i % 3 == 0 else 'in_progress'
        attempt = MockAttempt.objects.create(id=f'hist-{run_id}-{i:03d}', exam_id=exam_id, student_id=student.id, status=status,
                                             mode='timed', flow_mode='full_test', started_at=started, anti_cheat_count=0)
        expected.append(attempt.id)
    for i in range(5):
        MockAttempt.objects.create(id=f'other-{run_id}-{i}', exam_id=exam_id, student_id=other.id, status='completed', mode='timed',
                                   flow_mode='full_test', started_at=now - timedelta(minutes=i), anti_cheat_count=0)

    client.force_authenticate(student)

    # ── an older client (no new parameter): same shape as before, first 20, newest first ──
    legacy = get()
    check(len(legacy['data']) == 20 and legacy['meta']['page'] == 1 and legacy['meta']['limit'] == 20 and legacy['meta']['total'] == TOTAL,
          'Without parameters the first 20 attempts and the old meta (page, limit, total) are returned')
    check(legacy['meta']['hasMore'] is True and isinstance(legacy['meta']['nextCursor'], str), 'The meta now also says whether more attempts exist')

    # ── cursor walk: every attempt exactly once ──
    seen, cursor, pages = [], None, 0
    while True:
        body = get('?limit=20' + (f'&cursor={cursor}' if cursor else ''))
        seen.extend(a['id'] for a in body['data'])
        pages += 1
        cursor = body['meta']['nextCursor']
        if not body['meta']['hasMore']:
            check(cursor is None, 'The last page has no next cursor')
            break
        check(pages < 10, 'The cursor walk ends')
    check(len(seen) == TOTAL and len(set(seen)) == TOTAL and set(seen) == set(expected),
          f'The cursor walk returns all {TOTAL} attempts of the student, each exactly once, in {pages} pages')
    check(not any(i.startswith('other-') for i in seen), "Another student's attempts never appear")

    # ── page/limit walk gives the same order as the cursor walk ──
    paged = []
    for page in (1, 2, 3):
        paged.extend(a['id'] for a in get(f'?page={page}&limit=25')['data'])
    check(paged == seen, 'The legacy page/limit walk returns the same order as the cursor walk')
    rows = list(MockAttempt.objects.filter(student_id=student.id).order_by('-started_at', '-id').values_list('id', flat=True))
    check(seen == rows, 'The order is started time descending, ties broken by id descending')

    # ── page size and filters ──
    check(len(get('?limit=100')['data']) == TOTAL, 'A page of up to 100 returns the whole history in one call')
    get('?limit=101', 400, 'VALIDATION_ERROR')
    get('?limit=0', 400, 'VALIDATION_ERROR')
    small = get('?limit=7')
    check(len(small['data']) == 7 and small['meta']['nextCursor'], 'A small page still gets a cursor')
    done = get('?status=completed&limit=100')
    check(len(done['data']) == len([i for i in range(TOTAL) if i % 3 == 0]) and all(a['status'] == 'completed' for a in done['data']),
          'The status filter works together with the history')
    first = get('?status=completed&limit=5')
    second = get(f"?status=completed&limit=5&cursor={first['meta']['nextCursor']}")
    check(not {a['id'] for a in first['data']} & {a['id'] for a in second['data']}, 'A filtered cursor walk does not repeat attempts')

    # ── new attempt while the student reads page 2: the walk stays consistent ──
    page_one = get('?limit=10')
    MockAttempt.objects.create(id=f'hist-{run_id}-new', exam_id=exam_id, student_id=student.id, status='in_progress', mode='timed',
                               flow_mode='full_test', started_at=now + timedelta(minutes=5), anti_cheat_count=0)
    page_two = get(f"?limit=10&cursor={page_one['meta']['nextCursor']}")
    check(not {a['id'] for a in page_one['data']} & {a['id'] for a in page_two['data']},
          'An attempt started during the walk does not shift the next page (no repeat)')

    # ── invalid cursors and mixed parameters ──
    for bad in ('not-a-cursor', 'e30', 'W10', '%00', 'x' * 300, ''):
        get(f'?cursor={bad}', 400, 'VALIDATION_ERROR')
    get(f"?cursor={legacy['meta']['nextCursor']}&page=2", 400, 'VALIDATION_ERROR')
    get('?unknown=1', 400, 'VALIDATION_ERROR')

    # ── empty history ──
    client.force_authenticate(empty)
    nothing = get()
    check(nothing['data'] == [] and nothing['meta']['total'] == 0 and nothing['meta']['hasMore'] is False and nothing['meta']['nextCursor'] is None,
          'A student without attempts gets an empty page and no cursor')
    check(get('?limit=5&cursor=' + legacy['meta']['nextCursor'])['data'] == [], "A cursor from another account never exposes that account's attempts")
    print(f'{len(checks)} checks passed')
finally:
    MockAttempt.objects.filter(exam_id=exam_id).delete()
    MockExam.objects.filter(id=exam_id).delete()
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [[student.id, other.id, empty.id]])
    User.objects.filter(id__in=[admin.id, student.id, other.id, empty.id]).delete()
