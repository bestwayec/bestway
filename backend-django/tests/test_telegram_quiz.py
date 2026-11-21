"""Pure helpers of the Telegram quiz front end (the full journey is scripts/verify_telegram_quiz_postgres.py)."""
from __future__ import annotations

import string
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core import telegram_quiz as tq


class Helpers(SimpleTestCase):
    def test_uz_and_en_define_the_same_keys(self):
        self.assertEqual(set(tq.TEXT['uz']), set(tq.TEXT['en']))

    def test_placeholders_match_between_languages(self):
        fields = lambda s: {f for _, f, _, _ in string.Formatter().parse(s) if f}
        for key in tq.TEXT['uz']:
            self.assertEqual(fields(tq.TEXT['uz'][key]), fields(tq.TEXT['en'][key]), key)

    def test_callback_classification(self):
        for good in ('qt', 'qo:abc', 'qa:x:1:2', 'qr:x:0'):
            self.assertTrue(tq.is_quiz_callback(good), good)
        for other in ('btn:topic_x', 'download_apk', '', None, 'Q', 'qq:1', 'xqs:1'):
            self.assertFalse(tq.is_quiz_callback(other), other)

    def test_id_validation_rejects_hostile_values(self):
        self.assertTrue(tq._valid('3f2b8c1e-aaaa-4bbb-8ccc-1234567890ab'))
        for bad in ("a'; DROP", 'short', 'x' * 65, '', None, 'a b c d e f g h', '../../etc'):
            self.assertFalse(tq._valid(bad), bad)

    def test_formatting(self):
        self.assertEqual(tq.mmss(1029), '17:09')
        self.assertEqual(tq.mmss(-5), '0:00')
        self.assertEqual(tq.mmss(None), '0:00')
        self.assertEqual(len(tq.clip('x' * 500, 60)), 60)
        self.assertEqual(tq.clip('  a   b  ', 10), 'a b')
        self.assertEqual(tq.esc('<b>&'), '&lt;b&gt;&amp;')

    def test_status_labels_follow_the_percentage(self):
        self.assertEqual([tq.status_label('en', p) for p in (95, 78, 55, 20)], ['Excellent', 'Good progress', 'Fair', 'Needs practice'])
        self.assertEqual(tq.status_label('uz', 78), "Yaxshi")

    def test_question_view_never_contains_the_key(self):
        payload = dict(attemptId='a' * 36, title='T', secondsLeft=60, savedAnswers={}, questions=[
            dict(id='q1', type='mcq', prompt='P', options=['one', 'two'], points=1), dict(id='q2', type='text', prompt='Q', options=[], points=1)])
        text, keyboard = tq._question_view('en', payload, 0)
        flat = [b['callback_data'] for row in keyboard for b in row]
        self.assertIn('Question 1/2', text)
        self.assertTrue(all(len(c.encode()) <= 64 for c in flat))
        self.assertTrue(any(c.startswith('qa:') for c in flat) and any(c.startswith('qf:') for c in flat))
        text2, keyboard2 = tq._question_view('en', payload, 1)
        self.assertIn('Type your answer', text2)
        self.assertFalse(any(b['callback_data'].startswith('qa:') for row in keyboard2 for b in row))

    def test_group_chat_callbacks_are_refused_before_any_lookup(self):
        sent = []
        with patch.object(tq.api, 'send', side_effect=lambda cid, text, reply_markup=None: sent.append((cid, text))), \
                patch.object(tq, '_actor') as actor:
            self.assertTrue(tq.handle_callback(5, 1, 'qo:abcdefgh1234', chat_type='supergroup'))
        actor.assert_not_called()
        self.assertTrue(sent and '🔒' in sent[0][1])

    def test_non_quiz_callbacks_are_ignored(self):
        self.assertFalse(tq.handle_callback(1, 1, 'btn:topic_x'))
