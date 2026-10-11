"""Teacher results stay consistent without inventing provider scores."""
import copy
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch
from django.test import SimpleTestCase
from rest_framework.test import APIClient
from apps.core import assessment, assessment_results, mock_grading, mock_scoring
from apps.core.mock_submission_snapshots import build_input, blueprint_failure
from apps.core.multilevel import CURRENT_SPEC, task_guidance
from apps.core.mock_practice import SCOPE_KEY, scope_sections


def part(skill, identifier, score=None):
    return dict(skill=skill,groups=[dict(id=identifier,maxScore=5,partNumber=1,title='Real task',
        instructions='',passageText='',contentHtml='',questions=[dict(id=identifier,type='essay_task1' if skill=='writing' else 'speaking_task',points=5,prompt='Describe your work')])])


class TeacherProjectionTests(SimpleTestCase):
    def recompute(self, sections, answers, **fields):
        attempt=SimpleNamespace(id='a',exam=SimpleNamespace(type='multilevel'),specification_version=CURRENT_SPEC,
            flow_mode='single_skill',status='grading',**fields)
        with patch.object(mock_grading.MockAttempt,'objects') as attempts,patch.object(mock_grading.MockAnswer,'objects') as rows,\
                patch.object(mock_grading,'shape_exam',return_value=dict(sections=sections)),\
                patch.object(mock_grading,'band_tables',return_value={}),patch.object(mock_grading,'save_projection') as save,\
                patch.object(mock_grading,'annotate_practice_grades',side_effect=lambda attempt,result:result),\
                patch('apps.core.mock_submission_snapshots.notify'):
            attempts.select_related.return_value.filter.return_value.first.return_value=attempt
            rows.filter.return_value=[SimpleNamespace(question_id=q,response='Original response',is_graded=True,score=s) for q,s in answers.items()]
            result=mock_grading.recompute('a')
            save.assert_called_once_with(attempt,result)
            return result

    def test_pending_writing_does_not_hide_completed_speaking(self):
        result=self.recompute([part('writing','w'),part('speaking','s')],dict(s=4))
        self.assertEqual(result['status'],'grading')
        self.assertNotIn('writing',result['standardScores'])
        self.assertEqual(result['standardScores']['speaking']['rawScore'],4)
        self.assertIsNone(result['overallScore'])

    def test_pending_speaking_keeps_completed_writing(self):
        result=self.recompute([part('speaking','s'),part('writing','w')],dict(w=4))
        self.assertEqual(result['standardScores']['writing']['rawScore'],4)
        self.assertNotIn('speaking',result['standardScores'])

    def test_teacher_recompute_retains_legacy_multilevel_cefr(self):
        sections=[part('writing','w')]
        attempt=SimpleNamespace(id='a',exam=SimpleNamespace(type='multilevel'),specification_version=None,
            flow_mode='single_skill',status='grading')
        answer=SimpleNamespace(question_id='w',response='Original response',is_graded=True,score=4)
        with patch.object(mock_grading.MockAttempt,'objects') as attempts,patch.object(mock_grading.MockAnswer,'objects') as rows,\
                patch.object(mock_grading,'shape_exam',return_value=dict(sections=sections)),\
                patch.object(mock_grading,'band_tables',return_value={}),patch.object(mock_grading,'save_projection'),\
                patch.object(mock_grading,'annotate_practice_grades',side_effect=lambda attempt,result:result),\
                patch('apps.core.mock_submission_snapshots.notify'):
            attempts.select_related.return_value.filter.return_value.first.return_value=attempt
            rows.filter.return_value=[answer]
            result=mock_grading.recompute('a')
        self.assertEqual(result['cefrLevel'],'B2')

    def test_partial_raw_scores_never_receive_overall_or_standardized_result(self):
        original=dict(status='completed',rawScores=dict(writing=dict(score=12,max=16)),standardScores=dict(writing={}),overallScore=75,overallBand=9,cefrLevel='C1')
        result=mock_scoring.partial_result(original)
        self.assertEqual(result['rawScores'],original['rawScores'])
        self.assertEqual(result['standardScores'],{})
        self.assertIsNone(result['overallScore']);self.assertIsNone(result['cefrLevel'])
        self.assertEqual(result['scoreMethod'],'PRACTICE_PARTIAL')
        self.assertEqual(original['cefrLevel'],'C1')


class ManualAssessmentTests(SimpleTestCase):
    def test_unversioned_historical_multilevel_is_not_reinterpreted_as_current_rubric(self):
        job=SimpleNamespace(input_snapshot=dict(program='MULTILEVEL',specificationVersion=None,
            parts=[dict(responses=[dict(questionId='legacy-q')])]))
        with patch.object(assessment.AssessmentJob,'objects') as jobs,patch.object(assessment.MockAnswer,'objects') as answers:
            jobs.filter.return_value.order_by.return_value=[job]
            assessment.record_legacy_grade('legacy-attempt','legacy-q')
            answers.filter.assert_not_called()

    def test_partial_holistic_speaking_scores_only_one_part_for_three_recordings(self):
        input=dict(program='MULTILEVEL',skill='speaking',practiceMode='PARTIAL',parts=[dict(id='1.1',max=5)])
        base=assessment_results.empty(input)
        result=assessment_results.teacher_result(input,base,[dict(id='1.1',rawScore=4.5)])
        score=assessment_results.score(input,result)
        self.assertEqual(score['score'],4.5);self.assertEqual(score['rawTotal'],4.5)
        self.assertIsNone(score['level'])
        self.assertEqual(result['parts'][0]['criteria'],{})

    def test_manual_feedback_edit_preserves_unscored_ai_criteria(self):
        input=dict(program='MULTILEVEL',skill='writing',practiceMode='PARTIAL',parts=[dict(id='informal_email',max=5)])
        base=assessment_results.teacher_result(input,assessment_results.empty(input),[dict(id='informal_email',rawScore=4)])
        edited=copy.deepcopy(base);edited['parts'][0]['feedback']['grammar']='Use the past tense consistently.'
        edited['priorityImprovements']=['Check verb agreement.']
        approved=assessment_results.feedback_edit(edited,base)
        self.assertTrue(assessment.feedback_only(approved,base))
        self.assertEqual(approved['parts'][0]['criteria'],{})
        edited['parts'][0]['rawScore']=5
        self.assertFalse(assessment.feedback_only(assessment_results.feedback_edit(edited,base),base))

    def test_feedback_edit_rejects_unknown_parts_and_nontext_feedback(self):
        input=dict(program='MULTILEVEL',skill='writing',parts=[dict(id='task',max=5)])
        base=assessment_results.empty(input)
        for modification in ('unknown','nontext','extra'):
            edited=copy.deepcopy(base)
            if modification=='unknown':edited['parts'][0]['id']='other'
            elif modification=='nontext':edited['parts'][0]['feedback']['grammar']=False
            else:edited['parts'][0]['feedback']['unexpected']='x'
            with self.subTest(modification=modification),self.assertRaises(assessment_results.ProviderError):
                assessment_results.feedback_edit(edited,base)

    def test_partial_snapshot_retains_original_part_identity_and_audio_gate(self):
        attempt=SimpleNamespace(flow_mode='partial_practice',specification_version=CURRENT_SPEC,
            speaking_profile_version=None,media_state={})
        group=part('speaking','s')['groups'][0];group['sourcePartIndex']=2
        value=build_input(SimpleNamespace(type='multilevel'),attempt,'speaking',[group],{},Mock())
        self.assertEqual(value['parts'][0]['id'],'2')
        self.assertEqual(value['practiceMode'],'PARTIAL')
        self.assertEqual(blueprint_failure(value),'ASSESSMENT_AUDIO_MISSING')

    def test_filtered_earlier_question_does_not_shift_snapshot_speaking_timing(self):
        profile='BESTWAY_MULTILEVEL_SPEAKING_2026_V2'
        attempt=SimpleNamespace(flow_mode='partial_practice',specification_version=CURRENT_SPEC,
            speaking_profile_version=profile,media_state={SCOPE_KEY:dict(version=1,skills=['speaking'],questionIds=['retained'])})
        first=part('speaking','part11')['groups'][0]
        second=part('speaking','part12')['groups'][0]
        second['questions']=[dict(second['questions'][0],id=identifier,
            guidance=task_guidance('speaking',1,index,profile,CURRENT_SPEC))
            for index,identifier in enumerate(('omitted','retained'))]
        shaped=scope_sections(attempt,[dict(skill='speaking',groups=[first,second])])
        original=copy.deepcopy(second['questions'][1]['guidance'])
        value=build_input(SimpleNamespace(type='multilevel'),attempt,'speaking',shaped[0]['groups'],{},Mock())
        self.assertEqual(value['parts'][0]['id'],'1.2')
        self.assertEqual(value['parts'][0]['prepSeconds'],[5])
        self.assertEqual(value['parts'][0]['responseSeconds'],[30])
        self.assertEqual(shaped[0]['groups'][0]['questions'][0]['guidance'],original)

    def test_snapshot_preserves_actual_webm_recording_mime(self):
        attempt=SimpleNamespace(flow_mode='partial_practice',specification_version=CURRENT_SPEC,
            speaking_profile_version=None,media_state={})
        group=part('speaking','s')['groups'][0]
        value=build_input(SimpleNamespace(type='multilevel'),attempt,'speaking',[group],
            {'s':dict(audioKey='mock/recording.WEBM',response='')},Mock(return_value='sha256'))
        response=value['parts'][0]['responses'][0]
        self.assertEqual(response['mimeType'],'audio/webm')
        self.assertEqual(response['audioKey'],'mock/recording.WEBM')

    def test_assessment_audio_serves_webm_with_matching_mime_and_range(self):
        client=APIClient()
        client.force_authenticate(SimpleNamespace(id='teacher',role='teacher',is_authenticated=True))
        payload=b'\x1a\x45\xdf\xa3-local-recording'
        path=Mock(suffix='.webm')
        path.stat.return_value=SimpleNamespace(st_size=len(payload))
        path.open.side_effect=lambda *args:BytesIO(payload)
        with patch('apps.core.assessment_views.assessment.audio',return_value='mock/recording.webm'),\
                patch('apps.core.assessment_views.storage_path',return_value=path):
            for headers,status,expected in [({},200,payload),({'HTTP_RANGE':'bytes=0-3'},206,payload[:4])]:
                with self.subTest(status=status):
                    response=client.get('/v1/assessment/jobs/job/audio/question',**headers)
                    self.assertEqual(response.status_code,status)
                    self.assertEqual(response['Content-Type'],'audio/webm')
                    self.assertEqual(b''.join(response.streaming_content),expected)
                    if status==206:self.assertEqual(response['Content-Range'],f'bytes 0-3/{len(payload)}')
