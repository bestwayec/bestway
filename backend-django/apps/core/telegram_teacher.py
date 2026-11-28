"""Teacher tools inside the Telegram bot, on top of the same services the website uses.

Identity is the sender's linked, active teacher (or admin) account; callback data only carries opaque ids and every
service call re-checks that the id belongs to the actor's own groups/quizzes (404 otherwise), so a forged callback can
never reach another teacher's students, results or appeals.

callback grammar (<= 64 bytes):
  tg                 my groups              tg:<group>          group card
  tn                 new test wizard        tn:c:<cat>          category      tn:q:<10|20|30|40|0>  expected count
  tn:t:<minutes>     time limit (0 = none)  tn:g:<i> choose group (index into the durable wizard state)  tn:d:<hours>  deadline -> assign
  tq                 my assignments         tr:<assignment>     results       tc:<assignment>  CSV
  tp:<assignment>    result summary card (private)             tm:<assignment>  remind pending students
  ta                 review requests        ta:y|n:<appeal>     decide quiz appeal   tv:y|n:<report>  decide vocabulary report
  ts                 vocabulary sets        ts:<set>  pick set     ts:g:<i>  remind group <i> of the stored list to practise it
  tb                 announcement wizard    tb:g:<group>        choose group (then send text)  tb:ok  confirm
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
from datetime import timedelta
from types import SimpleNamespace

from django.db.models import Q
from django.utils import timezone

from apps.legacy_schema.models import AssessmentJob, Group, MockAttempt, User
from common.api.exceptions import ContractAPIException

from .classroom_results import assignment_attempts
from .classroom_roster import assert_active, member_profiles
from .live_exam_guard import _teacher_alert_scope
from . import class_quiz as cq
from . import class_quiz_appeals as appeals
from . import groups
from . import result_card as rc
from . import telegram_delivery as api
from . import telegram_links as links
from . import telegram_notify as notify
from . import telegram_outbox as outbox
from . import telegram_state as state
from . import vocabulary_bot as vb
from .models import (
    ClassQuizAssignment,
    ExamIntegrityIncident,
    TelegramClassroomBinding,
    VocabularySet,
)

logger = logging.getLogger(__name__)
PREFIXES = ('tg', 'tk', 'tn', 'tq', 'tr', 'tc', 'tp', 'tm', 'ta', 'tv', 'ts', 'tb', 'te', 'tw')
ID = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
STAFF = ('teacher', 'admin', 'super_admin')
KEY_LINE = re.compile(r'(?im)^\s*(?:key|answers?|javoblar|kalit)\s*:?\s*$')
COUNTS = (10, 20, 30, 40)
HOURS = (24, 48, 72, 168)

TEXT = {
    'uz': dict(
        not_linked="🔗 Avval akkauntingizni bog'lang: /start", staff_only="👨‍🏫 Bu bo'lim ustozlar uchun.", private_only='🔒 Iltimos, botga shaxsiy chatda yozing.',
        menu='👨‍🏫 <b>Ustoz paneli</b>', groups="👥 <b>Guruhlarim</b>", no_groups="📭 Sizga biriktirilgan guruh yo'q.", students='O\'quvchilar: {n}', active='Faol testlar: {n}',
        new_title='📝 <b>Yangi test</b>\nTest nomini yozib yuboring:', pick_cat='Test turini tanlang:', cat_grammar='Grammatika', cat_vocabulary="Lug'at", cat_mixed='Aralash',
        pick_count="Savollar soni (tekshirish uchun):", any_count='Boshqa', pick_time='Vaqt chegarasi:', no_limit="Cheklovsiz", minutes='{m} daqiqa',
        send_questions=("📥 Savollarni yuboring.\nBir xabarda savollar, so'ng alohida qatorda <code>KEY</code> va javoblar:\n\n<code>1. Choose the passive form.\nA) is done\nB) does\nC) did\nD) doing\n"
                        "2. The window was ___ (break).\nKEY\n1 A\n2 broken</code>"),
        imported="✅ Savollar qabul qilindi: <b>{n}</b> ta.", count_mismatch="⚠️ Siz {want} ta savol tanlagansiz, lekin {n} ta topildi. Davom etish mumkin.",
        import_failed="❌ Savollarni o'qib bo'lmadi: {why}\nQayta yuboring yoki /cancel.", missing_key="Javoblar bo'limi (KEY) topilmadi.",
        publish_assign="📤 Guruhga biriktirish", choose_group='Qaysi guruhga biriktiramiz?', choose_deadline='Muddatni tanlang:', hours='{h} soat', days='{d} kun',
        assigned="✅ Test <b>{title}</b> {group} guruhiga biriktirildi. Muddat: {d}.\nO'quvchilarga xabar navbatga qo'yildi.", cancelled='Bekor qilindi.',
        assignments='🗓 <b>Topshiriqlar</b>', no_assignments="Faol topshiriq yo'q.", results_title='📊 <b>{title}</b>', done='Topshirgan: {s}/{t} ({p}%)', avg="O'rtacha: {a}%",
        pending='⏳ Topshirmaganlar:', export='📄 CSV', card='🖼 Xulosa kartasi', remind='🔔 Eslatish', reminded="🔔 {n} ta o'quvchiga eslatma navbatga qo'yildi.", nobody='Hamma topshirgan 🎉',
        card_sent='🖼 Xulosa kartasi sizga yuborildi (faqat yig\'ma ko\'rsatkichlar, ismlarsiz). Guruhga o\'zingiz ulashishingiz mumkin.',
        requests='✅ <b>Ko\'rib chiqish so\'rovlari</b>', no_requests="Kutayotgan so'rov yo'q.", appeal_card="✍️ <b>{title}</b>\n❓ {prompt}\n👤 Javob: <code>{response}</code>\n✔️ To'g'ri: {correct}",
        vocab_card="📚 <b>{set}</b>\n🔤 {english} → {uzbek}\n👤 Javob: <code>{response}</code>", approve='✅ Qabul', reject='❌ Rad', decided_ok='✅ Qaror saqlandi.', decided_no='❌ Rad etildi.',
        sets='📚 <b>Lug\'at to\'plamlari</b>', no_sets="To'plam yo'q.", pick_group_for_set='Qaysi guruhni mashqqa chaqiramiz?', set_reminded="📚 {n} ta o'quvchiga lug'at eslatmasi navbatga qo'yildi.",
        set_hidden="⚠️ Bu to'plam tanlangan guruhga ko'rinmaydi. Avval uni guruhga biriktiring (sayt).", announce_pick='📢 Qaysi guruhga e\'lon?', announce_text="E'lon matnini yozib yuboring (max 700 belgi):",
        announce_confirm="📢 Quyidagi e'lon <b>{n}</b> ta o'quvchiga yuboriladi:\n\n{text}", announce_ok="📢 E'lon navbatga qo'yildi: {n} ta o'quvchi.", back='⬅️ Orqaga', yes='✅ Yuborish', no='✖️ Bekor',
        stale="Bu tugma eskirgan. /ustoz buyrug'ini bosing.", denied="Bu ma'lumot sizga tegishli emas.", error="⚠️ Xatolik. Qayta urinib ko'ring.", expired_dialog='Vaqt tugadi. Qaytadan boshlang.',
        tg_bound='Telegram guruh: ✅ Ulangan', tg_unbound='Telegram guruh: ⚪ Ulanmagan', guard_queue_btn='🛡 Nazorat va tekshirish ({n})',
        guard_queue_title='🛡 <b>{group} · Nazorat va tekshirish</b>', pending_grading='✍️ Baholash kutilmoqda: {n}', open_guard='🚨 Yangi nazorat hodisalari: {n}', no_guard_pending='✅ Kutilayotgan tekshiruv yoki nazorat hodisasi yo\'q.',
    ),
    'en': dict(
        not_linked='🔗 Please link your account first: /start', staff_only='👨‍🏫 This section is for teachers.', private_only='🔒 Please message the bot in a private chat.',
        menu='👨‍🏫 <b>Teacher panel</b>', groups='👥 <b>My groups</b>', no_groups='📭 No groups are assigned to you.', students='Students: {n}', active='Active tests: {n}',
        new_title='📝 <b>New test</b>\nSend the test title:', pick_cat='Choose the test type:', cat_grammar='Grammar', cat_vocabulary='Vocabulary', cat_mixed='Mixed',
        pick_count='Number of questions (for checking):', any_count='Other', pick_time='Time limit:', no_limit='No limit', minutes='{m} min',
        send_questions=("📥 Send the questions.\nIn one message: the questions, then a line with <code>KEY</code> and the answers:\n\n<code>1. Choose the passive form.\nA) is done\nB) does\nC) did\nD) doing\n"
                        "2. The window was ___ (break).\nKEY\n1 A\n2 broken</code>"),
        imported='✅ Questions accepted: <b>{n}</b>.', count_mismatch='⚠️ You chose {want} questions but {n} were found. You can continue.',
        import_failed='❌ Could not read the questions: {why}\nSend again or /cancel.', missing_key='The answer section (KEY) was not found.',
        publish_assign='📤 Assign to a group', choose_group='Which group?', choose_deadline='Choose the deadline:', hours='{h} h', days='{d} d',
        assigned='✅ Test <b>{title}</b> assigned to {group}. Deadline: {d}.\nStudent notifications were queued.', cancelled='Cancelled.',
        assignments='🗓 <b>Assignments</b>', no_assignments='No active assignments.', results_title='📊 <b>{title}</b>', done='Submitted: {s}/{t} ({p}%)', avg='Average: {a}%',
        pending='⏳ Not submitted yet:', export='📄 CSV', card='🖼 Summary card', remind='🔔 Remind', reminded='🔔 Reminder queued for {n} students.', nobody='Everyone has submitted 🎉',
        card_sent='🖼 The summary card was sent to you (aggregates only, no names). Share it with the group yourself if you wish.',
        requests='✅ <b>Review requests</b>', no_requests='No pending requests.', appeal_card='✍️ <b>{title}</b>\n❓ {prompt}\n👤 Answer: <code>{response}</code>\n✔️ Correct: {correct}',
        vocab_card='📚 <b>{set}</b>\n🔤 {english} → {uzbek}\n👤 Answer: <code>{response}</code>', approve='✅ Accept', reject='❌ Reject', decided_ok='✅ Decision saved.', decided_no='❌ Rejected.',
        sets='📚 <b>Vocabulary sets</b>', no_sets='No sets.', pick_group_for_set='Which group should practise?', set_reminded='📚 Vocabulary reminder queued for {n} students.',
        set_hidden='⚠️ This set is not visible to that group. Attach it to the group first (website).', announce_pick='📢 Which group?', announce_text='Send the announcement text (max 700 chars):',
        announce_confirm='📢 This announcement will be sent to <b>{n}</b> students:\n\n{text}', announce_ok='📢 Announcement queued for {n} students.', back='⬅️ Back', yes='✅ Send', no='✖️ Cancel',
        stale='This button is outdated. Send /teacher.', denied='This is not yours.', error='⚠️ Something went wrong. Please try again.', expired_dialog='Timed out. Start again.',
        tg_bound='Telegram chat: ✅ Connected', tg_unbound='Telegram chat: ⚪ Not connected', guard_queue_btn='🛡 Live Guard & Queue ({n})',
        guard_queue_title='🛡 <b>{group} · Live Guard &amp; Grading</b>', pending_grading='✍️ Awaiting grading: {n}', open_guard='🚨 Unreviewed guard alerts: {n}', no_guard_pending='✅ No pending grading or guard observations.',
    ),
}


def tr(lang, key, **kw):
    text = TEXT.get(lang, TEXT['uz'])[key]
    return text.format(**kw) if kw else text


def esc(value, n=300):
    return html.escape(str(value or '')[:n], quote=False)


def _actor(user_id):
    user = links.find(str(user_id), True)
    if user is None:
        return None, 'not_linked'
    if getattr(user, 'role', None) not in STAFF:
        return None, 'staff_only'
    return SimpleNamespace(id=user.id, role=user.role, name=user.name, is_authenticated=True), None


def _render(chat_id, message_id, text, keyboard=None):
    markup = dict(inline_keyboard=keyboard) if keyboard else None
    if message_id:
        payload = dict(chat_id=chat_id, message_id=message_id, text=text[:4000], parse_mode='HTML')
        if markup:
            payload['reply_markup'] = markup
        if api.call('editMessageText', payload) is not None:
            return
    api.send(chat_id, text[:4000], reply_markup=markup)


def _valid(*ids):
    return all(ID.match(i or '') for i in ids)


def _own_groups(actor):
    rows = Group.objects.all() if actor.role in ('admin', 'super_admin') else Group.objects.filter(teacher_id=actor.id)
    return list(rows.order_by('name')[:30])


def _group(actor, group_id):
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)        # teacher B gets FORBIDDEN for teacher A's group
    assert_active(group.id)
    return group


def _assignment(actor, assignment_id):
    return cq._assignment_for_staff(actor, assignment_id)     # 404 for another teacher's assignment


def _roster(group_id):
    return list(member_profiles(group_id).values_list('user_id', flat=True))


# ------------------------------------------------------------------------------------------------ views

def home(chat_id, message_id, actor, lang):
    keyboard = [[dict(text='📝', callback_data='tn'), dict(text='👥', callback_data='tg'), dict(text='🗓', callback_data='tq')],
                [dict(text='✅', callback_data='ta'), dict(text='📚', callback_data='ts'), dict(text='📢', callback_data='tb')],
                [dict(text=EXAM_TEXT[lang]['menu'], callback_data='te')]]
    _render(chat_id, message_id, tr(lang, 'menu') + '\n📝 /newtest · 👥 /groups · 🗓 /assignments · ✅ /requests · 📚 /sets · 📢 /announce · 🏆 /exams', keyboard)


EXAM_TEXT = {
    'uz': dict(menu='🏆 Imtihon natijalari', head='🏆 <b>Imtihonlar</b> (faol, kelgusi va yakunlangan)', none="📭 Imtihon topshiriqlari yo'q.",
               prev='⬅️ Oldingi sahifa', next='Keyingi sahifa ➡️', pending='⏳ Baholash kutilmoqda', web='💻 Teacher Workspace',
               excel='📊 Excel hisobot', progress='📈 O‘quvchilar rivojlanishi', no_pending="✅ Baholash kutilayotgan ish yo'q.",
               stage=dict(open='🟢 faol', preliminary='🟡 dastlabki', final='✅ yakuniy'), upcoming='🔜 kelgusi'),
    'en': dict(menu='🏆 Exam results', head='🏆 <b>Exams</b> (active, upcoming and closed)', none='📭 No exam assignments.',
               prev='⬅️ Previous page', next='Next page ➡️', pending='⏳ Awaiting grading', web='💻 Teacher Workspace',
               excel='📊 Excel report', progress='📈 Student progress', no_pending='✅ Nothing awaits grading.',
               stage=dict(open='🟢 active', preliminary='🟡 preliminary', final='✅ final'), upcoming='🔜 upcoming'),
}


def _web(path):
    from django.conf import settings
    return (getattr(settings, 'PUBLIC_WEB_URL', '') or 'https://bestwayec.uz') + path


def list_exams(chat_id, message_id, actor, lang):
    """Exam assignments of the teacher's own groups; permission is rechecked on every tap."""
    from .models import HomeworkAssignment
    t = EXAM_TEXT[lang]
    own = [g.id for g in _own_groups(actor)]
    rows = list(HomeworkAssignment.objects.select_related('cohort__classroom').filter(cohort__classroom_id__in=own, exam__isnull=False)
                .order_by('-deadline')[:15])
    if not rows:
        _render(chat_id, message_id, t['none'])
        return
    now = timezone.now()
    keyboard = []
    for a in rows:
        label = t['upcoming'] if a.opens_at and a.opens_at > now else t['stage']['open'] if a.deadline > now else '🏁'
        keyboard.append([dict(text=esc(f'{label} {a.title} · {a.cohort.classroom.name}', 55), callback_data=f'te:{a.id}')])
    _render(chat_id, message_id, t['head'], keyboard)


def exam_board(chat_id, message_id, actor, lang, assignment_id, page=0):
    from . import exam_report, exam_report_delivery
    t = EXAM_TEXT[lang]
    row = exam_report.assignment_for(actor, assignment_id)
    report = exam_report.build(row)
    pages = exam_report_delivery.pages(report, lang)
    page = max(0, min(page, len(pages) - 1))
    text = (t['stage'].get(report['stage'], '') + '\n' + pages[page])
    nav = []
    if page > 0:
        nav.append(dict(text=t['prev'], callback_data=f'te:{row.id}:{page - 1}'))
    if page < len(pages) - 1:
        nav.append(dict(text=t['next'], callback_data=f'te:{row.id}:{page + 1}'))
    keyboard = ([nav] if nav else []) + [
        [dict(text=t['pending'], callback_data=f'tw:{row.id}')],
        [dict(text=t['web'], url=_web(f'/teacher/results/exam/{row.id}'))],
        [dict(text=t['excel'], url=_web(f'/teacher/results/exam/{row.id}')),
         dict(text=t['progress'], url=_web(f'/teacher/results/exam/{row.id}#progress'))],
        [dict(text=tr(lang, 'back'), callback_data='te')]]
    _render(chat_id, message_id, text, keyboard)


def exam_pending(chat_id, message_id, actor, lang, assignment_id):
    from . import exam_report
    t = EXAM_TEXT[lang]
    row = exam_report.assignment_for(actor, assignment_id)
    rows = [r for r in exam_report.build(row)['rows'] if r['pendingSkills']]
    lines = [f'<b>{esc(row.title, 80)}</b>'] + [f"• {esc(r['name'], 40)} — {'/'.join(s.capitalize() for s in r['pendingSkills'])}" for r in rows[:60]]
    if len(rows) > 60:
        lines.append(f'… +{len(rows) - 60}')
    _render(chat_id, message_id, '\n'.join(lines) if rows else t['no_pending'],
            [[dict(text=t['web'], url=_web(f'/teacher/results/exam/{row.id}'))], [dict(text=tr(lang, 'back'), callback_data=f'te:{row.id}')]])


def list_groups(chat_id, message_id, actor, lang):
    rows = _own_groups(actor)
    if not rows:
        return _render(chat_id, message_id, tr(lang, 'no_groups'))
    lines, keyboard = [tr(lang, 'groups')], []
    for g in rows:
        n = len(_roster(g.id))
        active = ClassQuizAssignment.objects.filter(group_id=g.id, status='active', deadline__gt=timezone.now()).count()
        lines.append(f'• <b>{esc(g.name, 60)}</b> — {tr(lang, "students", n=n)}, {tr(lang, "active", n=active)}')
        keyboard.append([dict(text=esc(g.name, 40), callback_data=f'tg:{g.id}')])
    _render(chat_id, message_id, '\n'.join(lines), keyboard)


def group_card(chat_id, message_id, actor, lang, group_id):
    group = _group(actor, group_id)
    roster_ids = _roster(group.id)
    names = dict(User.objects.filter(id__in=roster_ids).values_list('id', 'name'))
    binding = TelegramClassroomBinding.objects.filter(group_id=group.id, is_active=True).first()
    guard_open = _teacher_alert_scope(ExamIntegrityIncident.objects.filter(group_id=group.id, status='open'), actor).count()
    grading_pending = AssessmentJob.objects.filter(
        attempt_id__in=assignment_attempts(MockAttempt.objects.all(), group_id=group.id).values('id'),
        status__in=('PENDING', 'PROCESSING', 'RETRY', 'NEEDS_REVIEW'),
    ).count()
    lines = [
        f'👥 <b>{esc(group.name, 80)}</b>',
        tr(lang, 'students', n=len(names)),
        tr(lang, 'tg_bound' if binding else 'tg_unbound'),
        tr(lang, 'pending_grading', n=grading_pending),
        tr(lang, 'open_guard', n=guard_open),
    ] + [f'• {esc(n, 40)}' for n in sorted(names.values())[:30]]
    rows = ClassQuizAssignment.objects.filter(group_id=group.id, status='active').order_by('-created_at')[:6]
    keyboard = [[dict(text=esc(a.snapshot['title'], 45), callback_data=f'tr:{a.id}')] for a in rows]
    keyboard.append([dict(text=tr(lang, 'guard_queue_btn', n=guard_open + grading_pending), callback_data=f'tk:{group.id}')])
    keyboard.append([dict(text=tr(lang, 'back'), callback_data='tg')])
    _render(chat_id, message_id, '\n'.join(lines), keyboard)


def group_monitoring_card(chat_id, message_id, actor, lang, group_id):
    group = _group(actor, group_id)
    incidents = list(
        _teacher_alert_scope(
            ExamIntegrityIncident.objects.select_related('student', 'exam').filter(group_id=group.id, status='open'),
            actor,
        )
        .order_by('-updated_at')[:8]
    )
    jobs = list(
        AssessmentJob.objects.filter(
            attempt_id__in=assignment_attempts(MockAttempt.objects.all(), group_id=group.id).values('id'),
            status__in=('PENDING', 'PROCESSING', 'RETRY', 'NEEDS_REVIEW'),
        ).order_by('-created_at')[:8]
    )
    lines = [tr(lang, 'guard_queue_title', group=esc(group.name, 60))]
    if not incidents and not jobs:
        lines.append(tr(lang, 'no_guard_pending'))
    else:
        for inc in incidents:
            lines.append(f'• 🚨 <b>{esc(getattr(inc.student, "name", ""), 32)}</b> — {esc(inc.event_type, 24)} ({esc(inc.skill or "-", 12)})')
        if jobs:
            snames = dict(User.objects.filter(id__in=[j.student_id for j in jobs]).values_list('id', 'name'))
            for j in jobs:
                lines.append(f'• ✍️ <b>{esc(snames.get(j.student_id, j.student_id), 32)}</b> — {esc(j.skill, 12)} ({esc(j.status, 16)})')
    keyboard = [[dict(text=tr(lang, 'back'), callback_data=f'tg:{group.id}')]]
    _render(chat_id, message_id, '\n'.join(lines), keyboard)


def list_assignments(chat_id, message_id, actor, lang):
    group_ids = [g.id for g in _own_groups(actor)]
    rows = ClassQuizAssignment.objects.filter(group_id__in=group_ids).order_by('-created_at')[:12]
    if not rows:
        return _render(chat_id, message_id, tr(lang, 'no_assignments'))
    names = {g.id: g.name for g in Group.objects.filter(id__in=group_ids)}
    keyboard = [[dict(text=esc(f'{a.snapshot["title"]} · {names.get(a.group_id, "")}', 55), callback_data=f'tr:{a.id}')] for a in rows]
    _render(chat_id, message_id, tr(lang, 'assignments'), keyboard)


def assignment_results(chat_id, message_id, actor, lang, assignment_id):
    overview = cq.assignment_overview(actor, assignment_id)
    pending = overview['pending']
    lines = [tr(lang, 'results_title', title=esc(overview['assignment']['title'], 80)), tr(lang, 'done', s=overview['submitted'], t=overview['total'], p=f'{overview["completionPercent"]:g}')]
    scores = [p['bestPercent'] for p in overview['participants'] if p['bestPercent'] is not None]
    if scores:
        lines.append(tr(lang, 'avg', a=f'{round(sum(scores) / len(scores), 1):g}'))
    lines.append(tr(lang, 'pending') if pending else tr(lang, 'nobody'))
    lines += [f'• {esc(p["name"], 40)}' for p in pending[:25]]
    keyboard = [[dict(text=tr(lang, 'export'), callback_data=f'tc:{assignment_id}'), dict(text=tr(lang, 'card'), callback_data=f'tp:{assignment_id}')]]
    if pending:
        keyboard.append([dict(text=tr(lang, 'remind'), callback_data=f'tm:{assignment_id}')])
    keyboard.append([dict(text=tr(lang, 'back'), callback_data='tq')])
    _render(chat_id, message_id, '\n'.join(lines), keyboard)


def send_csv(chat_id, actor, assignment_id):
    data = cq.export_csv(actor, assignment_id)
    api.send_document(chat_id, data.encode('utf-8'), filename=f'results-{assignment_id[:8]}.csv', caption=None)


def send_summary_card(chat_id, actor, lang, assignment_id):
    from . import result_card_delivery as rcd
    overview = cq.assignment_overview(actor, assignment_id)
    png = rc.render_png(rc.group_summary_data(overview, lang, timezone.now()), lang)
    api.send_photo(chat_id, png)          # to the teacher's own private chat only
    api.send(chat_id, tr(lang, 'card_sent'))


def remind_pending(chat_id, message_id, actor, lang, assignment_id):
    row = _assignment(actor, assignment_id)
    overview = cq.assignment_overview(actor, assignment_id)
    today = timezone.now().astimezone(notify.TASHKENT).date().isoformat()
    created = 0
    for p in overview['pending']:
        text = notify.tx(p['studentId'], 'deadline24', title=notify.esc(row.snapshot['title']), when=notify.local(row.deadline))
        if outbox.enqueue(p['studentId'], 'deadlines', f'manual_reminder:{row.id}:{p["studentId"]}:{today}', text,
                          [[dict(text='▶️', callback_data=f'qs:{row.id}')]]):
            created += 1
    api.send(chat_id, tr(lang, 'reminded', n=created))


def review_requests(chat_id, message_id, actor, lang):
    quiz = appeals.pending_appeals(actor, limit=5)
    vocab = vb.pending_reports(actor, limit=5)
    if not quiz and not vocab:
        return _render(chat_id, message_id, tr(lang, 'no_requests'))
    _render(chat_id, message_id, tr(lang, 'requests') + f'\n{len(quiz) + len(vocab)}')
    for a in quiz:
        api.send(chat_id, tr(lang, 'appeal_card', title=esc(a['quizTitle'], 80), prompt=esc(a['prompt'], 300), response=esc(a['response'], 120), correct=esc(' / '.join(map(str, a['correctAnswers'])), 120)),
                 reply_markup=dict(inline_keyboard=[[dict(text=tr(lang, 'approve'), callback_data=f'ta:y:{a["id"]}'), dict(text=tr(lang, 'reject'), callback_data=f'ta:n:{a["id"]}')]]))
    for r in vocab:
        api.send(chat_id, tr(lang, 'vocab_card', set=esc(r.word.set.title, 80), english=esc(r.word.english, 80), uzbek=esc(r.word.uzbek, 80), response=esc(r.response, 120)),
                 reply_markup=dict(inline_keyboard=[[dict(text=tr(lang, 'approve'), callback_data=f'tv:y:{r.id}'), dict(text=tr(lang, 'reject'), callback_data=f'tv:n:{r.id}')]]))


def list_sets(chat_id, message_id, actor, lang):
    rows = VocabularySet.objects.filter(Q(created_by_id=actor.id) | Q(group__teacher_id=actor.id)).order_by('-created_at')[:12] \
        if actor.role == 'teacher' else VocabularySet.objects.order_by('-created_at')[:12]
    if not rows:
        return _render(chat_id, message_id, tr(lang, 'no_sets'))
    _render(chat_id, message_id, tr(lang, 'sets'), [[dict(text=esc(s.title, 55), callback_data=f'ts:{s.id}')] for s in rows])


def set_pick_group(chat_id, message_id, actor, lang, set_id):
    vocab_set = _own_set(actor, set_id)
    own = _own_groups(actor)
    state.set_dialog(actor.id, 'ts_pick', dict(setId=vocab_set.id, groups=[g.id for g in own]))
    keyboard = [[dict(text=esc(g.name, 40), callback_data=f'ts:g:{i}')] for i, g in enumerate(own)]
    keyboard.append([dict(text=tr(lang, 'back'), callback_data='ts')])
    _render(chat_id, message_id, tr(lang, 'pick_group_for_set'), keyboard)


def _own_set(actor, set_id):
    vocab_set = VocabularySet.objects.select_related('group').filter(id=set_id).first()
    if vocab_set is None or not vb._manages_word(actor, SimpleNamespace(set=vocab_set)):
        raise ContractAPIException('VOCABULARY_SET_NOT_FOUND', 'not found', 404)
    return vocab_set


def remind_set(chat_id, message_id, actor, lang, set_id, group_id):
    vocab_set, group = _own_set(actor, set_id), _group(actor, group_id)
    visible = (vocab_set.group_id == group.id) or (vocab_set.group_id is None and vocab_set.is_public and vocab_set.created_by_id == group.teacher_id)
    if not visible:
        return api.send(chat_id, tr(lang, 'set_hidden'))
    today = timezone.now().astimezone(notify.TASHKENT).date().isoformat()
    created = 0
    for student_id in notify._linked_students(group.id):
        text = {'uz': f"📚 O'qituvchi sizni <b>{esc(vocab_set.title, 80)}</b> lug'atini mashq qilishga chaqirdi. /lugat",
                'en': f"📚 Your teacher asked you to practise <b>{esc(vocab_set.title, 80)}</b>. /lugat"}[state.language_of(student_id)]
        if outbox.enqueue(student_id, 'vocab', f'vocab_assign:{vocab_set.id}:{group.id}:{student_id}:{today}', text, [[dict(text='📚', callback_data=f'vs:{vocab_set.id}')]]):
            created += 1
    api.send(chat_id, tr(lang, 'set_reminded', n=created))


# ------------------------------------------------------------------------------------------------ wizards (durable dialog state)

def start_new_test(chat_id, message_id, actor, lang):
    state.set_dialog(actor.id, 'tc_title', {})
    _render(chat_id, message_id, tr(lang, 'new_title'))


def _cat_keyboard(lang):
    return [[dict(text=tr(lang, 'cat_grammar'), callback_data='tn:c:grammar'), dict(text=tr(lang, 'cat_vocabulary'), callback_data='tn:c:vocabulary'), dict(text=tr(lang, 'cat_mixed'), callback_data='tn:c:mixed')]]


def new_test_step(chat_id, message_id, actor, lang, parts):
    dialog, payload = state.get_dialog(actor.id)
    if dialog not in ('tc_cat', 'tc_count', 'tc_time', 'tc_questions') or not payload.get('title'):
        return api.send(chat_id, tr(lang, 'expired_dialog'))
    step = parts[1]
    if step == 'c' and parts[2] in ('grammar', 'vocabulary', 'mixed'):
        payload['category'] = parts[2]
        state.set_dialog(actor.id, 'tc_count', payload)
        _render(chat_id, message_id, tr(lang, 'pick_count'), [[dict(text=str(c), callback_data=f'tn:q:{c}') for c in COUNTS] + [dict(text=tr(lang, 'any_count'), callback_data='tn:q:0')]])
    elif step == 'q' and parts[2].isdigit() and int(parts[2]) in (0, *COUNTS):
        payload['expected'] = int(parts[2])
        state.set_dialog(actor.id, 'tc_time', payload)
        _render(chat_id, message_id, tr(lang, 'pick_time'), [[dict(text=tr(lang, 'no_limit'), callback_data='tn:t:0')] + [dict(text=tr(lang, 'minutes', m=m), callback_data=f'tn:t:{m}') for m in (15, 30, 45, 60)]])
    elif step == 't' and parts[2].isdigit() and int(parts[2]) in (0, 15, 30, 45, 60):
        quiz = cq.create_quiz(actor, dict(title=payload['title'], category=payload['category'], timeLimitMinutes=int(parts[2]) or None, maxAttempts=1))
        payload['quizId'] = quiz['id']
        state.set_dialog(actor.id, 'tc_questions', payload)
        _render(chat_id, message_id, tr(lang, 'send_questions'))
    else:
        api.send(chat_id, tr(lang, 'stale'))


def handle_text(chat_id, text):
    """Plain private message answering the teacher's pending wizard step. True when consumed."""
    actor, problem = _actor(chat_id)
    if problem:
        return False
    dialog, payload = state.get_dialog(actor.id)
    if dialog not in ('tc_title', 'tc_questions', 'tb_text'):
        return False
    lang = state.language_of(actor.id)
    try:
        if dialog == 'tc_title':
            title = text.strip()
            if not 2 <= len(title) <= 200:
                api.send(chat_id, tr(lang, 'new_title'))
                return True
            state.set_dialog(actor.id, 'tc_cat', dict(title=title))
            api.send(chat_id, tr(lang, 'pick_cat'), reply_markup=dict(inline_keyboard=_cat_keyboard(lang)))
        elif dialog == 'tc_questions':
            split = KEY_LINE.split(text, maxsplit=1)
            if len(split) < 2:
                api.send(chat_id, tr(lang, 'import_failed', why=tr(lang, 'missing_key')))
                return True
            try:
                result = cq.import_questions(actor, payload['quizId'], split[0].strip(), split[2 - 1].strip() if len(split) == 2 else '', replace=True)
            except ContractAPIException as error:
                api.send(chat_id, tr(lang, 'import_failed', why=esc(error.contract_message if hasattr(error, 'contract_message') else str(error.detail), 160)))
                return True
            n = len(result.get('questions') or []) or result.get('questionCount', 0)
            lines = [tr(lang, 'imported', n=n)]
            if payload.get('expected') and payload['expected'] != n:
                lines.append(tr(lang, 'count_mismatch', want=payload['expected'], n=n))
            own = _own_groups(actor)
            state.set_dialog(actor.id, 'tc_assign', dict(quizId=payload['quizId'], groups=[g.id for g in own]))   # ids stay server-side (64-byte callback limit)
            keyboard = [[dict(text=esc(g.name, 40), callback_data=f'tn:g:{i}')] for i, g in enumerate(own)]
            api.send(chat_id, '\n'.join(lines) + '\n\n' + tr(lang, 'choose_group'), reply_markup=dict(inline_keyboard=keyboard) if keyboard else None)
        else:  # tb_text
            body = text.strip()
            if not 3 <= len(body) <= 700:
                api.send(chat_id, tr(lang, 'announce_text'))
                return True
            group = _group(actor, payload['groupId'])
            state.set_dialog(actor.id, 'tb_confirm', dict(groupId=group.id, text=body))
            api.send(chat_id, tr(lang, 'announce_confirm', n=len(notify._linked_students(group.id)), text=esc(body, 700)),
                     reply_markup=dict(inline_keyboard=[[dict(text=tr(lang, 'yes'), callback_data='tb:ok'), dict(text=tr(lang, 'no'), callback_data='tb:no')]]))
    except ContractAPIException as error:
        state.clear_dialog(actor.id)
        api.send(chat_id, tr(lang, 'denied') if error.status_code in (403, 404) else tr(lang, 'error'))
    return True


def assign_step(chat_id, message_id, actor, lang, parts):
    """Choose group -> choose deadline -> publish + assign. Quiz id and candidate group ids live in the durable dialog row;
    the callback carries only a small index/hour value, and the group is re-authorised at every step."""
    dialog, payload = state.get_dialog(actor.id)
    if dialog != 'tc_assign' or not payload.get('quizId'):
        return api.send(chat_id, tr(lang, 'expired_dialog'))
    if parts[1] == 'g' and len(parts) == 3 and parts[2].isdigit():
        index = int(parts[2])
        if index >= len(payload.get('groups', [])):
            return api.send(chat_id, tr(lang, 'stale'))
        group = _group(actor, payload['groups'][index])
        state.set_dialog(actor.id, 'tc_assign', dict(payload, groupId=group.id))
        keyboard = [[dict(text=tr(lang, 'hours', h=h) if h < 48 else tr(lang, 'days', d=h // 24), callback_data=f'tn:d:{h}') for h in HOURS]]
        _render(chat_id, message_id, tr(lang, 'choose_deadline'), keyboard)
    elif parts[1] == 'd' and len(parts) == 3 and parts[2].isdigit() and int(parts[2]) in HOURS and payload.get('groupId'):
        group = _group(actor, payload['groupId'])
        cq.publish_quiz(actor, payload['quizId'])
        deadline = timezone.now() + timedelta(hours=int(parts[2]))
        state.clear_dialog(actor.id)                 # a second tap finds no dialog: no second assignment
        rows = cq.assign_quiz(actor, payload['quizId'], [group.id], deadline)
        _render(chat_id, message_id, tr(lang, 'assigned', title=esc(rows[0]['title'], 80), group=esc(group.name, 60), d=notify.local(deadline)))
    else:
        api.send(chat_id, tr(lang, 'stale'))


def announce_step(chat_id, message_id, actor, lang, parts):
    if len(parts) == 1:
        keyboard = [[dict(text=esc(g.name, 40), callback_data=f'tb:g:{g.id}')] for g in _own_groups(actor)]
        return _render(chat_id, message_id, tr(lang, 'announce_pick') if keyboard else tr(lang, 'no_groups'), keyboard or None)
    if parts[1] == 'g' and len(parts) == 3 and _valid(parts[2]):
        group = _group(actor, parts[2])
        state.set_dialog(actor.id, 'tb_text', dict(groupId=group.id))
        return _render(chat_id, message_id, tr(lang, 'announce_text'))
    dialog, payload = state.get_dialog(actor.id)
    if parts[1] == 'no':
        state.clear_dialog(actor.id)
        return _render(chat_id, message_id, tr(lang, 'cancelled'))
    if parts[1] == 'ok' and dialog == 'tb_confirm':
        group = _group(actor, payload['groupId'])      # re-checked at send time
        digest = hashlib.sha256(payload['text'].encode()).hexdigest()[:16]
        created = 0
        for student_id in notify._linked_students(group.id):
            body = f'📢 <b>{esc(actor.name, 60)}</b>:\n{esc(payload["text"], 700)}'
            if outbox.enqueue(student_id, 'announcements', f'announce:{group.id}:{digest}:{student_id}', body):
                created += 1
        state.clear_dialog(actor.id)
        return _render(chat_id, message_id, tr(lang, 'announce_ok', n=created))
    api.send(chat_id, tr(lang, 'stale'))


# ------------------------------------------------------------------------------------------------ entry points

COMMANDS = {'/ustoz': 'home', '/teacher': 'home', '/exams': 'exams', '/imtihonlar': 'exams', '/newtest': 'new', '/yangitest': 'new', '/groups': 'groups', '/guruhlar': 'groups',
            '/assignments': 'assign', '/topshiriqlar': 'assign', '/requests': 'requests', '/sorovlar': 'requests', '/sets': 'sets', '/announce': 'announce', '/elon': 'announce'}


def is_teacher_callback(data):
    return isinstance(data, str) and data.split(':', 1)[0] in PREFIXES


def command(chat_id, text, *, chat_type='private'):
    name = text.split('@')[0].split()[0].lower() if text else ''
    action = COMMANDS.get(name)
    if action is None:
        return False
    if chat_type != 'private':
        api.send(chat_id, tr('uz', 'private_only'))
        return True
    actor, problem = _actor(chat_id)
    if problem:
        api.send(chat_id, tr('uz', problem))
        return True
    lang = state.language_of(actor.id)
    try:
        {'home': lambda: home(chat_id, None, actor, lang), 'new': lambda: start_new_test(chat_id, None, actor, lang),
         'groups': lambda: list_groups(chat_id, None, actor, lang), 'assign': lambda: list_assignments(chat_id, None, actor, lang),
         'requests': lambda: review_requests(chat_id, None, actor, lang), 'sets': lambda: list_sets(chat_id, None, actor, lang),
         'announce': lambda: announce_step(chat_id, None, actor, lang, ['tb']),
         'exams': lambda: list_exams(chat_id, None, actor, lang)}[action]()
    except ContractAPIException as error:
        api.send(chat_id, tr(lang, 'denied') if error.status_code in (403, 404) else tr(lang, 'error'))
    except Exception:  # pragma: no cover
        logger.exception('teacher command failed')
        api.send(chat_id, tr(lang, 'error'))
    return True


def handle_callback(from_id, message_id, data, *, chat_type='private'):
    if not is_teacher_callback(data):
        return False
    chat_id = from_id
    if chat_type != 'private':
        api.send(chat_id, tr('uz', 'private_only'))
        return True
    actor, problem = _actor(from_id)
    if problem:
        api.send(chat_id, tr('uz', problem))
        return True
    lang = state.language_of(actor.id)
    parts = data.split(':')
    cmd = parts[0]
    try:
        if cmd == 'tg' and len(parts) == 1:
            list_groups(chat_id, message_id, actor, lang)
        elif cmd == 'tg' and len(parts) == 2 and _valid(parts[1]):
            group_card(chat_id, message_id, actor, lang, parts[1])
        elif cmd == 'tk' and len(parts) == 2 and _valid(parts[1]):
            group_monitoring_card(chat_id, message_id, actor, lang, parts[1])
        elif cmd == 'tn' and len(parts) == 1:
            start_new_test(chat_id, message_id, actor, lang)
        elif cmd == 'tn' and len(parts) == 3 and parts[1] in ('c', 'q', 't'):
            new_test_step(chat_id, message_id, actor, lang, parts)
        elif cmd == 'tn' and len(parts) == 3 and parts[1] in ('g', 'd'):
            assign_step(chat_id, message_id, actor, lang, parts)
        elif cmd == 'tq' and len(parts) == 1:
            list_assignments(chat_id, message_id, actor, lang)
        elif cmd == 'tr' and len(parts) == 2 and _valid(parts[1]):
            assignment_results(chat_id, message_id, actor, lang, parts[1])
        elif cmd == 'tc' and len(parts) == 2 and _valid(parts[1]):
            send_csv(chat_id, actor, parts[1])
        elif cmd == 'tp' and len(parts) == 2 and _valid(parts[1]):
            send_summary_card(chat_id, actor, lang, parts[1])
        elif cmd == 'tm' and len(parts) == 2 and _valid(parts[1]):
            remind_pending(chat_id, message_id, actor, lang, parts[1])
        elif cmd == 'ta' and len(parts) == 1:
            review_requests(chat_id, message_id, actor, lang)
        elif cmd == 'ta' and len(parts) == 3 and parts[1] in ('y', 'n') and _valid(parts[2]):
            appeals.decide(actor, parts[2], parts[1] == 'y')
            _render(chat_id, message_id, tr(lang, 'decided_ok' if parts[1] == 'y' else 'decided_no'))
        elif cmd == 'tv' and len(parts) == 3 and parts[1] in ('y', 'n') and _valid(parts[2]):
            vb.decide_report(actor, parts[2], parts[1] == 'y')
            _render(chat_id, message_id, tr(lang, 'decided_ok' if parts[1] == 'y' else 'decided_no'))
        elif cmd == 'ts' and len(parts) == 1:
            list_sets(chat_id, message_id, actor, lang)
        elif cmd == 'ts' and len(parts) == 2 and _valid(parts[1]):
            set_pick_group(chat_id, message_id, actor, lang, parts[1])
        elif cmd == 'ts' and len(parts) == 3 and parts[1] == 'g' and parts[2].isdigit():
            dialog, payload = state.get_dialog(actor.id)
            groups_ = payload.get('groups', []) if dialog == 'ts_pick' else []
            if int(parts[2]) >= len(groups_):
                api.send(chat_id, tr(lang, 'expired_dialog'))
            else:
                remind_set(chat_id, message_id, actor, lang, payload['setId'], groups_[int(parts[2])])
        elif cmd == 'tb':
            announce_step(chat_id, message_id, actor, lang, parts)
        elif cmd == 'te' and len(parts) == 1:
            list_exams(chat_id, message_id, actor, lang)
        elif cmd == 'te' and len(parts) in (2, 3) and _valid(parts[1]) and (len(parts) == 2 or parts[2].isdigit()):
            exam_board(chat_id, message_id, actor, lang, parts[1], int(parts[2]) if len(parts) == 3 else 0)
        elif cmd == 'tw' and len(parts) == 2 and _valid(parts[1]):
            exam_pending(chat_id, message_id, actor, lang, parts[1])
        else:
            api.send(chat_id, tr(lang, 'stale'))
    except ContractAPIException as error:
        api.send(chat_id, tr(lang, 'denied') if error.status_code in (403, 404) else tr(lang, 'error'))
    except Exception:  # pragma: no cover
        logger.exception('teacher callback failed')
        api.send(chat_id, tr(lang, 'error'))
    return True
