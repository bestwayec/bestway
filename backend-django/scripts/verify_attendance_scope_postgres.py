"""Synthetic attendance ownership and atomic batch checks on disposable PostgreSQL."""
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
u = urlparse(os.environ.get('DATABASE_URL', ''))
if u.hostname not in {'localhost', '127.0.0.1', '::1'} or not u.path.lstrip('/').startswith(('bestway_audit_', 'bestway_security_')):
    raise SystemExit('Requires an explicitly disposable local audit/security database')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
import django
django.setup()
from django.db import connection, transaction
from django.utils import timezone
from psycopg import sql
from rest_framework.test import APIClient
from apps.core import attendance
from apps.legacy_schema.models import Attendance, StudentProfile

prefix = 'attendance-scope-' + uuid4().hex[:12]
ids = {k: prefix + '-' + k for k in ('teacher-a', 'teacher-b', 'student-a', 'student-b', 'group-a', 'group-b')}

def insert(table, **values):
    with connection.cursor() as cursor:
        q = sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table),
            sql.SQL(',').join(map(sql.Identifier, values)), sql.SQL(',').join(sql.Placeholder() for _ in values))
        cursor.execute(q, list(values.values()))

def check(value, message):
    if not value: raise AssertionError(message)
    print('PASS ' + message)

with transaction.atomic():
    now = timezone.now()
    for name in ('teacher-a', 'teacher-b', 'student-a', 'student-b'):
        insert('User', id=ids[name], name='Synthetic', phone=ids[name], role='teacher' if name.startswith('teacher') else 'student', passwordHash='unused', updatedAt=now)
    for suffix in ('a', 'b'):
        insert('Group', id=ids['group-'+suffix], name='Synthetic group', teacherId=ids['teacher-'+suffix])
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","linkCode") VALUES (%s,ARRAY[\'IELTS\']::"ExamProgram"[],\'IELTS\',true,%s,%s)',
                [ids['student-'+suffix], ids['group-'+suffix], prefix+suffix])
    client=APIClient()
    client.force_authenticate(user=SimpleNamespace(id=ids['teacher-a'], role='teacher', is_authenticated=True))
    def post(group, students):
        return client.put('/v1/attendance/bulk', dict(groupId=group, date='2026-11-06',
            records=[dict(studentId=s, state='present') for s in students]), format='json')
    with patch.object(attendance, 'notify_parents') as notify:
        result=post(ids['group-a'], [ids['student-a'], ids['student-b']])
        check(result.status_code==400 and result.data['error']['code']=='STUDENT_NOT_IN_GROUP', 'mixed own/foreign batch is rejected')
        check(StudentProfile.objects.get(user_id=ids['student-b']).group_id==ids['group-b'], 'foreign student remains in original group')
        check(not Attendance.objects.filter(group_id=ids['group-a']).exists(), 'mixed batch persists no attendance')
        notify.assert_not_called()
        result=post(ids['group-a'], [ids['teacher-b']])
        check(result.status_code==400 and result.data['error']['code']=='STUDENT_NOT_IN_GROUP', 'non-student cannot acquire a student profile through attendance')
        check(not StudentProfile.objects.filter(user_id=ids['teacher-b']).exists(), 'non-student profile was not created')
        result=post(ids['group-b'], [ids['student-b']])
        check(result.status_code==403, 'teacher cannot mark a different teacher group')
        result=post(ids['group-a'], [ids['student-a']])
        check(result.status_code==200 and Attendance.objects.filter(group_id=ids['group-a'],student_id=ids['student-a'],state='present').exists(),
              'teacher can mark an existing student in their group')
        result=client.get('/v1/attendance/group-summary/'+ids['group-a']+'?date=2026-11-06')
        summary=result.data.get('data', {})
        check(result.status_code==200 and summary.get('presentCount')==1 and summary.get('totalStudents')==1
              and summary.get('students', [{}])[0].get('studentId')==ids['student-a'],
              'authorized daily summary returns the saved record and count')
        check(summary['students'][0]['isExcused'] is None and summary['students'][0]['note'] is None,
              'summary does not invent unsaved excuse or note information')
        result=client.get('/v1/attendance/group-summary?groupId='+ids['group-a']+'&month=2026-11')
        check(result.status_code==200 and result.data['data']['totalMarked']==1,
              'existing monthly group summary remains compatible')
        result=client.get('/v1/attendance/group-summary/'+ids['group-a']+'?date=2026-11-07')
        check(result.status_code==200 and result.data['data']['attendanceRate'] is None
              and result.data['data']['students']==[], 'unmarked day has no fabricated rate or attendance')
        result=client.get('/v1/attendance/group-summary/'+ids['group-b']+'?date=2026-11-06')
        check(result.status_code==403, 'foreign teacher cannot view a daily group summary')
        result=client.get('/v1/attendance/group-summary/'+ids['group-a']+'?date=2026-02-30')
        check(result.status_code==400, 'invalid summary date is rejected')
        client.force_authenticate(user=SimpleNamespace(id=ids['student-a'], role='student', is_authenticated=True))
        result=client.get('/v1/attendance/group-summary/'+ids['group-a']+'?date=2026-11-06')
        check(result.status_code==403, 'student cannot view staff attendance summary')
    transaction.set_rollback(True)
print('PASS all synthetic attendance fixtures rolled back')
