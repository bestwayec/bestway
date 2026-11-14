"""Answer saves: the last edit wins by its edit time on the server clock, so an edit
queued offline or made in an older tab never overwrites a newer saved answer."""
from contextlib import ExitStack, nullcontext
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import mock_attempts as engine

NOW = datetime(2026, 11, 13, 10, 0, tzinfo=timezone.utc)
ms = lambda moment: int(moment.timestamp() * 1000)


class LastWriteWinsTests(SimpleTestCase):
    def save(self, items, stored=None):
        writes = []
        attempt = SimpleNamespace(id="att", flow_mode="single_skill", current_skill=None, submitted_sections=[])
        rows = [SimpleNamespace(question_id=qid, response=resp, updated_at=at) for qid, (resp, at) in (stored or {}).items()]
        with ExitStack() as stack:
            stack.enter_context(patch.object(engine.transaction, "atomic", return_value=nullcontext()))
            stack.enter_context(patch.object(engine, "own", return_value=attempt))
            for name in ("assert_in_progress", "assert_time", "assert_program"):
                stack.enter_context(patch.object(engine, name))
            stack.enter_context(patch.object(engine, "questions", side_effect=lambda _a, ids: [SimpleNamespace(id=i) for i in ids]))
            stack.enter_context(patch.object(engine.MockAnswer.objects, "filter", return_value=rows))
            stack.enter_context(patch.object(engine, "upsert_answer", side_effect=lambda *a: writes.append(a)))
            stack.enter_context(patch.object(engine.timezone, "now", return_value=NOW))
            result = engine.save_answers(SimpleNamespace(id="stu"), "att", items, bulk=True)
        return result, writes

    def test_a_newer_edit_replaces_the_stored_answer(self):
        result, writes = self.save([{"questionId": "q1", "response": "new", "editedAt": ms(NOW - timedelta(seconds=5))}],
                                   {"q1": ("old", NOW - timedelta(minutes=1))})
        self.assertEqual(writes, [("att", "q1", "new", NOW - timedelta(seconds=5))])
        self.assertNotIn("stale", result)
        self.assertEqual(result["saved"], 1)

    def test_an_older_queued_edit_does_not_overwrite_and_returns_the_newer_value(self):
        result, writes = self.save([{"questionId": "q1", "response": "offline", "editedAt": ms(NOW - timedelta(minutes=5))}],
                                   {"q1": ("from other tab", NOW - timedelta(minutes=1))})
        self.assertEqual(writes, [])
        self.assertEqual(result["stale"], {"q1": "from other tab"})
        self.assertEqual(result["saved"], 1)

    def test_a_stored_time_without_time_zone_is_read_as_utc(self):
        naive = (NOW - timedelta(minutes=1)).replace(tzinfo=None)
        result, writes = self.save([{"questionId": "q1", "response": "older", "editedAt": ms(NOW - timedelta(minutes=2))}],
                                   {"q1": ("kept", naive)})
        self.assertEqual((writes, result["stale"]), ([], {"q1": "kept"}))

    def test_within_one_batch_the_latest_edit_of_a_question_wins(self):
        _result, writes = self.save([
            {"questionId": "q1", "response": "second", "editedAt": ms(NOW - timedelta(seconds=10))},
            {"questionId": "q1", "response": "first", "editedAt": ms(NOW - timedelta(seconds=20))},
        ])
        self.assertEqual([w[2] for w in writes], ["second"])

    def test_an_edit_time_in_the_future_is_clamped_to_now(self):
        _result, writes = self.save([{"questionId": "q1", "response": "x", "editedAt": ms(NOW + timedelta(hours=3))}])
        self.assertEqual(writes[0][3], NOW)

    def test_clients_without_edit_time_keep_the_old_behaviour(self):
        result, writes = self.save([{"questionId": "q1", "response": "desktop"}], {"q1": ("newer?", NOW)})
        self.assertEqual(writes, [("att", "q1", "desktop")])
        self.assertNotIn("stale", result)

    def test_the_edit_time_is_validated(self):
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id="stu", role="student", is_authenticated=True))
        with patch("apps.core.mock_attempt_views.attempt_signature.verify_request"):
            for bad in (-1, "yesterday", True, None and 0):
                if bad is None:
                    continue
                response = client.post("/v1/mock/attempts/att/answers", {"answers": [{"questionId": "q1", "response": "x", "editedAt": bad}]}, format="json")
                self.assertEqual(response.status_code, 400, bad)
