"""Run work on a short-lived thread without leaking database connections.

Django keeps one connection per thread. A connection opened on an ad-hoc
thread is never closed by the request cycle, and under CONN_MAX_AGE
close_old_connections() deliberately keeps it, so every finished thread used
to leave an idle PostgreSQL session behind until the server ran out of slots
("FATAL: sorry, too many clients already").
"""
import logging
import threading

from django.db import connections

logger = logging.getLogger(__name__)


def closing_connections(target):
    def run(*args, **kwargs):
        try:
            return target(*args, **kwargs)
        finally:
            connections.close_all()
    run.__name__ = getattr(target, '__name__', 'background_job')
    return run


def start_thread(target, *args, name=None, **kwargs):
    def run():
        try:
            target(*args, **kwargs)
        except Exception:
            logger.exception('Background job %s failed', getattr(target, '__name__', target))
        finally:
            connections.close_all()
    thread = threading.Thread(target=run, name=name or f'bestway-{getattr(target, "__name__", "job")}', daemon=True)
    thread.start()
    return thread
