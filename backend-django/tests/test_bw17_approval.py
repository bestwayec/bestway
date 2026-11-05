from types import SimpleNamespace
from unittest.mock import patch

import pytest
from apps.core import assessment


@pytest.mark.parametrize('policy,confidence,teacher_touched,expected', [
    ('PRACTICE_AUTO_AI', 0.99, False, True),
    ('PRACTICE_AUTO_AI', 0.01, False, False),
    ('FULL_MOCK_AI_WITH_REVIEW', 0.99, False, False),
    ('MANUAL_ONLY', 0.99, False, False),
    ('PRACTICE_AUTO_AI', 0.99, True, False),
])
def test_only_approved_auto_policy_projects_answers(policy, confidence, teacher_touched, expected):
    job = SimpleNamespace(attempt_id='attempt', input_snapshot={'parts': [{'responses': [{'questionId': 'q'}]}]}, policy_mode=policy)
    current = SimpleNamespace(id='job', skill='writing', input_snapshot=job.input_snapshot, final_score_source=None)
    result = {'confidence': confidence}
    with patch.object(assessment.MockAttempt.objects, 'select_for_update') as attempts, \
         patch.object(assessment, 'require_lease', return_value=current), \
         patch.object(assessment.results, 'score', return_value={'score': 5}), \
         patch.object(assessment.MockAnswer.objects, 'filter') as answers, \
         patch.object(assessment, 'project') as project, \
         patch.object(assessment, 'update') as update, \
         patch('apps.core.mock_grading.recompute') as recompute:
        attempts.return_value.get.return_value = SimpleNamespace(status='grading')
        answers.return_value.exists.return_value = teacher_touched
        assessment.finish.__wrapped__(job, result, 'evaluation', False)
    assert project.called is expected
    assert recompute.called is expected
    values = update.call_args.kwargs
    assert values['status'] == ('SUCCEEDED' if expected else 'NEEDS_REVIEW')
    assert values['ai_score'] == 5
    assert ('final_score' in values) is expected
    assert ('approved_feedback' in values) is expected
    assert ('final_result' in values) is expected


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
