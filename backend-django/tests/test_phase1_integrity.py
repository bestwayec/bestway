import copy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from apps.core import assessment_providers as providers, assessment_worker as worker
from apps.core.assessment_results import ProviderError
from tests.test_assessment import fixture


def chat(value):
    return {'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': json.dumps(value)}}]}


@pytest.mark.parametrize('mutation', ['empty', 'score', 'evidence', 'confidence'])
def test_incomplete_provider_results_fail_closed(mutation):
    input, result = fixture('MULTILEVEL')
    if mutation == 'empty': result = {}
    elif mutation == 'score': del result['parts'][0]['rawScore']
    elif mutation == 'evidence': del result['parts'][0]['evidence']
    else: del result['confidence']
    with patch.dict('os.environ', {'ASSESSMENT_PROVIDER':'openrouter', 'OPENROUTER_API_KEY':'fixture', 'OPENROUTER_MODEL':'fixture'}, clear=True), patch.object(providers, 'provider_json', return_value=chat(result)):
        with pytest.raises(ProviderError): providers.assess(input, 'PRIMARY')


def test_valid_provider_result_remains_verified():
    input, result = fixture('MULTILEVEL')
    with patch.dict('os.environ', {'ASSESSMENT_PROVIDER':'openrouter', 'OPENROUTER_API_KEY':'fixture', 'OPENROUTER_MODEL':'fixture'}, clear=True), patch.object(providers, 'provider_json', return_value=chat(result)):
        output = providers.assess(input, 'PRIMARY')
        assert output['provider'] == 'openrouter'
        assert output['result']['parts'][0]['rawScore'] == 3


@pytest.mark.parametrize('code', ['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_EMPTY_RESPONSE', 'PROVIDER_MALFORMED_JSON'])
def test_gemini_failure_never_becomes_success(code):
    input, _ = fixture('MULTILEVEL')
    with patch.dict('os.environ', {'GEMINI_API_KEY':'fixture'}, clear=True), patch.object(providers, 'provider_json', side_effect=ProviderError(code, True, True)):
        with pytest.raises(ProviderError, match=code): providers._assess_gemini(input, 'PRIMARY')


def test_local_stt_wins_over_remote_key_and_explicit_fallback():
    with patch.dict('os.environ', {'STT_PROVIDER':'faster-whisper','OPENROUTER_API_KEY':'fixture'}, clear=True), patch('apps.core.assessment_local_stt.transcribe', side_effect=ProviderError('STT_LOCAL_MODEL_UNAVAILABLE')), patch.object(providers, '_transcribe_openrouter', return_value={'text':'remote'}) as remote:
        with pytest.raises(ProviderError, match='STT_LOCAL_MODEL_UNAVAILABLE'): providers.transcribe(Path('fixture'), 'audio/webm')
        remote.assert_not_called()
        with patch.dict('os.environ', {'STT_ALLOW_REMOTE_FALLBACK':'true'}):
            assert providers.transcribe(Path('fixture'), 'audio/webm')['text'] == 'remote'
            remote.assert_called_once()


@pytest.mark.parametrize('mode', ['missing_hash','missing_file','bad_hash','empty_transcript','timeout','valid'])
def test_audio_integrity_before_evaluation(mode):
    with TemporaryDirectory() as directory:
        path = Path(directory)/'sample.wav'; path.write_bytes(b'synthetic audio')
        audio_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if mode == 'bad_hash': audio_hash = '0'*64
        if mode == 'missing_hash': audio_hash = ''
        if mode == 'missing_file': path.unlink()
        response = {'audioKey':'fixture.wav','audioHash':audio_hash,'questionId':'q'}
        input = {'parts':[{'responses':[response]}], 'evaluationPolicy':'none'}
        job = SimpleNamespace(id='job',attempt_id='attempt',student_id='student',attempt_count=1,lease_token='lease')
        rows = Mock(); rows.order_by.return_value.first.return_value = None
        speech = Mock(return_value=dict(text='' if mode == 'empty_transcript' else 'real transcript', segments=[],confidence=.9,provider='local',model='fixture',durationMs=1000))
        if mode == 'timeout': speech.side_effect=ProviderError('STT_LOCAL_TIMEOUT',True,False)
        with patch.object(worker, 'refresh'), patch.object(worker, 'storage_path', return_value=path), patch('apps.core.mock_media.resolve_key',return_value=path), patch.object(worker.SpeechTranscript.objects, 'filter', return_value=rows), patch.object(worker.SpeechTranscript.objects, 'create',return_value=SimpleNamespace(id='t')), patch.object(worker.transaction, 'atomic'), patch.object(worker.service,'require_lease'), patch.object(worker.MockAnswer.objects,'filter') as answers, patch.object(worker.Answer.objects,'filter') as legacy, patch.object(worker.MockAttempt.objects,'filter') as attempts:
            answers.return_value.first.return_value = None; legacy.return_value.first.return_value = None; attempts.return_value.first.return_value = None
            if mode == 'valid':
                worker.transcribe(job,input,speech); assert response['transcript'] == 'real transcript'
            else:
                with pytest.raises(ProviderError): worker.transcribe(job,input,speech)
                assert 'transcript' not in response
                if mode in ('missing_hash','missing_file','bad_hash'): speech.assert_not_called()


def test_cached_transcript_is_not_trusted_if_audio_changed():
    with TemporaryDirectory() as directory:
        path=Path(directory)/'audio.wav';path.write_bytes(b'changed')
        input={'parts':[{'responses':[{'audioKey':'audio.wav','audioHash':'0'*64,'questionId':'q'}]}]}
        job=SimpleNamespace(id='job',attempt_id='attempt',student_id='student',attempt_count=1,lease_token='lease')
        with patch.object(worker,'refresh'),patch.object(worker,'storage_path',return_value=path),patch.object(worker.SpeechTranscript.objects,'filter') as cache:
            with pytest.raises(ProviderError,match='STT_AUDIO_HASH_MISMATCH'): worker.transcribe(job,input,Mock())
            cache.assert_not_called()


def test_transient_failure_retries_but_uncertain_failure_needs_review():
    from apps.core import assessment
    job=SimpleNamespace(id='job',lease_token='lease',attempt_count=1)
    with patch.object(assessment.AssessmentJob.objects,'filter') as jobs:
        assessment.fail_job(job,'STT_LOCAL_TIMEOUT',True,False)
        assert jobs.return_value.update.call_args.kwargs['status']=='RETRY'
        assessment.fail_job(job,'PROVIDER_TIMEOUT',True,True)
        assert jobs.return_value.update.call_args.kwargs['status']=='NEEDS_REVIEW'


def test_failed_stt_cannot_call_grader():
    job=SimpleNamespace(attempt_id='attempt',input_snapshot={'skill':'speaking'},input_hash='hash')
    speech=Mock();grader=Mock()
    with patch.object(worker.service,'claim',return_value=job),patch.object(worker.MockAttempt.objects,'filter') as attempt,patch.object(worker,'canonical_checksum',return_value='hash'),patch.object(worker,'transcribe',side_effect=ProviderError('STT_AUDIO_HASH_MISMATCH')),patch.object(worker.service,'fail_job') as fail:
        attempt.return_value.first.return_value=SimpleNamespace(status='grading')
        assert worker.run_once(grader,speech)
        grader.assert_not_called()
        assert fail.call_args.args[1]=='STT_AUDIO_HASH_MISMATCH'


def test_actual_silent_pcm_is_detected_without_inventing_a_transcript():
    # The decoder comes from the optional local STT package (requirements/prod.txt only).
    pytest.importorskip('faster_whisper')
    import wave
    from apps.core.assessment_local_stt import _decode_audio
    with TemporaryDirectory() as directory:
        path = Path(directory) / 'silence.wav'
        with wave.open(str(path), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b'\0\0' * 16000)
        with pytest.raises(ProviderError, match='STT_NO_SPEECH'):
            _decode_audio(path, 600)


def test_silence_and_empty_transcript_remain_distinct_review_reasons():
    from apps.core import assessment
    job = SimpleNamespace(id='job', lease_token='lease', attempt_count=1)
    with patch.object(assessment.AssessmentJob.objects, 'filter') as jobs:
        for code in ('STT_NO_SPEECH', 'STT_EMPTY_TRANSCRIPT', 'STT_AUDIO_UNAVAILABLE'):
            assessment.fail_job(job, code, False, False)
            values = jobs.return_value.update.call_args.kwargs
            assert values['status'] == 'NEEDS_REVIEW'
            assert values['failure_code'] == code
            assert 'final_score' not in values
