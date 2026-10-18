"""Authoritative response windows for new/in-progress current-profile tasks."""
import hashlib
from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .mock_speaking_duration import POLICY, TOLERANCE_SECONDS, measure_duration
from .multilevel import CURRENT_SPEAKING_PROFILE, CURRENT_SPEC, task_guidance


def strict(attempt):
    return getattr(attempt, 'specification_version', None) == CURRENT_SPEC and getattr(attempt, 'speaking_profile_version', None) == CURRENT_SPEAKING_PROFILE


def expected(attempt, question):
    from apps.legacy_schema.models import MockQuestion, MockQuestionGroup

    from .mock_attempts import fail
    groups = list(MockQuestionGroup.objects.filter(section__exam_id=attempt.exam_id, section__skill='speaking').order_by('sort_order'))
    index = next((i for i, group in enumerate(groups) if group.id == question.group_id), -1)
    questions = list(MockQuestion.objects.filter(group_id=question.group_id).order_by('sort_order'))
    qi = next((i for i, item in enumerate(questions) if item.id == question.id), -1)
    guidance = task_guidance('speaking', index, qi, attempt.speaking_profile_version, attempt.specification_version) if index >= 0 and qi >= 0 else None
    seconds = (guidance or {}).get('responseSeconds')
    if seconds not in (30, 45, 120):
        fail('MEDIA_DURATION_REQUIRED', 'The speaking response timing is unavailable')
    return seconds


def phase_window(attempt, question_id, seconds, *, at=None):
    from .mock_attempts import aware, fail
    at = at or timezone.now()
    phase = (attempt.media_state or {}).get(question_id)
    try:
        prep = aware(parse_datetime(phase['prepEndsAt']))
        end = aware(parse_datetime(phase['expiresAt']))
        if not prep or not end or (end - prep).total_seconds() != seconds:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        fail('RECORDING_NOT_STARTED', 'Start the speaking task first')
    if at < prep:
        fail('SPEAKING_PREPARATION_ACTIVE', 'Wait for the speaking preparation to finish')
    if at < end:
        fail('SPEAKING_RESPONSE_ACTIVE', 'Finish the complete speaking response window before uploading')
    if at > end + timedelta(minutes=5):
        fail('UPLOAD_WINDOW_EXPIRED', 'The recording upload recovery window has expired')
    return dict(phase)


def audio_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_stored(attempt, question, key, *, submission=False):
    from .mock_attempts import fail
    from .mock_media import resolve_key
    seconds = expected(attempt, question)
    if submission:
        # A valid acknowledged recording remains usable after the upload
        # recovery window; submission can happen later than its individual task.
        phase = (attempt.media_state or {}).get(question.id) or {}
        try:
            prep, end = parse_datetime(phase['prepEndsAt']), parse_datetime(phase['expiresAt'])
            if not prep or not end or (end-prep).total_seconds() != seconds or timezone.now() < end:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            fail('SPEAKING_RESPONSE_INCOMPLETE', 'Complete the full speaking task before submitting')
    else:
        phase = phase_window(attempt, question.id, seconds)
    path = resolve_key(key)
    try:
        checksum = audio_hash(path)
    except OSError:
        fail('SPEAKING_RESPONSE_INCOMPLETE', 'The saved recording is unavailable')
    valid = phase.get('timingPolicy') == POLICY and phase.get('durationVerifiedKey') == key and phase.get('durationVerifiedHash') == checksum
    duration = phase.get('audioDurationMs')
    if not valid or type(duration) not in (int, float) or abs(duration/1000-seconds) > TOLERANCE_SECONDS:
        duration = measure_duration(path, seconds)
    phase.update(timingPolicy=POLICY, responseSeconds=seconds, minDurationMs=round((seconds-TOLERANCE_SECONDS)*1000),
        maxDurationMs=round((seconds+TOLERANCE_SECONDS)*1000), audioDurationMs=duration,
        durationVerifiedKey=key, durationVerifiedHash=checksum)
    state = dict(attempt.media_state or {})
    state[question.id] = phase
    attempt.media_state = state
    attempt.save(update_fields=['media_state'])
    return duration


def assert_submission(attempt, sections, answers):
    from apps.legacy_schema.models import MockQuestion

    from .mock_attempts import fail
    if not strict(attempt):
        return
    ids = [q['id'] for section in sections if section['skill'] == 'speaking' for group in section['groups'] for q in group['questions']]
    for question in MockQuestion.objects.filter(id__in=ids):
        key = answers.get(question.id, {}).get('audioKey')
        if not key:
            fail('SPEAKING_RESPONSE_INCOMPLETE', 'Record each complete speaking response before submitting')
        verify_stored(attempt, question, key, submission=True)
