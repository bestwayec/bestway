"""Expose BW-16 on a disposable local PostgreSQL DB; synthetic fixtures only."""
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
u = urlparse(os.environ.get('DATABASE_URL', ''))
if u.hostname not in {'localhost', '127.0.0.1', '::1'} or not u.path.lstrip('/').startswith(('bestway_audit_', 'bestway_security_')):
    raise SystemExit('Requires explicitly disposable local audit/security database')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
import django
django.setup()
from django.db import connection, connections, close_old_connections
from django.utils import timezone
from rest_framework.test import APIRequestFactory
from apps.core import auth_service, views
from apps.legacy_schema.models import User
from common.api.exceptions import ContractAPIException

uid = 'phase3-race-' + uuid4().hex
user = (uid, 'Synthetic', 'unused', 'student')
def parallel(*actions):
    barrier = Barrier(len(actions))
    def run(action):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                return action()
            except ContractAPIException as error:
                return {'error': error.contract_code}
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=len(actions)) as pool:
        return [future.result() for future in [pool.submit(run, action) for action in actions]]

try:
    User.objects.create(id=uid, name='Synthetic', phone=uid, role='student', password_hash='unused',
                        is_active=True, created_at=timezone.now(), updated_at=timezone.now())
    initial = auth_service.issue_tokens(user)['refreshToken']
    def logout():
        request = APIRequestFactory().post('/logout-refresh', {'refreshToken': initial}, format='json')
        return views.logout_refresh_view(request).status_code
    rotated, status = parallel(lambda: auth_service.refresh(initial), logout)
    assert status == 200, 'logout request failed'
    if 'refreshToken' in rotated:
        try:
            auth_service.refresh(rotated['refreshToken'])
        except ContractAPIException as error:
            assert error.contract_code == 'SESSION_EXPIRED'
        else:
            raise AssertionError('logout failed to revoke rotated token')
    else:
        assert rotated['error'] in ('SESSION_EXPIRED', 'REFRESH_IN_PROGRESS')
        # A competing logout can hold the row lock, producing a transient 409.
        # After logout commits the old credential must still be revoked.
        try:
            auth_service.refresh(initial)
        except ContractAPIException as error:
            assert error.contract_code == 'SESSION_EXPIRED'
        else:
            raise AssertionError('logout did not revoke the original token')
    print('PASS concurrent logout prevents refresh family reuse')

    initial = auth_service.issue_tokens(user)['refreshToken']
    outcomes = parallel(lambda: auth_service.refresh(initial), lambda: auth_service.refresh(initial))
    successes = [r for r in outcomes if 'refreshToken' in r]
    errors = [r.get('error') for r in outcomes if 'error' in r]
    if len(successes) == 1 and errors == ['REFRESH_IN_PROGRESS']:
        print('FAIL BW-16: a simultaneous legitimate request receives REFRESH_IN_PROGRESS instead of session recovery')
        raise SystemExit(1)
    if len(successes) == 1 and errors == ['SESSION_EXPIRED']:
        try:
            auth_service.refresh(successes[0]['refreshToken'])
        except ContractAPIException as error:
            assert error.contract_code == 'SESSION_EXPIRED'
            print('FAIL BW-16: simultaneous legitimate refresh requests revoke their token family')
            raise SystemExit(1)
    raise AssertionError('unexpected refresh-race result')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "RefreshToken" WHERE "userId"=%s', [uid])
    User.objects.filter(id=uid).delete()
