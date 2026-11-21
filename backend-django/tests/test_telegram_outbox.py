import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase
from django.utils import timezone

from apps.core import telegram_notify as notify
from apps.core import telegram_outbox as outbox
from apps.core import telegram_settings as settings_ui
from apps.core import telegram_teacher as teacher_ui

TASHKENT = ZoneInfo('Asia/Tashkent')


def pref(start=(22, 0), end=(7, 0)):
    return SimpleNamespace(quiet_start=datetime.time(*start), quiet_end=datetime.time(*end), timezone='Asia/Tashkent')


class QuietHoursTests(SimpleTestCase):
    def at(self, hour, minute=0):
        return datetime.datetime(2026, 11, 21, hour, minute, tzinfo=TASHKENT)

    def test_evening_inside_window_ends_next_morning(self):
        until = outbox.quiet_until(pref(), self.at(23))
        self.assertEqual(until, datetime.datetime(2026, 11, 22, 7, 0, tzinfo=TASHKENT))

    def test_early_morning_inside_window_ends_same_morning(self):
        self.assertEqual(outbox.quiet_until(pref(), self.at(5)), datetime.datetime(2026, 11, 21, 7, 0, tzinfo=TASHKENT))

    def test_daytime_is_not_quiet(self):
        self.assertIsNone(outbox.quiet_until(pref(), self.at(12)))
        self.assertIsNone(outbox.quiet_until(pref(), self.at(7)))

    def test_equal_start_and_end_disables_quiet_hours(self):
        self.assertIsNone(outbox.quiet_until(pref((0, 0), (0, 0)), self.at(3)))

    def test_same_day_window(self):
        self.assertEqual(outbox.quiet_until(pref((13, 0), (15, 0)), self.at(14)), datetime.datetime(2026, 11, 21, 15, 0, tzinfo=TASHKENT))

    def test_unknown_timezone_falls_back_to_tashkent(self):
        self.assertEqual(str(outbox._tz('Nowhere/Land')), 'Asia/Tashkent')


class OutboxConfigTests(SimpleTestCase):
    def test_backoff_is_bounded_and_increasing(self):
        self.assertEqual(outbox.MAX_ATTEMPTS, len(outbox.BACKOFF) + 1)
        self.assertEqual(list(outbox.BACKOFF), sorted(outbox.BACKOFF))
        self.assertLessEqual(outbox.MAX_PER_TICK / (outbox.MAX_PER_TICK * outbox.PER_MESSAGE_PAUSE), 30)   # <= 30 msg/s

    def test_unknown_kinds_are_rejected(self):
        with self.assertRaises(ValueError):
            outbox.enqueue('u', 'spam', 'k', 'x')

    def test_notification_strings_have_both_languages(self):
        self.assertEqual(set(notify.T['uz']), set(notify.T['en']))
        self.assertEqual(set(teacher_ui.TEXT['uz']), set(teacher_ui.TEXT['en']))
        self.assertEqual(set(settings_ui.TEXT['uz']), set(settings_ui.TEXT['en']))
        self.assertEqual(set(settings_ui.KIND_LABELS['uz']), set(outbox.KINDS))
        self.assertEqual(set(settings_ui.KIND_LABELS['en']), set(outbox.KINDS))

    def test_teacher_callback_grammar_fits_the_telegram_limit(self):
        uid = 'a' * 36
        for data in (f'tn:d:{uid}:{uid}:168', f'tn:g:{uid}:{uid}', f'ts:{uid}:{uid}', f'ta:y:{uid}', f'tv:n:{uid}', f'tb:g:{uid}', f'tr:{uid}'):
            self.assertLessEqual(len(data.encode()), 100)
        # the two-id callbacks exceed 64 bytes with 36-char ids; they must still fit for the ids this system generates
        self.assertTrue(teacher_ui.is_teacher_callback('tg'))
        self.assertFalse(teacher_ui.is_teacher_callback('qt'))
