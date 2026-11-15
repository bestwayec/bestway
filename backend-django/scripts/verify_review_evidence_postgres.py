"""Local-only disposable API check of S3 review material on the real PostgreSQL schema.

Authoring of evidence/timestamps (validated against the passage and audioscript), the
attempt detail (review material only once the result is released, a fixed number of
queries whatever the number of parts), the review recording (own released attempt only,
never during an attempt of the same exam) and accuracy per question type.
No external providers, production data or browser involved. Everything created is removed.
"""
import io
import os
import sys
import wave
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in {'127.0.0.1', 'localhost', '::1'}:
    raise SystemExit('Refusing non-local DATABASE_URL')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
import django

django.setup()

from django.conf import settings
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import mock_attempts
from apps.legacy_schema.models import AuditLog, MockAnswer, MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection, User

run_id = uuid4().hex[:12]
admin = SimpleNamespace(id=str(uuid4()), role='super_admin', is_authenticated=True)
student = SimpleNamespace(id=str(uuid4()), role='student', is_authenticated=True)
other = SimpleNamespace(id=str(uuid4()), role='student', is_authenticated=True)
exam_id = str(uuid4())
client = APIClient()
checks = []
audio_path = Path(settings.MEDIA_ROOT) / 'fixture' / f'review-{run_id}.wav'
PASSAGE = 'The old bridge was built in 1890.\nIt was repaired in 1920 after a flood.'
SCRIPT = '<p>Woman: The museum opens at <b>nine</b> on weekdays.</p><p>Man: And on Sundays?</p><p>Woman: At ten.</p>'


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS ' + label)


def data(response, status=200, code=None):
    if response.status_code != status:
        raise AssertionError(f"{response.request.get('PATH_INFO')} HTTP {response.status_code}: {getattr(response, 'data', '')}")
    if code:
        check(response.data['error']['code'] == code, f'HTTP {status} {code}')
        return response.data['error']
    return response.data['data'] if hasattr(response, 'data') and isinstance(response.data, dict) else response


def detail_queries():
    with CaptureQueriesContext(connection) as queries:
        mock_attempts.detail(student, attempt.id)
    return len(queries)


try:
    now = timezone.now()
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(audio_path), 'wb') as file:
        file.setnchannels(1); file.setsampwidth(2); file.setframerate(8000); file.writeframes(b'\0\0' * 8000 * 30)
    for index, actor in enumerate((admin, student, other)):
        User.objects.create(id=actor.id, name='Review Fixture', phone=f'+99878{run_id[:6]}{index}', role=actor.role,
                            password_hash='unused', is_active=True, created_at=now, updated_at=now)
    with connection.cursor() as cursor:
        for index, actor in enumerate((student, other)):
            cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                           "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, NULL, 0, %s, %s, NULL, false, NULL)",
                           [actor.id, f'RV{index}{run_id[:7].upper()}', now])
    MockExam.objects.create(id=exam_id, title='Local review evidence ' + run_id, type='ielts_academic', profile='practice',
                            is_published=False, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                            created_by_id=admin.id, created_at=now, updated_at=now)
    listening = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='listening', title='Listening', sort_order=0)
    reading = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='reading', title='Reading', sort_order=1)
    l_group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=listening.id, sort_order=0, title='Part 1', audio_script=SCRIPT,
                                               audio_key=f'fixture/review-{run_id}.wav', audio_duration_sec=30, audio_play_limit=1, part_number=1, created_at=now)
    r_group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=reading.id, sort_order=0, title='Passage 1', passage_text=PASSAGE,
                                               audio_play_limit=1, created_at=now)
    mc = dict(type='multiple_choice', points=1, accepted_variants=[], created_at=now)
    lq = MockQuestion.objects.create(id=str(uuid4()), group_id=l_group.id, number=1, sort_order=0, prompt='When does the museum open?',
                                     options=['At nine', 'At ten'], correct_answers=['At nine'], **mc)
    rq = MockQuestion.objects.create(id=str(uuid4()), group_id=r_group.id, number=1, sort_order=0, prompt='When was the bridge built?',
                                     options=['In 1890', 'In 1920'], correct_answers=['In 1890'], **mc)
    rq2 = MockQuestion.objects.create(id=str(uuid4()), group_id=r_group.id, number=2, sort_order=1, prompt='Why was it repaired?',
                                      options=['A flood', 'A fire'], correct_answers=['A flood'], type='true_false_notgiven', points=1,
                                      accepted_variants=[], created_at=now)

    # ── authoring ──
    client.force_authenticate(admin)
    saved = data(client.patch(f'/v1/mock/questions/{rq.id}', {'evidenceText': 'built  in\n1890'}, format='json'))
    check(saved['evidenceText'] == 'built in 1890' and saved['evidenceOffset'] == PASSAGE.index('built in 1890'),
          'Reading evidence is found in the passage (spacing ignored) and its offset is computed by the server')
    data(client.patch(f'/v1/mock/questions/{rq.id}', {'evidenceText': 'built in 1891'}, format='json'), 400, 'VALIDATION_ERROR')
    data(client.patch(f'/v1/mock/questions/{rq.id}', {'audioStartSec': 5}, format='json'), 400, 'VALIDATION_ERROR')
    check(MockQuestion.objects.get(id=rq.id).evidence_text == 'built in 1890', 'A refused change leaves the stored evidence as it was')
    saved = data(client.patch(f'/v1/mock/questions/{lq.id}', {'evidenceText': 'opens at nine', 'audioStartSec': 12.25}, format='json'))
    check(saved['audioStartSec'] == 12.2 and saved['evidenceText'] == 'opens at nine',
          'Listening evidence comes from the audioscript text and the moment is kept to a tenth of a second')
    data(client.patch(f'/v1/mock/questions/{lq.id}', {'audioStartSec': 31}, format='json'), 400, 'VALIDATION_ERROR')
    tree = data(client.get(f'/v1/mock/exams/{exam_id}'))
    staff_q = next(q for s in tree['sections'] for g in s['groups'] for q in g['questions'] if q['id'] == rq.id)
    check(staff_q['evidenceText'] == 'built in 1890', 'The Builder reads the evidence back from the exam tree')

    # ── the exam before release ──
    attempt = MockAttempt.objects.create(id=str(uuid4()), exam_id=exam_id, student_id=student.id, status='in_progress', mode='practice',
                                         flow_mode='full_test', started_at=now - timedelta(minutes=30), anti_cheat_count=0)
    client.force_authenticate(student)
    student_tree = data(client.get(f'/v1/mock/exams/{exam_id}'))
    flat = [q for s in student_tree['sections'] for g in s['groups'] for q in g['questions']]
    check(all('evidenceText' not in q and 'evidence' not in q and 'audioStartSec' not in q for q in flat),
          'The exam definition a student opens carries no review material')
    live = data(client.get(f'/v1/mock/attempts/{attempt.id}'))
    live_groups = [g for s in live['sections'] for g in s['groups']]
    check(all('audioScript' not in g and 'reviewAudioUrl' not in g for g in live_groups)
          and all('evidence' not in q and 'audioStartSec' not in q for g in live_groups for q in g['questions']),
          'During the attempt the detail has no audioscript, recording link, evidence or timestamp')
    data(client.get(f'/v1/mock/attempts/{attempt.id}/review/audio/{l_group.id}'), 403, 'REVIEW_NOT_AVAILABLE')

    # ── released ──
    MockAnswer.objects.create(id=str(uuid4()), attempt_id=attempt.id, question_id=rq.id, response='In 1920', is_correct=False, score=0, is_graded=True, updated_at=now)
    MockAnswer.objects.create(id=str(uuid4()), attempt_id=attempt.id, question_id=lq.id, response='At nine', is_correct=True, score=1, is_graded=True, updated_at=now)
    MockAttempt.objects.filter(id=attempt.id).update(status='completed', submitted_at=now, finished_at=now,
                                                     raw_scores={'listening': {'score': 1, 'max': 1}, 'reading': {'score': 0, 'max': 2}})
    attempt.refresh_from_db()
    released = data(client.get(f'/v1/mock/attempts/{attempt.id}'))
    by_id = {q['id']: (g, q) for s in released['sections'] for g in s['groups'] for q in g['questions']}
    r_group_out, r_out = by_id[rq.id]
    l_group_out, l_out = by_id[lq.id]
    check(r_out['evidence'] == {'text': 'built in 1890', 'offset': PASSAGE.index('built in 1890')}
          and r_group_out['passageText'][r_out['evidence']['offset']:].startswith('built in 1890'),
          'After release the Reading answer points at its words in the passage')
    check('evidence' not in by_id[rq2.id][1], 'A question without evidence (older content) shows no highlight')
    script = l_group_out['audioScript']
    check('<' not in script and script[l_out['evidence']['offset']:].startswith('opens at nine') and l_out['audioStartSec'] == 12.2,
          'After release the Listening part carries its audioscript as text, the evidence in it and the moment to play from')
    check(l_group_out['reviewAudioUrl'].endswith(f'/mock/attempts/{attempt.id}/review/audio/{l_group.id}'), 'The review recording link is given')
    response = client.get(f'/v1/mock/attempts/{attempt.id}/review/audio/{l_group.id}', HTTP_RANGE='bytes=0-99')
    check(response.status_code == 206 and int(response['Content-Length']) == 100, 'The student can play the recording from any moment (range requests)')
    data(client.get(f'/v1/mock/attempts/{attempt.id}/review/audio/{r_group.id}'), 404, 'FILE_NOT_FOUND')
    client.force_authenticate(other)
    data(client.get(f'/v1/mock/attempts/{attempt.id}/review/audio/{l_group.id}'), 403, 'FORBIDDEN')
    client.force_authenticate(student)
    retake = MockAttempt.objects.create(id=str(uuid4()), exam_id=exam_id, student_id=student.id, status='in_progress', mode='practice',
                                        flow_mode='full_test', started_at=now, anti_cheat_count=0)
    data(client.get(f'/v1/mock/attempts/{attempt.id}/review/audio/{l_group.id}'), 403, 'REVIEW_BLOCKED_DURING_ATTEMPT')
    MockAttempt.objects.filter(id=retake.id).delete()

    # ── no N+1 ──
    before = detail_queries()
    for index in range(1, 4):
        group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=reading.id, sort_order=index, title=f'Passage {index + 1}',
                                                 passage_text=PASSAGE, audio_play_limit=1, created_at=now)
        MockQuestion.objects.create(id=str(uuid4()), group_id=group.id, number=10 + index, sort_order=0, prompt='Extra',
                                    options=['A', 'B'], correct_answers=['A'], **mc)
    after = detail_queries()
    check(after == before, f'The attempt detail runs the same number of queries with 1 or 4 Reading parts ({before} → {after})')

    # ── accuracy per type ──
    accuracy = data(client.get('/v1/mock/attempts/mine/type-accuracy?program=IELTS'))
    types = {t['type']: t for t in accuracy['types']}
    check(types['multiple_choice']['total'] == 5 and types['multiple_choice']['correct'] == 1
          and types['true_false_notgiven'] == {**types['true_false_notgiven'], 'correct': 0, 'total': 1, 'accuracy': 0},
          'Accuracy per type counts every asked question of that type (unanswered ones too)')
    check(accuracy['types'][0]['type'] == 'true_false_notgiven' and len(types['multiple_choice']['history']) == 1,
          'Weakest type first, with one trend point per released attempt')
    data(client.get('/v1/mock/attempts/mine/type-accuracy?limit=0'), 400, 'VALIDATION_ERROR')
    print(f'\n{len(checks)} PASS')
finally:
    MockAnswer.objects.filter(attempt__exam_id=exam_id).delete()
    MockAttempt.objects.filter(exam_id=exam_id).delete()
    MockQuestion.objects.filter(group__section__exam_id=exam_id).delete()
    MockQuestionGroup.objects.filter(section__exam_id=exam_id).delete()
    MockSection.objects.filter(exam_id=exam_id).delete()
    MockExam.objects.filter(id=exam_id).delete()
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [[student.id, other.id]])
    AuditLog.objects.filter(user_id__in=[admin.id, student.id, other.id]).delete()
    User.objects.filter(id__in=[admin.id, student.id, other.id]).delete()
    audio_path.unlink(missing_ok=True)
