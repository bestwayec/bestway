"""Loopback-only persisted ranking contracts; every fixture row is rolled back."""
import copy
import json
import os
import sys
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
os.environ['ASSESSMENT_CONFIDENCE_THRESHOLD'] = '.85'
import django
django.setup()
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient
from psycopg import sql
from apps.core import assessment_results as results, assessment_quality as quality
from apps.core.mock_import_validate import canonical_checksum
from apps.core.mock_practice import SCOPE_KEY
from apps.core.multilevel import CURRENT_SPEC
from apps.legacy_schema.models import AssessmentJob, MockAttempt

prefix = 'rank-' + uuid4().hex[:12]
ids = {name: prefix + '-' + name for name in ('teacher', 'other_teacher', 'admin', 'super_admin', 'parent',
    'group', 'foreign_group', 'exam', 'foreign_exam', 'ielts', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'foreign')}
actors = {role: SimpleNamespace(id=ids[role], role='teacher' if role == 'other_teacher' else role, is_authenticated=True)
    for role in ('teacher', 'other_teacher', 'admin', 'super_admin', 'parent')}
actors['student'] = SimpleNamespace(id=ids['a'], role='student', is_authenticated=True)
checks = []


def check(value, message):
    if not value: raise AssertionError(message)
    checks.append(message); print('PASS ' + message)


def insert(table, **values):
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table),
            sql.SQL(',').join(map(sql.Identifier, values)), sql.SQL(',').join(sql.Placeholder() for _ in values)), list(values.values()))


def request(role, query='', expected=200, group=None):
    client = APIClient(); client.force_authenticate(user=actors[role])
    response = client.get('/v1/assessment/groups/' + (group or ids['group']) + '/rankings' + query)
    check(response.status_code == expected, f'{role} ranking HTTP {expected}')
    return response.data.get('data') if response.status_code < 400 else response.data


def snapshot(question='w1', skill='writing', modern=True):
    responses = [dict(questionId=prefix + '-' + question, prompt='Describe a helpful experience.', partNumber=1,
        originalResponse='I helped my friend prepare a clear plan for an important journey.')]
    if skill == 'speaking':
        responses = [dict(questionId=prefix + '-s' + str(index), prompt='Describe your experience.', partNumber=index,
            originalResponse='', audioKey='private-recording-' + str(index), audioHash='audio-' + str(index)) for index in (1, 2, 3)]
    value = dict(program='MULTILEVEL', skill=skill, practiceMode='PARTIAL', specificationVersion=CURRENT_SPEC,
        speakingProfileVersion='UZBMB_MULTILEVEL_SPEAKING_V3', rubricVersion='MULTILEVEL_' + skill.upper() + '_V2',
        promptVersion=quality.PROMPT_VERSION if modern else 'BESTWAY_ASSESSMENT_PROMPT_2026_V1',
        pronunciationEvidence='UNAVAILABLE', parts=[dict(id='1.1' if skill == 'speaking' else 'informal_email',
            max=5, task='Describe a helpful experience.', context='An authored task', responses=responses)])
    if modern: value.update(evaluationPolicy=quality.EVIDENCE_POLICY, gradingPolicy=dict(id=quality.GRADE_POLICY))
    return value


def attempt(student, suffix='', status='grading', days=0, exam='exam', skills=None):
    identifier = ids[student] + '-attempt' + suffix
    skills = skills or ['writing', 'speaking']
    questions = ([prefix + '-w1', prefix + '-w2'] if 'writing' in skills else []) + ([prefix + '-s' + str(index) for index in (1, 2, 3)] if 'speaking' in skills else [])
    insert('MockAttempt', id=identifier, examId=ids[exam], studentId=ids[student], status=status,
        startedAt=stamp + timedelta(days=days), submittedAt=stamp if status != 'in_progress' else None,
        specificationVersion=CURRENT_SPEC, flowMode='partial_practice',
        mediaState=json.dumps({SCOPE_KEY: dict(version=1, skills=skills, questionIds=questions)}))
    return identifier


def job(student, aid, raw=4, generation=1, status='SUCCEEDED', question='w1', modern=True,
        confidence=.95, skill='writing', teacher=None, invalid=False):
    source = snapshot(question, skill, modern); identifier = aid + '-' + skill + '-' + str(generation)
    result = results.empty(source); result['confidence'] = confidence
    part = result['parts'][0]; keys = results.keys(source)
    part.update(rawScore=raw, criteria={key: raw for key in keys}, evidence={key: 'Supported by candidate words' for key in keys})
    if modern: part['evidenceQuotes'] = [dict(criterion=key, responseIndex=0, quote='I helped my friend') for key in keys]
    hydrated = copy.deepcopy(source)
    if skill == 'speaking':
        for response in hydrated['parts'][0]['responses']:
            response.update(transcript='I helped my friend prepare a clear plan for an important journey.', transcriptConfidence=.95, audioDurationMs=30000)
    validated = results.validate(result, hydrated)
    final = validated
    if teacher is not None:
        final = results.teacher_result(hydrated, validated, [dict(id=part['id'], rawScore=teacher)])
    evaluation_id = identifier + '-evaluation'
    insert('AssessmentJob', id=identifier, attemptId=aid, studentId=ids[student], program='MULTILEVEL', skill=skill,
        inputHash=canonical_checksum(source), inputSnapshot=json.dumps(source), generation=generation,
        rubricVersion=source['rubricVersion'], promptVersion=source['promptVersion'], policyMode='PRACTICE_AUTO_AI',
        status=status, selectedEvaluationId=evaluation_id if status in ('SUCCEEDED', 'NEEDS_REVIEW') else None,
        aiScore=raw if status == 'SUCCEEDED' else None, teacherScore=teacher,
        finalScore=teacher if teacher is not None else raw if status == 'SUCCEEDED' else None,
        finalScoreSource='TEACHER' if teacher is not None else 'AI' if status == 'SUCCEEDED' else None,
        finalResult=json.dumps(final) if status == 'SUCCEEDED' else None, confidence=confidence, updatedAt=stamp)
    if status in ('SUCCEEDED', 'NEEDS_REVIEW'):
        if invalid: validated['parts'][0]['evidenceQuotes'][0]['quote'] = 'Fabricated response quote'
        insert('AssessmentEvaluation', id=evaluation_id, jobId=identifier, role='PRIMARY', attemptNumber=1,
            inputHash=canonical_checksum(hydrated), status='SUCCEEDED', provider='local-fixture', model='fixture-model',
            result=json.dumps(validated), confidence=confidence, completedAt=stamp)
    if skill == 'speaking':
        for response in source['parts'][0]['responses']:
            insert('SpeechTranscript', id=identifier + response['questionId'], jobId=identifier,
                questionId=response['questionId'], audioHash=response['audioHash'], status='SUCCEEDED', attemptNumber=1,
                text='I helped my friend prepare a clear plan for an important journey.', confidence=.95, durationMs=30000,
                provider='local-fixture', model='fixture-model', pronunciationEvidence='UNAVAILABLE', completedAt=stamp)
    return identifier


with transaction.atomic():
    stamp = timezone.now()
    for name in ('teacher', 'other_teacher', 'admin', 'super_admin', 'parent', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'foreign'):
        role = actors[name].role if name in actors else 'student'
        insert('User', id=ids[name], name='Ranking ' + name, phone=ids[name], passwordHash='unused', role=role, updatedAt=stamp)
    insert('Group', id=ids['group'], name='Ranking fixture', teacherId=ids['teacher'])
    insert('Group', id=ids['foreign_group'], name='Foreign fixture', teacherId=ids['other_teacher'])
    for student in ('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'foreign'):
        insert('StudentProfile', userId=ids[student], linkCode=ids[student], groupId=ids['foreign_group'] if student == 'foreign' else ids['group'])
    for exam in ('exam', 'foreign_exam', 'ielts'):
        insert('MockExam', id=ids[exam], type='ielts_academic' if exam == 'ielts' else 'multilevel',
            title='Ranking ' + exam, specificationVersion=CURRENT_SPEC, profile='practice', updatedAt=stamp)
    attempts = {student: attempt(student) for student in ('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k')}
    job('a', attempts['a'], teacher=3.5)
    job('b', attempts['b'], raw=4.5); job('b', attempts['b'], generation=2, status='PENDING')
    job('c', attempts['c']); attempt('c', '-new', status='in_progress', days=1)
    job('d', attempts['d'], question='w2', raw=2)
    job('e', attempts['e']); job('f', attempts['f'], raw=3)
    job('g', attempts['g'], modern=False)
    job('h', attempts['h'], invalid=True)
    job('i', attempts['i'], confidence=.5)
    job('j', attempts['j'], raw=2.5)
    speaking_only = attempt('j', '-speaking-only', status='in_progress', days=1, skills=['speaking'])
    job('k', attempts['k'], skill='speaking', raw=2.5)
    attempt('k', '-writing-only', status='in_progress', days=1, skills=['writing'])
    foreign = attempt('foreign'); job('foreign', foreign, raw=5)
    attempt('foreign', '-foreign', exam='foreign_exam'); attempt('a', '-ielts', exam='ielts')
    speech_job = job('a', attempts['a'], skill='speaking', raw=3.5)
    for role in ('student', 'parent', 'other_teacher'): request(role, expected=403)
    request('teacher', expected=403, group=ids['foreign_group'])
    for role in ('teacher', 'admin', 'super_admin'):
        options = request(role)
        check([exam['id'] for exam in options['exams']] == [ids['exam']], 'exam options exclude foreign groups and IELTS')
    request('teacher', '?examId=' + ids['foreign_exam'], 404)
    request('teacher', '?skill=listening', 400)
    query = '?examId=' + ids['exam']
    with CaptureQueriesContext(connection) as queries:
        data = request('teacher', query)
    check(len(queries) <= 6, 'Writing ranking uses at most six batched queries for eleven students')
    cohorts = data['cohorts']; check(len(cohorts) == 3, 'different task scopes and historical grading policy have separate cohorts')
    current = next(cohort for cohort in cohorts if cohort['gradingPolicyId'] == quality.GRADE_POLICY and cohort['parts'][0]['questionIds'] == [prefix + '-w1'])
    rows = {row['studentId']: row for row in current['rows']}
    check(rows[ids['a']]['aiScore'] == 47 and rows[ids['a']]['aiRawScore'] == 4, 'AI website grade uses real raw evidence mapped to 35–50 /75')
    check(rows[ids['a']]['teacherScore'] == 3.5 and rows[ids['a']]['finalPracticeGrade']['score'] == 45.5, 'teacher/final provenance stays separate from AI rank')
    check([(rows[ids[student]]['rank']) for student in ('a', 'e', 'f')] == [1, 1, 3], 'equal AI grades have competition ranks 1,1,3')
    check(rows[ids['b']]['aiScore'] is None and rows[ids['b']]['rank'] is None and rows[ids['b']]['status'] == 'PENDING', 'latest pending generation never falls back to earlier successful AI')
    check(rows[ids['h']]['aiScore'] is None and rows[ids['h']]['rank'] is None, 'fabricated evidence is not ranked')
    check(rows[ids['i']]['rank'] is None and not rows[ids['i']]['eligible'], 'low confidence proposal is never ranked')
    check(any(row['studentId'] == ids['c'] and row['status'] == 'IN_PROGRESS' for row in data['unranked']), 'new in-progress attempt hides old completed attempt score')
    check(rows[ids['j']]['attemptId'] == attempts['j'] and rows[ids['j']]['aiScore'] == 42.5,
        'new Speaking-only practice preserves latest relevant Writing assessment')
    check(any(row['studentId'] == ids['k'] and row['status'] == 'IN_PROGRESS' for row in data['unranked']),
        'latest Writing-only in-progress attempt remains unranked for Writing')
    check(ids['foreign'] not in json.dumps(data), 'foreign roster students never leak')
    check('originalResponse' not in json.dumps(data) and 'audioKey' not in json.dumps(data) and 'phone' not in json.dumps(data), 'candidate content, media keys and contacts are omitted')
    with CaptureQueriesContext(connection) as queries:
        speech = request('teacher', query + '&skill=speaking')
    check(len(queries) <= 7, 'Speaking ranking batches persisted transcripts in at most seven queries')
    check(speech['cohorts'][0]['rows'][0]['aiScore'] == 45.5 and speech['cohorts'][0]['rows'][0]['rank'] == 1, 'Speaking AI grade uses persisted validated transcript evidence')
    check(any(row['studentId'] == ids['k'] and row['attemptId'] == attempts['k'] and row['aiScore'] == 42.5 for row in speech['cohorts'][0]['rows']),
        'new Writing-only practice preserves latest relevant Speaking assessment')
    check(any(row['studentId'] == ids['j'] and row['status'] == 'IN_PROGRESS' for row in speech['unranked']),
        'latest Speaking-only in-progress attempt remains unranked for Speaking')
    check(speech['cohorts'][0]['rawMax'] == 5, 'three Speaking recordings are scored once for their holistic five-point part')
    broken = MockAttempt.objects.get(id=speaking_only); broken.media_state[SCOPE_KEY]['version'] = 999
    broken.save(update_fields=['media_state'])
    damaged = request('teacher', query)
    check(any(row['studentId'] == ids['j'] and row['attemptId'] == speaking_only and row['rank'] is None for row in damaged['unranked']),
        'unknown frozen-scope version cannot revive an older Writing grade')
    transaction.set_rollback(True)
check(not AssessmentJob.objects.filter(id__startswith=prefix).exists() and not MockAttempt.objects.filter(id__startswith=prefix).exists(), 'all local fixture attempts and jobs are rolled back')
print(f'AI ranking contracts: {len(checks)}/{len(checks)} PASS')
