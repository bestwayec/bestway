import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import wave

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient
from apps.core import mock_attempts, mock_speaking_policy as policy
from apps.core.mock_speaking_duration import decoded_duration, InvalidDuration, POLICY
from apps.core.multilevel import CURRENT_SPEC, CURRENT_SPEAKING_PROFILE, task_guidance
from common.api.exceptions import ContractAPIException

AT = datetime(2026, 10, 11, tzinfo=timezone.utc)


def wav(seconds):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
        audio.writeframes(b'\x01\x00' * round(seconds*8000))
    return stream.getvalue()


def attempt(seconds=30, prep=0):
    return SimpleNamespace(id='a', exam_id='e', student_id='s', status='in_progress', mode='practice',
        flow_mode='single_skill', specification_version=CURRENT_SPEC, speaking_profile_version=CURRENT_SPEAKING_PROFILE,
        current_skill='speaking', overall_deadline_at=None, deadline_at=None, section_deadlines=None,
        media_state={'q': dict(startedAt=mock_attempts.iso(AT), prepEndsAt=mock_attempts.iso(AT+timedelta(seconds=prep)),
            expiresAt=mock_attempts.iso(AT+timedelta(seconds=prep+seconds)))}, save=lambda **kwargs: None)


class SpeakingWindowTests(SimpleTestCase):
    def test_user_response_windows_and_picture_followups(self):
        self.assertEqual([[task_guidance('speaking', gi, qi, CURRENT_SPEAKING_PROFILE, CURRENT_SPEC)['responseSeconds']
            for qi in range(3 if gi < 2 else 1)] for gi in range(4)], [[30,30,30],[45,30,30],[120],[120]])
        self.assertEqual(task_guidance('speaking',2,0,CURRENT_SPEAKING_PROFILE,CURRENT_SPEC)['prepSeconds'],60)

    def test_missing_preparation_early_window_and_recovery_guards(self):
        for at, code in [(AT+timedelta(seconds=10),'SPEAKING_PREPARATION_ACTIVE'),
                (AT+timedelta(seconds=61),'SPEAKING_RESPONSE_ACTIVE'), (AT+timedelta(seconds=481),'UPLOAD_WINDOW_EXPIRED')]:
            with self.subTest(code=code), self.assertRaises(ContractAPIException) as caught:
                policy.phase_window(attempt(120,60),'q',120,at=at)
            self.assertEqual(caught.exception.contract_code,code)
        policy.phase_window(attempt(120,60),'q',120,at=AT+timedelta(seconds=180))
        missing=attempt();missing.media_state={}
        with self.assertRaises(ContractAPIException):policy.phase_window(missing,'q',30,at=AT+timedelta(seconds=30))

    def test_actual_samples_reject_truncated_wav_and_limit_decoded_length(self):
        with TemporaryDirectory() as directory:
            path=Path(directory)/'recording.wav';path.write_bytes(wav(30))
            self.assertEqual(decoded_duration(path,30.25),30)
            path.write_bytes(wav(3));self.assertEqual(decoded_duration(path,30.25),3)
            path.write_bytes(wav(31))
            with self.assertRaises(InvalidDuration):decoded_duration(path,30.25)
            path.write_bytes(wav(30)[:-1000])
            with self.assertRaises(InvalidDuration):decoded_duration(path,30.25)

    def test_phase_grant_is_idempotent_and_never_truncated_to_the_overall_deadline(self):
        def grant(item, at):
            with patch.object(mock_attempts.transaction,'atomic'),patch.object(mock_attempts,'own',return_value=item),\
                    patch.object(mock_attempts,'assert_program'),patch.object(mock_attempts.MockQuestionGroup,'objects') as groups,\
                    patch.object(mock_attempts.MockQuestion,'objects') as questions,patch.object(mock_attempts,'questions',return_value=[SimpleNamespace(id='q')]),\
                    patch.object(mock_attempts.timezone,'now',return_value=at):
                groups.filter.return_value.order_by.return_value=[SimpleNamespace(id='g')]
                questions.filter.return_value.order_by.return_value=[SimpleNamespace(id='q')]
                return mock_attempts.media_phase(SimpleNamespace(id='s'),'a','q','speaking')
        item=attempt();item.media_state={}
        first=grant(item,AT);repeat=grant(item,AT+timedelta(seconds=1))
        self.assertEqual(first['expiresAt'],repeat['expiresAt'])
        self.assertEqual(first['startedAt'],repeat['startedAt'])
        self.assertEqual(first['responseSeconds'],30)
        self.assertEqual(first['minDurationMs'],29750)
        timed=attempt();timed.mode='timed';timed.media_state={};timed.overall_deadline_at=AT+timedelta(seconds=20)
        with self.assertRaises(ContractAPIException) as caught:grant(timed,AT)
        self.assertEqual(caught.exception.contract_code,'SPEAKING_TIME_INSUFFICIENT')
        damaged=attempt();damaged.media_state['q']['expiresAt']='invalid'
        with self.assertRaises(ContractAPIException) as caught:grant(damaged,AT)
        self.assertEqual(caught.exception.contract_code,'RECORDING_NOT_STARTED')

    def test_verified_submission_receipt_requires_actual_file_hash(self):
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            path=Path(directory)/'recording.wav';path.write_bytes(wav(30));item=attempt()
            item.media_state['q'].update(timingPolicy=POLICY,durationVerifiedKey='recording.wav',durationVerifiedHash=policy.audio_hash(path),audioDurationMs=30000)
            with patch.object(policy,'expected',return_value=30),patch.object(policy.timezone,'now',return_value=AT+timedelta(hours=1)),patch.object(policy,'measure_duration') as measure:
                self.assertEqual(policy.verify_stored(item,SimpleNamespace(id='q'),'recording.wav',submission=True),30000)
                measure.assert_not_called()
                path.write_bytes(wav(3));measure.return_value=30000
                policy.verify_stored(item,SimpleNamespace(id='q'),'recording.wav',submission=True)
                measure.assert_called_once()


class SpeakingUploadApiTests(SimpleTestCase):
    def test_short_early_long_and_full_recordings_have_atomic_upload_results(self):
        # The subprocess transport is replaced by the actual bounded WAV
        # decoder; no client duration/elapsed metadata determines acceptance.
        def decoder(args, **kwargs):
            return SimpleNamespace(returncode=0, stdout=json.dumps(dict(duration=decoded_duration(args[-2],float(args[-1])))))
        client=APIClient();client.force_authenticate(SimpleNamespace(id='s',role='student',is_authenticated=True))
        q=SimpleNamespace(id='q',group_id='g')
        for seconds, elapsed, expected_code in [(3,30,'SPEAKING_AUDIO_DURATION_INVALID'),(30,1,'SPEAKING_RESPONSE_ACTIVE'),
                (31,31,'SPEAKING_AUDIO_DURATION_INVALID'),(30,30,None),(29.8,30,None)]:
            item=attempt()
            with self.subTest(seconds=seconds,elapsed=elapsed),TemporaryDirectory() as directory,override_settings(MEDIA_ROOT=directory),\
                    patch.object(mock_attempts.transaction,'atomic'),patch.object(mock_attempts,'own',return_value=item),\
                    patch.object(mock_attempts,'assert_program'),patch.object(mock_attempts.MockQuestion,'objects') as questions,\
                    patch.object(mock_attempts.MockAnswer,'objects') as answers,patch.object(policy,'expected',return_value=30),\
                    patch.object(policy.timezone,'now',return_value=AT+timedelta(seconds=elapsed)),\
                    patch('apps.core.mock_speaking_duration.subprocess.run',side_effect=decoder):
                questions.filter.return_value.first.return_value=q
                answers.filter.return_value.first.return_value=None
                response=client.post('/v1/mock/attempts/a/speaking/q',dict(audio=SimpleUploadedFile('voice.wav',wav(seconds),content_type='audio/wav'),durationMs=30000),format='multipart')
                if expected_code:
                    self.assertEqual(response.status_code,400,response.data)
                    self.assertEqual(response.data['error']['code'],expected_code)
                    answers.update_or_create.assert_not_called()
                    self.assertEqual(list(Path(directory).rglob('*.wav')),[])
                else:
                    self.assertEqual(response.status_code,201,response.data)
                    self.assertEqual(response.data['data']['audioDurationMs'],round(seconds*1000))
                    answers.update_or_create.assert_called_once()

    def test_timed_valid_retry_retains_first_accepted_recording(self):
        with TemporaryDirectory() as directory,override_settings(MEDIA_ROOT=directory):
            existing=Path(directory)/'original.wav';existing.write_bytes(wav(30));item=attempt();item.mode='timed'
            item.media_state['q'].update(timingPolicy=POLICY,durationVerifiedKey='original.wav',durationVerifiedHash=policy.audio_hash(existing),audioDurationMs=30000)
            with patch.object(mock_attempts.transaction,'atomic'),patch.object(mock_attempts,'own',return_value=item),\
                    patch.object(mock_attempts,'assert_program'),patch.object(mock_attempts.MockQuestion,'objects') as questions,\
                    patch.object(mock_attempts.MockAnswer,'objects') as answers,patch.object(policy,'expected',return_value=30),\
                    patch.object(policy.timezone,'now',return_value=AT+timedelta(seconds=31)),patch.object(policy,'measure_duration',return_value=30000):
                questions.filter.return_value.first.return_value=SimpleNamespace(id='q',group_id='g')
                answers.filter.return_value.first.return_value=SimpleNamespace(audio_key='original.wav')
                result=mock_attempts.upload_speaking(SimpleNamespace(id='s'),'a','q',SimpleUploadedFile('voice.wav',wav(30),content_type='audio/wav'))
                self.assertTrue(result['saved']);answers.update_or_create.assert_not_called()
                self.assertEqual(list(Path(directory).rglob('*.wav')),[existing])
                self.assertEqual(item.media_state['q']['durationVerifiedKey'],'original.wav')
