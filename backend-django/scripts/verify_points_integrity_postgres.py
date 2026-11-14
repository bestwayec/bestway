"""Loopback-only check that game points are given once, on the real schema.

Every fixture row is rolled back. Covers the Vocab Battle podium (recorded in the
FINISHED state, never given twice, never to a player without a game score or to a
staff account) and the targeted practice drill (answers not sent before a question is
answered, one award per drill, daily cap).
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
from django.db import connection, transaction
from django.utils import timezone
from psycopg import sql
from rest_framework.test import APIClient

from apps.core.models import VocabBattleSession, VocabularySet, VocabularyWord
from apps.legacy_schema.models import PointsLog, StudentProfile

prefix = 'pts-' + uuid4().hex[:12]
ids = {name: f'{prefix}-{name}' for name in ('teacher', 'other', 'a', 'b', 'c', 'd', 'zero')}
checks = []


def check(value, message):
    if not value: raise AssertionError(message)
    checks.append(message); print('PASS ' + message)


def insert(table, **values):
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table),
            sql.SQL(',').join(map(sql.Identifier, values)), sql.SQL(',').join(sql.Placeholder() for _ in values)), list(values.values()))


def client(name, role):
    api = APIClient(); api.force_authenticate(user=SimpleNamespace(id=ids[name], role=role, name=name, is_authenticated=True))
    return api


def points(name):
    return StudentProfile.objects.get(user_id=ids[name]).current_points


def logs(name=None):
    rows = PointsLog.objects.filter(student_id__in=list(ids.values()), reason__startswith='Vocab Battle')
    return rows.filter(student_id=ids[name]).count() if name else rows.count()


with transaction.atomic():
    stamp = timezone.now()
    for name in ids:
        role = 'teacher' if name in ('teacher', 'other') else 'student'
        insert('User', id=ids[name], name='Points ' + name, phone=ids[name], passwordHash='unused', role=role, updatedAt=stamp)
        if role == 'student':
            insert('StudentProfile', userId=ids[name], linkCode=ids[name])
    words = VocabularySet.objects.create(title='Points fixture', level='B1', created_by_id=ids['teacher'])
    for number in range(4):
        VocabularyWord.objects.create(set=words, english=f'word{number}', uzbek=f'soz{number}')

    host = client('teacher', 'teacher')
    created = host.post('/v1/vocabulary/battle/create', {'setId': words.id, 'questionCount': 1}, format='json')
    check(created.status_code == 201, 'host creates a battle')
    pin = created.data['data']['pin']
    for name in ('a', 'b', 'c', 'd', 'zero'):
        check(client(name, 'student').post('/v1/vocabulary/battle/join', {'pin': pin}, format='json').status_code == 200, f'{name} joins')
    check(client('other', 'teacher').post('/v1/vocabulary/battle/join', {'pin': pin}, format='json').status_code == 200, 'a second teacher joins as a player')
    check(host.post(f'/v1/vocabulary/battle/{pin}/next').data['data']['status'] == 'QUESTION', 'question is open')
    correct = VocabBattleSession.objects.get(pin=pin).questions[0]['correctIndex']
    # The teacher answers fastest, then a, b, c, d; "zero" answers wrongly.
    for name, role, elapsed in (('other', 'teacher', 0), ('a', 'student', 2), ('b', 'student', 4), ('c', 'student', 6), ('d', 'student', 8)):
        answer = client(name, role).post(f'/v1/vocabulary/battle/{pin}/answer', {'questionIndex': 0, 'selectedIndex': correct, 'elapsedSec': elapsed}, format='json')
        check(answer.status_code == 200 and answer.data['data']['isCorrect'], f'{name} answers correctly')
    wrong = client('zero', 'student').post(f'/v1/vocabulary/battle/{pin}/answer', {'questionIndex': 0, 'selectedIndex': (correct + 1) % 4, 'elapsedSec': 1}, format='json')
    check(wrong.status_code == 200 and not wrong.data['data']['isCorrect'], 'zero answers wrongly')
    check(host.post(f'/v1/vocabulary/battle/{pin}/next').data['data']['status'] == 'LEADERBOARD', 'leaderboard is shown')
    state = client('a', 'student').get(f'/v1/vocabulary/battle/{pin}/state').data['data']
    check(state['winners'] == [] and logs() == 0, 'no winners and no points before the battle is finished')

    finished = host.post(f'/v1/vocabulary/battle/{pin}/next').data['data']
    check(finished['status'] == 'FINISHED', 'the last step finishes the battle')
    winners = finished['winners']
    check([(w['rank'], w['studentId'], w['pointsAwarded']) for w in winners] == [(1, ids['other'], 0), (2, ids['a'], 7), (3, ids['b'], 5)],
          'FINISHED state lists rank, player and the points really given; the staff player gets none')
    check(all(w['score'] > 0 for w in winners), 'every listed winner has a game score')
    check((points('a'), points('b'), points('c'), points('zero')) == (7, 5, 0, 0), 'profile points match the reported awards')
    check(logs() == 2 and logs('a') == 1 and logs('b') == 1, 'one PointsLog row per awarded student')

    for attempt in range(3):
        again = host.post(f'/v1/vocabulary/battle/{pin}/finish')
        check(again.status_code == 200 and again.data['data']['winners'] == winners, f'repeated /finish #{attempt + 1} returns the recorded podium')
    host.post(f'/v1/vocabulary/battle/{pin}/next')
    check(logs() == 2 and (points('a'), points('b')) == (7, 5), 'repeated /finish and /next give no points again')
    player_state = client('b', 'student').get(f'/v1/vocabulary/battle/{pin}/state').data['data']
    check(player_state['winners'] == winners, 'players read the same winners from the state')
    check(client('other', 'teacher').post(f'/v1/vocabulary/battle/{pin}/finish').status_code == 403, 'only the host may finish')

    # A battle in which nobody scored has no podium at all.
    empty = host.post('/v1/vocabulary/battle/create', {'setId': words.id, 'questionCount': 1}, format='json').data['data']['pin']
    client('c', 'student').post('/v1/vocabulary/battle/join', {'pin': empty}, format='json')
    ended = host.post(f'/v1/vocabulary/battle/{empty}/finish')
    check(ended.status_code == 200 and ended.data['data']['winners'] == [], 'a battle without any score has an empty podium')
    check(points('c') == 0 and logs() == 2, 'a player with no game score gets no podium points')

    # ── Targeted practice drill: one award per drill, daily cap, answers not sent early ──
    from django.core.cache import cache

    from apps.core import study_plan_service as drills

    def drill_logs(name):
        return PointsLog.objects.filter(student_id=ids[name], reason__startswith=drills.TARGETED_PRACTICE_LOG_PREFIX)

    def run_drill(name, role='student', category='headings'):
        api = client(name, role)
        started = api.get(f'/v1/study-plan/targeted-practice?category={category}')
        body = started.content.decode()
        check(started.status_code == 200 and 'correctAnswer' not in body and 'explanation' not in body, f'{name}: drill questions carry no key or explanation')
        data = started.data['data']
        key = {qid: row['correctAnswer'] for qid, row in cache.get(drills._practice_key(data['practiceId']))['questions'].items()}
        for question in data['questions']:
            answer = api.post('/v1/study-plan/targeted-practice/answer', {'practiceId': data['practiceId'], 'questionId': question['id'],
                                                                         'selectedAnswer': key[question['id']]}, format='json')
            if answer.status_code != 200 or not answer.data['data']['isCorrect']: raise AssertionError('server rejects its own key')
        return api, data['practiceId'], api.post('/v1/study-plan/targeted-practice/submit', {'practiceId': data['practiceId']}, format='json').data['data']

    start_points = points('d')
    api, practice_id, first = run_drill('d')
    check((first['correctCount'], first['pointsAwarded'], first['replayed']) == (10, drills.TARGETED_PRACTICE_POINTS, False), 'a finished drill gives its points')
    for attempt in range(3):
        repeat = api.post('/v1/study-plan/targeted-practice/submit', {'practiceId': practice_id, 'answers': []}, format='json').data['data']
        check(repeat['replayed'] is True and repeat['pointsAwarded'] == first['pointsAwarded'], f'repeated submit #{attempt + 1} returns the stored result')
    check(points('d') - start_points == drills.TARGETED_PRACTICE_POINTS and drill_logs('d').count() == 1, 'repeated submits add no points and no ledger row')
    stolen = client('c', 'student').post('/v1/study-plan/targeted-practice/submit', {'practiceId': practice_id}, format='json').data['data']
    check(points('c') == 0 and stolen['replayed'] is True, "another student gets no points from someone else's finished drill")
    bare = api.post('/v1/study-plan/targeted-practice/submit', {'categoryId': 'tfng', 'answers': [{'questionId': 'tfng-q1', 'selectedAnswer': 'TRUE'}]}, format='json')
    check(bare.status_code == 400, 'a submit without a drill session is rejected')
    awards = [run_drill('d')[2]['pointsAwarded'] for _ in range(6)]
    cap = drills.TARGETED_PRACTICE_DAILY_POINTS_CAP
    check(awards == [50, 50, 50, 50, 50, 0], f'the daily cap stops the points at {cap}: {awards}')
    check(points('d') - start_points == cap and sum(drill_logs('d').values_list('change', flat=True)) == cap, 'profile and ledger both stop at the daily cap')
    staff = run_drill('teacher', 'teacher')[2]
    check(staff['correctCount'] == 10 and staff['pointsAwarded'] == 0, 'a staff account gets a result but no points')
    transaction.set_rollback(True)
check(not PointsLog.objects.filter(student_id__in=list(ids.values())).exists() and not VocabBattleSession.objects.filter(host_id=ids['teacher']).exists(),
      'all fixture rows are rolled back')
print(f'Points integrity contracts: {len(checks)}/{len(checks)} PASS')
