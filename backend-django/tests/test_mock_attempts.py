"""Clock and HTTP-boundary regressions; ORM integration lives in PG harness."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from django.urls import resolve
from rest_framework.test import APIClient
from unittest.mock import patch

from apps.core import mock_attempts as engine
from apps.core.mock_attempt_views import validate_answer, wire
from common.api.exceptions import ContractAPIException

AT = datetime(2026, 10, 8, tzinfo=timezone.utc)


class AttemptTimingTests(SimpleTestCase):
    def test_ielts_listening_uses_audio_and_review_not_minutes(self):
        self.assertEqual(engine.skill_seconds('listening', dict(durationMinutes=1, groups=[dict(audioDurationSec=90)]), 'ielts_academic'), 210)

    def test_ielts_listening_fallback(self):
        self.assertEqual(engine.skill_seconds('listening', None, 'ielts_general'), 1920)

    def test_ielts_speaking_untimed(self):
        self.assertIsNone(engine.skill_seconds('speaking', {}, 'ielts_academic'))

    def test_multilevel_current_durations(self):
        self.assertEqual([engine.skill_seconds(s, {}, 'multilevel') for s in engine.SKILLS], [2700, 3600, 3600, 660])

    def test_practice_has_no_clock(self):
        self.assertEqual(engine.timing('multilevel', [], 'practice', 'single_skill', AT), (None, None, None))

    def test_single_skill_clocks_are_parallel(self):
        sections = [dict(skill='reading', durationMinutes=10), dict(skill='writing', durationMinutes=15)]
        deadlines, overall, _ = engine.timing('ielts_academic', sections, 'timed', 'single_skill', AT)
        self.assertEqual(overall, AT+timedelta(minutes=15))
        self.assertEqual(deadlines['reading'], engine.iso(AT+timedelta(minutes=10)))

    def test_full_test_ielts_speaking_clears_overall(self):
        deadlines, overall, last = engine.timing('ielts_academic', [dict(skill='speaking')], 'timed', 'full_test', AT)
        self.assertIsNone(overall)
        self.assertNotIn('speaking', deadlines)
        self.assertEqual(last, AT+timedelta(seconds=1920+7200))

    def test_prisma_naive_utc_deadline_rejects_late_writes(self):
        attempt = SimpleNamespace(mode='timed', overall_deadline_at=None,
            deadline_at=AT.replace(tzinfo=None), section_deadlines=None, current_skill=None)
        with self.assertRaises(ContractAPIException) as caught:
            engine.assert_time(attempt, AT+timedelta(milliseconds=1))
        self.assertEqual(caught.exception.contract_code, 'MOCK_TIME_UP')

    def test_exact_deadline_not_yet_late_for_save(self):
        attempt = SimpleNamespace(mode='timed', overall_deadline_at=AT,
            deadline_at=AT, section_deadlines=None, current_skill=None)
        engine.assert_time(attempt, AT)

    def test_current_section_deadline_even_practice(self):
        attempt = SimpleNamespace(mode='practice', overall_deadline_at=None,
            deadline_at=None, section_deadlines={'reading': engine.iso(AT)}, current_skill='reading')
        with self.assertRaises(ContractAPIException) as caught:
            engine.assert_time(attempt, AT+timedelta(seconds=1))
        self.assertEqual(caught.exception.contract_code, 'MOCK_SECTION_TIME_UP')


class AttemptBoundaryTests(SimpleTestCase):
    def test_naive_prisma_timestamps_are_unambiguous_utc_on_wire(self):
        self.assertEqual(wire({'startedAt': AT.replace(tzinfo=None)}), {'startedAt': '2026-10-08T00:00:00.000Z'})

    def test_answer_clear_and_literal_formats(self):
        for response in ('', 'A, B', '["A","B"]', 'NOT GIVEN', 'Original essay'):
            validate_answer(dict(questionId='q', response=response))

    def test_answer_type_and_length(self):
        for value in (None, [], 'x'*10001):
            with self.assertRaises(ContractAPIException):
                validate_answer(dict(questionId='q', response=value))

    def test_audio_container_validation(self):
        engine.validate_audio_container(SimpleUploadedFile('fixture.wav', b'RIFF0000WAVEoriginal'))
        for payload in (b'', b'not really audio'):
            with self.assertRaises(ContractAPIException) as caught:
                engine.validate_audio_container(SimpleUploadedFile('bad.wav', payload))
            self.assertEqual(caught.exception.contract_code, 'INVALID_AUDIO')

    def test_registered_start_and_phase_routes(self):
        for path in ('/v1/mock/exams/e/start', '/v1/mock/attempts/a/answer',
            '/v1/mock/attempts/a/answers', '/v1/mock/attempts/a/advance',
            '/v1/mock/attempts/a/listening/g/prepare', '/v1/mock/attempts/a/listening/g/play',
            '/v1/mock/attempts/a/speaking/q/start', '/v1/mock/attempts/a/speaking/q',
            '/v1/mock/attempts/a/answers/q/audio', '/v1/mock/attempts/a/annotations',
            '/v1/mock/attempts/a/flag-cheat', '/v1/mock/attempts/a', '/v1/mock/attempts/mine'):
            self.assertTrue(resolve(path))

    def test_role_denial_before_database(self):
        client = APIClient()
        self.assertEqual(client.post('/v1/mock/exams/e/start', {}, format='json').status_code, 401)
        client.force_authenticate(SimpleNamespace(role='teacher', id='t', is_authenticated=True))
        self.assertEqual(client.post('/v1/mock/exams/e/start', {}, format='json').status_code, 403)

    @patch.object(engine, 'own')
    @patch.object(engine.transaction, 'atomic')
    def test_annotations_preserve_explicit_post_submit_exception(self, atomic, own):
        attempt = SimpleNamespace(status='completed', save=lambda **kwargs: None)
        own.return_value = attempt
        self.assertEqual(engine.annotations(SimpleNamespace(id='s'), 'a', ['note']), {'saved': True})
        self.assertEqual(attempt.annotations, ['note'])
