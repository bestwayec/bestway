"""Real loopback Django HTTP business flows using a disposable PostgreSQL schema.

Requires an explicitly supplied local DATABASE_URL. Copies schema DDL only;
never copies users or application data and never calls external providers.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from threading import Thread
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse, unquote
from urllib.request import Request, urlopen
from uuid import uuid4
from wsgiref.simple_server import WSGIRequestHandler, make_server

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
parsed = urlparse(os.environ.get('DATABASE_URL', ''))
if parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('An explicit loopback PostgreSQL DATABASE_URL is required')
query = dict(parse_qsl(parsed.query)); query.pop('schema', None)
base = urlunparse(parsed._replace(query=urlencode(query)))
schema = 'release_http_' + uuid4().hex[:12]
db = psycopg.connect(base, autocommit=True)
report = dict(transport='real loopback HTTP', cases=[], liveProviders='UNVERIFIED')
created = False
server = None
thread = None


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


try:
    dump = subprocess.run(['pg_dump', '--schema-only', '--no-owner', '--no-privileges', '--schema=public',
        '--host', parsed.hostname, '--port', str(parsed.port or 5432), '--username', unquote(parsed.username or ''),
        '--dbname', unquote(parsed.path.lstrip('/'))], env=dict(os.environ, PGPASSWORD=unquote(parsed.password or '')),
        capture_output=True, text=True, encoding='utf-8', timeout=30)
    if dump.returncode:
        raise RuntimeError('Local schema DDL export failed')
    ddl = '\n'.join(line for line in dump.stdout.splitlines() if not line.startswith('\\') and line.strip() != 'CREATE SCHEMA public;')
    db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema))); created = True
    db.execute(ddl.replace('public.', schema+'.').replace('SCHEMA public', 'SCHEMA '+schema), prepare=False)
    db.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
    os.environ.update(DATABASE_URL=urlunparse(parsed._replace(query=urlencode(dict(query, schema=schema)))),
        DJANGO_SETTINGS_MODULE='config.settings.local', JWT_SECRET='loopback-http-fixture-only-long-secret-2026',
        ALLOWED_HOSTS='localhost,127.0.0.1', TELEGRAM_MODE='off', TELEGRAM_BOT_TOKEN='',
        DEEPSEEK_API_KEY='', DEEPGRAM_API_KEY='', STT_API_KEY='', ASSESSMENT_WORKER_ENABLED='false')
    import django
    django.setup()
    from django.core.wsgi import get_wsgi_application
    from common.auth.passwords import hash_password
    password = 'LocalFixturePassword!'
    ids = {}
    for index, role in enumerate(('super_admin', 'admin', 'teacher')):
        ids[role] = str(uuid4())
        db.execute('INSERT INTO "User" (id,name,phone,"passwordHash",role,"updatedAt") VALUES (%s,%s,%s,%s,%s,NOW())',
            (ids[role], 'Local '+role, '+99890111000'+str(index), hash_password(password), role))
    server = make_server('127.0.0.1', 0, get_wsgi_application(), handler_class=QuietHandler)
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    tokens = {}

    def call(method, path, payload=None, *, role=None, status=200, label=None):
        headers = {'Content-Type': 'application/json'}
        if role:
            headers['Authorization'] = 'Bearer ' + tokens[role]
        request = Request(f'http://127.0.0.1:{server.server_port}'+path,
            data=json.dumps(payload).encode() if payload is not None else None, headers=headers, method=method)
        try:
            response = urlopen(request, timeout=20)
        except HTTPError as error:
            response = error
        with response:
            content = response.read()
            body = json.loads(content) if 'json' in response.headers.get('Content-Type', '') else content
            actual = response.status
        report['cases'].append(dict(method=method, path=re.sub(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', '<UUID>', path),
            role=role or 'anonymous', expected=status, actual=actual, status='PASS' if actual == status else 'FAIL', label=label or path))
        if actual != status:
            code = body.get('error', {}).get('code') if isinstance(body, dict) else 'non-json'
            raise AssertionError(f'{method} {path}: expected {status}, received {actual} ({code})')
        if isinstance(body, dict):
            assert body.get('success') is (status < 400), 'API response envelope invalid'
            return body.get('data')
        return body

    call('GET', '/v1/health')
    call('GET', '/v1/desktop-version')
    call('GET', '/v1/auth/me', status=401)
    for index, role in enumerate(('super_admin', 'admin', 'teacher')):
        result = call('POST', '/v1/auth/login', dict(phone='+99890111000'+str(index), password=password))
        tokens[role] = result['accessToken']
    for index, role in enumerate(('student', 'parent')):
        result = call('POST', '/v1/auth/register', dict(name='Local '+role, phone='+99890111000'+str(index+3), password=password, role=role), status=201)
        ids[role] = result['user']['id']; tokens[role] = result['accessToken']
    call('POST', '/v1/auth/login', dict(phone='+998901110003', password='wrong'), status=401)
    for role in tokens:
        me = call('GET', '/v1/auth/me', role=role)
        assert me['user']['id'] == ids[role]
    call('GET', '/v1/users', role='student', status=403)
    call('GET', '/v1/users', role='admin')
    call('PATCH', '/v1/settings', dict(initialPoints=25, monthlyFee=450000, teacherPointLimit=20), role='super_admin')
    call('PATCH', '/v1/settings', dict(initialPoints=30), role='teacher', status=403)
    group = call('POST', '/v1/groups', dict(name='Local HTTP Group', teacherId=ids['teacher']), role='admin', status=201)
    group_id = group['id']
    call('POST', f'/v1/groups/{group_id}/students', dict(studentId=ids['student']), role='admin', status=201)
    call('POST', '/v1/auth/link-child', dict(linkCode=db.execute('SELECT "linkCode" FROM "StudentProfile" WHERE "userId"=%s', (ids['student'],)).fetchone()[0]), role='parent')
    for role in ('teacher', 'student', 'parent'):
        call('GET', f'/v1/groups/{group_id}', role=role)
    attendance = dict(groupId=group_id, date='2026-10-10', records=[dict(studentId=ids['student'], state='present')])
    call('PUT', '/v1/attendance/bulk', attendance, role='teacher')
    call('PUT', '/v1/attendance/bulk', attendance, role='student', status=403)
    call('GET', f'/v1/attendance?studentId={ids["student"]}&month=2026-10', role='parent')
    call('GET', f'/v1/attendance/stats?groupId={group_id}&month=2026-10', role='teacher')
    payment = dict(year=2026, records=[dict(studentId=ids['student'], month=10, state='paid', amount=450000)])
    call('PUT', '/v1/payments/bulk', payment, role='teacher')
    call('PUT', '/v1/payments/bulk', payment, role='student', status=403)
    for role in ('student', 'parent'):
        call('GET', f'/v1/payments?studentId={ids["student"]}&year=2026&month=10', role=role)
    call('POST', f'/v1/points/{ids["student"]}/adjust', dict(change=10, reason='Local fixture'), role='teacher', status=201)
    call('GET', f'/v1/points/{ids["student"]}', role='parent')
    call('GET', '/v1/points/leaderboard')
    call('GET', '/v1/game/status', role='student')
    article = call('POST', '/v1/articles', dict(title='Original local article', body='Original local testing content only.', category='news', tags=['local']), role='admin', status=201)
    call('GET', f'/v1/articles/{article["id"]}')
    call('PATCH', f'/v1/articles/{article["id"]}', dict(title='Forbidden edit'), role='student', status=403)
    call('POST', '/v1/notifications/broadcast', dict(audience='group', groupId=group_id, includeParents=True, text='Local family message'), role='admin')
    call('GET', '/v1/notifications', role='student')
    call('GET', '/v1/notifications', role='parent')
    call('PATCH', '/v1/notifications/read-all', {}, role='student')
    call('GET', '/v1/stats/dashboard', role='super_admin')
    call('GET', '/v1/audit-logs', role='super_admin')
    exam = call('POST', '/v1/mock/exams', dict(type='ielts_academic', title='Original local fixture', skills=['reading'], starterStructure=True), role='admin', status=201)
    call('GET', f'/v1/mock/exams/{exam["id"]}', role='admin')
    call('GET', f'/v1/mock/exams/{exam["id"]}/readiness', role='admin')
    call('GET', '/v1/mock/attempts/mine', role='student')
    demo = call('POST', '/v1/mock/exams', dict(type='ielts_academic', title='Original local reading lifecycle', profile='practice', isDemo=True), role='admin', status=201)
    section = call('POST', f'/v1/mock/exams/{demo["id"]}/sections', dict(skill='reading'), role='admin', status=201)
    question_group = call('POST', f'/v1/mock/sections/{section["id"]}/groups', dict(title='Original local passage', passageText='Original synthetic passage for local testing.'), role='admin', status=201)
    questions = call('POST', f'/v1/mock/groups/{question_group["id"]}/questions', dict(questions=[dict(number=1, type='short_answer', prompt='Write original.', correctAnswers=['original'], points=1)]), role='admin', status=201)
    question_id = questions['questions'][0]['id']
    started = call('POST', f'/v1/mock/exams/{demo["id"]}/start', dict(mode='practice'), role='student', status=201)
    attempt_id = started['attemptId']
    assert 'correctAnswers' not in json.dumps(started['exam']), 'Student start leaked answer keys'
    resumed = call('POST', f'/v1/mock/exams/{demo["id"]}/start', dict(mode='timed'), role='student', status=201)
    assert resumed['attemptId'] == attempt_id and resumed['resumed'] and resumed['mode'] == 'practice'
    call('POST', f'/v1/mock/attempts/{attempt_id}/answer', dict(questionId=question_id, response='original'), role='student', status=201)
    call('POST', f'/v1/mock/attempts/{attempt_id}/answers', dict(answers=[dict(questionId=question_id, response='original')]), role='student', status=201)
    call('PUT', f'/v1/mock/attempts/{attempt_id}/annotations', dict(annotations=[dict(note='Original local note')]), role='student')
    call('POST', f'/v1/mock/attempts/{attempt_id}/flag-cheat', dict(event='tab_switch'), role='student', status=201)
    submitted = call('POST', f'/v1/mock/attempts/{attempt_id}/submit', {}, role='student', status=201)
    assert submitted['status'] == 'completed'
    call('GET', f'/v1/mock/attempts/{attempt_id}', role='student')
    call('GET', f'/v1/mock/attempts/{attempt_id}', role='parent')
    call('POST', f'/v1/mock/attempts/{attempt_id}/answer', dict(questionId=question_id, response='changed'), role='student', status=400)
    assert db.execute('SELECT state,amount FROM "Payment" WHERE "studentId"=%s', (ids['student'],)).fetchone() == ('paid', 450000)
    assert db.execute('SELECT state FROM "Attendance" WHERE "studentId"=%s', (ids['student'],)).fetchone() == ('present',)
    assert db.execute('SELECT COUNT(*) FROM "ParentStudent" WHERE "parentUserId"=%s AND "studentId"=%s', (ids['parent'], ids['student'])).fetchone()[0] == 1
    assert db.execute('SELECT status,"antiCheatCount" FROM "MockAttempt" WHERE id=%s', (attempt_id,)).fetchone() == ('completed', 1)
    assert db.execute('SELECT response,score FROM "MockAnswer" WHERE "attemptId"=%s', (attempt_id,)).fetchone() == ('original', 1)
    report['databaseChecks'] = ['payment amount/state persisted', 'attendance present persisted', 'parent/student link persisted',
        'mock completed attempt/cheat count persisted', 'mock answer graded correctly', 'student start omits answer keys', 'resume keeps attempt and original mode']
except Exception as error:
    report['error'] = type(error).__name__ + ': ' + str(error)
finally:
    if server:
        server.shutdown(); server.server_close()
    if thread:
        thread.join(timeout=5)
    if created:
        if not re.fullmatch(r'release_http_[a-f0-9]{12}', schema):
            raise RuntimeError('Unsafe schema cleanup')
        db.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
    db.close()
    report['cleanup'] = 'only generated PostgreSQL schema and owned HTTP server removed'
    report['passed'] = sum(case['status'] == 'PASS' for case in report['cases'])
    report['failed'] = sum(case['status'] == 'FAIL' for case in report['cases'])
    evidence = Path(os.environ.get('VERIFY_REPORT_DIR', str(ROOT/'evidence'/'release-20261010')))
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence/'HTTP_REPORT.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'cases'}))
sys.exit(1 if report.get('error') else 0)
