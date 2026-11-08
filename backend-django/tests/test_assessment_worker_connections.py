"""Regression: the assessment worker must not leak one DB connection per pool thread.

Production hit `FATAL: sorry, too many clients already` because every tick spawned
fresh ThreadPoolExecutor threads whose thread-local connections survived under
CONN_MAX_AGE and were never closed.
"""
import threading
from unittest.mock import patch

from django.db import connections
from django.test import SimpleTestCase

from apps.core import assessment_worker


class WorkerConnectionLifecycleTests(SimpleTestCase):
    def test_process_one_closes_thread_connections(self):
        closed = []

        def fake_run_once(grader, speech):
            return True

        def run_in_thread():
            with patch.object(assessment_worker, 'run_once', fake_run_once), \
                 patch.object(connections, 'close_all', side_effect=lambda: closed.append(threading.get_ident())):
                assessment_worker._process_one(None, None)

        worker = threading.Thread(target=run_in_thread)
        worker.start()
        worker.join()
        self.assertEqual(len(closed), 1)

    def test_process_one_closes_even_when_job_raises(self):
        calls = []
        with patch.object(assessment_worker, 'run_once', side_effect=RuntimeError('boom')), \
             patch.object(connections, 'close_all', side_effect=lambda: calls.append(1)):
            with self.assertRaises(RuntimeError):
                assessment_worker._process_one(None, None)
        self.assertEqual(calls, [1])
