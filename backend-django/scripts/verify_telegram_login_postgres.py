"""Real-PostgreSQL check for concurrent Telegram logins and connection cleanup.

Runs only against a database whose name ends in ``_local`` (the Windows dev
setup); it creates one synthetic Telegram student and never touches other rows.

    DJANGO_SETTINGS_MODULE=config.settings.local python scripts/verify_telegram_login_postgres.py
"""
import os
import secrets
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')

import django  # noqa: E402

django.setup()

from django.db import connection, connections  # noqa: E402

from apps.core import telegram_sso, telegram_views  # noqa: E402
from common.background import start_thread  # noqa: E402

if not connection.settings_dict['NAME'].endswith('_local'):
    sys.exit('Refusing to run: database name must end with _local')


def backend_count():
    with connection.cursor() as cursor:
        cursor.execute('SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()')
        return cursor.fetchone()[0]


def main():
    telegram_id = str(9_000_000_000 + secrets.randbelow(999_999_999))
    workers = 12
    barrier = threading.Barrier(workers)
    outcomes = []

    def login():
        try:
            barrier.wait()
            outcomes.append(telegram_views.login_or_register(telegram_id, 'Synthetic', 'Student', '', 'verify')['user']['id'])
        except Exception as error:  # noqa: BLE001
            outcomes.append(f'ERROR {type(error).__name__}')

    before = backend_count()
    threads = [start_thread(login) for _ in range(workers)]
    for thread in threads:
        thread.join()
    time.sleep(1)
    after = backend_count()

    with connection.cursor() as cursor:
        cursor.execute('SELECT count(*) FROM "User" WHERE "telegramChatId" = %s', [telegram_id])
        users = cursor.fetchone()[0]

    token = telegram_sso.issue_sso_token(telegram_id)
    results = []
    barrier2 = threading.Barrier(6)

    def use_token():
        barrier2.wait()
        results.append(telegram_sso.consume_sso_token(token) is not None)

    reuse = [threading.Thread(target=use_token) for _ in range(6)]
    [t.start() for t in reuse]
    [t.join() for t in reuse]

    distinct_ids = {o for o in outcomes if not o.startswith('ERROR')}
    errors = [o for o in outcomes if o.startswith('ERROR')]
    print(f'workers={workers} users_created={users} distinct_user_ids={len(distinct_ids)} errors={errors}')
    print(f'db_backends_before={before} db_backends_after={after} (thread connections closed: {after <= before})')
    print(f'sso_token_concurrent_uses_accepted={sum(results)} of {len(results)} (cache backend: {type(__import__("django.core.cache").core.cache.cache).__name__})')
    connections.close_all()
    ok = users == 1 and len(distinct_ids) == 1 and not errors and after <= before and sum(results) == 1
    print('RESULT', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
