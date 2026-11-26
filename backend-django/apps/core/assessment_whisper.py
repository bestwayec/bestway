"""Bounded multipart transcription with the existing provider HTTP transport."""
import math
import os
from urllib.parse import urlsplit
from uuid import uuid4

from .assessment_provider_policy import authorize_remote, enabled, is_loopback, request_remote
from .assessment_results import ProviderError
from .mock_audio_probe import inspect_audio

GROQ_MODEL = 'whisper-large-v3-turbo'
MODELS = {GROQ_MODEL, 'whisper-large-v3'}
FORMATS = {
    'audio/webm': ('webm', {'matroska', 'webm'}),
    'audio/ogg': ('ogg', {'ogg'}),
    'audio/wav': ('wav', {'wav'}),
    'audio/x-wav': ('wav', {'wav'}),
    'audio/mpeg': ('mp3', {'mp3'}),
    'audio/mp4': ('m4a', {'mp4', 'm4a'}),
    'audio/x-m4a': ('m4a', {'mp4', 'm4a'}),
}
MAX_AUDIO_BYTES = 25 * 1024 * 1024


def _timestamp(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def parse_transcript(output, model, duration, language):
    if not isinstance(output, dict):
        raise ProviderError('STT_RESPONSE_INVALID')
    text = output.get('text')
    if isinstance(text, str) and not text.strip():
        raise ProviderError('STT_EMPTY_TRANSCRIPT')
    if not isinstance(text, str) or len(text) > 100000:
        raise ProviderError('STT_RESPONSE_INVALID')
    detected = output.get('language')
    if detected and (not isinstance(detected, str) or detected.lower() not in {language, 'english'}):
        raise ProviderError('STT_LANGUAGE_MISMATCH')
    segments = output.get('segments') or []
    if not isinstance(segments, list) or len(segments) > 2000:
        raise ProviderError('STT_RESPONSE_INVALID')
    verified = []
    last_end = 0
    for segment in segments:
        if not isinstance(segment, dict):
            raise ProviderError('STT_RESPONSE_INVALID')
        start, end, words = segment.get('start'), segment.get('end'), segment.get('text')
        if not _timestamp(start) or not _timestamp(end) or not last_end <= start <= end <= duration + 1:
            raise ProviderError('STT_RESPONSE_INVALID')
        if not isinstance(words, str) or len(words) > 4000:
            raise ProviderError('STT_RESPONSE_INVALID')
        if words.strip():
            verified.append(dict(start=start, end=end, text=words, confidence=None))
        last_end = end
    return dict(text=text, segments=verified, confidence=None, provider='groq', model=model,
        language=language, durationMs=round(duration * 1000), pronunciationEvidence='UNAVAILABLE')


def transcribe(path, mime, language, duration_ms, *, transport, timeout):
    key = os.environ.get('GROQ_API_KEY', '').strip()
    if not key:
        raise ProviderError('STT_NOT_CONFIGURED')
    model = os.environ.get('STT_MODEL', GROQ_MODEL).strip() or GROQ_MODEL
    if model not in MODELS:
        raise ProviderError('STT_MODEL_UNAPPROVED')
    base = os.environ.get('STT_BASE_URL') or 'https://api.groq.com/openai/v1'
    from .assessment_providers import provider_url

    url = provider_url(base, 'audio/transcriptions')
    if not is_loopback(url):
        if urlsplit(url).hostname != 'api.groq.com' or not enabled('STT_GROQ_FREE_ACCOUNT_APPROVED'):
            raise ProviderError('STT_PLAN_UNVERIFIED')
        if not enabled('ASSESSMENT_EXTERNAL_AI_ALLOWED'):
            raise ProviderError('ASSESSMENT_EXTERNAL_AI_DISABLED')
    mime = mime.lower().split(';', 1)[0].strip()
    if mime not in FORMATS or language != 'en':
        raise ProviderError('STT_INPUT_INVALID')
    extension, containers = FORMATS[mime]
    try:
        if not path.is_file() or not 0 < path.stat().st_size <= MAX_AUDIO_BYTES:
            raise ProviderError('STT_INPUT_INVALID')
        media = inspect_audio(path)
        if not media or not media['decodable'] or not set(media['container'].split(',')) & containers:
            raise ProviderError('STT_INPUT_INVALID')
        duration = media['duration']
        if not 0 < duration <= 600:
            raise ProviderError('STT_INPUT_INVALID')
        if duration_ms and abs(duration - duration_ms / 1000) > 2:
            raise ProviderError('STT_AUDIO_DURATION_MISMATCH')
        with path.open('rb') as source:
            audio = source.read(MAX_AUDIO_BYTES + 1)
        if not 0 < len(audio) <= MAX_AUDIO_BYTES:
            raise ProviderError('STT_INPUT_INVALID')
    except OSError:
        raise ProviderError('STT_AUDIO_UNAVAILABLE') from None
    boundary = uuid4().hex
    fields = b''.join(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in [('model', model), ('language', language), ('response_format', 'verbose_json'),
                            ('timestamp_granularities[]', 'segment'), ('temperature', '0')]
    )
    file_header = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="response.{extension}"\r\n'
        f'Content-Type: {mime}\r\n\r\n'
    ).encode()
    body = fields + file_header + audio + f'\r\n--{boundary}--\r\n'.encode()
    authorize_remote(url, 'groq', model)
    output = request_remote(transport, url, body,
        {'Authorization': f'Bearer {key}', 'Content-Type': f'multipart/form-data; boundary={boundary}'}, timeout, 'groq')
    return parse_transcript(output, model, duration, language)
