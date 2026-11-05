"""Disposable local PostgreSQL real-JWT authorization checks; always rolled back."""
import os
import sys
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
u = urlparse(os.environ.get('DATABASE_URL', ''))
if u.hostname not in {'localhost', '127.0.0.1', '::1'} or not u.path.lstrip('/').startswith(('bestway_audit_', 'bestway_security_')):
    raise SystemExit('Requires explicitly disposable local audit/security database')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
import django
django.setup()
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.test import APIRequestFactory
from apps.core import auth_service, lms_views, parent_views, teacher_views, views
from apps.core.models import Cohort, Course, Lesson, UserLessonProgress
from apps.legacy_schema.models import User
from common.auth.jwt import issue_access
from common.api.exceptions import ContractAPIException

run = uuid4().hex
checks = []
factory = APIRequestFactory()
def check(condition, label):
    assert condition, label
    checks.append(label)
    print('PASS', label)
def auth(user, role):
    return {'HTTP_AUTHORIZATION': 'Bearer ' + issue_access(user, role)}

with transaction.atomic():
    ids = {role: f'phase3-{role}-{run}' for role in ('teacher', 'other', 'student')}
    for role, uid in ids.items():
        User.objects.create(id=uid, name='Synthetic', phone=uid, role='student' if role == 'student' else 'teacher',
                            password_hash='unused', is_active=True, created_at=timezone.now(), updated_at=timezone.now())
    request = factory.post('/v1/teacher/cohorts', {'name': 'Synthetic', 'invite_code': 'T' + run[:10]}, format='json', **auth(ids['teacher'], 'teacher'))
    created = teacher_views.teacher_cohorts_view(request)
    check(created.status_code == 201 and created.data['data']['teacher_id'] == ids['teacher'], 'real JWT creates cohort for authenticated teacher')
    cohort_id = created.data['data']['id']
    check(Cohort.objects.get(id=cohort_id).teacher_id == ids['teacher'], 'persisted owner is authenticated teacher')
    forbidden = teacher_views.cohort_analytics_view(factory.get('/analytics', **auth(ids['other'], 'teacher')), cohort_id)
    check(forbidden.status_code == 403, 'other teacher cannot access cohort')
    assignment_data = {'cohort_id': cohort_id, 'title': 'Synthetic task'}
    other_assignment = teacher_views.teacher_assignments_view(factory.post('/assignments', assignment_data, format='json', **auth(ids['other'], 'teacher')))
    check(other_assignment.status_code == 403, 'other teacher cannot assign work to cohort')
    owner_assignment = teacher_views.teacher_assignments_view(factory.post('/assignments', assignment_data, format='json', **auth(ids['teacher'], 'teacher')))
    check(owner_assignment.status_code == 201, 'cohort owner can assign work')
    invalid = teacher_views.teacher_cohorts_view(factory.get('/cohorts', HTTP_AUTHORIZATION='Bearer invalid-token'))
    check(invalid.status_code == 401, 'invalid JWT is rejected')
    response = teacher_views.teacher_cohorts_view(factory.post('/cohorts', {'name': 'no'}, format='json', **auth(ids['student'], 'student')))
    check(response.status_code == 403, 'student cannot create teacher cohort')
    response = teacher_views.teacher_cohorts_view(factory.post('/cohorts', {'name': 'no'}, format='json'))
    check(response.status_code == 401, 'anonymous cohort request is rejected')
    course = Course.objects.create(title='Synthetic')
    lesson = Lesson.objects.create(course=course, title='Synthetic')
    response = lms_views.lesson_progress_view(factory.get('/progress', **auth(ids['student'], 'student')), lesson.id)
    check(response.status_code == 200 and UserLessonProgress.objects.filter(user_id=ids['student'], lesson=lesson).exists(), 'real JWT creates lesson progress for student')
    with patch('apps.core.parent_views.get_or_create_parent_invite_code', return_value={'inviteCode': 'fixture'}) as invite:
        response = parent_views.parent_invite_code_view(factory.get('/invite', **auth(ids['student'], 'student')))
        check(response.status_code == 200 and invite.call_args.args[0] == ids['student'], 'real JWT parent invite uses authenticated student')
    with patch('apps.core.lms_views.trigger_hls_transcoding', return_value={'status': 'fixture'}) as transcode:
        student_response = lms_views.lesson_hls_transcode_trigger_view(factory.post('/transcode', **auth(ids['student'], 'student')), lesson.id)
        teacher_response = lms_views.lesson_hls_transcode_trigger_view(factory.post('/transcode', **auth(ids['teacher'], 'teacher')), lesson.id)
        check(student_response.status_code == 403 and teacher_response.status_code == 200 and transcode.call_count == 1, 'real JWT HLS role boundary')
    fixture_user = (ids['student'], 'Synthetic', 'unused', 'student')
    first = auth_service.issue_tokens(fixture_user)
    rotated = auth_service.refresh(first['refreshToken'])
    try:
        auth_service.refresh(first['refreshToken'])
    except ContractAPIException as exc:
        check(exc.contract_code == 'SESSION_EXPIRED', 'replay is rejected')
    else:
        raise AssertionError('replay accepted')
    try:
        auth_service.refresh(rotated['refreshToken'])
    except ContractAPIException as exc:
        check(exc.contract_code == 'SESSION_EXPIRED', 'replay revokes replacement family')
    else:
        raise AssertionError('replacement remained active after replay')

    first = auth_service.issue_tokens(fixture_user)
    rotated = auth_service.refresh(first['refreshToken'])
    logout = views.logout_view(factory.post('/logout', {'refreshToken': first['refreshToken']}, format='json', **auth(ids['student'], 'student')))
    check(logout.status_code == 200, 'logout accepts an already-rotated token')
    try:
        auth_service.refresh(rotated['refreshToken'])
    except ContractAPIException as exc:
        check(exc.contract_code == 'SESSION_EXPIRED', 'logout revokes concurrently rotated replacement')
    else:
        raise AssertionError('logout did not revoke replacement')

    first = auth_service.issue_tokens(fixture_user)
    rotated = auth_service.refresh(first['refreshToken'])
    unrelated = auth_service.issue_tokens(fixture_user)
    unauth_logout = views.logout_refresh_view(factory.post('/logout-refresh', {'refreshToken': first['refreshToken']}, format='json'))
    check(unauth_logout.status_code == 200, 'refresh bearer can revoke its family without access token')
    try:
        auth_service.refresh(rotated['refreshToken'])
    except ContractAPIException as exc:
        check(exc.contract_code == 'SESSION_EXPIRED', 'refresh-bearer logout revokes rotated successor')
    else:
        raise AssertionError('refresh-bearer logout left successor active')
    check(bool(auth_service.refresh(unrelated['refreshToken'])['refreshToken']), 'refresh-bearer logout does not revoke another family')
    unknown = views.logout_refresh_view(factory.post('/logout-refresh', {'refreshToken': 'synthetic-unknown'}, format='json'))
    check(unknown.status_code == 200, 'unknown refresh bearer gives non-enumerating response')

    expired = auth_service.issue_tokens(fixture_user)
    with connection.cursor() as cursor:
        cursor.execute("UPDATE \"RefreshToken\" SET \"expiresAt\"=NOW() - interval '1 second' WHERE \"tokenHash\"=%s", [auth_service.token_hash(expired['refreshToken'])])
    response = views.logout_refresh_view(factory.post('/logout-refresh', {'refreshToken': expired['refreshToken']}, format='json'))
    check(response.status_code == 200, 'expired refresh logout remains non-enumerating')
    with connection.cursor() as cursor:
        cursor.execute('SELECT "revokedAt" FROM "RefreshToken" WHERE "tokenHash"=%s', [auth_service.token_hash(expired['refreshToken'])])
        check(cursor.fetchone()[0] is None, 'expired refresh bearer cannot revoke a family')
    try:
        auth_service.refresh(expired['refreshToken'])
    except ContractAPIException as exc:
        check(exc.contract_code == 'INVALID_REFRESH_TOKEN', 'expired refresh token is rejected')
    else:
        raise AssertionError('expired token accepted')
    transaction.set_rollback(True)
print(f'Phase 3 real JWT PostgreSQL: {len(checks)} PASS; fixtures rolled back')
