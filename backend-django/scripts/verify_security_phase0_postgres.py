"""Local-only Phase 0 real JWT/legacy-schema integration. All fixtures roll back."""
import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
url = urlparse(os.environ.get('DATABASE_URL', ''))
if url.hostname not in {'localhost', '127.0.0.1', '::1'} or not url.path.lstrip('/').startswith(('bestway_audit_', 'bestway_security_')):
    raise SystemExit('Requires an explicitly disposable local bestway_audit_ or bestway_security_ database')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
import django
django.setup()
from django.db import connection, transaction
from django.test import RequestFactory, override_settings
from django.utils import timezone
from rest_framework.test import APIRequestFactory
from apps.core.models import PlacementTestResult
from apps.core.mock_attempt_views import speaking_audio_view
from apps.exams.placement_views import placement_claim_view
from apps.legacy_schema.models import User, StudentProfile
from common.auth.jwt import issue_access

run = uuid4().hex
checks = 0

def check(value):
    global checks
    assert value
    checks += 1

with TemporaryDirectory() as directory, transaction.atomic():
    ids = {role: f'security-{role}-{run}' for role in ['owner', 'other', 'teacher', 'foreign-teacher']}
    for role, identifier in ids.items():
        User.objects.create(id=identifier, phone=identifier, name='Synthetic security fixture', password_hash='unusable', role='teacher' if 'teacher' in role else 'student', is_active=True, created_at=timezone.now(), updated_at=timezone.now())
    record = PlacementTestResult.objects.create(result_token='pt_'+run, guest_session_id=run, cefr_level='B2', cefr_label='B2', estimated_ielts_band='6', score_percent=75)
    def claim(role, body_user=None):
        request = RequestFactory().post('/claim', data=json.dumps(dict(result_token=record.result_token, user_id=body_user)), content_type='application/json', HTTP_AUTHORIZATION='Bearer '+issue_access(ids[role], 'teacher' if 'teacher' in role else 'student'))
        return placement_claim_view(request)
    check(claim('owner', ids['other']).status_code == 200)
    record.refresh_from_db()
    check(record.student_id == ids['owner'])
    check(StudentProfile.objects.get(user_id=ids['owner']).initial_level == 'B2')
    check(claim('owner').status_code == 200)
    check(claim('other').status_code == 409)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "Group" (id,name,"teacherId") VALUES (%s,%s,%s)', [run, 'Synthetic', ids['teacher']])
        cursor.execute('UPDATE "StudentProfile" SET "groupId"=%s WHERE "userId"=%s', [run, ids['owner']])
    for folder in ['speaking_submissions', 'private/speaking_submissions']:
        path = Path(directory) / folder / 'fixture.wav'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'synthetic recording')
        responses = []
        with override_settings(MEDIA_ROOT=directory), patch('apps.legacy_schema.models.MockAttempt.objects.filter') as attempts, patch('apps.legacy_schema.models.MockAnswer.objects.filter') as answers:
            attempts.return_value.first.return_value = SimpleNamespace(student_id=ids['owner'])
            answers.return_value.first.return_value = SimpleNamespace(audio_key=f'{folder}/fixture.wav')
            for role, status in [('owner', 200), ('other', 403), ('teacher', 200), ('foreign-teacher', 403)]:
                request = APIRequestFactory().get('/audio', HTTP_AUTHORIZATION='Bearer '+issue_access(ids[role], 'teacher' if 'teacher' in role else 'student'))
                response = speaking_audio_view(request, 'attempt', 'question')
                check(response.status_code == status)
                if status == 200:
                    check(b''.join(response.streaming_content) == b'synthetic recording')
                    responses.append(response)
        # File iterator has closed its stream after exhaustion. Do not emit
        # request_finished here: it would close this rollback-only DB transaction.
    transaction.set_rollback(True)
print(f'Phase 0 real JWT/legacy PostgreSQL checks: {checks} PASS; fixtures rolled back')
