"""Telegram front end of the classroom quiz engine (class_quiz.py).

The bot holds no exam state of its own: every action calls the same service functions as the website, so scoring,
deadlines, attempts and privacy are identical. Callback data is a short opaque command (<= 64 bytes) and is treated as
untrusted input: identity always comes from the linked account of the Telegram sender, never from the payload, and the
service layer re-checks ownership/membership on every call. Duplicate taps are harmless (idempotent engine calls).

callback grammar:  qt                 list my tests          qo:<assignment>        open card
                   qi:<assignment>    instructions           qs:<assignment>        start / resume
                   qn:<attempt>:<i>   show question i        qa:<attempt>:<i>:<o>   answer option o of question i
                   qf:<attempt>       confirm finish         qc:<attempt>           finish now
                   qr:<attempt>:<p>   review mistakes (page)
"""
from __future__ import annotations

import html
import logging
import re
from types import SimpleNamespace

from django.utils import timezone

from common.api.exceptions import ContractAPIException

from . import class_quiz as cq
from . import class_quiz_appeals as appeals
from . import result_card as rc
from . import result_card_delivery as rcd
from . import telegram_delivery as api
from . import telegram_links as links
from . import telegram_state as state

logger = logging.getLogger(__name__)
PREFIXES = ('qt', 'qo', 'qi', 'qs', 'qn', 'qa', 'qf', 'qc', 'qr', 'qp', 'qk')
ID = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
LINE = '━━━━━━━━━━━━'
PAGE = 4

TEXT = {
    'uz': dict(
        not_linked="🔗 Avval akkauntingizni bog'lang: /start", students_only="📝 Testlar faqat o'quvchilar uchun.",
        no_tests="📭 Hozircha sizga biriktirilgan test yo'q.", tests_title='📝 <b>Mening testlarim</b>',
        new_test='📝 <b>Yangi test: {title}</b>', questions='Savollar: {n}', limit='Vaqt chegarasi: {m} daqiqa', no_limit='Vaqt chegarasi: yo\'q',
        deadline='Muddat: {d}', attempts='Urinishlar: {a}', start='▶️ Testni boshlash', instr='📄 Ko\'rsatmalar', back='⬅️ Orqaga',
        instructions=("📄 <b>Ko'rsatmalar</b>\n• Vaqt serverda hisoblanadi — telefoningiz soatiga bog'liq emas.\n• Javoblar darhol saqlanadi; uzilib qolsangiz "
                      "testni davom ettirishingiz mumkin.\n• Muddat tugagach javob qabul qilinmaydi va natija avtomatik hisoblanadi.\n"
                      "• To'g'ri javoblar test yakunlangach ko'rsatiladi."),
        question='Savol {i}/{n}', left='⏱ {t}', type_answer="✍️ Javobingizni <b>xabar sifatida</b> yozib yuboring.", saved='✅ Saqlandi',
        prev='⬅️', nxt='➡️', finish='🏁 Yakunlash', answered='Javob berilgan: {a}/{n}', confirm_finish="Testni yakunlaysizmi? Keyin o'zgartirib bo'lmaydi.",
        yes='✅ Ha, yakunlash', no='↩️ Davom etish', result_title='📝 <b>Test natijasi</b>', correct='To\'g\'ri: <b>{c} / {n}</b>', score='Ball: <b>{p}%</b>',
        time='Vaqt: <b>{t}</b>', status='Holat: <b>{s}</b>', review='🔎 Xatolarni ko\'rish', keys_later="🔒 To'g'ri javob oxirgi urinishdan yoki muddat tugagach ko'rsatiladi", no_mistakes="🎉 Xato yo'q!", mistakes='🔎 <b>Xatolar</b> ({a}-{b} / {n})',
        your='Sizning javobingiz', right="To'g'ri javob", empty='(javob yo\'q)', next_page='Keyingi ➡️', closed="⌛ Test muddati tugagan.", no_attempts="Urinishlar tugagan.",
        time_up="⌛ Vaqt tugadi. Javoblaringiz saqlandi va natija hisoblandi.", stale="Bu tugma eskirgan. /testlar buyrug'ini bosing.", error="⚠️ Xatolik. Qayta urinib ko'ring.",
        not_yours="Bu test sizga tegishli emas.", private_only="🔒 Testni shaxsiy chatda ishlang.", unsupported="Iltimos, javobni matn ko'rinishida yuboring.",
        s_top="A'lo", s_good='Yaxshi', s_ok='Qoniqarli', s_low='Takrorlash kerak', ans_prompt="Javobni yuboring…", home='🏠 Menyu', tests_cmd='/testlar',
        card_btn='🖼 Natija kartasi', appeal_btn='✍️ {n}-javobim qabul qilinsin', appeal_sent="📨 So'rov o'qituvchiga yuborildi. Natija faqat o'qituvchi qarori bilan o'zgaradi.",
        appeal_dup="ℹ️ Bu javob uchun so'rov allaqachon yuborilgan.", appeal_none="Bu javob uchun so'rov yuborib bo'lmaydi.", appeal_status_pending='⏳ ko\'rib chiqilmoqda',
        appeal_status_approved='✅ qabul qilindi', appeal_status_rejected='❌ rad etildi',
    ),
    'en': dict(
        not_linked='🔗 Please link your account first: /start', students_only='📝 Tests are for students.', no_tests='📭 No tests assigned to you yet.',
        tests_title='📝 <b>My tests</b>', new_test='📝 <b>New test: {title}</b>', questions='Questions: {n}', limit='Time limit: {m} minutes', no_limit='Time limit: none',
        deadline='Deadline: {d}', attempts='Attempts: {a}', start='▶️ Start test', instr='📄 Instructions', back='⬅️ Back',
        instructions=("📄 <b>Instructions</b>\n• Time is counted on the server, not by your phone.\n• Answers are saved instantly; if you get disconnected you can "
                      "resume.\n• After the deadline no answers are accepted and the result is calculated automatically.\n• Correct answers are shown after you finish."),
        question='Question {i}/{n}', left='⏱ {t}', type_answer='✍️ Type your answer as a <b>message</b>.', saved='✅ Saved', prev='⬅️', nxt='➡️', finish='🏁 Finish',
        answered='Answered: {a}/{n}', confirm_finish='Finish the test? You cannot change answers afterwards.', yes='✅ Yes, finish', no='↩️ Continue',
        result_title='📝 <b>Test result</b>', correct='Correct: <b>{c} / {n}</b>', score='Score: <b>{p}%</b>', time='Time: <b>{t}</b>', status='Status: <b>{s}</b>',
        review='🔎 Review mistakes', keys_later='🔒 The correct answer is shown after your last attempt or the deadline', no_mistakes='🎉 No mistakes!', mistakes='🔎 <b>Mistakes</b> ({a}-{b} / {n})', your='Your answer', right='Correct answer',
        empty='(no answer)', next_page='Next ➡️', closed='⌛ This test is closed.', no_attempts='No attempts left.',
        time_up='⌛ Time is up. Your saved answers were scored.', stale='This button is outdated. Send /tests.', error='⚠️ Something went wrong. Please try again.',
        not_yours='This test is not yours.', private_only='🔒 Please take tests in a private chat.', unsupported='Please send your answer as text.',
        s_top='Excellent', s_good='Good progress', s_ok='Fair', s_low='Needs practice', ans_prompt='Send your answer…', home='🏠 Menu', tests_cmd='/tests',
        card_btn='🖼 Result card', appeal_btn='✍️ Accept my answer to #{n}', appeal_sent="📨 Request sent to your teacher. The result changes only by the teacher's decision.",
        appeal_dup='ℹ️ A request for this answer was already sent.', appeal_none='A request cannot be sent for this answer.', appeal_status_pending='⏳ under review',
        appeal_status_approved='✅ accepted', appeal_status_rejected='❌ rejected',
    ),
}


def tr(lang: str, key: str, **kwargs) -> str:
    return TEXT.get(lang, TEXT['uz'])[key].format(**kwargs) if kwargs else TEXT.get(lang, TEXT['uz'])[key]


def esc(value) -> str:
    return html.escape(str(value), quote=False)


def clip(value: str, n: int) -> str:
    value = ' '.join(str(value).split())
    return value if len(value) <= n else value[:n - 1] + '…'


def mmss(seconds) -> str:
    seconds = max(0, int(seconds or 0))
    return f'{seconds // 60}:{seconds % 60:02d}'


def status_label(lang: str, percent: float) -> str:
    return tr(lang, 's_top' if percent >= 90 else 's_good' if percent >= 75 else 's_ok' if percent >= 50 else 's_low')


def local_deadline(value) -> str:
    return timezone.localtime(value).strftime('%d.%m %H:%M')


# ------------------------------------------------------------------------------------------------- identity / transport

def _actor(user_id_or_chat):
    """The linked ACTIVE student for this Telegram sender, or None. Identity never comes from callback data."""
    user = links.find(str(user_id_or_chat), True)
    if user is None:
        return None, 'not_linked'
    if getattr(user, 'role', None) != 'student':
        return None, 'students_only'
    return SimpleNamespace(id=user.id, role=user.role, name=user.name, is_authenticated=True), None


def _render(chat_id, message_id, text, keyboard=None):
    """Edit the message the button belongs to (no chat spam); fall back to a new message."""
    markup = dict(inline_keyboard=keyboard) if keyboard else None
    if message_id:
        payload = dict(chat_id=chat_id, message_id=message_id, text=text, parse_mode='HTML')
        if markup:
            payload['reply_markup'] = markup
        if api.call('editMessageText', payload) is not None:
            return
    api.send(chat_id, text, reply_markup=markup)


def _lang(actor) -> str:
    return state.language_of(actor.id)


# ------------------------------------------------------------------------------------------------- views

def assignment_card(lang: str, a: dict, *, with_buttons=True):
    lines = [tr(lang, 'new_test', title=esc(a['title'])), tr(lang, 'questions', n=a['questionCount'])]
    lines.append(tr(lang, 'limit', m=a['timeLimitMinutes']) if a.get('timeLimitMinutes') else tr(lang, 'no_limit'))
    lines.append(tr(lang, 'deadline', d=local_deadline(a['deadline'])))
    if a.get('maxAttempts'):
        lines.append(tr(lang, 'attempts', a=a['maxAttempts']))
    keyboard = [[dict(text=tr(lang, 'start'), callback_data=f'qs:{a["id"]}'), dict(text=tr(lang, 'instr'), callback_data=f'qi:{a["id"]}')]] if with_buttons else None
    return '\n'.join(lines), keyboard


def send_my_tests(chat_id, message_id=None):
    actor, problem = _actor(chat_id)
    if problem:
        api.send(chat_id, tr('uz', problem))
        return
    lang = _lang(actor)
    items = [a for a in cq.my_assignments(actor) if a['state'] in ('available', 'in_progress')][:8]
    if not items:
        _render(chat_id, message_id, tr(lang, 'no_tests'))
        return
    keyboard = [[dict(text=clip(f'{"▶️" if a["state"] == "in_progress" else "📝"} {a["title"]} · {local_deadline(a["deadline"])}', 60),
                      callback_data=f'qo:{a["id"]}')] for a in items]
    _render(chat_id, message_id, tr(lang, 'tests_title'), keyboard)


def _question_view(lang, payload, index):
    questions = payload['questions']
    q = questions[index]
    saved = payload['savedAnswers'].get(q['id'])
    head = f'<b>{esc(clip(payload["title"], 60))}</b>\n{tr(lang, "question", i=index + 1, n=len(questions))}  ·  {tr(lang, "left", t=mmss(payload["secondsLeft"]))}\n{LINE}\n'
    body = esc(clip(q['prompt'], 1500))
    keyboard = []
    if q['type'] in ('mcq', 'tf'):
        for o, option in enumerate(q['options']):
            mark = '✅ ' if saved == str(o) else ''
            keyboard.append([dict(text=clip(f'{mark}{chr(65 + o)}) {option}', 60), callback_data=f'qa:{payload["attemptId"]}:{index}:{o}')])
    else:
        body += f'\n\n{tr(lang, "type_answer")}' + (f'\n<i>{esc(clip(saved, 100))}</i>' if saved else '')
    nav = []
    if index > 0:
        nav.append(dict(text=tr(lang, 'prev'), callback_data=f'qn:{payload["attemptId"]}:{index - 1}'))
    nav.append(dict(text=tr(lang, 'finish'), callback_data=f'qf:{payload["attemptId"]}'))
    if index < len(questions) - 1:
        nav.append(dict(text=tr(lang, 'nxt'), callback_data=f'qn:{payload["attemptId"]}:{index + 1}'))
    keyboard.append(nav)
    return head + body, keyboard


def show_question(chat_id, message_id, actor, attempt_id, index):
    lang = _lang(actor)
    payload = cq.get_attempt(actor, attempt_id)
    if payload.get('status') == 'submitted':
        return send_result(chat_id, message_id, actor, payload)
    questions = payload['questions']
    if not 0 <= index < len(questions):
        index = payload['nextIndex'] if payload['nextIndex'] is not None else 0
    text, keyboard = _question_view(lang, payload, index)
    if questions[index]['type'] == 'text':
        state.set_dialog(actor.id, 'quiz_text', dict(attemptId=attempt_id, index=index))
    else:
        state.clear_dialog(actor.id)
    _render(chat_id, message_id, text, keyboard)


def send_result(chat_id, message_id, actor, result):
    lang = _lang(actor)
    state.clear_dialog(actor.id)
    lines = ([tr(lang, 'time_up')] if result.get('autoSubmitted') else []) + [tr(lang, 'result_title'), f'<b>{esc(result["title"])}</b>', tr(lang, 'correct', c=result['correct'], n=result['total']),
             tr(lang, 'score', p=f'{result["percent"]:g}'), tr(lang, 'time', t=mmss(result['durationSeconds'])),
             tr(lang, 'status', s=status_label(lang, result['percent']))]
    keyboard = [[dict(text=tr(lang, 'review'), callback_data=f'qr:{result["attemptId"]}:0')]] if result['correct'] < result['total'] else []
    keyboard.append([dict(text=tr(lang, 'card_btn'), callback_data=f'qk:{result["attemptId"]}')])
    _render(chat_id, message_id, '\n'.join(lines), keyboard)
    _send_card(chat_id, actor, lang, result, auto=True)
    return result


def _send_card(chat_id, actor, lang, result, *, auto):
    """Private card of a SAVED result (own chat only); automatic sends are once per result version."""
    if result.get('status') != 'submitted' or result.get('percent') is None:
        return
    rcd.send_card(chat_id, rc.quiz_card_data(result, lang, actor.name), lang, kind='quiz', ref_id=result['attemptId'], recipient=actor.id,
                  version=result.get('resultVersion') or 1, auto=auto)


def send_review(chat_id, message_id, actor, attempt_id, page):
    lang = _lang(actor)
    result = cq.my_result(actor, attempt_id)
    wrong = result['incorrect']
    if not wrong:
        _render(chat_id, message_id, tr(lang, 'no_mistakes'))
        return
    start = max(0, page) * PAGE
    chunk = wrong[start:start + PAGE]
    lines = [tr(lang, 'mistakes', a=start + 1, b=start + len(chunk), n=len(wrong)), LINE]
    for row in chunk:
        lines.append(f'\n❓ {esc(clip(row["prompt"], 220))}\n✖️ {tr(lang, "your")}: {esc(clip(row["yourAnswer"] or tr(lang, "empty"), 100))}\n'
                     + (f'✔️ {tr(lang, "right")}: <b>{esc(clip(row["correctAnswer"], 120))}</b>' if row['correctAnswer'] is not None
                        else tr(lang, 'keys_later'))
                     + (f'\n💡 {esc(clip(row["explanation"], 200))}' if row['explanation'] else ''))
    keyboard = []
    for row in chunk:
        if row.get('type') == 'text' and row.get('answered') and not row.get('appeal'):
            keyboard.append([dict(text=tr(lang, 'appeal_btn', n=row['index'] + 1), callback_data=f'qp:{attempt_id}:{row["index"]}')])
        elif row.get('appeal'):
            lines.append(f'#{row["index"] + 1}: ' + tr(lang, 'appeal_status_' + row['appeal']))
    if start + PAGE < len(wrong):
        keyboard.append([dict(text=tr(lang, 'next_page'), callback_data=f'qr:{attempt_id}:{page + 1}')])
    _render(chat_id, message_id, '\n'.join(lines)[:3900], keyboard or None)


# ------------------------------------------------------------------------------------------------- callbacks

def is_quiz_callback(data: str) -> bool:
    return isinstance(data, str) and data.split(':', 1)[0] in PREFIXES


def _valid(*ids) -> bool:
    return all(ID.match(i or '') for i in ids)


def handle_callback(from_id, message_id, data: str, *, chat_type='private') -> bool:
    """True when the callback was a quiz command (handled or politely refused)."""
    if not is_quiz_callback(data):
        return False
    chat_id = from_id  # answers go to the private chat with the sender, never to a group
    if chat_type != 'private':
        api.send(chat_id, tr('uz', 'private_only'))
        return True
    actor, problem = _actor(from_id)
    if problem:
        api.send(chat_id, tr('uz', problem))
        return True
    lang = _lang(actor)
    parts = data.split(':')
    cmd = parts[0]
    try:
        if cmd == 'qt' and len(parts) == 1:
            send_my_tests(chat_id, message_id)
        elif cmd in ('qo', 'qi', 'qs') and len(parts) == 2 and _valid(parts[1]):
            _assignment_command(chat_id, message_id, actor, lang, cmd, parts[1])
        elif cmd == 'qn' and len(parts) == 3 and _valid(parts[1]) and parts[2].isdigit():
            show_question(chat_id, message_id, actor, parts[1], int(parts[2]))
        elif cmd == 'qa' and len(parts) == 4 and _valid(parts[1]) and parts[2].isdigit() and parts[3].isdigit():
            _answer(chat_id, message_id, actor, lang, parts[1], int(parts[2]), parts[3])
        elif cmd == 'qf' and len(parts) == 2 and _valid(parts[1]):
            payload = cq.get_attempt(actor, parts[1])
            if payload.get('status') == 'submitted':
                send_result(chat_id, message_id, actor, payload)
            else:
                answered = len(payload['savedAnswers'])
                _render(chat_id, message_id, f'{tr(lang, "answered", a=answered, n=payload["questionCount"])}\n\n{tr(lang, "confirm_finish")}',
                        [[dict(text=tr(lang, 'yes'), callback_data=f'qc:{parts[1]}'), dict(text=tr(lang, 'no'), callback_data=f'qn:{parts[1]}:{payload["nextIndex"] or 0}')]])
        elif cmd == 'qc' and len(parts) == 2 and _valid(parts[1]):
            send_result(chat_id, message_id, actor, cq.finish_attempt(actor, parts[1]))
        elif cmd == 'qr' and len(parts) == 3 and _valid(parts[1]) and parts[2].isdigit():
            send_review(chat_id, message_id, actor, parts[1], int(parts[2]))
        elif cmd == 'qk' and len(parts) == 2 and _valid(parts[1]):
            payload = cq.my_result(actor, parts[1])
            _send_card(chat_id, actor, lang, payload, auto=False)       # explicit request: allowed again
        elif cmd == 'qp' and len(parts) == 3 and _valid(parts[1]) and parts[2].isdigit():
            _appeal, created = appeals.file_appeal(actor, parts[1], int(parts[2]))
            api.send(chat_id, tr(lang, 'appeal_sent' if created else 'appeal_dup'))
        else:
            api.send(chat_id, tr(lang, 'stale'))
    except ContractAPIException as error:
        _explain(chat_id, lang, error)
    except Exception:  # pragma: no cover - last resort, never leak internals to the chat
        logger.exception('Telegram quiz callback failed')
        api.send(chat_id, tr(lang, 'error'))
    return True


def _assignment_command(chat_id, message_id, actor, lang, cmd, assignment_id):
    item = next((a for a in cq.my_assignments(actor) if a['id'] == assignment_id), None)
    if item is None:
        raise ContractAPIException('QUIZ_NOT_FOUND', 'not found', 404)
    if cmd == 'qo':
        text, keyboard = assignment_card(lang, item)
        _render(chat_id, message_id, text, keyboard)
    elif cmd == 'qi':
        _render(chat_id, message_id, tr(lang, 'instructions'), [[dict(text=tr(lang, 'start'), callback_data=f'qs:{assignment_id}'), dict(text=tr(lang, 'back'), callback_data=f'qo:{assignment_id}')]])
    else:
        payload = cq.start_attempt(actor, assignment_id)
        index = payload['nextIndex'] if payload['nextIndex'] is not None else 0
        show_question(chat_id, message_id, actor, payload['attemptId'], index)


def _answer(chat_id, message_id, actor, lang, attempt_id, index, option):
    payload = cq.get_attempt(actor, attempt_id)
    if payload.get('status') == 'submitted':
        send_result(chat_id, message_id, actor, payload)
        return
    questions = payload['questions']
    if not 0 <= index < len(questions):
        api.send(chat_id, tr(lang, 'stale'))
        return
    cq.save_answer(actor, attempt_id, questions[index]['id'], option)
    if index + 1 < len(questions):
        show_question(chat_id, message_id, actor, attempt_id, index + 1)
    else:
        _render(chat_id, message_id, f'{tr(lang, "saved")}\n{tr(lang, "answered", a=len(cq.get_attempt(actor, attempt_id)["savedAnswers"]), n=len(questions))}\n\n{tr(lang, "confirm_finish")}',
                [[dict(text=tr(lang, 'yes'), callback_data=f'qc:{attempt_id}'), dict(text=tr(lang, 'no'), callback_data=f'qn:{attempt_id}:0')]])


def _explain(chat_id, lang, error: ContractAPIException):
    code = error.contract_code
    if code == 'TIME_UP':
        api.send(chat_id, tr(lang, 'time_up'))
    elif code in ('QUIZ_CLOSED',):
        api.send(chat_id, tr(lang, 'closed'))
    elif code == 'NO_ATTEMPTS_LEFT':
        api.send(chat_id, tr(lang, 'no_attempts'))
    elif code in ('QUIZ_NOT_FOUND', 'ATTEMPT_NOT_FOUND'):
        api.send(chat_id, tr(lang, 'not_yours'))
    elif code == 'NOTHING_TO_APPEAL':
        api.send(chat_id, tr(lang, 'appeal_none'))
    elif code == 'ATTEMPT_FINISHED':
        api.send(chat_id, tr(lang, 'stale'))
    else:
        api.send(chat_id, tr(lang, 'stale') if code in ('QUESTION_NOT_FOUND', 'VALIDATION_ERROR') else tr(lang, 'error'))


# ------------------------------------------------------------------------------------------------- free-text answers

def handle_text(chat_id, text: str) -> bool:
    """A plain message answers the pending free-text question (durable dialog state). True if consumed."""
    actor, problem = _actor(chat_id)
    if problem:
        return False
    dialog, payload = state.get_dialog(actor.id)
    if dialog != 'quiz_text':
        return False
    lang = _lang(actor)
    try:
        attempt = cq.get_attempt(actor, payload['attemptId'])
        if attempt.get('status') == 'submitted':
            state.clear_dialog(actor.id)
            send_result(chat_id, None, actor, attempt)
            return True
        index = int(payload['index'])
        cq.save_answer(actor, payload['attemptId'], attempt['questions'][index]['id'], text)
        api.send(chat_id, tr(lang, 'saved'))
        if index + 1 < len(attempt['questions']):
            show_question(chat_id, None, actor, payload['attemptId'], index + 1)
        else:
            state.clear_dialog(actor.id)
            api.send(chat_id, tr(lang, 'confirm_finish'), reply_markup=dict(inline_keyboard=[[dict(text=tr(lang, 'yes'), callback_data=f'qc:{payload["attemptId"]}'),
                                                                                           dict(text=tr(lang, 'no'), callback_data=f'qn:{payload["attemptId"]}:0')]]))
    except ContractAPIException as error:
        state.clear_dialog(actor.id)
        _explain(chat_id, lang, error)
    except (KeyError, IndexError, ValueError):
        state.clear_dialog(actor.id)
        api.send(chat_id, tr(lang, 'stale'))
    return True
