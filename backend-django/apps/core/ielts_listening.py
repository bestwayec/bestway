"""Server schedule of one IELTS Listening part in the timed exam (recordings play once).

Pressing Play records when the part started: first the reading time for the questions, then
the recording. The schedule is stored once on the attempt (``media_state['listening:<group>']``)
and never restarted, so a reload or a lost connection resumes the recording at the point the
server clock has reached instead of replaying it or locking it. While that window is open the
audio can be fetched again (the device may have lost its copy); after it closes, never again.
Older clients that never call start keep the previous play-count rule.
"""
from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from . import mock_attempts as engine
from .exam_blueprint import blueprint
from apps.legacy_schema.models import MockQuestionGroup

KEY_PREFIX = 'listening:'
# A recording may start a little late (buffering): keep the audio reachable this long after its end.
GRACE_SECONDS = 120


def reading_seconds(exam_type: str) -> int:
    section = next((s for s in (blueprint(exam_type) or {}).get('sections', []) if s['skill'] == 'listening'), {})
    return int(section.get('previewSeconds') or 0)


def state_key(group_id: str) -> str:
    return KEY_PREFIX + group_id


def started_parts(attempt) -> dict:
    """Schedules already recorded on the attempt, by group id (for the runner on reload)."""
    state = attempt.media_state if isinstance(attempt.media_state, dict) else {}
    return {key[len(KEY_PREFIX):]: value for key, value in state.items() if key.startswith(KEY_PREFIX) and isinstance(value, dict)}


def start(actor, attempt_id: str, group_id: str) -> dict:
    with transaction.atomic():
        attempt = engine.own(actor, attempt_id, lock=True)
        engine.assert_in_progress(attempt)
        engine.assert_time(attempt)
        if attempt.mode != 'timed' or engine.versioned(attempt):
            engine.fail('LISTENING_SCHEDULE_NOT_USED', 'Only the timed IELTS exam uses the Listening schedule', 400)
        group = MockQuestionGroup.objects.select_related('section').filter(id=group_id).first()
        if group is None or group.section.exam_id != attempt.exam_id or group.section.skill != 'listening' or not group.audio_key:
            engine.fail('QUESTION_NOT_IN_EXAM', 'Listening part not in this exam', 403)
        if attempt.flow_mode == 'full_test' and attempt.current_skill != 'listening':
            engine.fail('SECTION_LOCKED', 'Listening section is locked', 403)
        state = dict(attempt.media_state or {})
        key = state_key(group_id)
        if key not in state:  # once only: a second start returns the first schedule
            now = timezone.now()
            reading = reading_seconds(attempt.exam.type)
            state[key] = dict(startedAt=engine.iso(now), readingEndsAt=engine.iso(now + timedelta(seconds=reading)),
                              readingSeconds=reading, durationSec=group.audio_duration_sec)
            attempt.media_state = state
            attempt.save(update_fields=['media_state'])
        return dict(state[key], serverTime=engine.iso(timezone.now()))


def access_window_open(attempt, group) -> bool | None:
    """True/False when the part was started with the schedule; None for clients that never started it."""
    schedule = started_parts(attempt).get(group.id)
    if schedule is None:
        return None
    reading_end = engine.aware(parse_datetime(schedule['readingEndsAt']))
    duration = schedule.get('durationSec') or group.audio_duration_sec
    if duration:
        closes = reading_end + timedelta(seconds=duration + GRACE_SECONDS)
    else:  # length unknown: until the Listening time is over
        raw = (attempt.section_deadlines or {}).get('listening')
        closes = engine.aware(parse_datetime(raw)) if raw else engine.aware(attempt.overall_deadline_at or attempt.deadline_at)
    return closes is None or timezone.now() <= closes
