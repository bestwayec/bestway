"""Loopback-only BESTWAY 5.1 check of the authoritative exam report and its deliveries.

Synthetic classroom of eight students on an IELTS exam assignment with fixed closing time:
ranked finalized results with a tie, a student awaiting the teacher's Writing/Speaking
grade, an in-progress student, a never-started student. Verifies pending is never 0, the
stage moves open -> preliminary -> final, the private teacher leaderboard lists every
student exactly once (also for a 120-student class with HTML-special names, paged under
the Telegram limit), the classroom chat gets aggregates only, reports are not duplicated
by repeated sweeps, a late advisory job cannot change a teacher-final grade or the report,
a grade correction produces one labelled revision, unrelated teachers get 404, and the
Excel export matches the dataset and neutralises formulas. Telegram is a recorded fake.
"""
import os
import sys
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
os.environ['ASSESSMENT_INLINE_TICK'] = 'false'
import django

django.setup()
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import assessment as service, exam_report, exam_report_delivery as delivery
from apps.core.homework_scoring import ASSIGNMENT_KEY
from apps.core.models import ExamReportState, HomeworkAssignment, TelegramClassroomBinding, TelegramOutbox
from apps.legacy_schema.models import AssessmentJob, MockAttempt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exam51_fixtures import Fixture  # noqa: E402

fx = Fixture('x51r')
checks = []


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def attempt(student, exam_id, assignment_id, *, status='completed', bands=None, overall=None, auto=False):
    now = timezone.now()
    state = {ASSIGNMENT_KEY: assignment_id}
    if auto:
        state['__auto_submitted'] = dict(at=now.isoformat(), deadline=now.isoformat(), reason='deadline')
    row = MockAttempt.objects.create(id=str(uuid4()), exam_id=exam_id, student_id=student.id, status=status, started_at=now - timedelta(hours=2),
                                     submitted_at=None if status == 'in_progress' else now - timedelta(minutes=30),
                                     finished_at=now if status == 'completed' else None, mode='timed', flow_mode='full_test',
                                     current_skill='speaking', media_state=state, anti_cheat_count=0,
                                     section_bands=bands, overall_band=overall,
                                     raw_scores={'listening': {'score': 30, 'max': 40}, 'reading': {'score': 28, 'max': 40}})
    return row


def job(row, skill, *, final=None, status='SUCCEEDED'):
    return AssessmentJob.objects.create(id=str(uuid4()), attempt_id=row.id, student_id=row.student_id, program='IELTS', skill=skill,
                                        input_hash=uuid4().hex, input_snapshot={'skill': skill, 'parts': []}, generation=0,
                                        rubric_version='r', prompt_version='p', policy_mode='FULL_MOCK_AI_WITH_REVIEW', status=status, version=1, attempt_count=0,
                                        final_score=final, teacher_score=final, final_score_source='TEACHER' if final is not None else None,
                                        created_at=timezone.now(), updated_at=timezone.now())


try:
    teacher = fx.user('teacher', 'Teacher A', chat='7100001')
    stranger = fx.user('teacher', 'Teacher B', chat='7100002')
    gid = fx.group(teacher, 'Synthetic IELTS Advanced')
    names = ['Student 01', 'Student 02', 'Student 03', 'Student 04', 'Student 05', 'Student 06', 'Student 07', 'Student 08']
    s = [fx.student(gid, n) for n in names]
    exam_id, _ = fx.reading_exam()
    from apps.legacy_schema.models import MockExam
    MockExam.objects.filter(id=exam_id).update(profile='full_mock', title='Synthetic IELTS Mock 07')
    created = api(teacher).post(f'/v1/groups/{gid}/assignments', {'title': 'Mock 07', 'exam_id': exam_id, 'timing_policy': 'fixed_close',
                                                                  'deadline': (timezone.now() + timedelta(hours=1)).isoformat()}, format='json')
    aid = created.data['data']['id']
    TelegramClassroomBinding.objects.create(group_id=gid, chat_id='-1009' + fx.run[:6].translate(str.maketrans('abcdef', '123456')),
                                            is_active=True, bot_can_post=True, verified_telegram_id='7100001',
                                            bound_by_id=teacher.id, verified_at=timezone.now())
    finals = {0: ((8.5, 8.0), 7.5, 8.0, 8.0), 1: ((8.0, 7.5), 7.0, 7.5, 7.5), 2: ((7.5, 7.5), 7.0, 7.5, 7.5),
              3: ((7.0, 6.5), 6.0, 6.5, 6.5), 4: ((6.0, 6.0), 5.5, 6.0, 6.0)}
    rows = {}
    for i, (lr, w, sp, o) in finals.items():
        rows[i] = attempt(s[i], exam_id, aid, bands={'listening': lr[0], 'reading': lr[1], 'writing': w, 'speaking': sp}, overall=o, auto=i == 4)
        job(rows[i], 'writing', final=w)
        job(rows[i], 'speaking', final=sp)
    rows[5] = attempt(s[5], exam_id, aid, status='grading', bands={'listening': 7.0, 'reading': 6.5})
    pending_w = job(rows[5], 'writing', status='NEEDS_REVIEW')
    job(rows[5], 'speaking', final=6.0)
    rows[6] = attempt(s[6], exam_id, aid, status='in_progress')
    # s[7] never starts.

    row = HomeworkAssignment.objects.select_related('cohort', 'cohort__classroom', 'exam').get(id=aid)
    rep = exam_report.build(row)
    check(rep['stage'] == 'open', 'before closing the report stage is open')
    check(delivery.deliver(aid)['reason'] == 'open', 'nothing is sent while the exam is open')
    by = {r['name']: r for r in rep['rows']}
    check([by[n]['rank'] for n in names[:5]] == [1, 2, 2, 4, 5], 'shared competition ranking for the 7.5 tie (1, 2, 2, 4, 5)')
    check(by['Student 06']['grading'] == 'partially_graded' and by['Student 06']['scores']['writing'] is None
          and by['Student 06']['scores']['speaking'] == 6.0 and by['Student 06']['overall'] is None and by['Student 06']['rank'] is None,
          'a pending Writing grade is shown as pending, never as 0, and the student is not ranked')
    check(by['Student 07']['participation'] == 'in_progress' and by['Student 08']['participation'] == 'not_started',
          'in-progress and never-started students are listed with their status')
    check(by['Student 05']['participation'] == 'auto_submitted', 'the auto hand-in is distinguished')
    check(rep['stats']['average'] == round((8.0 + 7.5 + 7.5 + 6.5 + 6.0) / 5, 2) and rep['stats']['sample'] == 5,
          'the average uses finalized results only (n=5)')
    c = rep['counts']
    check(c['eligible'] == 8 and c['handedIn'] == 6 and c['autoSubmitted'] == 1 and c['finalized'] == 5 and c['awaitingGrading'] == 1
          and c['inProgress'] == 1 and c['notStarted'] == 1, 'participation and grading counts reconcile with the roster')

    # Close the exam: Student 07 is handed in (as the worker would), Student 08 is a non-submitter.
    MockAttempt.objects.filter(id=rows[6].id).update(status='completed', submitted_at=timezone.now(), finished_at=timezone.now(),
                                                     section_bands={'listening': 5.0, 'reading': 5.0}, overall_band=None,
                                                     media_state={ASSIGNMENT_KEY: aid, '__auto_submitted': {'reason': 'deadline'}})
    job(MockAttempt.objects.get(id=rows[6].id), 'writing', status='PENDING')
    HomeworkAssignment.objects.filter(id=aid).update(deadline=timezone.now() - timedelta(minutes=1))
    row.refresh_from_db()
    rep = exam_report.build(row)
    check(rep['stage'] == 'preliminary', 'after closing with pending grades the stage is preliminary')
    check(next(r for r in rep['rows'] if r['name'] == 'Student 08')['participation'] == 'not_submitted', 'never-started becomes not_submitted after closing')
    sent = delivery.sweep()
    board = list(TelegramOutbox.objects.filter(recipient_id=teacher.id, dedupe_key__startswith=f'exam_board:{aid}:preliminary'))
    check(len(board) == 1 and 'DASTLABKI' in board[0].text or 'PRELIMINARY' in board[0].text, 'the preliminary leaderboard is queued automatically')
    text = board[0].text
    check(all(text.count(n) == 1 for n in names), 'every eligible student appears exactly once in the leaderboard')
    check('🥇 1. Student 01 — <b>8.0</b>' in text and 'L: 8.5 | R: 8.0 | W: 7.5 | S: 8.0' in text, 'rank, overall and L/R/W/S are shown')
    check('2. Student 02' in text and '2. Student 03' in text and '4. Student 04' in text, 'the tie shares rank 2 in Telegram as on the website')
    group_rows = list(TelegramOutbox.objects.filter(group_id=gid))
    check(group_rows and all(n not in r.text for r in group_rows for n in names), 'the classroom group report contains no student names')
    check(not TelegramOutbox.objects.filter(recipient_id=stranger.id).exists(), 'an unrelated teacher receives nothing')
    before = TelegramOutbox.objects.count()
    delivery.sweep()
    delivery.sweep()
    check(TelegramOutbox.objects.count() == before, 'repeated sweeps (or a restart) queue no duplicate report')

    # Late advisory job after the teacher's final grade: no change.
    late = job(rows[4], 'writing', final=5.5)
    AssessmentJob.objects.filter(id=late.id).update(status='PROCESSING', lease_token='stale', final_score_source='TEACHER')
    late.refresh_from_db()
    AssessmentJob.objects.filter(id=late.id).update(lease_token=None, status='SUCCEEDED')  # teacher finalized meanwhile
    revision = exam_report.build(row)['revision']
    try:
        service.finish(late, {'confidence': 0.9, 'parts': []}, None, False)
        stale_refused = False
    except Exception as error:  # noqa: BLE001
        stale_refused = 'STALE' in str(getattr(error, 'contract_code', error))
    service.fail_job(late, 'PROVIDER_TIMEOUT', True, False)
    late.refresh_from_db()
    check(stale_refused and late.final_score == 5.5 and late.final_score_source == 'TEACHER' and late.status == 'SUCCEEDED',
          'a late advisory result under a stale lease cannot touch the teacher-final grade')
    check(exam_report.build(row)['revision'] == revision, 'the report revision is unchanged by the late advisory job')
    AssessmentJob.objects.filter(id=late.id).delete()

    # Teacher grades the remaining responses -> final.
    AssessmentJob.objects.filter(id=pending_w.id).update(status='SUCCEEDED', final_score=6.5, teacher_score=6.5, final_score_source='TEACHER')
    MockAttempt.objects.filter(id=rows[5].id).update(status='completed', overall_band=6.5,
                                                     section_bands={'listening': 7.0, 'reading': 6.5, 'writing': 6.5, 'speaking': 6.0})
    AssessmentJob.objects.filter(attempt_id=rows[6].id).update(status='SUCCEEDED', final_score=5.0, teacher_score=5.0, final_score_source='TEACHER')
    MockAttempt.objects.filter(id=rows[6].id).update(overall_band=5.0, section_bands={'listening': 5.0, 'reading': 5.0, 'writing': 5.0})
    rep = exam_report.build(row)
    check(rep['stage'] == 'final' and rep['counts']['finalized'] == 7, 'once every handed-in result is teacher-final the stage is final')
    delivery.sweep()
    final = list(TelegramOutbox.objects.filter(recipient_id=teacher.id, dedupe_key__startswith=f'exam_board:{aid}:final'))
    check(len(final) == 1 and 'YAKUNIY NATIJALAR' in final[0].text and 'Student 08' in final[0].text, 'the final leaderboard is queued, non-submitter listed')
    check(final[0].keyboard and final[0].keyboard[0][0]['url'].endswith(f'/teacher/results/exam/{aid}'), 'the leaderboard links to the authenticated Result Center')
    st = ExamReportState.objects.get(assignment_id=aid)
    check(st.final_version == 1 and st.final_at is not None, 'the final report state is durable')
    check(delivery.deliver(aid)['reason'] == 'unchanged', 'an unchanged final report is not sent again')
    # Authorized correction -> revised report.
    MockAttempt.objects.filter(id=rows[3].id).update(overall_band=7.0)
    out = delivery.deliver(aid)
    revised = TelegramOutbox.objects.filter(recipient_id=teacher.id, dedupe_key__startswith=f'exam_board:{aid}:final').order_by('-id').first()
    check(out['version'] == 2 and 'tuzatilgan versiya 2' in revised.text, 'a grade correction produces one labelled revised report')

    # Website API, authorization, Excel.
    web = api(teacher).get(f'/v1/teacher/exam-assignments/{aid}/results?limit=3')
    check(web.status_code == 200 and web.data['data']['pagination']['total'] == 8 and len(web.data['data']['rows']) == 3,
          'the Result Center API paginates the full roster')
    full = api(teacher).get(f'/v1/teacher/exam-assignments/{aid}/results').data['data']['rows']
    web_ranks = {r['name']: r['rank'] for r in full}
    check(all(f"{web_ranks[n]}. {n}" in revised.text for n in names[:7]), 'website and Telegram ranks agree')
    check(api(stranger).get(f'/v1/teacher/exam-assignments/{aid}/results').status_code == 404, 'an unrelated teacher gets 404')
    check(api(s[0]).get(f'/v1/teacher/exam-assignments/{aid}/results').status_code == 403, 'a student cannot open the Result Center')
    check(api(teacher).post(f'/v1/teacher/exam-assignments/{aid}/results/resend', {}, format='json').status_code == 400,
          'a resend without explicit confirmation is refused')
    resend = api(teacher).post(f'/v1/teacher/exam-assignments/{aid}/results/resend', {'confirm': True}, format='json')
    check(resend.status_code == 201 and resend.data['data']['queued'] == 1, 'a confirmed manual resend queues the current report once')
    from apps.legacy_schema.models import User
    User.objects.filter(id=s[7].id).update(name='=HYPERLINK("http://x")')
    xlsx = api(teacher).get(f'/v1/teacher/exam-assignments/{aid}/results/excel')
    import openpyxl
    sheet = openpyxl.load_workbook(BytesIO(b''.join(xlsx.streaming_content) if xlsx.streaming else xlsx.content)).active
    data = list(sheet.iter_rows(min_row=3, values_only=True))
    check(len(data) == 8 and [r[0] for r in data[:7]] == [1, 2, 2, 4, 5, 6, 7], 'Excel has every student with the same ranks')
    check(any(isinstance(r[1], str) and r[1].startswith("'=") for r in data), 'a formula-like name is neutralised in Excel')

    # Large class with HTML-special names: paging, every student exactly once.
    big = dict(rep)
    big['rows'] = [dict(r, name=f'<Talaba & {i:03d}>', studentId=f'b{i}', rank=i + 1, overall=9 - i / 20,
                        scores={'listening': 7.0, 'reading': 7.0, 'writing': 6.5, 'speaking': 6.5}) for i, r in enumerate([rep['rows'][0]] * 120)]
    pages = delivery.pages(big, 'uz')
    joined = '\n'.join(pages)
    check(len(pages) > 1 and all(len(p) <= 4096 for p in pages), f'a 120-student leaderboard is split into {len(pages)} pages under the Telegram limit')
    check(all(joined.count(f'&lt;Talaba &amp; {i:03d}&gt;') == 1 for i in range(120)), 'every student appears exactly once, HTML-escaped')
finally:
    TelegramClassroomBinding.objects.filter(group_id__in=fx.groups).delete()
    fx.cleanup()
print(f'BESTWAY 5.1 exam reports: {len(checks)}/{len(checks)} PASS')
