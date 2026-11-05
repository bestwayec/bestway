"""Cross-process refresh contention and lock-owner crash on a disposable DB."""
import os
import sys
from multiprocessing import get_context
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
u = urlparse(os.environ.get('DATABASE_URL', ''))
if u.hostname not in {'localhost', '127.0.0.1', '::1'} or not u.path.lstrip('/').startswith(('bestway_audit_', 'bestway_security_')):
    raise SystemExit('Requires explicitly disposable local audit/security database')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
import django
django.setup()
from django.db import connection, connections, transaction
from django.utils import timezone
from apps.core import auth_service
from apps.legacy_schema.models import User
from common.api.exceptions import ContractAPIException


def holder(token_digest, locked, release):
    connections.close_all()
    try:
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute('SELECT "id" FROM "RefreshToken" WHERE "tokenHash"=%s FOR UPDATE', [token_digest])
            assert cursor.fetchone()
            locked.set()
            assert release.wait(20)
    finally:
        connections.close_all()


def main():
    uid = 'refresh-contention-' + uuid4().hex
    worker = None
    ctx = get_context('spawn')
    try:
        User.objects.create(id=uid, name='Synthetic', phone=uid, role='student', password_hash='unused', is_active=True, created_at=timezone.now(), updated_at=timezone.now())
        old = auth_service.issue_tokens((uid, 'Synthetic', 'unused', 'student'))['refreshToken']
        locked, release = ctx.Event(), ctx.Event()
        worker = ctx.Process(target=holder, args=(auth_service.token_hash(old), locked, release))
        worker.start()
        assert locked.wait(15), 'worker did not obtain PostgreSQL lock'
        try:
            auth_service.refresh(old)
        except ContractAPIException as error:
            assert error.contract_code == 'REFRESH_IN_PROGRESS' and error.status_code == 409
        else:
            raise AssertionError('lock contention did not return REFRESH_IN_PROGRESS')
        # Simulate a worker dying while it holds the transaction: PostgreSQL
        # rolls back and releases the lock without consuming the token.
        worker.terminate()
        worker.join(15)
        assert not worker.is_alive(), 'lock holder did not stop'
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
        print('PASS independent process lock, crash recovery, rotation and replay defense')
    finally:
        if worker is not None and worker.is_alive():
            worker.terminate()
            worker.join(15)
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM "RefreshToken" WHERE "userId"=%s', [uid])
        User.objects.filter(id=uid).delete()


if __name__ == '__main__':
    main()
