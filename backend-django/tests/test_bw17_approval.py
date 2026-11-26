from types import SimpleNamespace
from unittest.mock import patch

import pytest
from apps.core import assessment


@pytest.mark.parametrize('policy', ['PRACTICE_AUTO_AI', 'FULL_MOCK_AI_WITH_REVIEW', 'MANUAL_ONLY'])
@pytest.mark.parametrize('source', [None, 'TEACHER'])
def test_ai_never_projects_answers_and_preserves_teacher_finalization(policy, source):
    snapshot = {'parts': [{'responses': [{'questionId': 'q'}]}]}
    job = SimpleNamespace(attempt_id='attempt', input_snapshot=snapshot, policy_mode=policy)
    current = SimpleNamespace(id='job', skill='writing', input_snapshot=snapshot, final_score_source=source)
    with patch.object(assessment.MockAttempt.objects, 'select_for_update'), \
         patch.object(assessment, 'require_lease', return_value=current), \
         patch.object(assessment.results, 'score', return_value={'score': 5}), \
         patch.object(assessment, 'project') as project, \
         patch.object(assessment, 'update') as update, \
         patch('apps.core.mock_grading.recompute') as recompute:
        assessment.finish.__wrapped__(job, {'confidence': .99}, 'evaluation', False)
    project.assert_not_called()
    recompute.assert_not_called()
    values = update.call_args.kwargs
    assert values['status'] == ('SUCCEEDED' if source == 'TEACHER' else 'NEEDS_REVIEW')
    assert values['ai_score'] == 5
    assert not {'final_score', 'approved_feedback', 'final_result'} & values.keys()


@pytest.mark.parametrize('status,score', [('NEEDS_REVIEW', None), ('PENDING', None), ('FAILED', None), ('SUCCEEDED', None)])
def test_certificate_denied_when_latest_assessment_unapproved(status, score):
    from apps.core import mock_support
    from common.api.exceptions import ContractAPIException
    attempt = SimpleNamespace(id='a', student_id='s', status='completed', flow_mode='partial_practice', media_state={})
    job = SimpleNamespace(skill='speaking', status=status, final_score=score)
    with patch.object(mock_support.MockAttempt.objects, 'select_related') as attempts, \
         patch.object(mock_support, 'assert_view'), \
         patch.object(mock_support.AssessmentJob.objects, 'filter') as jobs:
        attempts.return_value.filter.return_value.first.return_value = attempt
        jobs.return_value.order_by.return_value = [job]
        with pytest.raises(ContractAPIException) as error:
            mock_support.certificate_data(SimpleNamespace(id='s', role='student'), 'a')
    assert error.value.contract_code == 'ASSESSMENT_NEEDS_REVIEW'
