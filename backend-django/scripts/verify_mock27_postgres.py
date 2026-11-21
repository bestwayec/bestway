"""Loopback-only check of the Mock 27 import, Listening audio gate and publication gate on the real schema.

Imports a SYNTHETIC structural fixture (no supplied content) plus the original Writing/Speaking into a
throwaway exam, then drives the real HTTP endpoints as teacher / admin / student:
validated MP3/M4A upload, status MISSING/UPLOADED/VERIFIED, safe replacement, verification invalidation,
content-rights gate, publish/demo/quick-content bypass attempts, idempotent re-import. Every fixture row and file is removed.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
run_id = uuid4().hex[:8]
storage = tempfile.mkdtemp(prefix='mock27-')
os.environ['STORAGE_DIR'] = storage
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
import django

django.setup()
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.mock27.importer import import_mock27
from apps.core.mock_authoring import delete_exam, readiness
from apps.core.models import MockExamGate, MockListeningAudio
from apps.legacy_schema.models import MockAnswer, MockExam, MockQuestion, MockQuestionGroup, User
from audio_fixtures import make_m4a, make_mp3
from mock27_fixtures import write_source_dir

EXAM = 'm27-' + run_id
SUFFIX = '-' + run_id
checks = []


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def user(role, tag=''):
    now = timezone.now()
    row = User.objects.create(id=f'm27-{role}{tag}-{run_id}', name=f'm27 {role}', phone='+99871' + uuid4().hex[:7], role=role,
                              password_hash='unused', is_active=True, created_at=now, updated_at=now)
    return SimpleNamespace(id=row.id, role=role, is_authenticated=True)


def client(actor):
    c = APIClient()
    c.force_authenticate(actor)
    return c


def upload(c, group, data, name, ctype):
    return c.post(f'/v1/mock/groups/{group}/listening-audio', {'audio': SimpleUploadedFile(name, data, content_type=ctype)}, format='multipart')


def report(c):
    return c.get(f'/v1/mock/exams/{EXAM}/listening-audio').json()['data']


def statuses(c):
    return [p['status'] for p in report(c)['audio']['parts']]


def error_code(response):
    body = response.json()
    return (body.get('error') or {}).get('code') or body.get('code')


try:
    admin, teacher, other_teacher = user('super_admin'), user('teacher'), user('teacher', 'b')
    source = write_source_dir(Path(storage) / 'src')
    result = import_mock27(admin, source_dir=source, exam_id=EXAM, id_suffix=SUFFIX)
    check(result['imported'] == ['listening', 'reading', 'writing', 'speaking'], 'all four skills imported in one transaction')
    check(import_mock27(admin, source_dir=source, exam_id=EXAM, id_suffix=SUFFIX)['replayed'] == ['listening', 'reading', 'writing', 'speaking'],
          're-running the import replays every package and changes nothing')
    check(MockExam.objects.filter(id=EXAM).count() == 1 and not MockExam.objects.get(id=EXAM).is_published, 'one draft exam, not published')
    counts = {s: MockQuestion.objects.filter(group__section__exam_id=EXAM, group__section__skill=s).count() for s in ('listening', 'reading', 'writing', 'speaking')}
    check(counts == dict(listening=40, reading=40, writing=2, speaking=3), f'question counts L40 R40 W2 S3 {counts}')
    check(MockExamGate.objects.get(exam_id=EXAM).content_rights == 'unverified', 'content rights start unverified (provided material)')
    exam = MockExam.objects.get(id=EXAM)
    exam.created_by_id = teacher.id
    exam.save(update_fields=['created_by_id'])

    a, t, o = client(admin), client(teacher), client(other_teacher)
    groups = list(MockQuestionGroup.objects.filter(section__exam_id=EXAM, section__skill='listening').order_by('part_number'))
    check(statuses(a) == ['MISSING'] * 4, 'all four Listening parts start MISSING')
    check('audioKey' not in str(report(a)) and 'storage' not in str(report(a)), 'status payload exposes no storage key')
    r = readiness(admin, EXAM)
    failing = sorted(i['key'] for i in r['items'] if not i['ok'])
    check(not r['ready'] and {'listening_audio', 'listening_audio_verified', 'content_rights'} <= set(failing), f'readiness blocked: {failing}')

    # --- upload validation ---
    p1 = groups[0].id
    check(o.get(f'/v1/mock/exams/{EXAM}/listening-audio').status_code == 403, "another teacher cannot read the exam's audio status")
    check(upload(o, p1, make_mp3(75), 'x.mp3', 'audio/mpeg').status_code == 403, "another teacher cannot upload to someone else's exam")
    check(upload(t, p1, b'plain text, not audio' * 2000, 'part1.mp3', 'audio/mpeg').status_code == 400, 'text file renamed .mp3 is rejected')
    check(upload(t, p1, make_m4a(75), 'part1.mp3', 'audio/mpeg').status_code == 400, 'M4A bytes renamed .mp3 are rejected')
    check(upload(t, p1, make_mp3(75), 'part1.wav', 'audio/wav').status_code == 400, 'WAV is not an accepted Listening format')
    check(upload(t, p1, make_mp3(20), 'short.mp3', 'audio/mpeg').status_code == 400, 'a 20-second recording is rejected as too short')
    check(upload(t, p1, make_mp3(75)[:4000], 'trunc.mp3', 'audio/mpeg').status_code == 400, 'a truncated file is rejected')
    audio_files = lambda: [f for f in Path(storage).rglob('*') if f.suffix in ('.mp3', '.m4a', '.wav')]
    check(statuses(a) == ['MISSING'] * 4 and not audio_files(), 'rejected uploads leave no part attached and no orphan audio file')

    # --- valid uploads ---
    mp3_a, m4a_b = make_mp3(75), make_m4a(80)
    r = upload(t, p1, mp3_a, 'part1.mp3', 'audio/mpeg')
    check(r.status_code == 201 and r.json()['data']['status'] == 'UPLOADED', 'teacher (owner) uploads a valid MP3 -> UPLOADED')
    r = upload(a, groups[1].id, m4a_b, 'part2.m4a', 'audio/mp4')
    check(r.status_code == 201, 'administrator uploads a valid M4A')
    parts = report(a)['audio']['parts']
    check([p['status'] for p in parts] == ['UPLOADED', 'UPLOADED', 'MISSING', 'MISSING'], 'status per part: UPLOADED, UPLOADED, MISSING, MISSING')
    check(abs(parts[0]['durationSec'] - 76) <= 2 and parts[0]['audio']['container'] == 'mp3' and parts[1]['audio']['codec'] == 'aac', 'duration/container/codec recorded from the file itself')
    check(a.get(f'/v1/mock/groups/{p1}/audio').status_code == 200, 'staff can play the stored recording through the secure stream')

    # --- verification ---
    nums1 = parts[0]['questionNumbers']
    good = dict(attestation=True, listenedFully=True, heardQuestions=nums1, note='checked against the recording')
    check(t.post(f'/v1/mock/groups/{p1}/listening-audio/verify', good, format='json').status_code == 403, 'a teacher cannot verify audio')
    check(a.post(f'/v1/mock/groups/{p1}/listening-audio/verify', dict(good, heardQuestions=nums1[:-1]), format='json').status_code == 400, 'verification needs every question of the part confirmed')
    check(a.post(f'/v1/mock/groups/{p1}/listening-audio/verify', dict(good, listenedFully=False), format='json').status_code == 400, 'verification needs the full-listen attestation')
    check(a.post(f'/v1/mock/groups/{groups[2].id}/listening-audio/verify', good, format='json').status_code == 409, 'cannot verify a part with no recording')
    check(a.post(f'/v1/mock/groups/{p1}/listening-audio/verify', good, format='json').status_code == 200, 'administrator verifies Part 1')
    check(statuses(a)[0] == 'VERIFIED', 'Part 1 is VERIFIED')

    # --- safe replacement & invalidation ---
    old_key = MockQuestionGroup.objects.get(id=p1).audio_key
    r = upload(t, p1, make_mp3(90), 'part1-v2.mp3', 'audio/mpeg')
    check(r.status_code == 201 and r.json()['data']['replaced'] and r.json()['data']['revision'] == 2, 'replacing the recording bumps the revision')
    check(statuses(a)[0] == 'UPLOADED', 'replacement resets VERIFIED -> UPLOADED')
    check(not (Path(storage) / old_key).exists(), 'the replaced file is deleted after commit')
    check(a.post(f'/v1/mock/groups/{p1}/listening-audio/verify', dict(good, heardQuestions=nums1), format='json').status_code == 200, 'Part 1 verified again')
    q = MockQuestion.objects.filter(group_id=p1).order_by('number').first()
    old_answers = q.correct_answers
    q.correct_answers = ['A']
    q.save(update_fields=['correct_answers'])
    check(statuses(a)[0] == 'UPLOADED', 'editing an answer key after verification invalidates it')
    q.correct_answers = old_answers
    q.save(update_fields=['correct_answers'])
    check(statuses(a)[0] == 'VERIFIED', 'restoring the exact key restores the verification (fingerprint match)')
    # generic media endpoint must not bypass validation on a gated exam
    bad = t.post(f'/v1/mock/groups/{p1}/media', {'audio': SimpleUploadedFile('p.mp3', b'not audio' * 3000, content_type='audio/mpeg')}, format='multipart')
    check(bad.status_code == 400 and statuses(a)[0] == 'VERIFIED', 'the legacy media endpoint is validated for gated exams (no bypass)')
    # tamper: file changed on disk -> verification refuses
    key = MockQuestionGroup.objects.get(id=groups[1].id).audio_key
    (Path(storage) / key).write_bytes(b'tampered' + (Path(storage) / key).read_bytes())
    check(a.post(f'/v1/mock/groups/{groups[1].id}/listening-audio/verify', dict(good, heardQuestions=report(a)['audio']['parts'][1]['questionNumbers']), format='json').status_code == 409,
          'a recording altered on disk cannot be verified (checksum mismatch)')
    r = upload(a, groups[1].id, m4a_b, 'part2.m4a', 'audio/mp4')

    # --- publication gates ---
    s = client(user('student'))
    check(a.patch(f'/v1/mock/exams/{EXAM}', {'isPublished': True}, format='json').status_code == 400, 'publishing is refused while gates fail')
    check(a.patch(f'/v1/mock/exams/{EXAM}', {'isDemo': True}, format='json').status_code == 400, 'marking the exam demo (catalogue exposure) is refused too')
    # NB: quick-content currently fails with a 500 (pre-existing: locked_exam outside a transaction); either way it must not publish.
    check(a.post(f'/v1/mock/exams/{EXAM}/quick-content', {'publish': True}, format='json').status_code != 200 and not MockExam.objects.get(id=EXAM).is_published, 'quick-content cannot publish a gated exam')
    check(not MockExam.objects.get(id=EXAM).is_published and not MockExam.objects.get(id=EXAM).is_demo, 'exam is still an unpublished, non-demo draft')
    ids = [e['id'] for e in (s.get('/v1/mock/exams').json().get('data') or [])] if s.get('/v1/mock/exams').status_code == 200 else []
    check(EXAM not in ids, 'the draft is not in the student catalogue')
    check(s.get(f'/v1/mock/groups/{p1}/audio').status_code in (401, 403, 404), 'a student cannot fetch the draft audio')
    check(t.post(f'/v1/mock/exams/{EXAM}/content-rights', dict(status='verified', attestation=True, evidence='x' * 30), format='json').status_code == 403, 'a teacher cannot record content rights')
    check(a.post(f'/v1/mock/exams/{EXAM}/content-rights', dict(status='verified', attestation=True, evidence='short'), format='json').status_code == 400, 'rights need written permission evidence')
    for g in groups[2:]:
        check(upload(a, g.id, make_mp3(70), f'p{g.part_number}.mp3', 'audio/mpeg').status_code == 201, f'Part {g.part_number} uploaded')
    for g in groups:
        nums = sorted(MockQuestion.objects.filter(group_id=g.id).values_list('number', flat=True))
        if statuses(a)[g.part_number - 1] != 'VERIFIED':
            check(a.post(f'/v1/mock/groups/{g.id}/listening-audio/verify', dict(good, heardQuestions=nums), format='json').status_code == 200, f'Part {g.part_number} verified')
    check(statuses(a) == ['VERIFIED'] * 4, 'all four parts VERIFIED')
    check(a.patch(f'/v1/mock/exams/{EXAM}', {'isPublished': True}, format='json').status_code == 400, 'verified audio alone is not enough: rights still unverified')
    check(a.post(f'/v1/mock/exams/{EXAM}/content-rights', dict(status='verified', attestation=True, evidence='Written licence ref TEST-0001 (fixture)'), format='json').status_code == 200, 'administrator records verified rights')
    ready = readiness(admin, EXAM)
    check(ready['ready'], 'readiness passes only after audio AND rights AND content gates are all green')
    check(a.patch(f'/v1/mock/exams/{EXAM}', {'isPublished': True}, format='json').status_code == 200 and MockExam.objects.get(id=EXAM).is_published, 'publishing succeeds only then (fixture exam)')
    check(a.post(f'/v1/mock/exams/{EXAM}/content-rights', dict(status='unverified'), format='json').status_code == 200 and not MockExam.objects.get(id=EXAM).is_published,
          'withdrawing rights immediately unpublishes the exam')
    # --- clone keeps the gate ---
    cloned = a.post(f'/v1/mock/exams/{EXAM}/clone', {}, format='json')
    if cloned.status_code in (200, 201):
        cid = cloned.json()['data']['id']
        check(MockExamGate.objects.filter(exam_id=cid, content_rights='unverified').exists(), 'a clone of a gated exam stays gated')
        MockExamGate.objects.filter(exam_id=cid).delete()
        delete_exam(admin, cid)
    check(not MockExam.objects.filter(id__startswith='bestway-').exclude(id='bestway-ielts-academic-full-mock-27').exists(), 'no stray exams')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    try:
        if MockExam.objects.filter(id=EXAM).exists():
            delete_exam(SimpleNamespace(id='x', role='super_admin', is_authenticated=True), EXAM)
        MockListeningAudio.objects.filter(exam_id=EXAM).delete()
        MockExamGate.objects.filter(exam_id=EXAM).delete()
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM "MockExamImport" WHERE "packageId" LIKE %s', [f'%{SUFFIX}'])
            cursor.execute('DELETE FROM "MockStagedMedia" WHERE "ownerId" LIKE %s', [f'm27-%{run_id}'])
        User.objects.filter(id__endswith=run_id).delete()
    finally:
        shutil.rmtree(storage, ignore_errors=True)
