"""Student attempt mutations over the unchanged Prisma-owned schema.

Exam locks serialize starts with definition edits. Attempt locks serialize
response/media mutations; no client revision or countdown is authoritative.
"""
from __future__ import annotations

from copy import copy
from datetime import timedelta
from datetime import timezone as datetime_timezone

from django.db import connection, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.legacy_schema.models import (MockAnswer, MockAttempt, MockCheatEvent,
    MockExam, MockQuestion, MockQuestionGroup, MockSection, StudentProfile)
from common.api.exceptions import ContractAPIException
from . import exam_programs, mock_catalog
from .mock_authoring import _exam_tree, multilevel_readiness, new_id
from .multilevel import CURRENT_SPEC, CURRENT_SPEAKING_PROFILE, SPECS, speaking_profile, task_guidance

SKILLS = ('listening', 'reading', 'writing', 'speaking')


def fail(code, message, status=400):
    raise ContractAPIException(code, message, status)


def iso(value):
    return aware(value).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def aware(value):
    # Prisma uses PostgreSQL timestamp without time zone, storing UTC.
    return value.replace(tzinfo=datetime_timezone.utc) if value is not None and timezone.is_naive(value) else value


def versioned(attempt):
    return attempt.specification_version in SPECS


def assert_in_progress(attempt):
    if attempt.status != 'in_progress':
        fail('MOCK_ATTEMPT_FINISHED', 'Bu urinish allaqachon yakunlangan')


def assert_time(attempt, at=None):
    at = at or timezone.now()
    overall = attempt.overall_deadline_at or attempt.deadline_at
    if attempt.mode == 'timed' and overall and at > aware(overall):
        fail('MOCK_TIME_UP', 'Vaqt tugadi — imtihonni yakunlang')
    section = (attempt.section_deadlines or {}).get(attempt.current_skill)
    if section and at > parse_datetime(section):
        fail('MOCK_SECTION_TIME_UP', 'Bo‘lim vaqti tugadi — keyingi bo‘limga o‘ting')


def own(actor, attempt_id, *, lock=False):
    rows = MockAttempt.objects.select_for_update() if lock else MockAttempt.objects
    attempt = rows.filter(id=attempt_id).first()
    if attempt is None or attempt.student_id != actor.id:
        fail('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    return attempt


def assert_program(actor, attempt):
    if versioned(attempt):
        with connection.cursor() as cursor:
            programs = exam_programs.state(cursor, actor.id)['availablePrograms']
        if 'MULTILEVEL' not in programs:
            fail('PROGRAM_NOT_ENROLLED', 'Not enrolled in Multilevel', 403)


def questions(attempt, ids):
    return list(MockQuestion.objects.filter(id__in=ids,
        group__section__exam_id=attempt.exam_id).select_related('group__section'))


def assert_question(attempt, question_id):
    rows = questions(attempt, [question_id])
    if not rows:
        fail('QUESTION_NOT_IN_EXAM', 'Savol bu imtihonga tegishli emas')
    q = rows[0]
    if attempt.flow_mode == 'full_test' and attempt.current_skill and q.group.section.skill != attempt.current_skill:
        fail('SECTION_LOCKED', 'Hozir faqat joriy bo‘limga javob beriladi', 403)
    return q


def skill_seconds(skill, section, exam_type):
    if exam_type == 'multilevel':
        return SPECS[CURRENT_SPEC][skill]['duration'] * 60 if section is not None else None
    if skill == 'speaking':
        return None
    if skill == 'listening':
        audio = sum(g['audioDurationSec'] or 0 for g in (section or {}).get('groups', []))
        return (audio if audio > 0 else 1800) + 120
    minutes = (section or {}).get('durationMinutes')
    return (60 if minutes is None else minutes) * 60


def timing(exam_type, sections, mode, flow, at):
    by_skill = {s['skill']: s for s in sections}
    deadlines = {}
    last = None
    cursor = at
    if mode == 'timed':
        for skill in SKILLS:
            if flow != 'full_test' and skill not in by_skill:
                continue
            seconds = skill_seconds(skill, by_skill.get(skill), exam_type)
            if seconds is None:
                continue
            last = (cursor if flow == 'full_test' else at) + timedelta(seconds=seconds)
            deadlines[skill] = iso(last)
            cursor = last
    overall = last
    if flow == 'full_test' and 'speaking' in by_skill and exam_type != 'multilevel':
        overall = None
    return deadlines or None, overall, last


def start_response(attempt, exam, resumed, full_duration=None):
    definition = copy(exam)
    definition.specification_version = attempt.specification_version
    definition.speaking_profile_version = attempt.speaking_profile_version
    shaped = mock_catalog.shape_exam(definition, False)
    return dict(attemptId=attempt.id, resumed=resumed, mode=attempt.mode,
        startedAt=attempt.started_at,
        deadlineAt=(attempt.overall_deadline_at or attempt.deadline_at) if resumed else attempt.deadline_at,
        serverTime=timezone.now(), durationMinutes=full_duration if full_duration is not None else mock_catalog.total_duration(exam, shaped['sections']),
        flowMode=attempt.flow_mode or 'single_skill', currentSkill=attempt.current_skill,
        sectionDeadlines=attempt.section_deadlines, overallDeadlineAt=attempt.overall_deadline_at,
        exam=shaped, annotations=attempt.annotations or [] if resumed else [],
        savedAnswers={a.question_id: '[audio]' if a.audio_key else a.response
            for a in MockAnswer.objects.filter(attempt_id=attempt.id)} if resumed else {})


def start(actor, exam_id, data):
    if not StudentProfile.objects.filter(user_id=actor.id).exists():
        fail('NOT_A_STUDENT', "Faqat o'quvchi imtihon topshira oladi", 403)
    exam = MockExam.objects.filter(id=exam_id).first()
    if not exam:
        fail('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404)
    if not exam.is_published and not exam.is_demo:
        fail('MOCK_EXAM_NOT_PUBLISHED', 'Bu imtihon hali ochilmagan')
    with connection.cursor() as cursor:
        programs = exam_programs.state(cursor, actor.id)['availablePrograms']
    if mock_catalog.program_for_type(exam.type) not in programs:
        fail('PROGRAM_NOT_ENROLLED', 'Not enrolled in this exam track', 403)
    access = mock_catalog.access_for(actor, exam)
    if access == 'pending':
        fail('MOCK_PURCHASE_PENDING', 'Xaridingiz tasdiqlanishini kuting', 402)
    if access != 'granted':
        fail('MOCK_PAYMENT_REQUIRED', "Bu imtihon uchun to'lov talab qilinadi", 402)
    with transaction.atomic():
        current = MockExam.objects.select_for_update().filter(id=exam_id).first()
        if current is None:
            fail('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404)
        if current.content_version != exam.content_version:
            fail('MOCK_CONTENT_CONFLICT', 'Exam content changed. Reload before starting or resuming', 409)
        if not current.is_published and not current.is_demo:
            fail('MOCK_EXAM_NOT_PUBLISHED', 'Bu imtihon hali ochilmagan')
        existing = MockAttempt.objects.filter(exam_id=exam_id, student_id=actor.id, status='in_progress').first()
        if existing:
            return start_response(existing, exam, True)
        if exam.type == 'multilevel':
            readiness = multilevel_readiness(_exam_tree(exam))
            if not readiness['supported']:
                fail('SPECIFICATION_UNSUPPORTED', readiness['issues'][0])
            if readiness['issues']:
                fail('MOCK_NOT_READY', '; '.join(readiness['issues']))
            exam.speaking_profile_version = exam.speaking_profile_version or CURRENT_SPEAKING_PROFILE
        shaped = mock_catalog.shape_exam(exam, False)
        if shaped['questionCount'] == 0:
            fail('MOCK_EXAM_EMPTY', "Bu imtihonda hali savollar yo'q")
        flow = 'full_test' if data.get('flow') == 'full_test' else 'single_skill'
        if flow == 'full_test' and exam.profile != 'full_mock':
            fail('MOCK_FULL_TEST_UNAVAILABLE', 'Full Mock flow faqat full_mock imtihonlarda mavjud')
        mode = 'timed' if flow == 'full_test' else data.get('mode') or 'practice'
        at = timezone.now()
        deadlines, overall, last = timing(exam.type, shaped['sections'], mode, flow, at)
        attempt = MockAttempt.objects.create(id=new_id(), exam_id=exam_id, student_id=actor.id,
            specification_version=exam.specification_version, speaking_profile_version=exam.speaking_profile_version,
            status='in_progress', started_at=at, mode=mode, deadline_at=overall,
            overall_deadline_at=overall, section_deadlines=deadlines,
            flow_mode=flow if flow == 'full_test' else None, current_skill='listening' if flow == 'full_test' else None,
            anti_cheat_count=0, audio_plays={} if flow == 'full_test' else None,
            submitted_sections=[] if flow == 'full_test' else None)
        duration = int((last-at).total_seconds()/60 + .5) if flow == 'full_test' else None
        return start_response(attempt, exam, False, duration)


def upsert_answer(attempt_id, question_id, response):
    MockAnswer.objects.update_or_create(attempt_id=attempt_id, question_id=question_id,
        defaults=dict(response=response, updated_at=timezone.now()),
        create_defaults=dict(id=new_id(), response=response, updated_at=timezone.now(), is_graded=False))


def save_answers(actor, attempt_id, items, *, bulk=False):
    with transaction.atomic():
        attempt = own(actor, attempt_id, lock=True)
        assert_in_progress(attempt)
        assert_time(attempt)
        if not bulk:
            assert_question(attempt, items[0]['questionId'])
        valid = questions(attempt, [a['questionId'] for a in items])
        if attempt.flow_mode == 'full_test' and attempt.current_skill:
            valid = [q for q in valid if q.group.section.skill == attempt.current_skill]
        valid_ids = {q.id for q in valid}
        selected = [a for a in items if a['questionId'] in valid_ids]
        if bulk and versioned(attempt) and len(selected) != len(items):
            fail('SECTION_LOCKED', 'All answers must belong to the current section', 403)
        if not selected:
            full = attempt.flow_mode == 'full_test'
            fail('SECTION_LOCKED' if full else 'QUESTION_NOT_IN_EXAM',
                'Hozir faqat joriy bo‘limga javob beriladi' if full else 'Javoblar bu imtihonga tegishli emas', 403 if full else 400)
        assert_program(actor, attempt)
        for item in selected:
            upsert_answer(attempt.id, item['questionId'], item['response'])
        return {'saved': len(selected) if bulk else True}


def flag_cheat(actor, attempt_id, event):
    with transaction.atomic():
        attempt = own(actor, attempt_id, lock=True)
        if attempt.status == 'in_progress' and MockCheatEvent.objects.filter(attempt_id=attempt_id).count() < 50:
            MockCheatEvent.objects.create(id=new_id(), attempt_id=attempt_id, event=event, created_at=timezone.now())
            attempt.anti_cheat_count += 1
            attempt.save(update_fields=['anti_cheat_count'])
    return {'saved': True}


def advance(actor, attempt_id):
    with transaction.atomic():
        attempt = own(actor, attempt_id, lock=True)
        assert_in_progress(attempt)
        if attempt.flow_mode != 'full_test':
            fail('NOT_FULL_TEST', 'Bu urinish full_test rejimida emas')
        if versioned(attempt):
            assert_program(actor, attempt)
            order = SKILLS
        else:
            order = SKILLS if MockSection.objects.filter(exam_id=attempt.exam_id, skill='speaking').exists() else SKILLS[:3]
        index = order.index(attempt.current_skill) if attempt.current_skill in order else -1
        if index < 0 or index == len(order)-1:
            fail('FLOW_COMPLETE', 'Submit the final section' if versioned(attempt) else 'Oxirgi bo‘limdasiz — imtihonni yakunlang')
        submitted = list(attempt.submitted_sections or [])
        if attempt.current_skill not in submitted:
            submitted.append(attempt.current_skill)
        attempt.current_skill = order[index+1]
        attempt.submitted_sections = submitted
        fields = ['current_skill', 'submitted_sections']
        if versioned(attempt):
            cursor = timezone.now()
            limit = aware(attempt.overall_deadline_at)
            deadlines = dict(attempt.section_deadlines or {})
            for skill in order[index+1:]:
                cursor += timedelta(minutes=SPECS[CURRENT_SPEC][skill]['duration'])
                if limit:
                    cursor = min(limit, cursor)
                deadlines[skill] = iso(cursor)
            attempt.section_deadlines = deadlines
            attempt.overall_deadline_at = attempt.deadline_at = cursor
            fields += ['section_deadlines', 'overall_deadline_at', 'deadline_at']
        elif attempt.current_skill == 'speaking':
            attempt.overall_deadline_at = attempt.deadline_at = None
            fields += ['overall_deadline_at', 'deadline_at']
        attempt.save(update_fields=fields)
        return dict(saved=True, currentSkill=attempt.current_skill, submittedSections=submitted,
            serverTime=timezone.now(), sectionDeadlines=attempt.section_deadlines, overallDeadlineAt=attempt.overall_deadline_at)


def media_phase(actor, attempt_id, entity_id, kind, play=False):
    with transaction.atomic():
        attempt = own(actor, attempt_id, lock=True)
        if not versioned(attempt):
            fail('SPECIFICATION_UNSUPPORTED', 'Multilevel task required')
        groups = list(MockQuestionGroup.objects.filter(section__exam_id=attempt.exam_id,
            section__skill=kind).order_by('sort_order'))
        grouped = [list(MockQuestion.objects.filter(group_id=g.id).order_by('sort_order')) for g in groups]
        gi = next((i for i, g in enumerate(groups) if g.id == entity_id), -1) if kind == 'listening' else next((i for i, qs in enumerate(grouped) if any(q.id == entity_id for q in qs)), -1)
        if gi < 0:
            fail('QUESTION_NOT_IN_EXAM', 'Media task not in exam')
        group = groups[gi]
        qi = next((i for i, q in enumerate(grouped[gi]) if q.id == entity_id), -1)
        ids = [entity_id] if kind == 'speaking' else [q.id for q in grouped[gi]]
        assert_program(actor, attempt)
        assert_in_progress(attempt)
        assert_time(attempt)
        qs = questions(attempt, ids)
        if attempt.flow_mode == 'full_test' and any(q.group.section.skill != attempt.current_skill for q in qs):
            fail('SECTION_LOCKED', 'Question outside current section', 403)
        at = timezone.now()
        state = dict(attempt.media_state or {})
        phase = state.get(entity_id)
        ordered = [q for part in grouped for q in part]
        index = next((i for i, q in enumerate(ordered) if q.id == entity_id), -1)
        if not phase or attempt.mode == 'practice':
            if attempt.mode == 'timed':
                previous = state.get(groups[gi-1].id) if kind == 'listening' and gi > 0 else state.get(ordered[index-1].id) if kind == 'speaking' and index > 0 else None
                needs_previous = gi > 0 if kind == 'listening' else index > 0
                if needs_previous and (not previous or at < parse_datetime(previous['expiresAt']) or (kind == 'listening' and previous['plays'] < 2)):
                    fail('PART_LOCKED', 'Complete the previous listening part first' if kind == 'listening' else 'Complete the previous speaking response first', 403)
            if kind == 'speaking' and speaking_profile(attempt.speaking_profile_version) and index > 0:
                if not MockAnswer.objects.filter(attempt_id=attempt_id, question_id=ordered[index-1].id).exclude(audio_key=None).exclude(audio_key='').exists():
                    fail('PREVIOUS_UPLOAD_PENDING', 'Wait for the previous recording upload acknowledgement', 409)
            guidance = task_guidance(kind, gi, qi, attempt.speaking_profile_version, attempt.specification_version)
            prep = 20 if kind == 'listening' else (guidance or {}).get('prepSeconds', 0)
            duration = group.audio_duration_sec if kind == 'listening' else (guidance or {}).get('responseSeconds')
            if not duration:
                fail('MEDIA_DURATION_REQUIRED', 'Media duration required')
            phase = dict(startedAt=iso(at), prepEndsAt=iso(at+timedelta(seconds=prep)), expiresAt=iso(at+timedelta(seconds=prep+duration)), plays=0)
        if kind == 'listening' and play:
            if at < parse_datetime(phase['prepEndsAt']) or (phase['plays'] > 0 and at < parse_datetime(phase['expiresAt'])):
                fail('PREVIEW_ACTIVE', 'Wait for the preview/current playback to finish', 403)
            if phase['plays'] >= 2:
                fail('AUDIO_REPLAY_BLOCKED', 'Audio plays twice in Multilevel', 403)
            phase = dict(phase, plays=phase['plays']+1, expiresAt=iso(at+timedelta(seconds=group.audio_duration_sec)))
        state[entity_id] = phase
        attempt.media_state = state
        attempt.save(update_fields=['media_state'])
        return dict(phase, serverTime=iso(timezone.now()), playLimit=2)


def assert_view(actor, student_id):
    if actor.role in ('admin', 'super_admin') or (actor.role == 'student' and actor.id == student_id):
        return
    with connection.cursor() as cursor:
        if actor.role == 'teacher':
            cursor.execute('SELECT 1 FROM "StudentProfile" s JOIN "Group" g ON g.id=s."groupId" WHERE s."userId"=%s AND g."teacherId"=%s', [student_id, actor.id])
        elif actor.role == 'parent':
            cursor.execute('SELECT 1 FROM "ParentStudent" WHERE "parentUserId"=%s AND "studentId"=%s', [actor.id, student_id])
        else:
            fail('FORBIDDEN', "Bu ma'lumotni ko'rish huquqingiz yo'q", 403)
        if cursor.fetchone():
            return
    fail('FORBIDDEN', "Bu ma'lumotni ko'rish huquqingiz yo'q", 403)


def summary(attempt, *, detail=False):
    from .mock_catalog import student_title
    result = dict(id=attempt.id, examId=attempt.exam_id, studentId=attempt.student_id,
        examTitle=student_title(attempt.exam.title), examType=attempt.exam.type,
        status=attempt.status, mode=attempt.mode, deadlineAt=attempt.overall_deadline_at or attempt.deadline_at,
        flowMode=attempt.flow_mode or 'single_skill', currentSkill=attempt.current_skill,
        sectionDeadlines=attempt.section_deadlines, overallDeadlineAt=attempt.overall_deadline_at,
        rawScores=attempt.raw_scores, sectionBands=attempt.section_bands, overallBand=attempt.overall_band,
        cefrLevel=attempt.cefr_level, antiCheatCount=attempt.anti_cheat_count,
        startedAt=attempt.started_at, submittedAt=attempt.submitted_at, finishedAt=attempt.finished_at)
    if detail:
        result['studentName'] = attempt.student.user.name
    if versioned(attempt):
        result.update(specificationVersion=attempt.specification_version, standardScores=attempt.standard_scores,
            overallScore=attempt.overall_score, scoreMethod=attempt.score_method, scoreVersion=attempt.score_version, isOfficial=False)
    return result


def my_attempts(actor, query):
    with connection.cursor() as cursor:
        track = exam_programs.state(cursor, actor.id)
    if query.get('program') and query['program'] != track['activeProgram']:
        fail('PROGRAM_CHANGED', 'Your exam track changed. Refresh and try again.', 409)
    active = track['activeProgram'] if track['activeProgram'] in track['availablePrograms'] else None
    types = ['multilevel'] if active == 'MULTILEVEL' else ['ielts_academic', 'ielts_general'] if active == 'IELTS' else []
    rows = MockAttempt.objects.filter(student_id=actor.id, exam__type__in=types).select_related('exam').order_by('-started_at')
    if query.get('status'):
        rows = rows.filter(status=query['status'])
    if query.get('examId'):
        rows = rows.filter(exam_id=query['examId'])
    page, limit = query.get('page', 1), query.get('limit', 20)
    return [summary(a) for a in rows[(page-1)*limit:page*limit]], dict(page=page, limit=limit, total=rows.count())


def detail(actor, attempt_id):
    attempt = MockAttempt.objects.select_related('exam', 'student__user').filter(id=attempt_id).first()
    if not attempt:
        fail('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    assert_view(actor, attempt.student_id)
    staff = mock_catalog.is_staff(actor)
    show = staff or attempt.status == 'completed'
    answers = {a.question_id: a for a in MockAnswer.objects.filter(attempt_id=attempt_id)}
    sections = []
    for section in MockSection.objects.filter(exam_id=attempt.exam_id).order_by('sort_order'):
        raw = (attempt.raw_scores or {}).get(section.skill, {})
        shaped = dict(id=section.id, skill=section.skill, title=section.title,
            durationMinutes=section.duration_minutes, instructions=section.instructions,
            score=raw.get('score'), max=raw.get('max'), band=(attempt.section_bands or {}).get(section.skill),
            standardScore=(attempt.standard_scores or {}).get(section.skill, {}).get('estimatedStandardScore'), groups=[])
        for gi, group in enumerate(MockQuestionGroup.objects.filter(section_id=section.id).order_by('sort_order')):
            shaped_group = dict(id=group.id, title=group.title, instructions=group.instructions,
                passageText=None if versioned(attempt) and section.skill == 'listening' and not show else group.passage_text,
                contentHtml=group.content_html, contentLayout=group.content_layout,
                optionsReusable=group.options_reusable, hasAudio=bool(group.audio_key), questions=[])
            for qi, q in enumerate(MockQuestion.objects.filter(group_id=group.id).order_by('sort_order')):
                a = answers.get(q.id)
                item = dict(id=q.id, number=q.number, type=q.type, prompt=q.prompt, options=q.options,
                    points=q.points, wordLimit=q.word_limit, answerRule=q.answer_rule,
                    response=a.response if a else None, hasAudio=bool(a and a.audio_key),
                    audioUrl=answer_audio_url(attempt_id, q.id) if a and a.audio_key else None,
                    score=a.score if a else None, isCorrect=a.is_correct if a else None,
                    isGraded=a.is_graded if a else False, feedback=a.feedback if a else None,
                    rubricScores=a.rubric_scores if a else None)
                if versioned(attempt):
                    guidance = task_guidance(section.skill, gi, qi, attempt.speaking_profile_version, attempt.specification_version)
                    if guidance is not None:
                        item['guidance'] = guidance
                if show:
                    item['correctAnswers'] = q.correct_answers
                shaped_group['questions'].append(item)
            shaped['groups'].append(shaped_group)
        sections.append(shaped)
    result = summary(attempt, detail=True)
    if staff:
        result['examTitle'] = attempt.exam.title
        result['cheatEvents'] = [dict(event=e.event, date=e.created_at) for e in MockCheatEvent.objects.filter(attempt_id=attempt_id).order_by('created_at')]
    result.update(serverTime=timezone.now(), annotations=attempt.annotations or [], sections=sections)
    return result


def answer_audio_url(attempt_id, question_id):
    from .mock_media import media_url
    return media_url('', 'audio').split('/mock/groups/')[0] + f'/mock/attempts/{attempt_id}/answers/{question_id}/audio'


def annotations(actor, attempt_id, values):
    # Explicit parity decision: Nest permits annotations after submission.
    with transaction.atomic():
        attempt = own(actor, attempt_id, lock=True)
        attempt.annotations = values or []
        attempt.save(update_fields=['annotations'])
    return {'saved': True}


def validate_audio_container(upload):
    if not upload.size:
        fail('INVALID_AUDIO', 'The recording is empty')
    header = upload.read(16)
    upload.seek(0)
    recognized = len(header) >= 12 and (
        (header[:4] == b'RIFF' and header[8:12] == b'WAVE') or header[:4] == b'OggS' or
        header[4:8] == b'ftyp' or header[:4] == b'\x1a\x45\xdf\xa3' or
        header[:3] == b'ID3' or (header[0] == 255 and header[1] & 224 == 224))
    if not recognized:
        fail('INVALID_AUDIO', 'The file is not a supported audio recording')


def upload_speaking(actor, attempt_id, question_id, upload):
    from .mock_media import store_upload, delete_created, delete_unreferenced, validate_upload
    if upload is None:
        fail('NO_FILE', 'Audio fayl yuklanmadi')
    validate_upload(upload, 'audio')
    if upload.size > 25*1024*1024:
        fail('FILE_TOO_LARGE', 'Fayl hajmi ruxsat etilganidan katta')
    created_key = None
    try:
        with transaction.atomic():
            attempt = own(actor, attempt_id, lock=True)
            assert_in_progress(attempt)
            if not versioned(attempt):
                assert_time(attempt)
            if attempt.flow_mode == 'full_test' and attempt.current_skill:
                assert_question(attempt, question_id)
            q = MockQuestion.objects.filter(id=question_id, group__section__exam_id=attempt.exam_id,
                group__section__skill='speaking').first()
            if q is None:
                fail('NOT_SPEAKING_QUESTION', 'Bu savol speaking emas yoki imtihonga tegishli emas')
            if versioned(attempt):
                validate_audio_container(upload)
                assert_program(actor, attempt)
                if attempt.mode == 'timed':
                    phase = (attempt.media_state or {}).get(question_id)
                    if not phase or timezone.now() < parse_datetime(phase['prepEndsAt']):
                        fail('RECORDING_NOT_STARTED', 'Start the speaking task first')
                    if timezone.now() > parse_datetime(phase['expiresAt']) + timedelta(minutes=5):
                        fail('UPLOAD_WINDOW_EXPIRED', 'The recording upload recovery window has expired')
            prior = MockAnswer.objects.filter(attempt_id=attempt_id, question_id=question_id).first()
            if prior and prior.audio_key and versioned(attempt) and attempt.mode == 'timed':
                return dict(saved=True, audioUrl=answer_audio_url(attempt_id, question_id))
            created_key = store_upload(upload, 'audio')
            MockAnswer.objects.update_or_create(attempt_id=attempt_id, question_id=question_id,
                defaults=dict(audio_key=created_key, updated_at=timezone.now()),
                create_defaults=dict(id=new_id(), audio_key=created_key, response='', is_graded=False, updated_at=timezone.now()))
            if prior and prior.audio_key:
                transaction.on_commit(lambda: delete_unreferenced(prior.audio_key), robust=True)
        return dict(saved=True, audioUrl=answer_audio_url(attempt_id, question_id))
    except Exception:
        if created_key:
            delete_created(created_key)
        raise
