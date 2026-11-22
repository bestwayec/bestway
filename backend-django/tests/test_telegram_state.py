"""Update de-duplication primitives (unit level; the real-database behaviour is in verify_telegram_engine_postgres.py)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.db import IntegrityError, ProgrammingError
from django.test import SimpleTestCase

from apps.core import telegram_bot, telegram_state


class ClaimUpdate(SimpleTestCase):
    def test_first_delivery_is_claimed(self):
        with patch.object(telegram_state.TelegramUpdateReceipt.objects, "create"), patch.object(telegram_state.transaction, "atomic", MagicMock()):
            self.assertTrue(telegram_state.claim_update({"update_id": 1, "message": {}}))

    def test_duplicate_is_rejected(self):
        with patch.object(telegram_state.TelegramUpdateReceipt.objects, "create", side_effect=IntegrityError), \
                patch.object(telegram_state.transaction, "atomic", MagicMock()):
            self.assertFalse(telegram_state.claim_update({"update_id": 1, "callback_query": {"id": "x"}}))

    def test_update_without_numeric_id_is_not_blocked_and_needs_no_database(self):
        for value in (None, "12", 1.5, True):
            self.assertTrue(telegram_state.claim_update({"update_id": value}))
        self.assertTrue(telegram_state.claim_update({}))

    def test_missing_table_degrades_to_no_dedupe_instead_of_outage(self):
        error = ProgrammingError('relation "core_telegramupdatereceipt" does not exist')
        with patch.object(telegram_state.TelegramUpdateReceipt.objects, "create", side_effect=error), \
                patch.object(telegram_state.transaction, "atomic", MagicMock()):
            self.assertTrue(telegram_state.claim_update({"update_id": 5}))

    def test_other_database_errors_are_not_swallowed(self):
        with patch.object(telegram_state.TelegramUpdateReceipt.objects, "create", side_effect=ProgrammingError("syntax error")), \
                patch.object(telegram_state.transaction, "atomic", MagicMock()):
            with self.assertRaises(ProgrammingError):
                telegram_state.claim_update({"update_id": 5})

    def test_bot_handle_stops_on_a_duplicate(self):
        with patch("apps.core.telegram_state.claim_update", return_value=False), patch("apps.core.telegram_bot.menu") as menu:
            telegram_bot.handle({"update_id": 9, "message": {"chat": {"id": 1}, "text": "/help"}})
        menu.handle.assert_not_called()
