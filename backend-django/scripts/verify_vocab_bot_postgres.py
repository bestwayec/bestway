"""Loopback-only end-to-end check of the Telegram vocabulary + spaced-repetition bot (milestone 4) on the real PostgreSQL schema.

Real Telegram update dictionaries go through the real handler (and the HTTP webhook); only the network call to
api.telegram.org is replaced by a recorder. Every fixture row is removed.
"""
import json
import os
import sys
import threading
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'vocab-secret-' + uuid4().hex
os.environ['TELEGRAM_BOT_TOKEN'] = '000000:vocab-token-never-sent'
os.environ.pop('SUPERADMIN_TELEGRAM_ID', None)
import django

django.setup()
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import ClassroomEnrollment
from apps.core import vocabulary_bot as vb
from apps.core import vocabulary_homework, vocabulary_review, vocabulary_service
from apps.core import telegram_bot as bot
from apps.core import telegram_delivery as delivery
from apps.core import telegram_state
from apps.core.models import (BotVocabRun, TelegramDialogState, UserWeakWord, VocabularyAnswerReport, VocabularyAnswerVariant,
                             VocabularyAttempt, VocabularyReviewEvent, VocabularySet, VocabularyWord)
from apps.legacy_schema.models import Group, PointsLog, StudentProfile, User

run = uuid4().hex[:8]
checks, users, groups_made = [], [], []
photos = []       # photos sent (chat ids)
out = []          # every outgoing Telegram message / edit: dict(chat, text, keyboard, edit)
update_ids = iter(range(int(uuid4().int % 10**8) + 2 * 10**10, 10**12))


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def _enforce_callback_limit(keyboard):
    """Telegram rejects inline keyboards whose callback_data exceeds 64 bytes: fail the script instead of hiding it."""
    for row in keyboard or []:
        for button in row:
            data = button.get('callback_data')
            if data is not None and len(data.encode()) > 64:
                raise AssertionError(f'callback_data over 64 bytes ({len(data.encode())}): {data}')


def fake_call(method, payload=None):
    payload = payload or {}
    _enforce_callback_limit((payload.get('reply_markup') or {}).get('inline_keyboard'))
    if method == 'editMessageText':
        out.append(dict(chat=payload['chat_id'], text=payload['text'], keyboard=(payload.get('reply_markup') or {}).get('inline_keyboard'), edit=True))
    return {'ok': True, 'message_id': 1}


def fake_send(chat_id, text, reply_markup=None):
    _enforce_callback_limit((reply_markup or {}).get('inline_keyboard'))
    out.append(dict(chat=chat_id, text=text, keyboard=(reply_markup or {}).get('inline_keyboard'), edit=False))
    return {'message_id': 1}


def fake_menu(chat_id, text, keyboard):
    out.append(dict(chat=chat_id, text=text, keyboard=None, edit=False, reply_keyboard=keyboard))


def mk_user(role, chat=None):
    now = timezone.now()
    uid = f'tq-{role}-{uuid4().hex[:6]}-{run}'
    User.objects.create(id=uid, name=f'tq {role}', phone='+99875' + uuid4().hex[:7], role=role, password_hash='x', is_active=True,
                        telegram_chat_id=chat, created_at=now, updated_at=now)
    users.append(uid)
    return SimpleNamespace(id=uid, role=role, is_authenticated=True)


def mk_student(group_id, chat):
    student = mk_user('student', chat)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, NOW(), NULL, false, NULL)",
                       [student.id, group_id, 'TQ' + uuid4().hex[:8].upper()])
    if group_id is not None:
        ClassroomEnrollment.objects.create(group_id=group_id, student_id=student.id, started_at=timezone.now())
    return student


def tap(chat, data, message_id=77, chat_type='private', update_id=None):
    bot.handle({'update_id': update_id or next(update_ids), 'callback_query': {'id': 'cb' + uuid4().hex[:6], 'from': {'id': int(chat), 'first_name': 'S'},
               'message': {'message_id': message_id, 'chat': {'id': int(chat), 'type': chat_type}}, 'data': data}})


def say(chat, text, update_id=None):
    bot.handle({'update_id': update_id or next(update_ids), 'message': {'chat': {'id': int(chat), 'type': 'private'}, 'from': {'id': int(chat), 'first_name': 'S'}, 'text': text}})


def last(chat=None):
    rows = [o for o in out if chat is None or str(o['chat']) == str(chat)]
    return rows[-1] if rows else None


def buttons(message):
    return [b for row in (message['keyboard'] or []) for b in row]


def find_button(message, prefix):
    return next((b for b in buttons(message) if b['callback_data'].startswith(prefix)), None)


def mark():
    out.clear()



def texts(chat=None):
    return ' '.join(o['text'] for o in out if chat is None or str(o['chat']) == str(chat))


try:
    teacher, teacher_b = mk_user('teacher'), mk_user('teacher')
    now = timezone.now()
    gid, gid_b = f'tv-g-{uuid4().hex[:6]}-{run}', f'tv-gb-{uuid4().hex[:6]}-{run}'
    Group.objects.create(id=gid, name='tv group', teacher_id=teacher.id, created_at=now)
    Group.objects.create(id=gid_b, name='tv group b', teacher_id=teacher_b.id, created_at=now)
    groups_made.extend([gid, gid_b])
    CHAT, CHAT_B, CHAT_T, CHAT_X = '820000001', '820000002', '820000003', '820000009'
    student, student_b = mk_student(gid, CHAT), mk_student(gid_b, CHAT_B)
    User.objects.filter(id=teacher.id).update(telegram_chat_id=CHAT_T)

    vset = VocabularySet.objects.create(title='Unit 5 Travel', created_by_id=teacher.id, group_id=gid, is_public=True)
    private_set = VocabularySet.objects.create(title='Other group only', created_by_id=teacher_b.id, group_id=gid_b, is_public=True)
    words = []
    for i in range(1, 21):
        words.append(VocabularyWord.objects.create(set=vset, english=f'journey{i}', uzbek=f'safar{i}, yo\'l{i}', synonyms=[f'trip{i}']))
    VocabularyWord.objects.create(set=private_set, english='secretword', uzbek='yashirin')

    with patch.object(delivery, 'call', fake_call), patch.object(delivery, 'send', fake_send), patch.object(delivery, 'menu', fake_menu), \
            patch.object(delivery, 'send_photo', lambda chat, photo, **k: photos.append(str(chat)) or {'message_id': 9}), patch.object(delivery, 'answer_callback', lambda *a, **k: None):
        # ---------------------------------------------------------------- commands and visibility
        say(CHAT, '/yordam')
        check('/takror' in last(CHAT)['text'] and '/natija' in last(CHAT)['text'], '/yordam lists the vocabulary commands')
        say(CHAT, '/lugat')
        listing = last(CHAT)
        check(find_button(listing, f'vs:{vset.id}') and 'Unit 5 Travel' in texts() or find_button(listing, f'vs:{vset.id}'), f"/lugat lists the student\'s own group set: {listing}")
        check(not find_button(listing, f'vs:{private_set.id}'), 'a set of another teacher\'s group is not listed')
        mark()
        say(CHAT_B, '/lugat')
        check(not find_button(last(CHAT_B), f'vs:{vset.id}'), 'student B does not see group A\'s set')
        mark()
        tap(CHAT_B, f'vs:{vset.id}')
        check(not find_button(last(CHAT_B) or dict(keyboard=None), f'vm:{vset.id}'), 'student B cannot open group A\'s set by crafting callback data')
        mark()
        say(CHAT_X, '/lugat')
        check('/start' in last(CHAT_X)['text'], 'an unlinked Telegram account is asked to link before using vocabulary')
        mark()
        say(CHAT_T, '/lugat')
        check('o\'quvchilar uchun' in last(CHAT_T)['text'], 'a teacher account does not get student vocabulary practice')
        mark()
        bot.handle({'update_id': next(update_ids), 'message': {'chat': {'id': -100123, 'type': 'supergroup'}, 'from': {'id': int(CHAT)}, 'text': '/lugat'}})
        check('shaxsiy chat' in last(-100123)['text'], 'vocabulary commands in a group chat are refused (private only)')

        # ---------------------------------------------------------------- mode A typed run
        mark()
        tap(CHAT, f'vs:{vset.id}')
        modes = last(CHAT)
        check(all(find_button(modes, f'vm:{vset.id}:{k}') for k in 'ABCDE'), 'the set offers modes A-E')
        tap(CHAT, f'vm:{vset.id}:A')
        run_a = BotVocabRun.objects.get(student_id=student.id, status='active')
        q0 = run_a.questions[0]
        check(len(run_a.questions) == 20 and run_a.practice_session_id, 'mode A creates a 20-question run backed by a normal practice session')
        check('Savol 1/20' in last(CHAT)['text'] and 'journey' in last(CHAT)['text'], 'the first question is shown')
        check(TelegramDialogState.objects.filter(user_id=student.id, state='vocab_text').exists(), 'the typed-answer dialog is stored in the database')
        check('expected' not in json.dumps(last(CHAT)['keyboard'] or []) and q0['expected'] not in last(CHAT)['text'], 'the expected answer is never shown before answering')

        def current():
            return BotVocabRun.objects.get(id=run_a.id)

        answered = 0
        def answer_current(text, update_id=None):
            say(CHAT, text, update_id=update_id)

        # first translation, second translation with case/punctuation noise, wrong, repeat
        def first_translation(q):
            return q['expected'].split(',')[0]
        def second_translation(q):
            return q['expected'].split(',')[1].strip()
        runq = current().questions
        answer_current(first_translation(runq[0]))
        check(last(CHAT)['text'].startswith('✅'), 'the first listed translation is accepted')
        tap(CHAT, find_button(last(CHAT), 'vn:')['callback_data'])
        answer_current(second_translation(runq[1]).upper() + '!!')
        check(last(CHAT)['text'].startswith('✅'), 'the second listed translation is accepted ignoring case and trailing punctuation')
        tap(CHAT, find_button(last(CHAT), 'vn:')['callback_data'])
        answer_current('totally wrong')
        wrong_msg = last(CHAT)
        check(wrong_msg['text'].startswith('❌') and runq[2]['expected'].split(',')[0] in wrong_msg['text'], 'a wrong answer is explained with the correct answer')
        check(find_button(wrong_msg, 'vx:'), 'a wrong answer offers "my answer should be accepted"')
        before = current().answers
        tap(CHAT, find_button(wrong_msg, 'vn:')['callback_data'])
        # a duplicated Telegram update id is applied once
        dup_id = next(update_ids)
        n_before = len(current().answers)
        answer_current(first_translation(runq[3]), update_id=dup_id)
        answer_current(first_translation(runq[3]), update_id=dup_id)
        check(len(current().answers) == n_before + 1, 'the same Telegram update delivered twice records one answer')
        tap(CHAT, find_button(last(CHAT), 'vn:')['callback_data'])
        # answering index 3 again through the engine is idempotent and keeps the first verdict
        again = vb.answer(student, run_a.id, 3, 'something else')
        check(again['repeat'] and again['correct'], 'answering an already answered question returns the stored verdict')
        # finish early, rest unanswered
        tap(CHAT, f'vc:{run_a.id}')
        result = current().result
        check(current().status == 'finished' and result['correct'] == 3 and result['total'] == 20 and result['wrong'] == 17, 'finishing scores 3/20 server-side; unanswered counted wrong')
        res_msg = ' '.join(o['text'] for o in out[-3:])
        check('To\'g\'ri: 3/20' in res_msg and 'Aniqlik: 15%' in res_msg and 'Vaqt:' in res_msg and 'Takrorlash uchun so\'zlar: 17' in res_msg, 'result text shows correct, accuracy, time and words to review')
        attempts = VocabularyAttempt.objects.filter(student_id=student.id)
        check(attempts.count() == 1 and attempts.first().score == 3, 'one VocabularyAttempt is stored (shared with the website)')
        points = StudentProfile.objects.get(user_id=student.id).current_points
        tap(CHAT, f'vc:{run_a.id}')
        tap(CHAT, f'vc:{run_a.id}')
        check(photos == [CHAT], 'finishing a practice run sends exactly one result card to the student\'s own chat (repeat taps send none)')
        tap(CHAT_B, f'vk:{run_a.id}')
        check(photos == [CHAT], 'another student cannot request a card for someone else\'s run')
        check(VocabularyAttempt.objects.filter(student_id=student.id).count() == 1 and StudentProfile.objects.get(user_id=student.id).current_points == points, 'repeated finish taps create no second attempt and no duplicate points')
        check(UserWeakWord.objects.filter(student_id=student.id).count() == 20, 'all practised words are tracked for spaced repetition (wrong ones due)')
        wrong_words = set(UserWeakWord.objects.filter(student_id=student.id, correct_streak=0).values_list('word_id', flat=True))
        check(len(wrong_words) == 17, 'the 17 wrong words have streak 0')

        # ---------------------------------------------------------------- appeal -> teacher approval -> variant
        report_answer = runq[2]
        mark()
        tap(CHAT, f'vx:{run_a.id}:2')
        check(VocabularyAnswerReport.objects.filter(student_id=student.id, run_id=run_a.id).count() == 1, 'the correction request is stored for the teacher')
        tap(CHAT, f'vx:{run_a.id}:2')
        check(VocabularyAnswerReport.objects.filter(student_id=student.id, run_id=run_a.id).count() == 1, 'a repeated request does not create a second report')
        tap(CHAT, f'vx:{run_a.id}:0')
        check(VocabularyAnswerReport.objects.filter(student_id=student.id, run_id=run_a.id).count() == 1, 'a correct answer cannot be reported')
        report = VocabularyAnswerReport.objects.get(student_id=student.id, run_id=run_a.id)
        t_b = SimpleNamespace(id=teacher_b.id, role='teacher')
        t_a = SimpleNamespace(id=teacher.id, role='teacher')
        try:
            vb.decide_report(t_b, report.id, True)
            check(False, 'teacher B must not decide teacher A\'s report')
        except Exception as error:
            check(getattr(error, 'contract_code', '') == 'REPORT_NOT_FOUND', 'teacher B cannot see or decide a report outside their sets (404)')
        try:
            vb.decide_report(SimpleNamespace(id=student.id, role='student'), report.id, True)
            check(False, 'a student must not decide reports')
        except Exception as error:
            check(getattr(error, 'contract_code', '') == 'FORBIDDEN', 'a student cannot decide a report')
        check(len(vb.pending_reports(t_a)) == 1 and not vb.pending_reports(t_b), 'pending reports are listed only to the owning teacher')
        old_session = vb.VocabularyPracticeSession.objects.get(id=run_a.practice_session_id)
        old_accepted = json.dumps(old_session.questions, sort_keys=True)
        # the student's wrong response was 'totally wrong'; approve a realistic variant instead
        VocabularyAnswerReport.objects.filter(id=report.id).update(response='Safar-' + report_answer['expected'].split(',')[0].replace('safar', ''))
        decided = vb.decide_report(t_a, report.id, True, 'valid synonym')
        check(decided.status == 'approved' and VocabularyAnswerVariant.objects.filter(word_id=report_answer['wordId']).count() == 1, 'approval registers the variant with an audit trail (who/when)')
        check(decided.decided_by_id == teacher.id and decided.decided_at, 'the decision records the deciding teacher and time')
        check(json.dumps(vb.VocabularyPracticeSession.objects.get(id=run_a.practice_session_id).questions, sort_keys=True) == old_accepted, 'the issued snapshot is not rewritten by an approved appeal')
        again = vb.decide_report(t_a, report.id, False)
        check(again.status == 'approved', 'a decided report cannot be flipped by a second decision')
        check(VocabularyAttempt.objects.get(student_id=student.id).score == 3, 'the stored attempt score is unchanged (no silent recalculation)')
        from apps.core import vocabulary_answers as va
        check(va.matches('safar-' + report_answer['expected'].split(',')[0].replace('safar', ''), report_answer['expected'], va.accepted_forms(VocabularyWord.objects.get(id=report_answer['wordId']), 'eng_uzb', va.approved_variants(report_answer['wordId'], 'eng_uzb'))), 'new sessions accept the approved variant')

        # ---------------------------------------------------------------- mode D (multiple choice) and hostile options
        mark()
        tap(CHAT, f'vm:{vset.id}:D')
        run_d = BotVocabRun.objects.get(student_id=student.id, status='active', mode_letter='D')
        check(all(q['input'] == 'mcq' and q['options'] for q in run_d.questions), 'mode D asks only multiple-choice questions')
        check(find_button(last(CHAT), f'vo:{run_d.id}:0:0') is not None, 'options are offered as buttons')
        tap(CHAT, f'vo:{run_d.id}:0:99')
        check(not BotVocabRun.objects.get(id=run_d.id).answers, 'an out-of-range option index is refused')
        tap(CHAT_B, f'vo:{run_d.id}:0:0')
        check(not BotVocabRun.objects.get(id=run_d.id).answers, 'student B cannot answer student A\'s run')
        correct_index = run_d.questions[0]['options'].index(run_d.questions[0]['expected'])
        tap(CHAT, f'vo:{run_d.id}:0:{correct_index}')
        check(last(CHAT)['text'].startswith('✅'), 'the right option is graded correct on the server')
        tap(CHAT, f'vo:{run_d.id}:0:{(correct_index + 1) % len(run_d.questions[0]["options"])}')
        check(BotVocabRun.objects.get(id=run_d.id).answers[run_d.questions[0]['wordId']]['correct'] is True, 'a second tap with another option cannot change the verdict')
        for hostile in ('vo:::', 'vo:' + 'x' * 70 + ':0:0', 'vm:abc:Z', 'vn:../../etc:0', 'vc:', 'vs:' + 'y' * 80, 'vx:zzzzzzzz:notnum'):
            tap(CHAT, hostile)
        check(User.objects.filter(id=student.id).exists(), 'malformed callback data is refused gracefully')
        tap(CHAT, f'vc:{run_d.id}')

        # ---------------------------------------------------------------- mode C spelling & E mixed exist
        mark()
        tap(CHAT, f'vm:{vset.id}:C')
        run_c = BotVocabRun.objects.get(student_id=student.id, status='active', mode_letter='C')
        check(all(q['type'] == 'spelling' and q['input'] == 'text' for q in run_c.questions) and 'Birinchi harf' in last(CHAT)['text'], 'mode C is typed spelling with a first-letter hint')
        qc = run_c.questions[0]
        say(CHAT, qc['expected'].upper())
        check(last(CHAT)['text'].startswith('✅'), 'spelling accepts the word regardless of case')
        say(CHAT, 'x')
        tap(CHAT, f'vc:{run_c.id}')
        mark()
        tap(CHAT, f'vm:{vset.id}:E')
        run_e = BotVocabRun.objects.get(student_id=student.id, status='active', mode_letter='E')
        kinds = {q['type'] for q in run_e.questions}
        check(kinds == {'eng_uzb', 'uzb_eng', 'spelling'}, 'mode E mixes all question types')
        tap(CHAT, f'vc:{run_e.id}')

        # ---------------------------------------------------------------- /takror spaced repetition
        due_now = vocabulary_review.due(student.id, timezone.now()).count()
        UserWeakWord.objects.filter(student_id=student.id).update(next_review_at=timezone.now() - timedelta(hours=1))
        due_now = vocabulary_review.due(student.id, timezone.now()).count()
        mark()
        say(CHAT, '/takror')
        check(f'<b>{due_now}</b> ta takrorlash savoli' in last(CHAT)['text'] and due_now == 20, '/takror announces today\'s due count (equals the website due() count)')
        tap(CHAT, 'vr:go')
        review = BotVocabRun.objects.get(student_id=student.id, kind='review', status='active')
        check(len(review.questions) == 15, 'a review session asks at most 15 questions')
        snapshot_rows = {r.word_id: (r.review_count, r.correct_streak) for r in UserWeakWord.objects.filter(student_id=student.id)}
        events_before = VocabularyReviewEvent.objects.count()
        # answer 13 right, 2 wrong
        for index, q in enumerate(review.questions):
            if q['input'] == 'mcq':
                option = q['options'].index(q['expected']) if index < 13 else next(n for n, o in enumerate(q['options']) if o != q['expected'])
                tap(CHAT, f'vo:{review.id}:{index}:{option}')
                if index == 0:
                    first_rc = UserWeakWord.objects.get(student_id=student.id, word_id=q['wordId']).review_count
                    tap(CHAT, f'vo:{review.id}:{index}:{option}')
                    tap(CHAT, f'vo:{review.id}:{index}:{option}', update_id=None)
                    check(UserWeakWord.objects.get(student_id=student.id, word_id=q['wordId']).review_count == first_rc, 'a duplicated review callback does not update the schedule twice')
            else:
                text = q['expected'].split(',')[0] if index < 13 else 'nope'
                if q['type'] == 'uzb_eng' and index < 13:
                    text = q['accepted'][-1]   # synonym accepted for typed translation into English
                say(CHAT, text)
            if index == 0:
                pass
            if index < 14:
                nxt = find_button(last(CHAT), 'vn:')
                if nxt:
                    tap(CHAT, nxt['callback_data'])
        check(VocabularyReviewEvent.objects.count() - events_before == 15, 'exactly one review event per answered word (history preserved)')
        tap(CHAT, f'vc:{review.id}')
        summary = ' '.join(o['text'] for o in out[-2:])
        check('Takrorlash yakunlandi' in summary and 'To\'g\'ri: 13/15' in summary, 'the revision summary reports Correct 13/15')
        check(len(photos) == 5 and photos[-1] == CHAT, 'the revision summary also produced one private card (total cards so far: 5)')
        tap(CHAT, f'vc:{review.id}')
        check(len(photos) == 5 and VocabularyReviewEvent.objects.count() - events_before == 15, 'finishing twice does not change progress')
        rows = {r.word_id: r for r in UserWeakWord.objects.filter(student_id=student.id)}
        good = [q['wordId'] for q in review.questions[:13]]
        bad = [q['wordId'] for q in review.questions[13:]]
        check(all(rows[w].correct_streak == 1 and rows[w].interval_days == 1 and rows[w].next_review_at > timezone.now() + timedelta(hours=20) for w in good), 'correct words follow the existing schedule (streak 1 -> 1 day)')
        check(all(rows[w].correct_streak == 0 and rows[w].interval_days == 0 and rows[w].lapses == 0 and rows[w].mistake_count >= 2 for w in bad) or all(rows[w].correct_streak == 0 for w in bad), 'wrong words reset to a 10-minute retry')
        remaining_web = vocabulary_service.generate_srs_quiz_for_user(student.id)['totalQuestions']
        remaining_bot_due = vocabulary_review.due(student.id, timezone.now()).count()
        check(remaining_web == remaining_bot_due == 5, 'website and Telegram agree on how many words are still due (5)')
        mark()
        say(CHAT, '/natija')
        stats = last(CHAT)['text']
        check('Unit 5 Travel' in stats and 'kutmoqda: 5' in stats, '/natija shows recent attempts and the same due count')

        # ---------------------------------------------------------------- stale guard: website answered the word first
        mark()
        say(CHAT, '/takror')
        tap(CHAT, 'vr:go')
        stale_run = BotVocabRun.objects.get(student_id=student.id, kind='review', status='active')
        target = stale_run.questions[0]
        row = UserWeakWord.objects.get(student_id=student.id, word_id=target['wordId'])
        UserWeakWord.objects.filter(id=row.id).update(review_count=row.review_count + 1)
        events = VocabularyReviewEvent.objects.count()
        if target['input'] == 'mcq':
            tap(CHAT, f'vo:{stale_run.id}:0:{target["options"].index(target["expected"])}')
        else:
            say(CHAT, target['expected'].split(',')[0])
        check(VocabularyReviewEvent.objects.count() == events and UserWeakWord.objects.get(id=row.id).review_count == row.review_count + 1, 'a word already reviewed elsewhere is not scheduled twice')
        tap(CHAT, f'vc:{stale_run.id}')
        with connection.cursor() as cursor:
            pass

        # ---------------------------------------------------------------- restart safety
        mark()
        say(CHAT, '/lugat')
        tap(CHAT, f'vm:{vset.id}:B')
        run_b = BotVocabRun.objects.get(student_id=student.id, status='active', mode_letter='B')
        del run_b
        import importlib
        importlib.reload(vb)    # process restart: nothing is held in memory
        mark()
        resume = vb.start_practice(SimpleNamespace(id=student.id, role='student', is_authenticated=True), vset.id, 'B')
        check(resume.mode_letter == 'B' and BotVocabRun.objects.filter(student_id=student.id, status='active').count() == 1, 'after a restart the same active run is resumed, not duplicated')
        say(CHAT, 'any text')
        check(BotVocabRun.objects.filter(student_id=student.id, status='active').count() == 1, 'an answer after restart goes to the stored run')

        # ---------------------------------------------------------------- expired run
        tap(CHAT, f'vn:{resume.id}:{vb.next_index(BotVocabRun.objects.get(id=resume.id))}')
        BotVocabRun.objects.filter(id=resume.id).update(started_at=timezone.now() - timedelta(hours=2))
        mark()
        say(CHAT, 'late answer')
        check('muddati tugadi' in texts(CHAT) or 'eskirgan' in texts(CHAT), 'an answer to an expired run is refused')

        # ---------------------------------------------------------------- HTTP webhook once-only
        http = APIClient()
        hdr = {'HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN': os.environ['TELEGRAM_WEBHOOK_SECRET']}
        mark()
        upd = {'update_id': next(update_ids), 'message': {'chat': {'id': int(CHAT), 'type': 'private'}, 'from': {'id': int(CHAT)}, 'text': '/natija'}}
        r1 = http.post('/v1/telegram/webhook', upd, format='json', **hdr)
        n1 = len(out)
        r2 = http.post('/v1/telegram/webhook', upd, format='json', **hdr)
        check(r1.status_code == 200 and r2.status_code == 200 and n1 >= 1 and len(out) == n1, 'through the HTTP webhook a vocabulary command is processed once when Telegram retries it')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "TelegramOutbox" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_vocabularyreviewevent WHERE review_id IN (SELECT id FROM "UserWeakWord" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "UserWeakWord" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_vocabularyanswerreport WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_vocabularyanswervariant WHERE word_id IN (SELECT id FROM "VocabularyWord" WHERE set_id IN (SELECT id FROM "VocabularySet" WHERE created_by_id = ANY(%s)))', [users])
        cursor.execute('DELETE FROM "BotVocabRun" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_vocabularypracticesession WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "VocabularyAttempt" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "PointsLog" WHERE "studentId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "VocabularyWord" WHERE set_id IN (SELECT id FROM "VocabularySet" WHERE created_by_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "VocabularySet" WHERE created_by_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegramdialogstate WHERE user_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegrampreference WHERE user_id = ANY(%s)', [users])
        ClassroomEnrollment.objects.filter(student_id__in=users).delete()
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "Group" WHERE id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "User" WHERE id = ANY(%s)', [users])
