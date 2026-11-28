"""Notification producers (all durable: they only insert TelegramOutbox rows) and the periodic sweeps.

Nothing here talks to Telegram. The worker (`run_telegram_outbox`) calls `tick()`: sweeps enqueue what is due
(deadline reminders, daily vocabulary review, closed-test summaries) and then the outbox delivers. Every producer uses
a deterministic dedupe key, so running a sweep twice, after a restart, or from two workers creates one message.
"""
from __future__ import annotations

import html
import logging
import os
from datetime import timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from django.db.models import Q
from django.utils import timezone

from apps.legacy_schema.models import Group, MockAttempt, User

from .classroom_roster import member_profiles
from . import telegram_outbox as outbox
from . import telegram_state as state
from .models import (
    ClassQuizAppeal,
    ClassQuizAssignment,
    ClassQuizAttempt,
    HomeworkAssignment,
    HomeworkSubmission,
    TelegramClassroomBinding,
    UserWeakWord,
)

logger = logging.getLogger(__name__)
TASHKENT = ZoneInfo('Asia/Tashkent')
VOCAB_HOUR = 17            # local hour from which the daily review reminder may go out
CLOSED_WINDOW = timedelta(hours=48)

T = {
    'uz': dict(
        deadline24='⏰ <b>{title}</b> testi muddati yaqin: {when} gacha topshiring.', deadline2="⏰ <b>{title}</b> testi tugashiga 2 soatdan kam qoldi!",
        vocab_due="🔁 Bugun sizda <b>{n}</b> ta takrorlash savoli bor. /takror", result_ready="📊 <b>{title}</b> natijasi tayyor: {c}/{n} ({p}%)",
        result_corrected="✅ <b>{title}</b> natijangiz o'qituvchi qarori bilan yangilandi: {p}%", closed="🏁 <b>{title}</b> testi yopildi.\nTopshirganlar: {s}/{t}\nO'rtacha: {a}%",
        appeal_ok="✅ Javobingiz qabul qilindi (<b>{title}</b>). Natijangiz qayta hisoblandi.", appeal_no="❌ Javobingiz qabul qilinmadi (<b>{title}</b>).{note}",
        vocab_ok="✅ O'qituvchi javobingizni qabul qildi: <b>{word}</b>.", vocab_no="❌ O'qituvchi javobingizni qabul qilmadi: <b>{word}</b>.{note}",
        attendance_absent="📅 {day} kuni darsda qatnashmagansiz.", attendance_late="📅 {day} kuni darsga kech qoldingiz.", attendance_present="📅 {day}: davomat belgilandi ✅",
        note='\nIzoh: {x}', feedback="👨‍🏫 <b>{teacher}</b> sizga fikr bildirdi:\n{text}", appeal_new="✍️ Yangi murojaat: <b>{title}</b>. Ko'rib chiqing.",
        start='▶️ Testni boshlash', review='🔎 Xatolarni ko\'rish', card='🖼 Natija kartasi', open_results='📊 Natijalar',
        new_homework="📝 <b>Yangi uy vazifasi</b>\n{title}\n{detail}Muddat: {when}", open_homework='🌐 Vazifani ochish',
        homework_reminder="⏰ <b>{title}</b> vazifasini hali topshirmadingiz. Muddat: {when}", hw_vocabulary="Lug'at mashqi · {n} ta so'z\n",
        hw_exam='Imtihon\n', hw_lesson='Dars / vazifa\n', hw_questions='{n} ta savol\n',
        group_homework="📢 <b>{group}</b> · Yangi topshiriq: <b>{title}</b>\n{detail}Muddat: {when} (Toshkent vaqti)",
        group_report="📊 <b>{group}</b> · <b>{title}</b> hisoboti\nTopshirganlar: {s}/{t}\nO'rtacha natija: {a}%{provisional}",
        group_report_small="📊 <b>{group}</b> · <b>{title}</b> hisoboti\nTopshirganlar: {s}/{t}\n<i>Kichik guruh maxfiyligi sabab ballar umumiy xabar sifatida berkitildi.</i>{provisional}",
        teacher_report="👨‍🏫 <b>{group}</b> · <b>{title}</b> ustoz hisoboti\nTopshirganlar: {s}/{t}\nO'rtacha: {a}%\nTekshirish kutilmoqda: {pending}{provisional}",
        provisional_note="\n⏳ <i>Taxminiy (Provisional): Writing/Speaking ustoz tasdig'ini kutmoqda.</i>",
    ),
    'en': dict(
        deadline24='⏰ The deadline for <b>{title}</b> is near: submit before {when}.', deadline2='⏰ Less than 2 hours left for <b>{title}</b>!',
        vocab_due='🔁 You have <b>{n}</b> review questions today. /takror', result_ready='📊 Your result for <b>{title}</b> is ready: {c}/{n} ({p}%)',
        result_corrected='✅ Your result for <b>{title}</b> was updated by your teacher: {p}%', closed='🏁 <b>{title}</b> is closed.\nSubmitted: {s}/{t}\nAverage: {a}%',
        appeal_ok='✅ Your answer was accepted (<b>{title}</b>). Your result was recalculated.', appeal_no='❌ Your answer was not accepted (<b>{title}</b>).{note}',
        vocab_ok='✅ Your teacher accepted your answer: <b>{word}</b>.', vocab_no='❌ Your teacher did not accept your answer: <b>{word}</b>.{note}',
        attendance_absent='📅 You were marked absent on {day}.', attendance_late='📅 You were marked late on {day}.', attendance_present='📅 {day}: attendance recorded ✅',
        note='\nNote: {x}', feedback='👨‍🏫 <b>{teacher}</b> left you feedback:\n{text}', appeal_new='✍️ New request: <b>{title}</b>. Please review.',
        start='▶️ Start test', review='🔎 Review mistakes', card='🖼 Result card', open_results='📊 Results',
        new_homework='📝 <b>New homework</b>\n{title}\n{detail}Deadline: {when}', open_homework='🌐 Open homework',
        homework_reminder='⏰ You have not submitted <b>{title}</b> yet. Deadline: {when}', hw_vocabulary='Vocabulary practice · {n} words\n',
        hw_exam='Exam\n', hw_lesson='Lesson / task\n', hw_questions='{n} questions\n',
        group_homework='📢 <b>{group}</b> · New assignment: <b>{title}</b>\n{detail}Deadline: {when} (Asia/Tashkent)',
        group_report='📊 <b>{group}</b> · <b>{title}</b> summary\nSubmitted: {s}/{t}\nAverage: {a}%{provisional}',
        group_report_small='📊 <b>{group}</b> · <b>{title}</b> summary\nSubmitted: {s}/{t}\n<i>Score breakdown suppressed for small-group privacy.</i>{provisional}',
        teacher_report='👨‍🏫 <b>{group}</b> · <b>{title}</b> teacher summary\nSubmitted: {s}/{t}\nAverage: {a}%\nAwaiting grading: {pending}{provisional}',
        provisional_note='\n⏳ <i>Provisional: Writing/Speaking awaits teacher confirmation.</i>',
    ),
}


def tx(user_id, key, **kw):
    return T[state.language_of(user_id)][key].format(**kw)


def esc(value):
    return html.escape(str(value or ''), quote=False)


def local(value, lang='uz'):
    return value.astimezone(TASHKENT).strftime('%d.%m.%Y %H:%M')


def _linked_students(group_id):
    ids = list(member_profiles(group_id).values_list('user_id', flat=True))
    return list(User.objects.filter(id__in=ids, is_active=True, role='student').exclude(telegram_chat_id__isnull=True).exclude(telegram_chat_id='').values_list('id', flat=True))


# ------------------------------------------------------------------------------------------------ producers

def quiz_assigned(assignment_id, now=None):
    """New test: the same card the student sees under My Tests (title, questions, limit, deadline) + Start button."""
    from . import class_quiz as cq
    from . import telegram_quiz as tq
    row = ClassQuizAssignment.objects.filter(id=assignment_id).first()
    if row is None:
        return 0
    summary = cq.assignment_summary(row)
    count = 0
    from .teacher_workspace import site_url, student_href
    web = site_url(student_href('quiz', row.id))
    for student_id in _linked_students(row.group_id):
        lang = state.language_of(student_id)
        text, keyboard = tq.assignment_card(lang, summary)
        keyboard = (keyboard or []) + [[dict(text=T[lang]['open_homework'], url=web)]]   # same assignment on the website
        if outbox.enqueue(student_id, 'tests', f'quiz_assigned:{row.id}:{student_id}', text, keyboard, now=now):
            count += 1
    return count


def homework_assigned(assignment_id, now=None):
    """Lesson / vocabulary / exam homework from the website: private DMs + bound group announcement."""
    from .models import HomeworkAssignment
    from .teacher_workspace import homework_kind, site_url, student_href
    row = HomeworkAssignment.objects.select_related('cohort', 'cohort__classroom', 'vocabulary_set').filter(id=assignment_id).first()
    if row is None or not row.cohort.classroom_id:
        return 0
    kind = homework_kind(row)
    words = row.vocabulary_set.words.filter(is_archived=False).count() if row.vocabulary_set_id else 0
    web = site_url(student_href(kind, row.id))
    count = 0
    for student_id in _linked_students(row.cohort.classroom_id):
        if row.participant_ids is not None and student_id not in row.participant_ids:
            continue
        lang = state.language_of(student_id)
        detail = T[lang]['hw_' + kind].format(n=words)
        text = T[lang]['new_homework'].format(title=esc(row.title), detail=detail, when=local(row.deadline))
        if outbox.enqueue(student_id, 'tests', f'homework_assigned:{row.id}:{student_id}', text, [[dict(text=T[lang]['open_homework'], url=web)]], now=now):
            count += 1
    binding = TelegramClassroomBinding.objects.filter(
        group_id=row.cohort.classroom_id,
        is_active=True,
        bot_can_post=True,
    ).first()
    if binding is not None:
        classroom = row.cohort.classroom
        lang = state.language_of(classroom.teacher_id) if classroom and classroom.teacher_id else 'uz'
        detail = T[lang]['hw_' + kind].format(n=words)
        gtext = T[lang]['group_homework'].format(
            group=esc(classroom.name if classroom else row.cohort.name),
            title=esc(row.title),
            detail=detail,
            when=local(row.deadline),
        )
        if outbox.enqueue(
            f'group:{row.cohort.classroom_id}',
            'announcements',
            f'group_homework:{row.id}:{binding.chat_id}',
            gtext,
            [[dict(text=T[lang]['open_homework'], url=web)]],
            now=now,
            group_id=row.cohort.classroom_id,
            chat_id_override=binding.chat_id,
        ):
            count += 1
    return count


def _reminder_windows_hours() -> tuple[int, ...]:
    raw = os.environ.get('TELEGRAM_REMINDER_HOURS', '24,2')
    parsed = []
    for part in str(raw).split(','):
        part = part.strip()
        if part.isdigit() and int(part) > 0:
            parsed.append(int(part))
    return tuple(sorted(set(parsed), reverse=True)) or (24, 2)


def homework_deadline_sweep(now=None, *, windows=None):
    """Queue configurable Tashkent-local reminders for active classroom homework, skipping submitted learners."""
    now = now or timezone.now()
    horizon_list = sorted(set(windows or _reminder_windows_hours()), reverse=True)
    max_h = max(horizon_list)
    count = 0
    for row in HomeworkAssignment.objects.select_related('cohort').filter(
        cohort__classroom_id__isnull=False,
        deadline__gt=now,
        deadline__lte=now + timedelta(hours=max_h),
    ):
        remaining_sec = (row.deadline - now).total_seconds()
        matched_h = None
        for h in sorted(horizon_list):
            if remaining_sec <= h * 3600:
                matched_h = h
                break
        if matched_h is None:
            continue
        done_ids = set(
            HomeworkSubmission.objects.filter(
                assignment=row,
                status__in=('graded', 'awaiting_review', 'awaiting_result', 'submitted'),
            ).values_list('student_id', flat=True)
        )
        if row.exam_id:
            from .classroom_results import assignment_attempts
            from .homework_scoring import ASSIGNMENT_KEY

            done_ids.update(assignment_attempts(MockAttempt.objects.filter(
                exam_id=row.exam_id, submitted_at__isnull=False, status__in=('completed', 'grading'),
            )).filter(media_state__contains={ASSIGNMENT_KEY: row.id}).values_list('student_id', flat=True))
        deadline_stamp = int(row.deadline.timestamp())
        for student_id in _linked_students(row.cohort.classroom_id):
            if student_id in done_ids or (row.participant_ids is not None and student_id not in row.participant_ids):
                continue
            text = tx(
                student_id,
                'homework_reminder',
                title=esc(row.title),
                when=local(row.deadline),
            )
            dedupe = f'hw_deadline:{row.id}:{student_id}:{matched_h}h:{deadline_stamp}'
            if outbox.enqueue(student_id, 'deadlines', dedupe, text, now=now, urgent=matched_h <= 2):
                count += 1
    return count


def homework_group_report(assignment_id: str, *, reason: str = 'closed', now=None) -> dict:
    """Enqueue aggregate classroom group report (small-group privacy aware + provisional labeled) and private teacher report."""
    from apps.legacy_schema.models import AssessmentJob
    from . import homework_scoring

    now = now or timezone.now()
    row = HomeworkAssignment.objects.select_related('cohort', 'cohort__classroom').filter(id=assignment_id).first()
    if row is None or not row.cohort.classroom_id:
        return {'sent': False, 'reason': 'missing_classroom'}
    group_id = row.cohort.classroom_id
    classroom = row.cohort.classroom
    roster_ids = row.participant_ids
    if roster_ids is None:
        roster_ids = list(member_profiles(group_id).values_list('user_id', flat=True))
    total = len(roster_ids)

    for sid in roster_ids:
        homework_scoring.sync_from_exam(row, sid)

    subs = list(HomeworkSubmission.objects.filter(assignment=row, student_id__in=roster_ids))
    submitted_subs = [s for s in subs if s.status in ('graded', 'awaiting_review', 'awaiting_result', 'submitted')]
    graded_subs = [s for s in subs if s.status == 'graded']
    avg = round(sum(s.score_percent for s in graded_subs) / len(graded_subs), 1) if graded_subs else 0
    pending_count = sum(1 for s in subs if s.status in ('awaiting_review', 'awaiting_result'))

    has_provisional = bool(pending_count > 0)
    if row.exam_id and not has_provisional:
        attempt_ids = [s.attempt_id for s in subs if s.attempt_id]
        if attempt_ids:
            has_provisional = AssessmentJob.objects.filter(attempt_id__in=attempt_ids).filter(
                Q(status__in=('PENDING', 'PROCESSING', 'RETRY', 'NEEDS_REVIEW')) | ~Q(final_score_source='TEACHER')
            ).exists()

    if reason == "automatic" and now < row.deadline and (not total or len(submitted_subs) < total):
        return {"sent": False, "reason": "assignment_open"}
    report_key = str(int(now.timestamp())) if reason == "manual" else "provisional" if has_provisional else "final"

    small_group = total < 5 or len(submitted_subs) < 5
    binding = TelegramClassroomBinding.objects.filter(group_id=group_id, is_active=True, bot_can_post=True).first()
    queued_group = False
    queued_teacher = False

    teacher_id = classroom.teacher_id if classroom and classroom.teacher_id else row.cohort.teacher_id
    if binding is not None:
        lang = state.language_of(teacher_id) if teacher_id else 'uz'
        prov = T[lang]['provisional_note'] if has_provisional else ''
        template_key = 'group_report_small' if small_group else 'group_report'
        text = T[lang][template_key].format(
            group=esc(classroom.name if classroom else row.cohort.name),
            title=esc(row.title),
            s=len(submitted_subs),
            t=total,
            a=f'{avg:g}',
            provisional=prov,
        )
        queued_group = bool(
            outbox.enqueue(
                f'group:{group_id}',
                'announcements',
                f'hw_group_report:{row.id}:{reason}:{binding.chat_id}:{report_key}',
                text,
                now=now,
                group_id=group_id,
                chat_id_override=binding.chat_id,
            )
        )

    if teacher_id:
        lang = state.language_of(teacher_id)
        prov = T[lang]['provisional_note'] if has_provisional else ''
        ttext = T[lang]['teacher_report'].format(
            group=esc(classroom.name if classroom else row.cohort.name),
            title=esc(row.title),
            s=len(submitted_subs),
            t=total,
            a=f'{avg:g}',
            pending=pending_count,
            provisional=prov,
        )
        queued_teacher = bool(
            outbox.enqueue(
                teacher_id,
                'teacher',
                f'hw_teacher_report:{row.id}:{reason}:{report_key}',
                ttext,
                now=now,
            )
        )
    return {
        'groupId': group_id,
        'assignmentId': row.id,
        'submitted': len(submitted_subs),
        'total': total,
        'smallGroupSuppressed': small_group,
        'provisional': has_provisional,
        'queuedGroup': queued_group,
        'queuedTeacher': queued_teacher,
    }


def homework_report_sweep(now=None):
    now = now or timezone.now()
    rows = HomeworkAssignment.objects.filter(
        exam_id__isnull=False, cohort__classroom_id__isnull=False,
        deadline__range=(now - CLOSED_WINDOW, now),
    )
    queued = 0
    for assignment_id in rows.values_list("pk", flat=True).iterator():
        report = homework_group_report(assignment_id, reason="automatic", now=now)
        queued += int(report.get("queuedGroup", False)) + int(report.get("queuedTeacher", False))
    return queued


def exam_reports_sweep(now=None):
    """BESTWAY 5.1: durable preliminary/final exam reports (no 48-hour window)."""
    from . import exam_report_delivery
    return exam_report_delivery.sweep(now)


def deadline_sweep(now=None):
    now = now or timezone.now()
    count = 0
    for row in ClassQuizAssignment.objects.filter(status='active', deadline__gt=now, deadline__lte=now + timedelta(hours=24)):
        horizon = '2h' if row.deadline - now <= timedelta(hours=2) else '24h'
        done = set(ClassQuizAttempt.objects.filter(assignment=row, status='submitted').values_list('student_id', flat=True))
        for student_id in _linked_students(row.group_id):
            if student_id in done:
                continue
            text = tx(student_id, 'deadline2' if horizon == '2h' else 'deadline24', title=esc(row.snapshot['title']), when=local(row.deadline))
            keyboard = [[dict(text=T[state.language_of(student_id)]['start'], callback_data=f'qs:{row.id}')]]
            if outbox.enqueue(student_id, 'deadlines', f'quiz_deadline:{row.id}:{student_id}:{horizon}', text, keyboard, now=now, urgent=horizon == '2h'):
                count += 1
    return count


def vocab_due_sweep(now=None):
    """Once per local day, from 17:00: students with due words and a linked chat get one reminder."""
    now = now or timezone.now()
    due = (UserWeakWord.objects.filter(Q(next_review_at__lte=now) | Q(next_review_at__isnull=True, is_mastered=False))
           .values_list('student_id').order_by().distinct())
    counts = {}
    for student_id in {sid for (sid,) in due}:
        counts[student_id] = UserWeakWord.objects.filter(student_id=student_id).filter(
            Q(next_review_at__lte=now) | Q(next_review_at__isnull=True, is_mastered=False)).count()
    linked = set(User.objects.filter(id__in=list(counts), is_active=True, role='student').exclude(telegram_chat_id__isnull=True)
                 .exclude(telegram_chat_id='').values_list('id', flat=True))
    created = 0
    for student_id in linked:
        pref = state.get_preference(student_id)
        zone = outbox._tz(pref.timezone)
        local_now = now.astimezone(zone)
        if local_now.hour < VOCAB_HOUR:
            continue
        keyboard = [[dict(text='🔁', callback_data='vr')]]
        if outbox.enqueue(student_id, 'vocab', f'vocab_due:{student_id}:{local_now.date().isoformat()}', tx(student_id, 'vocab_due', n=counts[student_id]), keyboard, now=now):
            created += 1
    return created


def assignment_closed_sweep(now=None):
    """Teacher gets one summary (counts and average only) after a test closes; this also auto-submits unfinished attempts."""
    from . import class_quiz as cq
    now = now or timezone.now()
    created = 0
    for row in ClassQuizAssignment.objects.filter(deadline__lte=now, deadline__gte=now - CLOSED_WINDOW):
        group = Group.objects.filter(id=row.group_id).first()
        if group is None or not group.teacher_id:
            continue
        teacher = User.objects.filter(id=group.teacher_id, is_active=True).exclude(telegram_chat_id__isnull=True).exclude(telegram_chat_id='').first()
        if teacher is None:
            continue
        overview = cq.assignment_overview(SimpleNamespace(id=teacher.id, role='teacher'), row.id)
        scores = [p['bestPercent'] for p in overview['participants'] if p['bestPercent'] is not None]
        average = round(sum(scores) / len(scores), 1) if scores else 0
        text = tx(teacher.id, 'closed', title=esc(row.snapshot['title']), s=overview['submitted'], t=overview['total'], a=f'{average:g}')
        if outbox.enqueue(teacher.id, 'teacher', f'assignment_closed:{row.id}', text, [[dict(text=T[state.language_of(teacher.id)]['open_results'], callback_data=f'tr:{row.id}')]], now=now):
            created += 1
    return created


def result_ready(attempt_id, now=None):
    """Result ready for an attempt finished outside the bot (website or deadline auto-submit)."""
    attempt = ClassQuizAttempt.objects.select_related('assignment').filter(id=attempt_id, status='submitted').first()
    if attempt is None:
        return None
    lang = state.language_of(attempt.student_id)
    text = tx(attempt.student_id, 'result_ready', title=esc(attempt.assignment.snapshot['title']), c=attempt.correct_count, n=attempt.question_count, p=f'{attempt.percent:g}')
    keyboard = [[dict(text=T[lang]['review'], callback_data=f'qr:{attempt.id}:0'), dict(text=T[lang]['card'], callback_data=f'qk:{attempt.id}')]]
    return outbox.enqueue(attempt.student_id, 'results', f'result_ready:{attempt.id}', text, keyboard, now=now)


def appeal_decided(appeal_id, changed=(), now=None):
    appeal = ClassQuizAppeal.objects.select_related('attempt__assignment').filter(id=appeal_id).first()
    if appeal is None or appeal.status == 'pending':
        return
    title = esc(appeal.attempt.assignment.snapshot['title'])
    note = tx(appeal.student_id, 'note', x=esc(appeal.note)) if appeal.note else ''
    key = 'appeal_ok' if appeal.status == 'approved' else 'appeal_no'
    outbox.enqueue(appeal.student_id, 'feedback', f'appeal_decided:{appeal.id}', tx(appeal.student_id, key, title=title, note=note), now=now)
    for item in changed:       # other students whose result changed because of the same approval
        if item['studentId'] != appeal.student_id:
            outbox.enqueue(item['studentId'], 'results', f'result_corrected:{item["attemptId"]}:{appeal.id}',
                           tx(item['studentId'], 'result_corrected', title=title, p=f'{item["newPercent"]:g}'), now=now)


def new_appeal(appeal_id, now=None):
    appeal = ClassQuizAppeal.objects.select_related('attempt__assignment').filter(id=appeal_id).first()
    if appeal is None:
        return
    group = Group.objects.filter(id=appeal.attempt.assignment.group_id).first()
    if group and group.teacher_id:
        outbox.enqueue(group.teacher_id, 'teacher', f'appeal_new:{appeal.id}',
                       tx(group.teacher_id, 'appeal_new', title=esc(appeal.attempt.assignment.snapshot['title'])), [[dict(text='✅', callback_data='ta')]], now=now)


def vocab_report_decided(student_id, word, approved, note='', now=None, key=''):
    text = tx(student_id, 'vocab_ok' if approved else 'vocab_no', word=esc(word), note=tx(student_id, 'note', x=esc(note)) if note and not approved else '')
    outbox.enqueue(student_id, 'feedback', key or f'vocab_report:{student_id}:{word}', text, now=now)


def teacher_feedback(student_id, teacher_name, text, key, now=None):
    return outbox.enqueue(student_id, 'feedback', f'feedback:{key}', tx(student_id, 'feedback', teacher=esc(teacher_name), text=esc(text)[:1500]), now=now)


def attendance_update(student_id, day, state_name, group_id='', now=None):
    k = {'absent': 'attendance_absent', 'late': 'attendance_late', 'present': 'attendance_present'}.get(state_name)
    if k is None:
        return None
    return outbox.enqueue(student_id, 'attendance', f'attendance:{student_id}:{group_id}:{day}:{state_name}', tx(student_id, k, day=day), now=now)


def send_recent_feedback(chat_id):
    """Menu button "Teacher feedback": the student's own recent feedback notices (decisions, comments), newest first."""
    from . import telegram_links as links
    from . import telegram_delivery as api
    from .models import TelegramOutbox
    user = links.find(str(chat_id), True)
    if user is None:
        api.send(chat_id, '🔗 /start')
        return
    lang = state.language_of(user.id)
    rows = list(TelegramOutbox.objects.filter(recipient_id=user.id, kind='feedback').exclude(status__in=('skipped',)).order_by('-id')[:5])
    head = {'uz': "👨‍🏫 <b>O'qituvchi fikrlari</b>", 'en': '👨‍🏫 <b>Teacher feedback</b>'}[lang]
    empty = {'uz': "Hozircha fikr yo'q.", 'en': 'No feedback yet.'}[lang]
    api.send(chat_id, head + '\n\n' + ('\n\n'.join(r.text for r in rows) if rows else empty))


# ------------------------------------------------------------------------------------------------ worker tick

def tick(now=None, *, deliver=True):
    now = now or timezone.now()
    made = {}
    for name, sweep in (
        ('deadlines', deadline_sweep),
        ('homework_deadlines', homework_deadline_sweep),
        ('homework_reports', exam_reports_sweep),
        ('vocab', vocab_due_sweep),
        ('closed', assignment_closed_sweep),
    ):
        try:
            made[name] = sweep(now)
        except Exception:  # noqa: BLE001 - one failing sweep must not stop delivery
            logger.exception('notification sweep failed: %s', name)
            made[name] = -1
    made['delivery'] = outbox.deliver_due(now) if deliver else {}
    return made
