"""Immutable assessment handoff only. No provider, worker, or teacher execution."""
import hashlib
import os
from pathlib import Path
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from apps.legacy_schema.models import (AssessmentJob, MockAnswer, MockQuestionGroup,
    Notification, ParentStudent)
from .mock_authoring import new_id
from .mock_catalog import shape_exam, student_title
from .mock_import_validate import canonical_checksum
from .mock_media import resolve_key
from .multilevel import CURRENT_SPEC, SPECS, task_guidance
from common.api.exceptions import ContractAPIException

PROMPT_VERSION = 'BESTWAY_ASSESSMENT_PROMPT_2026_V1'


def build_input(exam, attempt, skill, groups, answers, hash_audio):
    program = 'MULTILEVEL' if exam.type == 'multilevel' else 'IELTS_GENERAL' if exam.type == 'ielts_general' else 'IELTS_ACADEMIC'
    parts = []
    for index, group in enumerate(groups):
        responses = []
        for question in group['questions']:
            answer = answers.get(question['id'], {})
            response = dict(questionId=question['id'], prompt=question['prompt'],
                originalResponse=answer.get('response') or '', partNumber=group['partNumber'] if group['partNumber'] is not None else index+1)
            key = answer.get('audioKey')
            if key:
                mime = {'.m4a':'audio/mp4','.mp4':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav','.aac':'audio/aac'}.get(Path(key).suffix.lower(), 'audio/mpeg')
                response.update(audioKey=key, audioHash=hash_audio(key), mimeType=mime)
            phase = (attempt.media_state or {}).get(question['id'], {})
            try:
                start, end = parse_datetime(phase.get('prepEndsAt', '')), parse_datetime(phase.get('expiresAt', ''))
                duration = (end-start).total_seconds()*1000 if start and end else 0
                if duration > 0:
                    response['durationMs'] = duration
            except (ValueError, TypeError):
                pass
            responses.append(response)
        task = '\n'.join(filter(None, [group['title'], group['instructions']]))
        context = '\n'.join(filter(None, [group['passageText'], group['contentHtml']]))
        images = dict(imageKeys=[group['imageKey']]) if group.get('imageKey') else {}
        if program == 'MULTILEVEL':
            spec = SPECS[CURRENT_SPEC][skill]['parts']
            part = spec[index] if index < len(spec) else None
            value = dict(id=part[0] if part else 'part:'+group['id'],
                max=part[3] if part else group['questions'][0]['points'] if group['questions'] else 0,
                task=task, context=context, responses=responses, **images)
            if skill == 'speaking':
                guidance = [task_guidance(skill,index,qi,attempt.speaking_profile_version,attempt.specification_version) or {} for qi,_ in enumerate(group['questions'])]
                value.update(prepSeconds=[g.get('prepSeconds',0) for g in guidance], responseSeconds=[g.get('responseSeconds',0) for g in guidance])
            parts.append(value)
        elif skill == 'writing':
            for question, response in zip(group['questions'], responses):
                task2 = question['type'] == 'essay_task2'
                parts.append(dict(id=('task2:' if task2 else 'task1:')+question['id'], max=9,
                    weight=2 if task2 else 1, task='\n'.join(filter(None,[group['title'],group['instructions'],question['prompt']])), context=context, responses=[response], **images))
        else:
            if not parts:
                parts.append(dict(id='speaking',max=9,task='IELTS Speaking Parts 1, 2 and 3, assessed holistically',context='',responses=[]))
            parts[0]['responses'].extend(responses)
            parts[0]['context'] += f"\nPart {group['partNumber'] if group['partNumber'] is not None else index+1}: " + '\n'.join(filter(None,[group['title'],group['instructions'],group['passageText']]))
    return dict(program=program,skill=skill,specificationVersion=attempt.specification_version,
        speakingProfileVersion=attempt.speaking_profile_version, rubricVersion=f"{'MULTILEVEL' if program=='MULTILEVEL' else 'IELTS'}_{skill.upper()}_RUBRIC_V1",
        promptVersion=PROMPT_VERSION,pronunciationEvidence='UNAVAILABLE',parts=parts)


def blueprint_failure(value):
    parts = value['parts']
    if not parts or any(not p['responses'] for p in parts):
        return 'ASSESSMENT_INCOMPLETE_BLUEPRINT'
    if value['program'] == 'MULTILEVEL':
        spec = SPECS[CURRENT_SPEC][value['skill']]['parts']
        if len(parts)!=len(spec) or any(p['id']!=s[0] or len(p['responses'])!=s[1] or p['max']!=s[3] for p,s in zip(parts,spec)):
            return 'ASSESSMENT_INCOMPLETE_BLUEPRINT'
    if value['skill']=='speaking' and any(not r.get('audioKey') or not r.get('audioHash') for p in parts for r in p['responses']):
        return 'ASSESSMENT_AUDIO_MISSING'
    return None


def enqueue(attempt, wanted=None):
    exam = attempt.exam
    answers = {a.question_id:dict(response=a.response,audioKey=a.audio_key) for a in MockAnswer.objects.filter(attempt_id=attempt.id)}
    image_keys = dict(MockQuestionGroup.objects.filter(section__exam_id=exam.id).values_list('id','image_key'))
    for section in shape_exam(exam, True)['sections']:
        skill = section['skill']
        if skill not in ('writing','speaking') or wanted and skill not in wanted:
            continue
        for group in section['groups']:
            group['imageKey'] = image_keys[group['id']]
        missing = []
        def hash_audio(key):
            try:
                with resolve_key(key).open('rb') as stream:
                    return hashlib.file_digest(stream, 'sha256').hexdigest()
            except (OSError, ValueError, ContractAPIException):
                missing.append(key)
                return 'UNAVAILABLE'
        value = build_input(exam,attempt,skill,section['groups'],answers,hash_audio)
        policy = exam.assessment_policy if exam.assessment_policy is not None else os.environ.get('ASSESSMENT_POLICY','MANUAL_ONLY')
        if policy not in ('MANUAL_ONLY','PRACTICE_AUTO_AI','FULL_MOCK_AI_WITH_REVIEW'):
            policy = 'MANUAL_ONLY'
        if (exam.profile=='full_mock' or attempt.flow_mode=='full_test') and policy=='PRACTICE_AUTO_AI':
            policy = 'FULL_MOCK_AI_WITH_REVIEW'
        failure = 'ASSESSMENT_AUDIO_MISSING' if missing else blueprint_failure(value) or ('MANUAL_POLICY' if policy=='MANUAL_ONLY' else None)
        now = timezone.now()
        AssessmentJob.objects.get_or_create(attempt_id=attempt.id,skill=skill,input_hash=canonical_checksum(value),generation=0,
            defaults=dict(id=new_id(),student_id=attempt.student_id,program=value['program'], input_snapshot=value,
                rubric_version=value['rubricVersion'],prompt_version=PROMPT_VERSION,policy_mode=policy,
                status='NEEDS_REVIEW' if failure else 'PENDING', failure_code=failure,
                version=1,attempt_count=0,created_at=now,updated_at=now))


def notify(attempt):
    from .mock_attempts import versioned
    def create(user_id, text):
        Notification.objects.create(id=new_id(),user_id=user_id,type='test_result',text=text,read=False,created_at=timezone.now())
    if attempt.status == 'grading':
        student = attempt.student
        if student.group_id and student.group.teacher_id:
            create(student.group.teacher_id,f'{student.user.name} "{attempt.exam.title}" mock imtihonini topshirdi — Writing/Speaking baholashingiz kutilmoqda.')
        return
    def number(value):
        return '—' if value is None else format(value,'.15g')
    if attempt.exam.type == 'multilevel':
        headline = f"estimated (unofficial): {number(attempt.overall_score)}/75 · {attempt.cefr_level or '—'}" if versioned(attempt) else f"daraja: {attempt.cefr_level or '—'}"
    else:
        headline = 'Overall Band: '+number(attempt.overall_band)
    title = student_title(attempt.exam.title)
    create(attempt.student_id,f'Mock imtihon natijangiz tayyor: "{title}" — {headline}.')
    for parent in set(ParentStudent.objects.filter(student_id=attempt.student_id).values_list('parent_user_id',flat=True)):
        create(parent,f'Farzandingizning "{title}" mock natijasi: {headline}.')
