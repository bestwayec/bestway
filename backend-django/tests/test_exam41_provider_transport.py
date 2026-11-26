"""HTTP and recording checks using synthetic data and a loopback provider."""
import json
import math
import struct
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from apps.core.assessment_providers import provider_json, transcribe
from apps.core.assessment_results import ProviderError
from apps.core.assessment_whisper import GROQ_MODEL


@pytest.fixture
def provider():
    captured = []
    state = {
        'status': 200, 'retry_after': None, 'pause': 0, 'response': json.dumps({
            'text': '  Synthetic English response. ', 'language': 'english',
            'segments': [{'start': 0, 'end': 0.9, 'text': 'Synthetic English response.'}],
        }).encode(),
    }

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            captured.append((self.path, dict(self.headers.items()), self.rfile.read(int(self.headers['Content-Length']))))
            if state['pause']:
                time.sleep(state['pause'])
            self.send_response(state['status'])
            if state['retry_after']:
                self.send_header('Retry-After', state['retry_after'])
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(state['response'])))
            self.end_headers()
            try:
                self.wfile.write(state['response'])
            except BrokenPipeError:
                pass

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    runner = Thread(target=server.serve_forever, kwargs={'poll_interval': 0.02}, daemon=True)
    runner.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', state, captured
    finally:
        server.shutdown()
        server.server_close()
        runner.join()


@pytest.fixture
def recording(tmp_path):
    path = tmp_path / 'private-name-with-student-id.wav'
    with wave.open(str(path), 'wb') as source:
        source.setnchannels(1)
        source.setsampwidth(2)
        source.setframerate(16000)
        source.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(index / 12))) for index in range(16000)))
    return path


def set_groq(monkeypatch, url):
    monkeypatch.setenv('STT_PROVIDER', 'groq')
    monkeypatch.setenv('GROQ_API_KEY', 'fixture-only')
    monkeypatch.setenv('STT_MODEL', GROQ_MODEL)
    monkeypatch.setenv('STT_BASE_URL', url)
    monkeypatch.delenv('STT_ALLOW_LOCAL_FALLBACK', raising=False)


def test_whisper_preserves_original_bytes_transcript_and_measurement(provider, recording, monkeypatch):
    url, _, captured = provider
    set_groq(monkeypatch, url)
    original = recording.read_bytes()
    result = transcribe(recording, 'audio/wav', 'en', 1000)
    assert result['text'] == '  Synthetic English response. '
    assert (result['provider'], result['model'], result['durationMs']) == ('groq', GROQ_MODEL, 1000)
    assert result['pronunciationEvidence'] == 'UNAVAILABLE'
    assert result['confidence'] is None
    assert result['segments'] == [dict(start=0, end=.9, text='Synthetic English response.', confidence=None)]
    assert recording.read_bytes() == original
    path, headers, payload = captured[0]
    assert path == '/audio/transcriptions'
    assert headers['Authorization'] == 'Bearer fixture-only'
    assert headers['Content-Type'].startswith('multipart/form-data; boundary=')
    assert b'name="language"\r\n\r\nen' in payload
    assert b'name="model"\r\n\r\nwhisper-large-v3-turbo' in payload
    assert b'verbose_json' in payload
    assert original in payload
    assert recording.name.encode() not in payload


@pytest.mark.parametrize(('status', 'code', 'transient'), [
    (401, 'PROVIDER_AUTH_FAILED', False),
    (403, 'PROVIDER_AUTH_FAILED', False),
    (429, 'PROVIDER_RATE_LIMITED', True),
    (500, 'PROVIDER_UNAVAILABLE', True),
    (503, 'PROVIDER_UNAVAILABLE', True),
])
def test_provider_http_errors_and_retry_after(provider, status, code, transient):
    url, state, captured = provider
    state.update(status=status, retry_after='73')
    with pytest.raises(ProviderError, match=code) as error:
        provider_json(url, b'{}', {}, 1000)
    assert error.value.transient == transient
    assert error.value.retry_after == (73 if transient else 0)
    assert len(captured) == 1


def test_provider_timeout_has_an_uncertain_outcome(provider):
    url, state, _ = provider
    state['pause'] = 0.2
    with pytest.raises(ProviderError, match='PROVIDER_TIMEOUT') as error:
        provider_json(url, b'{}', {}, 50)
    assert error.value.uncertain is True


@pytest.mark.parametrize(('payload', 'code'), [
    (b'invalid JSON', 'PROVIDER_MALFORMED_JSON'),
    (b'{"text":"   "}', 'STT_EMPTY_TRANSCRIPT'),
    (b'{"text":"Test","language":"uzbek"}', 'STT_LANGUAGE_MISMATCH'),
    (b'{"text":"Test","segments":[{"start":0,"end":8,"text":"Test"}]}', 'STT_RESPONSE_INVALID'),
])
def test_bad_transcript_preserves_audio(provider, recording, monkeypatch, payload, code):
    url, state, captured = provider
    set_groq(monkeypatch, url)
    original = recording.read_bytes()
    state['response'] = payload
    with pytest.raises(ProviderError, match=code):
        transcribe(recording, 'audio/wav')
    assert recording.read_bytes() == original
    assert len(captured) == 1


def test_invalid_audio_and_unapproved_plan_do_not_dispatch(provider, recording, monkeypatch):
    url, _, captured = provider
    set_groq(monkeypatch, url)
    with pytest.raises(ProviderError, match='STT_INPUT_INVALID'):
        transcribe(recording, 'audio/ogg')
    with pytest.raises(ProviderError, match='STT_AUDIO_DURATION_MISMATCH'):
        transcribe(recording, 'audio/wav', duration_ms=5000)
    monkeypatch.setenv('STT_BASE_URL', 'https://api.groq.com/openai/v1')
    monkeypatch.setenv('STT_GROQ_FREE_ACCOUNT_APPROVED', 'false')
    with pytest.raises(ProviderError, match='STT_PLAN_UNVERIFIED'):
        transcribe(recording, 'audio/wav')
    assert not captured


def test_groq_does_not_use_a_legacy_provider_key(provider, recording, monkeypatch):
    url, _, captured = provider
    set_groq(monkeypatch, url)
    monkeypatch.delenv('GROQ_API_KEY')
    monkeypatch.setenv('STT_API_KEY', 'unrelated-fixture')
    with pytest.raises(ProviderError, match='STT_NOT_CONFIGURED'):
        transcribe(recording, 'audio/wav')
    assert not captured
