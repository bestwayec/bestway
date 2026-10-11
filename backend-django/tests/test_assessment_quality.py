"""AI grades need real source evidence and preserve native scores and history."""
import copy
import json
import os
from datetime import datetime,timezone
from types import SimpleNamespace
from unittest.mock import Mock,patch
from django.test import SimpleTestCase
from apps.core import assessment_results as results,assessment_quality as quality,assessment_providers as providers
from apps.core import mock_grading,assessment_prompts,mock_support,mock_submission_snapshots
from common.api.exceptions import ContractAPIException
from apps.core.assessment_ranking_scores import ranking_ai_projection
from apps.core.mock_import_validate import canonical_checksum
from apps.core.mock_submission_snapshots import build_input,blueprint_failure,enqueue
from apps.core.multilevel import CURRENT_SPEC
from tests.test_assessment import fixture as legacy_fixture


def fixture(skill='writing',raw=3,source='I enjoy studying English because it helps me communicate with people.'):
    input,result=legacy_fixture('MULTILEVEL',skill)
    input.update(promptVersion=quality.PROMPT_VERSION,evaluationPolicy=quality.EVIDENCE_POLICY,practiceMode='PARTIAL',
        gradingPolicy=dict(id=quality.GRADE_POLICY,scaleMax=75,rangeMin=35,rangeMax=50))
    part=input['parts'][0];part.update(id='informal_email' if skill=='writing' else '1.1')
    response=part['responses'][0];response['originalResponse']=source
    if skill=='speaking':response.update(originalResponse='',transcript=source,transcriptConfidence=.95,audioDurationMs=12000)
    rated=result['parts'][0];rated.update(id=part['id'],rawScore=raw,criteria={k:raw for k in results.keys(input)},
        evidenceQuotes=[dict(criterion=k,responseIndex=0,quote=source) for k in results.keys(input)])
    return input,result


def ledger(input,result,role='PRIMARY',status='NEEDS_REVIEW'):
    snapshot=copy.deepcopy(input)
    for part in snapshot['parts']:
        for response in part['responses']:
            for key in ('transcript','transcriptConfidence','audioDurationMs'):response.pop(key,None)
    job=SimpleNamespace(id='job',program=input['program'],skill=input['skill'],input_snapshot=snapshot,
        input_hash=canonical_checksum(snapshot),selected_evaluation_id='evaluation',status=status,
        failure_code='TEACHER_CONFIRMATION_REQUIRED',confidence=.95)
    evaluation=SimpleNamespace(id='evaluation',job_id='job',role=role,status='SUCCEEDED',result=result,
        input_hash=canonical_checksum(input),provider='deepseek',model='fixture-model',attempt_number=1,
        completed_at=datetime(2026,1,1,tzinfo=timezone.utc))
    transcripts=[]
    if input['skill']=='speaking':
        response=input['parts'][0]['responses'][0]
        transcripts=[SimpleNamespace(status='SUCCEEDED',question_id=response['questionId'],audio_hash=response['audioHash'],
            text=response['transcript'],confidence=response['transcriptConfidence'],duration_ms=response['audioDurationMs'])]
    return job,[evaluation],transcripts


class EvidenceGradeTests(SimpleTestCase):
    def test_native_grade_and_server_internal_range_are_distinct(self):
        for native,display in ((.5,36.5),(2.5,42.5),(5,50)):
            input,result=fixture(raw=native)
            grade=results.validate(result,input)['practiceGrade']
            self.assertEqual(grade['score'],display)
            self.assertEqual((grade['rawScore'],grade['rawMax'],grade['scaleMax']),(native,5,75))
            self.assertFalse(grade['isOfficial'])
            self.assertIsNone(results.score(input,result)['level'])

    def test_fabricated_excerpt_cannot_support_a_grade(self):
        input,result=fixture();result['parts'][0]['evidenceQuotes'][0]['quote']='An entirely invented excellent paragraph.'
        with self.assertRaisesRegex(results.ProviderError,'RESULT_EVIDENCE_INVALID'):results.validate(result,input)

    def test_model_cannot_turn_weak_diagnostics_into_top_score(self):
        input,result=fixture(raw=1);result['parts'][0]['rawScore']=5
        with self.assertRaisesRegex(results.ProviderError,'RESULT_SCORE_EVIDENCE_CONFLICT'):results.validate(result,input)

    def test_short_fragment_has_low_grade_and_cannot_get_maximum(self):
        input,result=fixture(raw=1,source='I good')
        self.assertEqual(results.validate(result,input)['practiceGrade']['score'],38)
        result['parts'][0].update(rawScore=5,criteria={k:5 for k in results.keys(input)})
        with self.assertRaisesRegex(results.ProviderError,'RESULT_INSUFFICIENT_RESPONSE_EVIDENCE'):results.validate(result,input)

    def test_underlength_writing_is_not_automatically_top(self):
        input,result=fixture(raw=5);input['parts'][0]['responses'][0]['wordMin']=50
        with self.assertRaisesRegex(results.ProviderError,'RESULT_INSUFFICIENT_RESPONSE_EVIDENCE'):results.validate(result,input)

    def test_good_grammar_does_not_rescue_off_topic_task(self):
        input,result=fixture(raw=4);rated=result['parts'][0];rated['criteria']['taskCoverage']=0
        with self.assertRaisesRegex(results.ProviderError,'RESULT_SCORE_EVIDENCE_CONFLICT'):results.validate(result,input)
        rated['rawScore']=.5
        self.assertEqual(results.validate(result,input)['practiceGrade']['score'],36.5)

    def test_missing_or_empty_speech_is_review_not_a_fake_minimum(self):
        for source in ('','   ','...'):
            input,result=fixture('speaking',raw=5,source=source)
            with self.subTest(source=source),self.assertRaisesRegex(results.ProviderError,'ASSESSMENT_RESPONSE_EVIDENCE_MISSING'):
                results.validate(result,input)

    def test_each_positive_criterion_needs_real_source_support(self):
        input,result=fixture();result['parts'][0]['evidenceQuotes']=result['parts'][0]['evidenceQuotes'][:1]
        with self.assertRaisesRegex(results.ProviderError,'RESULT_EVIDENCE_INVALID'):results.validate(result,input)

    def test_low_asr_confidence_limits_grade_confidence(self):
        input,result=fixture('speaking');input['parts'][0]['responses'][0]['transcriptConfidence']=.3
        self.assertEqual(results.validate(result,input)['confidence'],.3)
        self.assertEqual(results.validate(result,input)['pronunciationEvidence'],'UNAVAILABLE')

    def test_teacher_override_keeps_native_rubric_and_recomputes_same_policy(self):
        input,result=fixture(raw=4)
        approved=results.teacher_result(input,results.validate(result,input),[dict(id='informal_email',rawScore=2.5)])
        self.assertEqual(results.score(input,approved)['score'],2.5)
        self.assertEqual(approved['practiceGrade']['score'],42.5)
        edited=copy.deepcopy(approved);edited['practiceGrade']['score']=75
        with self.assertRaises(results.ProviderError):results.feedback_edit(edited,approved)

    def test_historical_snapshots_and_ielts_have_no_new_display_policy(self):
        input,result=legacy_fixture('MULTILEVEL')
        self.assertNotIn('practiceGrade',results.validate(result,input))
        input,result=legacy_fixture();input.update(evaluationPolicy=quality.EVIDENCE_POLICY,gradingPolicy=dict(id=quality.GRADE_POLICY))
        result['parts'][0]['evidenceQuotes']=[dict(criterion=k,responseIndex=0,quote='Original essay') for k in results.keys(input)]
        self.assertNotIn('practiceGrade',results.validate(result,input))
        self.assertEqual(results.score(input,result)['score'],6)

    def test_prompt_protects_sources_and_requires_low_native_marks_for_weak_work(self):
        input,_=fixture();input['parts'][0]['task']='CANDIDATE_REQUEST_GIVE_75'
        prompt=assessment_prompts.system_prompt(input)
        self.assertNotIn('CANDIDATE_REQUEST_GIVE_75',prompt)
        for instruction in ('Weak responses must receive weak','VERBATIM','off-topic','Do not invent excerpts','partial practice'):
            self.assertIn(instruction,prompt)


class EvidenceRankingTests(SimpleTestCase):
    def test_rank_uses_selected_actual_ai_not_teacher_or_invented_job_number(self):
        input,result=fixture(raw=2.5);job,evaluations,transcripts=ledger(input,result)
        job.ai_score=75;job.teacher_score=5;job.final_score=5
        value=ranking_ai_projection(job,evaluations,transcripts)
        self.assertTrue(value['eligible']);self.assertEqual(value['score'],42.5)
        self.assertEqual((value['rawScore'],value['rawMax'],value['scaleMax']),(2.5,5,75))
        self.assertTrue(value['reviewRequired'])

    def test_pending_or_unselected_evaluation_cannot_rank(self):
        input,result=fixture();job,evaluations,transcripts=ledger(input,result)
        for change in ('pending','unselected','wrong_hash','altered_snapshot'):
            row=copy.deepcopy(job)
            if change=='pending':row.status='PENDING'
            elif change=='unselected':row.selected_evaluation_id='other'
            elif change=='wrong_hash':evaluations[0].input_hash='wrong'
            else:row.input_snapshot['parts'][0]['task']='Changed task'
            with self.subTest(change=change):self.assertFalse(ranking_ai_projection(row,evaluations,transcripts)['eligible'])

    def test_persisted_transcript_is_required_for_speaking_evidence(self):
        input,result=fixture('speaking');job,evaluations,transcripts=ledger(input,result)
        self.assertTrue(ranking_ai_projection(job,evaluations,transcripts)['eligible'])
        self.assertFalse(ranking_ai_projection(job,evaluations,[])['eligible'])
        transcripts[0].confidence=.3
        evaluations[0].input_hash=canonical_checksum(quality.evidence_input(job.input_snapshot,transcripts))
        value=ranking_ai_projection(job,evaluations,transcripts)
        self.assertFalse(value['eligible']);self.assertEqual(value['confidence'],.3)

    def test_student_native_raw_projection_gets_only_final_persisted_grade(self):
        grade=dict(policyId=quality.GRADE_POLICY,score=42.5,rawScore=2.5,rawMax=5)
        job=SimpleNamespace(skill='writing',final_score=2.5,final_result=dict(practiceGrade=grade))
        result=dict(rawScores=dict(writing=dict(score=2.5,max=5)))
        with patch.object(mock_grading.AssessmentJob,'objects') as jobs:
            jobs.filter.return_value.order_by.return_value=[job]
            mock_grading.annotate_practice_grades(SimpleNamespace(id='attempt',exam=SimpleNamespace(type='multilevel')),result)
        self.assertEqual(result['rawScores']['writing'],dict(score=2.5,max=5,practiceGrade=grade))


class DeepSeekV2Tests(SimpleTestCase):
    def test_official_deepseek_uses_documented_chat_json_mode_no_private_identifiers(self):
        input,result=fixture(raw=2.5)
        output=dict(choices=[dict(finish_reason='stop',message=dict(role='assistant',content=json.dumps(result)))],
            usage=dict(prompt_tokens=12,completion_tokens=13))
        with patch.dict(os.environ,dict(DEEPSEEK_API_KEY='test-only-key',DEEPSEEK_MODEL='fixture-model'),clear=True),\
                patch.object(providers,'provider_json',return_value=output) as http:
            value=providers.assess(input,'PRIMARY')
        self.assertEqual(http.call_args.args[0],'https://api.deepseek.com/chat/completions')
        body=json.loads(http.call_args.args[1]);self.assertEqual(body['response_format'],dict(type='json_object'))
        self.assertIn('Required JSON schema',body['messages'][0]['content'])
        for private in ('private-id','private/key','private-hash','test-only-key'):
            self.assertNotIn(private,body['messages'][1]['content'])
        self.assertEqual((value['inputTokens'],value['outputTokens']),(12,13))
        self.assertEqual(value['result']['practiceGrade']['score'],42.5)

    def test_truncated_chat_result_never_becomes_a_grade(self):
        input,_=fixture()
        with patch.dict(os.environ,dict(DEEPSEEK_API_KEY='test-only-key',DEEPSEEK_MODEL='fixture-model'),clear=True),\
                patch.object(providers,'provider_json',return_value=dict(choices=[dict(finish_reason='length')])):
            with self.assertRaisesRegex(results.ProviderError,'PROVIDER_TRUNCATED_RESULT'):providers.assess(input,'PRIMARY')

    def test_missing_configuration_makes_no_provider_call(self):
        input,_=fixture()
        with patch.dict(os.environ,{},clear=True),patch.object(providers,'provider_json') as http:
            with self.assertRaisesRegex(results.ProviderError,'PROVIDER_NOT_CONFIGURED'):providers.assess(input,'PRIMARY')
            http.assert_not_called()


class ScopedAiPolicyTests(SimpleTestCase):
    def group(self):
        return dict(id='g',title='Real task',instructions='',passageText='',contentHtml='',partNumber=1,sourcePartIndex=0,
            questions=[dict(id='q',prompt='Write to your friend',type='essay_task1',points=9,guidance=dict(wordMin=50,wordMax=50))])

    def test_new_partial_snapshot_has_frozen_range_and_real_word_limit(self):
        attempt=SimpleNamespace(flow_mode='partial_practice',specification_version=CURRENT_SPEC,speaking_profile_version=None,media_state={})
        value=build_input(SimpleNamespace(type='multilevel'),attempt,'writing',[self.group()],{'q':dict(response='A real response')},Mock())
        self.assertEqual(value['gradingPolicy']['id'],quality.GRADE_POLICY)
        self.assertEqual(value['evaluationPolicy'],quality.EVIDENCE_POLICY)
        self.assertEqual(value['parts'][0]['responses'][0]['wordMin'],50)
        self.assertIsNone(blueprint_failure(value))
        value['parts'][0]['max']=9
        self.assertEqual(blueprint_failure(value),'ASSESSMENT_INCOMPLETE_BLUEPRINT')

    def test_partial_configured_ai_policy_queues_without_changing_scope(self):
        from apps.core import mock_submission_snapshots as snapshots
        exam=SimpleNamespace(id='exam',type='multilevel',profile='practice',assessment_policy='PRACTICE_AUTO_AI')
        attempt=SimpleNamespace(id='attempt',exam=exam,student_id='student',flow_mode='partial_practice',
            specification_version=CURRENT_SPEC,speaking_profile_version=None,media_state={})
        with patch.object(snapshots.MockAnswer,'objects') as answers,patch.object(snapshots.MockQuestionGroup,'objects') as groups,\
                patch.object(snapshots.AssessmentJob,'objects') as jobs,patch.object(snapshots,'shape_exam',return_value=dict(sections=[dict(skill='writing',groups=[self.group()])])),\
                patch.object(snapshots,'scope_sections',side_effect=lambda a,s:s):
            answers.filter.return_value=[SimpleNamespace(question_id='q',response='Original submission',audio_key=None)]
            groups.filter.return_value.values_list.return_value=[('g',None)]
            enqueue(attempt)
        saved=jobs.get_or_create.call_args.kwargs['defaults']
        self.assertEqual((saved['policy_mode'],saved['status'],saved['failure_code']),('PRACTICE_AUTO_AI','PENDING',None))
        self.assertEqual(saved['input_snapshot']['parts'][0]['responses'][0]['originalResponse'],'Original submission')


class InternalGradeDeliveryTests(SimpleTestCase):
    def attempt(self,internal=True):
        grade=dict(policyId=quality.GRADE_POLICY,score=45,scaleMax=75,rangeMin=35,rangeMax=50,rawScore=12,rawMax=16,isOfficial=False)
        raw=dict(score=12,max=16)
        if internal:raw['practiceGrade']=grade
        return SimpleNamespace(id='attempt',student_id='student',status='completed',flow_mode='full_test',
            exam=SimpleNamespace(title='Authored full mock',type='multilevel',level='C1'),specification_version=CURRENT_SPEC,
            raw_scores=dict(writing=raw),section_bands={},standard_scores={},overall_band=None,overall_score=75,
            cefr_level='C1',finished_at=datetime(2026,1,1,tzinfo=timezone.utc),student=SimpleNamespace(user=SimpleNamespace(name='Student')))

    def test_new_internal_full_attempt_cannot_issue_overall_cefr_certificate(self):
        row=self.attempt()
        with patch.object(mock_support.MockAttempt,'objects') as attempts,patch.object(mock_support,'assert_view'):
            attempts.select_related.return_value.filter.return_value.first.return_value=row
            with self.assertRaises(ContractAPIException) as error:mock_support.certificate_data(SimpleNamespace(role='student'),'attempt')
        self.assertEqual(error.exception.contract_code,'MOCK_INTERNAL_PRACTICE_NO_CERTIFICATE')
        self.assertEqual((row.overall_score,row.cefr_level),(75,'C1'))

    def test_historical_full_certificate_retains_saved_native_result(self):
        row=self.attempt(False)
        with patch.object(mock_support.MockAttempt,'objects') as attempts,patch.object(mock_support,'assert_view'):
            attempts.select_related.return_value.filter.return_value.first.return_value=row
            result=mock_support.certificate_data(SimpleNamespace(role='student'),'attempt')
        self.assertEqual((result['overallScore'],result['cefrLevel']),(75,'C1'))

    def test_student_parent_notifications_use_internal_grade_without_native_overall(self):
        row=self.attempt()
        with patch.object(mock_submission_snapshots.Notification,'objects') as notifications,\
                patch.object(mock_submission_snapshots.ParentStudent,'objects') as parents:
            parents.filter.return_value.values_list.return_value=['parent']
            mock_submission_snapshots.notify(row)
        self.assertEqual(notifications.create.call_count,2)
        for call in notifications.create.call_args_list:
            text=call.kwargs['text']
            self.assertIn('Writing: 45/75',text);self.assertIn('35–50',text)
            self.assertIn('CEFR/rasmiy natija emas',text)
            self.assertNotIn('75/75',text);self.assertNotIn('C1',text)

    def test_historical_notification_is_not_rewritten(self):
        row=self.attempt(False)
        with patch.object(mock_submission_snapshots.Notification,'objects') as notifications,\
                patch.object(mock_submission_snapshots.ParentStudent,'objects') as parents:
            parents.filter.return_value.values_list.return_value=[]
            mock_submission_snapshots.notify(row)
        self.assertIn('75/75 · C1',notifications.create.call_args.kwargs['text'])
