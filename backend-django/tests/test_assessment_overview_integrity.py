"""The overview must not invent assessment evidence or promote stale results."""
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core import assessment


def job(skill='speaking', status='SUCCEEDED', **overrides):
    response = dict(questionId='q1', partNumber=1, prompt='Prompt', originalResponse='Essay or old response',
                    audioHash='current-hash', audioKey='audio.webm')
    values = dict(id=skill, skill=skill, program='IELTS', status=status, policy_mode='PRACTICE_AI_AUTO',
        version=1, ai_score=7, teacher_score=None, final_score=7, final_score_source='AI', confidence=None,
        rubric_version='V1', prompt_version='V1', failure_code=None, final_result=None,
        approved_feedback={'parts': []}, selected_evaluation_id=None,
        input_snapshot={'parts': [dict(id='p1', max=9, task='Task', context='', responses=[response])]})
    values.update(overrides)
    return SimpleNamespace(**values)


def transcript(audio_hash='current-hash', text='Verified words', confidence=None, diagnostics='UNAVAILABLE'):
    return SimpleNamespace(question_id='q1', audio_hash=audio_hash, text=text, confidence=confidence,
                           segments=[], pronunciation_evidence=diagnostics)


class AssessmentOverviewIntegrityTests(SimpleTestCase):
    def overview(self, jobs, transcripts=(), reviewed=(), overall=None):
        attempt = SimpleNamespace(student_id='s1', status='completed', overall_band=overall,
            media_state={'transcripts': {'q1': 'unverified'}, 'speech_diagnostics': {'q1': {'fluency_score': 10}}})
        answer = SimpleNamespace(question_id='q1', response='unverified answer', score=None, graded_by_id=None,
            feedback=None, rubric_scores={'transcript': 'unverified answer', 'speech_diagnostics': {'fluency_score': 10}})
        with ExitStack() as stack:
            stack.enter_context(patch.object(assessment, 'assert_can_view'))
            att = stack.enter_context(patch.object(assessment.MockAttempt.objects, 'filter'))
            att.return_value.select_related.return_value.first.return_value = attempt
            stack.enter_context(patch.object(assessment.MockAnswer.objects, 'filter', return_value=[answer]))
            js = stack.enter_context(patch.object(assessment.AssessmentJob.objects, 'filter'))
            js.return_value.order_by.return_value = jobs
            ev = stack.enter_context(patch.object(assessment.AssessmentEvaluation.objects, 'filter'))
            ev.return_value.order_by.return_value = []
            ts = stack.enter_context(patch.object(assessment.SpeechTranscript.objects, 'filter'))
            ts.return_value.order_by.return_value = list(transcripts)
            audit = stack.enter_context(patch.object(assessment.AuditLog.objects, 'filter'))
            audit.return_value.values_list.return_value = list(reviewed)
            return assessment.for_attempt(SimpleNamespace(role='teacher'), 'attempt')

    def test_wrong_hash_missing_hash_and_blank_transcript_are_not_presented(self):
        for speech, records in [(job(), [transcript(audio_hash='old-hash')]),
                                (job(), [transcript(text='  ')]),
                                (job(), [])]:
            with self.subTest(records=records):
                result = self.overview([speech], records)
                submission = result['assessments'][0]['submissions'][0]
                self.assertIsNone(submission['transcript'])
                self.assertIsNone(submission['speechDiagnostics'])
                self.assertEqual(result['assessments'][0]['speechDiagnostics'], {})
        speech = job()
        speech.input_snapshot['parts'][0]['responses'][0].pop('audioHash')
        self.assertIsNone(self.overview([speech], [transcript()])['assessments'][0]['submissions'][0]['transcript'])

    def test_matching_transcript_does_not_claim_legacy_diagnostics_are_acoustic(self):
        data = self.overview([job()], [transcript(confidence=None, diagnostics='{"mispronounced_words": [{"word": "test"}]}')])
        submission = data['assessments'][0]['submissions'][0]
        self.assertEqual(submission['transcript']['text'], 'Verified words')
        self.assertIsNone(submission['transcript']['confidence'])
        self.assertIsNone(submission['speechDiagnostics'])
        self.assertEqual(submission['transcript']['pronunciationEvidence'], 'UNAVAILABLE')

    def test_writing_response_is_not_a_speech_transcript(self):
        submission = self.overview([job(skill='writing')], [transcript()])['assessments'][0]['submissions'][0]
        self.assertIsNone(submission['transcript'])
        self.assertEqual(submission['originalResponse'], 'Essay or old response')

    def test_no_fabricated_overall_criteria_or_confidence(self):
        data = self.overview([job()])
        self.assertIsNone(data['overall_band'])
        self.assertIsNone(data['confidence'])
        self.assertEqual(data['criteria_scores'], {})
        self.assertFalse(data['teacher_confirmed'])
        self.assertTrue(data['provisional'])
        self.assertFalse(data['assessments'][0]['teacherReviewed'])

    def test_teacher_acceptance_is_verified_by_audit(self):
        data = self.overview([job()], reviewed=['speaking'])
        self.assertTrue(data['teacher_confirmed'])
        self.assertTrue(data['assessments'][0]['teacherReviewed'])
        self.assertFalse(data['provisional'])

    def test_latest_failed_or_review_results_do_not_become_completed(self):
        for status, expected in [('NEEDS_REVIEW', 'needs_review'), ('FAILED', 'failed'), ('PENDING', 'grading')]:
            with self.subTest(status=status):
                data = self.overview([job(status=status), job()], overall=8)
                self.assertEqual(data['status'], expected)
                self.assertIsNone(data['overall_band'])

    def test_mixed_skills_require_all_reviews_and_success(self):
        data = self.overview([job(), job(skill='writing', status='NEEDS_REVIEW')], reviewed=['speaking'], overall=7)
        self.assertEqual(data['status'], 'needs_review')
        self.assertFalse(data['teacher_confirmed'])
        self.assertIsNone(data['overall_band'])


class ManualGradeBoundaryTests(SimpleTestCase):
    def setUp(self):
        self.teacher = SimpleNamespace(id='teacher', role='teacher', name='Teacher')
        self.attempt = SimpleNamespace(status='grading', exam=SimpleNamespace(type='ielts'),
            student=SimpleNamespace(group=SimpleNamespace(teacher_id='teacher')))

    def grade_error(self, payload):
        from common.api.exceptions import ContractAPIException
        with patch.object(assessment.MockAttempt.objects, 'filter') as attempts:
            attempts.return_value.select_related.return_value.select_for_update.return_value.first.return_value = self.attempt
            with self.assertRaises(ContractAPIException) as error:
                assessment.teacher_grade_attempt.__wrapped__(self.teacher, 'attempt', payload)
        return error.exception

    def test_unassigned_or_unowned_group_cannot_grade(self):
        for group in (None, SimpleNamespace(teacher_id=None), SimpleNamespace(teacher_id='other')):
            with self.subTest(group=group):
                self.attempt.student.group = group
                self.assertEqual(self.grade_error({'final_score': 5}).status_code, 403)

    def test_unsubmitted_attempt_cannot_be_manually_graded(self):
        self.attempt.status = 'in_progress'
        self.assertEqual(self.grade_error({'final_score': 5}).status_code, 409)

    def test_invalid_nonfinite_and_out_of_range_scores_are_rejected(self):
        for value in ('garbage', 'NaN', 'Infinity', -1, 9.1, True):
            with self.subTest(value=value):
                self.assertEqual(self.grade_error({'final_score': value}).status_code, 400)
        self.attempt.exam.type = 'multilevel'
        self.assertEqual(self.grade_error({'speaking_score': 75.1}).status_code, 400)


class SpeechConfidencePolicyTests(SimpleTestCase):
    def verified(self, records, audio_hash='current-hash'):
        from apps.core.assessment_quality import EVIDENCE_POLICY
        current = job()
        current.input_snapshot['evaluationPolicy'] = EVIDENCE_POLICY
        current.input_snapshot['parts'][0]['responses'][0]['audioHash'] = audio_hash
        with patch.object(assessment.SpeechTranscript.objects, 'filter') as query:
            query.return_value.order_by.return_value = records
            return assessment.speech_confidence_verified(current)

    def test_missing_mismatched_or_low_confidence_requires_review(self):
        with patch.object(assessment, 'threshold', return_value=.70):
            for records in ([], [transcript(confidence=None)], [transcript(confidence=.69)],
                            [transcript(audio_hash='old-hash', confidence=.99)]):
                with self.subTest(records=records):
                    self.assertFalse(self.verified(records))
            self.assertFalse(self.verified([transcript(confidence=.99)], audio_hash=''))
            self.assertTrue(self.verified([transcript(confidence=.85)]))
