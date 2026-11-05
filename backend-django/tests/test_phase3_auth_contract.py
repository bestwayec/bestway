from types import SimpleNamespace
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.core import lms_services
from common.auth.authentication import LegacyUser


def client(role):
    result = APIClient()
    if role:
        result.force_authenticate(LegacyUser('actor', 'Synthetic', '000000000', role, True))
    return result


def test_parent_invite_uses_authenticated_user_and_rejects_anonymous():
    with patch('apps.core.parent_views.get_or_create_parent_invite_code', return_value={'inviteCode': 'synthetic'}) as invite:
        assert client(None).get('/v1/parents/my-invite-code').status_code == 401
        assert client('teacher').get('/v1/parents/my-invite-code').status_code == 403
        response = client('student').get('/v1/parents/my-invite-code')
        assert response.status_code == 200
        invite.assert_called_once_with('actor', 'Synthetic')


@pytest.mark.parametrize('role,status', [(None, 401), ('student', 403), ('teacher', 200), ('admin', 200)])
def test_transcode_authorization(role, status):
    with patch('apps.core.lms_views.trigger_hls_transcoding', return_value={'status': 'processing'}) as transcode:
        response = client(role).post('/v1/lessons/lesson/hls/transcode', {}, format='json')
        assert response.status_code == status
        assert transcode.called == (status == 200)


def test_lesson_progress_uses_authenticated_identity():
    with patch('apps.core.lms_views.Lesson.objects.get', return_value=SimpleNamespace(id='lesson')), patch('apps.core.lms_views.get_or_create_progress', return_value=SimpleNamespace(watched_seconds=1, max_watched_seconds=1, is_completed=False, earned_xp=0)) as get_progress:
        assert client(None).get('/v1/lessons/lesson/progress').status_code == 401
        assert client('student').get('/v1/lessons/lesson/progress').status_code == 200
        assert get_progress.call_args.args[0].id == 'actor'


def test_progress_orm_uses_identifier_not_legacy_dataclass():
    with patch('apps.core.lms_services.UserLessonProgress.objects.get_or_create', return_value=(object(), True)) as query:
        lms_services.get_or_create_progress(LegacyUser('actor', 'n', 'p', 'student', True), SimpleNamespace())
        assert query.call_args.kwargs['user_id'] == 'actor'
        assert 'user' not in query.call_args.kwargs


def test_teacher_cohort_creation_rejects_unknown_identity():
    with patch('apps.core.teacher_views.User.objects.filter') as users, patch('apps.core.teacher_views.Cohort.objects.filter') as cohorts:
        users.return_value.exists.return_value = False
        cohorts.return_value.exists.return_value = False
        response = client('teacher').post('/v1/teacher/cohorts', {'name': 'Synthetic', 'invite_code': 'BW-0001'}, format='json')
        assert response.status_code == 401


@pytest.mark.parametrize('role', ['teacher', 'instructor'])
def test_other_teacher_or_instructor_cannot_view_or_assign_cohort(role):
    from apps.core import teacher_views
    cohort = SimpleNamespace(teacher_id='different-owner')
    with patch.object(teacher_views.Cohort.objects, 'select_related') as related:
        related.return_value.get.return_value = cohort
        assert client(role).get('/v1/teacher/cohorts/other/analytics').status_code == 403
    with patch.object(teacher_views.Cohort.objects, 'get', return_value=cohort):
        response = client(role).post('/v1/teacher/assignments', {'cohort_id': 'other', 'title': 'Synthetic'}, format='json')
        assert response.status_code == 403


def test_auth_helpers_share_the_same_user_contract():
    from apps.core import teacher_views, views
    user = LegacyUser('actor', 'Synthetic', '000000000', 'student', True)
    request = SimpleNamespace(user=user)
    assert views.require_authenticated(request) is user
    assert teacher_views.require_authenticated(request) is user


def test_battle_host_uses_legacy_user_identifier():
    from apps.core import vocab_battle
    words = [SimpleNamespace(english='cat', uzbek='mushuk'), SimpleNamespace(english='dog', uzbek='it')]
    vocab_set = SimpleNamespace(words=SimpleNamespace(all=lambda: words), title='Synthetic', level='B1')
    with patch.object(vocab_battle.VocabularySet.objects, 'prefetch_related') as sets, patch.object(vocab_battle.VocabBattleSession.objects, 'filter') as sessions, patch.object(vocab_battle.VocabBattleSession.objects, 'create') as create:
        sets.return_value.filter.return_value.first.return_value = vocab_set
        sessions.return_value.exists.return_value = False
        create.return_value = SimpleNamespace(id='battle', pin='123456', status='WAITING')
        vocab_battle.create_battle_session(LegacyUser('teacher-id', 'n', 'p', 'teacher', True), 'set')
        assert create.call_args.kwargs['host_id'] == 'teacher-id'


def test_authenticated_battle_creation_returns_201():
    with patch('apps.core.vocab_battle_views.create_battle_session', return_value={'sessionId': 'synthetic'}):
        assert client('teacher').post('/v1/vocabulary/battle/create', {'setId': 'set'}, format='json').status_code == 201
