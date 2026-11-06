"""Verify attendance waits for concurrent group/roster changes on synthetic PostgreSQL data."""
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
u = urlparse(os.environ.get('DATABASE_URL', ''))
if u.hostname not in {'localhost', '127.0.0.1', '::1'} or not u.path.lstrip('/').startswith(('bestway_audit_', 'bestway_security_')):
    raise SystemExit('Requires an explicitly disposable local audit/security database')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
import django
django.setup()
from django.db import close_old_connections, connection, connections, transaction
from django.utils import timezone
from psycopg import sql
from apps.core import attendance
from apps.legacy_schema.models import Attendance, Group, StudentProfile, User
from common.api.exceptions import ContractAPIException

prefix = 'attendance-race-' + uuid4().hex[:12]
ids = {k: prefix+'-'+k for k in ('teacher-a','teacher-b','student','group-a','group-b')}
actor = SimpleNamespace(id=ids['teacher-a'], role='teacher')

def insert(table, **values):
    with connection.cursor() as cursor:
        query=sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table),
            sql.SQL(',').join(map(sql.Identifier, values)), sql.SQL(',').join(sql.Placeholder() for _ in values))
        cursor.execute(query,list(values.values()))

def race(change, expected_code, label):
    held, release = Event(), Event()
    app_name = prefix+'-'+label
    def hold_change():
        close_old_connections()
        try:
            with transaction.atomic():
                change()
                held.set()
                assert release.wait(10)
        finally:
            connections.close_all()
    def mark():
        close_old_connections()
        try:
            with connections['default'].cursor() as cursor:
                cursor.execute("SELECT set_config('application_name', %s, false)", [app_name])
            try:
                attendance.bulk(actor, dict(groupId=ids['group-a'],date='2026-11-06',
                    records=[dict(studentId=ids['student'],state='present')]))
            except ContractAPIException as error:
                return error.contract_code
            return 'unexpected-success'
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        holder=pool.submit(hold_change)
        assert held.wait(10)
        worker=pool.submit(mark)
        try:
            waiting=False
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                with connection.cursor() as cursor:
                    cursor.execute('SELECT wait_event_type, query FROM pg_stat_activity WHERE application_name=%s',[app_name])
                    current=cursor.fetchone()
                if current and current[0]=='Lock':
                    waiting=current[1].lstrip().startswith('SELECT ')
                    break
                if worker.done(): break
                time.sleep(.05)
            if not waiting: raise AssertionError(label+' did not wait on the authorization lock')
            release.set()
            holder.result(timeout=15)
            outcome=worker.result(timeout=15)
        finally:
            release.set()
    if outcome!=expected_code: raise AssertionError(label+' returned '+outcome)
    if Attendance.objects.filter(group_id=ids['group-a']).exists(): raise AssertionError(label+' wrote an unauthorized record')
    print('PASS '+label+' waits for the lock and rejects stale authorization')

try:
    now=timezone.now()
    for key in ('teacher-a','teacher-b','student'):
        insert('User',id=ids[key],name='Synthetic',phone=ids[key],role='student' if key=='student' else 'teacher',passwordHash='unused',updatedAt=now)
    for suffix in ('a','b'):
        insert('Group',id=ids['group-'+suffix],name='Synthetic',teacherId=ids['teacher-'+suffix])
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","linkCode") VALUES (%s,ARRAY[\'IELTS\']::"ExamProgram"[],\'IELTS\',true,%s,%s)',
            [ids['student'],ids['group-a'],prefix])
    def change_owner():
        group=Group.objects.select_for_update().get(id=ids['group-a'])
        group.teacher_id=ids['teacher-b'];group.save(update_fields=['teacher'])
    race(change_owner,'FORBIDDEN','group owner change')
    Group.objects.filter(id=ids['group-a']).update(teacher_id=ids['teacher-a'])
    def move_student():
        profile=StudentProfile.objects.select_for_update().get(user_id=ids['student'])
        profile.group_id=ids['group-b'];profile.save(update_fields=['group'])
    race(move_student,'STUDENT_NOT_IN_GROUP','student transfer')
finally:
    Attendance.objects.filter(group_id__in=[ids['group-a'],ids['group-b']]).delete()
    StudentProfile.objects.filter(user_id=ids['student']).delete()
    Group.objects.filter(id__in=[ids['group-a'],ids['group-b']]).delete()
    User.objects.filter(id__in=[ids['teacher-a'],ids['teacher-b'],ids['student']]).delete()
    connections.close_all()
