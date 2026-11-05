from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.test import RequestFactory
from rest_framework.test import force_authenticate
from apps.core import cd_exam_views as cd


def user(role, uid='owner'):
    return SimpleNamespace(id=uid, role=role, is_authenticated=True)


def legacy(published=True):
    return SimpleNamespace(id='legacy', title='Synthetic', type='ielts_academic', is_published=published, created_by_id='owner')


@pytest.mark.parametrize('actor,published,access,allowed', [
    (None, False, 'granted', False),
    (None, True, 'granted', True),
    (None, True, 'locked', False),
    (user('student'), True, 'locked', False),
    (user('student'), True, 'granted', True),
    (user('teacher'), False, 'locked', True),
    (user('teacher', 'other'), False, 'granted', False),
    (user('admin'), False, 'locked', True),
])
def test_legacy_access_requires_publication_entitlement_or_owner(actor, published, access, allowed):
    with patch.object(cd.mock_catalog, 'access_for', return_value=access):
        assert cd._may_view_legacy(actor, legacy(published)) is allowed


def test_draft_cd_without_author_has_admin_only_preview():
    exam = SimpleNamespace(id='cd', code='CODE', is_published=False)
    with patch.object(cd.MockExam.objects, 'filter') as matches:
        matches.return_value.first.return_value = None
        assert not cd._may_view_cd(None, exam)
        assert not cd._may_view_cd(user('teacher'), exam)
        assert cd._may_view_cd(user('admin'), exam)


def test_cd_shadow_cannot_bypass_legacy_entitlement():
    exam = SimpleNamespace(id='cd', code='CODE', is_published=True)
    with patch.object(cd.MockExam.objects, 'filter') as matches, patch.object(cd.mock_catalog, 'access_for', return_value='locked'):
        matches.return_value.first.return_value = legacy()
        assert not cd._may_view_cd(user('student'), exam)


def test_legacy_question_serialization_never_uses_staff_shape():
    from django.http import JsonResponse
    with patch('apps.core.mock_catalog.shape_exam', return_value={'sections': [], 'id': 'x', 'title': 'x', 'type': 'ielts_academic'}) as shape:
        response = cd._serialize_legacy_mock_exam(legacy())
    assert isinstance(response, JsonResponse)
    assert shape.call_args.args[1] is False


def test_nested_answer_metadata_is_removed_without_changing_public_options():
    data = {'options': [{'label': 'A', 'isCorrect': True, 'nested': {'correct_answers': ['secret'], 'hint': 'public'}}], 'answerRule': 'ONE_WORD', 'answerKey': 'secret'}
    assert cd._without_answer_metadata(data) == {'options': [{'label': 'A', 'nested': {'hint': 'public'}}], 'answerRule': 'ONE_WORD'}


@pytest.mark.parametrize('actor,published,access,expected', [
    (None, False, 'granted', 404),
    (None, True, 'granted', 200),
    (user('student'), True, 'locked', 404),
    (user('student'), True, 'granted', 200),
    (user('teacher'), False, 'locked', 200),
    (user('teacher', 'other'), False, 'granted', 404),
    (user('admin'), False, 'locked', 200),
])
def test_legacy_session_http_authorization(actor, published, access, expected):
    from django.http import JsonResponse
    request = RequestFactory().get('/v1/exams/legacy/cd-session')
    if actor:
        force_authenticate(request, user=actor)
    with patch.object(cd.Exam.objects, 'filter') as exams, \
         patch.object(cd.MockExam.objects, 'filter') as legacy_exams, \
         patch.object(cd.mock_catalog, 'access_for', return_value=access), \
         patch.object(cd, '_serialize_legacy_mock_exam', return_value=JsonResponse({'ok': True})) as serialize:
        exams.return_value.first.return_value = None
        legacy_exams.return_value.first.return_value = legacy(published)
        response = cd.get_cd_exam_session(request, 'legacy')
    assert response.status_code == expected
    assert serialize.called is (expected == 200)
