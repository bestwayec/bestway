"""Listening audio must be served to a Listening practice (it was refused for every partial attempt)."""
from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.core import mock_media
from apps.core.mock_practice import SCOPE_KEY
from common.api.exceptions import ContractAPIException

ACTOR = SimpleNamespace(id='student-1')


def scope(skills):
    return {SCOPE_KEY: {'version': 1, 'skills': skills, 'questionIds': []}}


def attempt(skills, *, mode='practice', media_state=None):
    state = {**scope(skills), **(media_state or {})}
    return SimpleNamespace(
        id='attempt-1', student_id=ACTOR.id, flow_mode='single_skill', mode=mode, status='in_progress',
        media_state=state, overall_deadline_at=None, deadline_at=None, section_deadlines={},
        current_skill='listening', exam_id='exam-1', specification_version='UZBMB_MULTILEVEL_EN_2026_V1',
        audio_plays={},
    )


def gate(row, group_id='grp-l1'):
    group = SimpleNamespace(section=SimpleNamespace(skill='listening', exam_id='exam-1'), audio_key='a.wav', audio_play_limit=2)
    with patch.object(mock_media.MockAttempt.objects, 'select_for_update') as locked, \
            patch.object(mock_media.MockQuestionGroup.objects, 'select_related') as groups, \
            patch.object(mock_media, 'SPECS', {row.specification_version}):
        locked.return_value.filter.return_value.first.return_value = row
        groups.return_value.filter.return_value.first.return_value = group
        mock_media.record_audio_access(ACTOR, row.id, group_id)


@pytest.mark.django_db
def test_listening_practice_may_load_audio():
    gate(attempt(['listening']))  # does not raise


@pytest.mark.django_db
@pytest.mark.parametrize('skills', [['writing'], ['speaking'], ['reading'], ['writing', 'speaking']])
def test_practice_of_other_skills_is_refused(skills):
    with pytest.raises(ContractAPIException) as caught:
        gate(attempt(skills))
    assert caught.value.contract_code == 'QUESTION_NOT_IN_EXAM'


@pytest.mark.django_db
def test_timed_listening_practice_needs_a_granted_play():
    row = attempt(['listening'], mode='timed')
    with pytest.raises(ContractAPIException) as caught:
        gate(row)
    assert caught.value.contract_code == 'AUDIO_REPLAY_BLOCKED'
    expires = (timezone.now() + timedelta(seconds=300)).isoformat()
    row.media_state['grp-l1'] = {'plays': 1, 'expiresAt': expires}
    gate(row)  # granted play inside its window: served


@pytest.mark.django_db
def test_timed_listening_practice_refuses_after_the_play_window():
    row = attempt(['listening'], mode='timed', media_state={'grp-l1': {'plays': 1, 'expiresAt': (timezone.now() - timedelta(seconds=1)).isoformat()}})
    with pytest.raises(ContractAPIException) as caught:
        gate(row)
    assert caught.value.contract_code == 'AUDIO_REPLAY_BLOCKED'


def test_importer_reports_placeholder_listening_audio(tmp_path):
    import wave
    from apps.core import record_mock_1_content as content

    def tone(path, seconds):
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), 'wb') as handle:
            handle.setnchannels(1); handle.setsampwidth(2); handle.setframerate(8000)
            handle.writeframes(b'\x00\x00' * int(8000 * seconds))

    for index, (src, _) in enumerate(content.REQUIRED_MEDIA):
        if src.endswith('.wav'):
            tone(tmp_path / src, 90 if index == 0 else 3)
    short = dict(content.placeholder_audio(tmp_path))
    assert 'exams/record_mock_1/record_mock1_audio_part_1.wav' not in short
    assert len(short) == 5 and all(seconds == 3 for seconds in short.values())
