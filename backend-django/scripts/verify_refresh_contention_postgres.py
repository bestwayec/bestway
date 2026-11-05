"""Verify refresh lock contention against an explicitly disposable local DB."""
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from urllib.parse import urlparse
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
u = urlparse(os.environ.get('DATABASE_URL', ''))
if u.hostname not in {'localhost', '127.0.0.1', '::1'} or not u.path.lstrip('/').startswith(('bestway_audit_', 'bestway_security_')):
    raise SystemExit('Requires explicitly disposable local audit/security database')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
import django
django.setup()
from django.db import connection, connections, close_old_connections, transaction
from django.utils import timezone
from apps.core import auth_service
from apps.legacy_schema.models import User
from common.api.exceptions import ContractAPIException

uid = 'refresh-contention-' + uuid4().hex
locked, release = Event(), Event()
try:
    User.objects.create(id=uid, name='Synthetic', phone=uid, role='student', password_hash='unused', is_active=True, created_at=timezone.now(), updated_at=timezone.now())
    old = auth_service.issue_tokens((uid, 'Synthetic', 'unused', 'student'))['refreshToken']
    def holder():
        close_old_connections()
        try:
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute('SELECT "id" FROM "RefreshToken" WHERE "tokenHash"=%s FOR UPDATE', [auth_service.token_hash(old)])
                assert cursor.fetchone()
                locked.set()
                assert release.wait(15)
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=1) as pool:
        worker = pool.submit(holder)
        assert locked.wait(15)
        try:
            auth_service.refresh(old)
        except ContractAPIException as error:
            assert error.contract_code == 'REFRESH_IN_PROGRESS' and error.status_code == 409
        else:
            raise AssertionError('lock contention did not return REFRESH_IN_PROGRESS')
        finally:
            release.set()
        worker.result()
    rotated = auth_service.refresh(old)
    assert rotated['refreshToken'] != old
    try:
        auth_service.refresh(old)
    except ContractAPIException as error:
        assert error.contract_code == 'SESSION_EXPIRED'
    else:
        raise AssertionError('replay accepted')
    try:
        auth_service.refresh(rotated['refreshToken'])
    except ContractAPIException as error:
        assert error.contract_code == 'SESSION_EXPIRED'
    else:
        raise AssertionError('family remained active after replay')
    print('PASS lock contention returns 409 without revocation; later rotation and replay defense hold')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "RefreshToken" WHERE "userId"=%s', [uid])
    User.objects.filter(id=uid).delete()
