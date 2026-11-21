"""Telegram front end for vocabulary practice and spaced-repetition review (vocabulary_bot.py).

Commands: /lugat (sets + modes), /mashq (alias), /takror (due words), /natija (progress), /yordam (help).
Modes: A EN->UZ, B UZ->EN, C spelling, D multiple choice, E mixed.

callback grammar (<= 64 bytes, untrusted; identity comes from the sender's linked account):
  vl                       list sets             vs:<set>            choose mode       vm:<set>:<A-E>   start run
  vo:<run>:<i>:<o>         MCQ answer            vn:<run>:<i>        show question     vc:<run>         finish
  vr                       start review          vh                  my results        vx:<run>:<i>     "accept my answer" report
"""
from __future__ import annotations

import html
import logging
import re
from types import SimpleNamespace

from django.utils import timezone

from common.api.exceptions import ContractAPIException

from . import telegram_delivery as api
from . import telegram_links as links
from . import telegram_state as state
from . import result_card as rc
from . import result_card_delivery as rcd
from . import vocabulary_bot as vb
from .telegram_quiz import clip, esc, mmss

logger = logging.getLogger(__name__)
PREFIXES = ('vl', 'vs', 'vm', 'vo', 'vn', 'vc', 'vr', 'vh', 'vx', 'vk')
ID = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
COMMANDS = {'/lugat': 'list', '/mashq': 'list', '/takror': 'review', '/natija': 'results', '/yordam': 'help'}
MODE_NAMES = {
    'uz': {'A': "A · Inglizcha → O'zbekcha", 'B': "B · O'zbekcha → Inglizcha", 'C': "C · Imlo (yozib chiqish)", 'D': "D · Variantli test", 'E': "E · Aralash"},
    'en': {'A': 'A · English → Uzbek', 'B': 'B · Uzbek → English', 'C': 'C · Spelling', 'D': 'D · Multiple choice', 'E': 'E · Mixed'},
}

TEXT = {
    'uz': dict(
        not_linked="🔗 Avval akkauntingizni bog'lang: /start", students_only="📚 Lug'at mashqlari o'quvchilar uchun.",
        private_only="🔒 Iltimos, botga shaxsiy chatda yozing.",
        sets_title="📚 <b>Lug'at</b>\nMashq uchun to'plamni tanlang:", no_sets="📭 Hozircha sizga ochiq lug'at to'plami yo'q.",
        set_item="{title} · {n} so'z", pick_mode="📚 <b>{title}</b>\nMashq turini tanlang:", review_btn="🔁 Takrorlash", results_btn="📊 Natijalarim",
        question="❓ <b>Savol {i}/{n}</b>", q_eng_uzb="Quyidagi so'zning o'zbekcha tarjimasi:", q_uzb_eng="Quyidagi so'zning inglizcha tarjimasi:",
        q_spelling="Inglizcha yozilishini kiriting:", hint="Birinchi harf: {x}", type_answer="✍️ Javobni yozib yuboring.",
        right="✅ To'g'ri!", wrong="❌ Noto'g'ri.", correct_is="To'g'ri javob: <b>{x}</b>", yours="Sizning javobingiz: {x}",
        also_ok="Qabul qilinadigan variantlar: {x}", next="➡️ Keyingi", finish="🏁 Yakunlash", report="✍️ Javobim qabul qilinsin",
        reported="📨 So'rovingiz o'qituvchiga yuborildi. Natija o'qituvchi qarori bilan o'zgaradi.", reported_again="ℹ️ Bu javob uchun so'rov allaqachon yuborilgan.",
        confirm_finish="Tugatilmagan savollar noto'g'ri hisoblanadi. Yakunlaymizmi?", yes="Ha", no="Yo'q",
        result_title="📚 <b>{title}</b>", correct="To'g'ri: {c}/{n}", accuracy="Aniqlik: {p}%", time="Vaqt: {t}", to_review="Takrorlash uchun so'zlar: {w}",
        points="⭐ Ball: +{p}", review_btn_after="🔁 Xatolarni takrorlash", mistakes_title="❌ <b>Xato so'zlar</b>",
        review_intro="🔁 Bugun sizda <b>{n}</b> ta takrorlash savoli bor.", review_batch="Bir sessiyada {b} tagacha savol beriladi.",
        review_start="▶️ Takrorlashni boshlash", nothing_due="🎉 Bugun takrorlash uchun so'z yo'q. Yangi mashq qiling: /lugat",
        review_done="✅ <b>Takrorlash yakunlandi</b>", review_correct="To'g'ri: {c}/{n}", next_review="⏭ Keyingi takrorlash: {x}", due_now="Hozir yana {n} ta so'z kutmoqda",
        wrong_rescheduled="Xato so'zlar 10 daqiqadan keyin qaytadi", right_rescheduled="To'g'ri so'zlar keyinroq (1→3→7→14→30 kun) qaytadi",
        stats_title="📊 <b>Lug'at natijalarim</b>", stats_recent="So'nggi mashqlar:", stats_none="Hali mashqlar yo'q.", stats_srs="🔁 Takrorlash kutmoqda: {d}\n🧠 O'zlashtirilgan: {m} / {t}",
        help="📚 <b>Lug'at buyruqlari</b>\n/lugat — to'plamlar va mashqlar\n/mashq — mashq boshlash\n/takror — bugungi takrorlash\n/natija — natijalarim\n/yordam — shu yordam\n\nRejimlar: A (EN→UZ), B (UZ→EN), C (imlo), D (variantli), E (aralash).",
        stale="⚠️ Bu tugma eskirgan. /lugat ni qayta oching.", expired="⏱ Mashq muddati tugadi. /lugat dan qayta boshlang.", error="⚠️ Xatolik yuz berdi. Keyinroq urinib ko'ring.",
        card_btn='🖼 Natija kartasi', tomorrow="ertaga", today="bugun", in_days="{d} kundan keyin", in_minutes="{m} daqiqadan keyin", back="⬅️ Orqaga",
    ),
    'en': dict(
        not_linked="🔗 Please link your account first: /start", students_only="📚 Vocabulary practice is for students.",
        private_only="🔒 Please message the bot in a private chat.",
        sets_title="📚 <b>Vocabulary</b>\nChoose a set to practise:", no_sets="📭 No vocabulary sets are available to you yet.",
        set_item="{title} · {n} words", pick_mode="📚 <b>{title}</b>\nChoose a practice mode:", review_btn="🔁 Review", results_btn="📊 My results",
        question="❓ <b>Question {i}/{n}</b>", q_eng_uzb="Translate this word into Uzbek:", q_uzb_eng="Translate this word into English:",
        q_spelling="Type the English spelling:", hint="First letter: {x}", type_answer="✍️ Send your answer as a message.",
        right="✅ Correct!", wrong="❌ Not correct.", correct_is="Correct answer: <b>{x}</b>", yours="Your answer: {x}",
        also_ok="Accepted variants: {x}", next="➡️ Next", finish="🏁 Finish", report="✍️ My answer should be accepted",
        reported="📨 Your request was sent to the teacher. Results change only by the teacher's decision.", reported_again="ℹ️ A request for this answer was already sent.",
        confirm_finish="Unanswered questions count as wrong. Finish now?", yes="Yes", no="No",
        result_title="📚 <b>{title}</b>", correct="Correct: {c}/{n}", accuracy="Accuracy: {p}%", time="Time: {t}", to_review="Words to review: {w}",
        points="⭐ Points: +{p}", review_btn_after="🔁 Review mistakes", mistakes_title="❌ <b>Words to review</b>",
        review_intro="🔁 Today you have <b>{n}</b> review questions.", review_batch="Up to {b} questions per session.",
        review_start="▶️ Start review", nothing_due="🎉 Nothing to review today. Practise something new: /lugat",
        review_done="✅ <b>Revision complete</b>", review_correct="Correct: {c}/{n}", next_review="⏭ Next review: {x}", due_now="{n} more words are due now",
        wrong_rescheduled="Wrong words come back in 10 minutes", right_rescheduled="Correct words return later (1→3→7→14→30 days)",
        stats_title="📊 <b>My vocabulary results</b>", stats_recent="Recent practice:", stats_none="No practice yet.", stats_srs="🔁 Waiting for review: {d}\n🧠 Mastered: {m} / {t}",
        help="📚 <b>Vocabulary commands</b>\n/lugat — sets and practice\n/mashq — start practice\n/takror — today's review\n/natija — my results\n/yordam — this help\n\nModes: A (EN→UZ), B (UZ→EN), C (spelling), D (multiple choice), E (mixed).",
        stale="⚠️ This button is out of date. Reopen /lugat.", expired="⏱ This run expired. Start again with /lugat.", error="⚠️ Something went wrong. Please try again later.",
        card_btn='🖼 Result card', tomorrow="tomorrow", today="today", in_days="in {d} days", in_minutes="in {m} minutes", back="⬅️ Back",
    ),
}


def tr(lang, key, **kw):
    text = TEXT.get(lang, TEXT['uz'])[key]
    return text.format(**kw) if kw else text


def _actor(user_id):
    user = links.find(str(user_id), True)
    if user is None:
        return None, 'not_linked'
    if getattr(user, 'role', None) != 'student':
        return None, 'students_only'
    return SimpleNamespace(id=user.id, role=user.role, name=user.name, is_authenticated=True), None


def _render(chat_id, message_id, text, keyboard=None):
    markup = dict(inline_keyboard=keyboard) if keyboard else None
    if message_id:
        payload = dict(chat_id=chat_id, message_id=message_id, text=text, parse_mode='HTML')
        if markup:
            payload['reply_markup'] = markup
        if api.call('editMessageText', payload) is not None:
            return
    api.send(chat_id, text, reply_markup=markup)


def _when(lang, iso):
    if not iso:
        return None
    from datetime import datetime
    delta = datetime.fromisoformat(iso) - timezone.now()
    minutes = max(1, int(delta.total_seconds() // 60))
    if minutes < 90:
        return tr(lang, 'in_minutes', m=minutes)
    days = round(delta.total_seconds() / 86400)
    return tr(lang, 'tomorrow') if days <= 1 else tr(lang, 'in_days', d=days)


# ------------------------------------------------------------------------------------------------- views

def send_sets(chat_id, message_id, actor, lang):
    sets = vb.visible_sets(actor)
    if not sets:
        _render(chat_id, message_id, tr(lang, 'no_sets'), [[dict(text=tr(lang, 'review_btn'), callback_data='vr')]])
        return
    keyboard = [[dict(text=clip(tr(lang, 'set_item', title=s.title, n=s.wordCount), 60), callback_data=f'vs:{s.id}')] for s in sets]
    keyboard.append([dict(text=tr(lang, 'review_btn'), callback_data='vr'), dict(text=tr(lang, 'results_btn'), callback_data='vh')])
    _render(chat_id, message_id, tr(lang, 'sets_title'), keyboard)


def send_modes(chat_id, message_id, actor, lang, set_id):
    vocab_set = vb.get_visible_set(actor, set_id)
    keyboard = [[dict(text=MODE_NAMES[lang][k], callback_data=f'vm:{vocab_set.id}:{k}')] for k in 'ABCDE']
    keyboard.append([dict(text=tr(lang, 'back'), callback_data='vl')])
    _render(chat_id, message_id, tr(lang, 'pick_mode', title=esc(vocab_set.title)), keyboard)


def show_question(chat_id, message_id, actor, lang, run, index):
    questions = run.questions
    if run.status != 'active':
        return send_result(chat_id, message_id, actor, lang, run.result or vb.finish(actor, run.id), run)
    if not 0 <= index < len(questions):
        nxt = vb.next_index(run)
        if nxt is None:
            return send_finish_prompt(chat_id, message_id, lang, run)
        index = nxt
    q = questions[index]
    lines = [tr(lang, 'question', i=index + 1, n=len(questions)), tr(lang, 'q_' + q['type']), f'<b>{esc(clip(q["prompt"], 300))}</b>']
    if q['type'] == 'spelling' and q.get('firstLetter'):
        lines.append(tr(lang, 'hint', x=esc(q['firstLetter'])))
    keyboard = []
    if q['input'] == 'mcq':
        keyboard = [[dict(text=clip(opt, 56), callback_data=f'vo:{run.id}:{index}:{n}')] for n, opt in enumerate(q['options'])]
        state.clear_dialog(actor.id)
    else:
        lines.append(tr(lang, 'type_answer'))
        state.set_dialog(actor.id, 'vocab_text', dict(runId=run.id, index=index))
    keyboard.append([dict(text=tr(lang, 'finish'), callback_data=f'vc:{run.id}')])
    _render(chat_id, message_id, '\n'.join(lines), keyboard)


def send_feedback(chat_id, message_id, lang, outcome, index):
    run, q = outcome['run'], outcome['question']
    lines = [tr(lang, 'right') if outcome['correct'] else tr(lang, 'wrong')]
    if not outcome['correct']:
        lines += [tr(lang, 'yours', x=esc(clip(outcome['response'], 120))), tr(lang, 'correct_is', x=esc(clip(q['expected'], 160)))]
        extra = [a for a in q.get('accepted', []) if a != q['expected']][:5]
        if extra:
            lines.append(tr(lang, 'also_ok', x=esc(', '.join(extra))))
    nxt = vb.next_index(run)
    row = []
    if nxt is not None:
        row.append(dict(text=tr(lang, 'next'), callback_data=f'vn:{run.id}:{nxt}'))
    else:
        row.append(dict(text=tr(lang, 'finish'), callback_data=f'vc:{run.id}'))
    keyboard = [row]
    if not outcome['correct']:
        keyboard.append([dict(text=tr(lang, 'report'), callback_data=f'vx:{run.id}:{index}')])
    _render(chat_id, message_id, '\n'.join(lines), keyboard)


def send_finish_prompt(chat_id, message_id, lang, run):
    _render(chat_id, message_id, tr(lang, 'confirm_finish'),
            [[dict(text=tr(lang, 'yes'), callback_data=f'vc:{run.id}'), dict(text=tr(lang, 'no'), callback_data=f'vn:{run.id}:{vb.next_index(run) or 0}')]])


def send_result(chat_id, message_id, actor, lang, result, run=None):
    state.clear_dialog(actor.id)
    if result['kind'] == 'review':
        lines = [tr(lang, 'review_done'), tr(lang, 'review_correct', c=result['correct'], n=result['total']), tr(lang, 'accuracy', p=f'{result["percent"]:g}'),
                 tr(lang, 'time', t=mmss(result['durationSeconds']))]
        info = result.get('nextDue') or {}
        if result['correct']:
            lines.append(tr(lang, 'right_rescheduled'))
        if result['wrong']:
            lines.append(tr(lang, 'wrong_rescheduled'))
        when = _when(lang, info.get('nextAt'))
        if info.get('dueNow'):
            lines.append(tr(lang, 'due_now', n=info['dueNow']))
        elif when:
            lines.append(tr(lang, 'next_review', x=when))
        keyboard = [[dict(text=tr(lang, 'review_btn'), callback_data='vr')]] if info.get('dueNow') else []
        if run is not None:
            keyboard.append([dict(text=tr(lang, 'card_btn'), callback_data=f'vk:{run.id}')])
        _render(chat_id, message_id, '\n'.join(lines), keyboard or None)
        return _send_card(chat_id, actor, lang, result, run, auto=True)
    lines = [tr(lang, 'result_title', title=esc(result.get('setTitle', ''))), tr(lang, 'correct', c=result['correct'], n=result['total']),
             tr(lang, 'accuracy', p=f'{result["percent"]:g}'), tr(lang, 'time', t=mmss(result['durationSeconds'])), tr(lang, 'to_review', w=result['wrong'])]
    if result.get('pointsAwarded'):
        lines.append(tr(lang, 'points', p=result['pointsAwarded']))
    keyboard = [[dict(text=tr(lang, 'review_btn_after'), callback_data='vr')]] if result['wrong'] else []
    if run is not None:
        keyboard.append([dict(text=tr(lang, 'card_btn'), callback_data=f'vk:{run.id}')])
    _render(chat_id, message_id, '\n'.join(lines), keyboard or None)
    _send_card(chat_id, actor, lang, result, run, auto=True)
    # list the wrong words (bounded) so the student sees exactly what to review
    wrong = result.get('wordsToReview') or []
    if wrong:
        rows = [f'• {esc(clip(w["prompt"], 60))} → <b>{esc(clip(w["expected"], 80))}</b>' for w in wrong[:20]]
        if len(wrong) > 20:
            rows.append(f'… +{len(wrong) - 20}')
        api.send(chat_id, tr(lang, 'mistakes_title') + '\n' + '\n'.join(rows))


def _send_card(chat_id, actor, lang, result, run, *, auto):
    """Private card built from the stored run result (never from client data); automatic send happens once per run."""
    if run is None or 'percent' not in result:
        return
    rcd.send_card(chat_id, rc.vocab_card_data(result, lang, actor.name, run.finished_at), lang, kind='vocab', ref_id=run.id, recipient=actor.id, auto=auto)


def send_review_intro(chat_id, message_id, actor, lang):
    from .vocabulary_review import due
    now = timezone.now()
    count = due(actor.id, now).count()
    if not count:
        return _render(chat_id, message_id, tr(lang, 'nothing_due'))
    text = tr(lang, 'review_intro', n=count) + ('\n' + tr(lang, 'review_batch', b=vb.REVIEW_BATCH) if count > vb.REVIEW_BATCH else '')
    _render(chat_id, message_id, text, [[dict(text=tr(lang, 'review_start'), callback_data='vr:go')]])


def send_results(chat_id, message_id, actor, lang):
    data = vb.summary(actor)
    lines = [tr(lang, 'stats_title')]
    if data['recent']:
        lines.append(tr(lang, 'stats_recent'))
        lines += [f'• {esc(clip(r["title"], 40))}: {r["score"]}/{r["total"]} ({r["percent"]:g}%)' for r in data['recent']]
    else:
        lines.append(tr(lang, 'stats_none'))
    lines.append('\n' + tr(lang, 'stats_srs', d=data['due'], m=data['mastered'], t=data['tracked']))
    keyboard = [[dict(text=tr(lang, 'review_btn'), callback_data='vr')]] if data['due'] else None
    _render(chat_id, message_id, '\n'.join(lines), keyboard)


# ------------------------------------------------------------------------------------------------- entry points

def is_vocab_callback(data):
    return isinstance(data, str) and data.split(':', 1)[0] in PREFIXES


def _valid(*ids):
    return all(ID.match(i or '') for i in ids)


def command(chat_id, text, *, chat_type='private'):
    """Handle /lugat /mashq /takror /natija /yordam. Returns True when the text was one of them."""
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
        if action == 'list':
            send_sets(chat_id, None, actor, lang)
        elif action == 'review':
            send_review_intro(chat_id, None, actor, lang)
        elif action == 'results':
            send_results(chat_id, None, actor, lang)
        else:
            api.send(chat_id, tr(lang, 'help'))
    except Exception:  # pragma: no cover
        logger.exception('vocab command failed')
        api.send(chat_id, tr(lang, 'error'))
    return True


def handle_callback(from_id, message_id, data, *, chat_type='private'):
    if not is_vocab_callback(data):
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
        if cmd == 'vl' and len(parts) == 1:
            send_sets(chat_id, message_id, actor, lang)
        elif cmd == 'vs' and len(parts) == 2 and _valid(parts[1]):
            send_modes(chat_id, message_id, actor, lang, parts[1])
        elif cmd == 'vm' and len(parts) == 3 and _valid(parts[1]) and parts[2] in vb.MODES:
            run = vb.start_practice(actor, parts[1], parts[2])
            show_question(chat_id, message_id, actor, lang, run, vb.next_index(run) or 0)
        elif cmd == 'vr' and len(parts) == 1:
            send_review_intro(chat_id, message_id, actor, lang)
        elif cmd == 'vr' and parts[1:] == ['go']:
            run = vb.start_review(actor)
            if run is None:
                _render(chat_id, message_id, tr(lang, 'nothing_due'))
            else:
                show_question(chat_id, message_id, actor, lang, run, vb.next_index(run) or 0)
        elif cmd == 'vh' and len(parts) == 1:
            send_results(chat_id, message_id, actor, lang)
        elif cmd == 'vn' and len(parts) == 3 and _valid(parts[1]) and parts[2].isdigit():
            show_question(chat_id, message_id, actor, lang, vb.get_run(actor, parts[1]), int(parts[2]))
        elif cmd == 'vo' and len(parts) == 4 and _valid(parts[1]) and parts[2].isdigit() and parts[3].isdigit():
            outcome = vb.answer(actor, parts[1], int(parts[2]), parts[3])
            send_feedback(chat_id, message_id, lang, outcome, int(parts[2]))
        elif cmd == 'vc' and len(parts) == 2 and _valid(parts[1]):
            result = vb.finish(actor, parts[1])
            send_result(chat_id, message_id, actor, lang, result, vb.get_run(actor, parts[1]))
        elif cmd == 'vk' and len(parts) == 2 and _valid(parts[1]):
            run = vb.get_run(actor, parts[1])
            if run.result is None:
                raise ContractAPIException('RUN_NOT_FOUND', 'not ready', 404)
            _send_card(chat_id, actor, lang, run.result, run, auto=False)
        elif cmd == 'vx' and len(parts) == 3 and _valid(parts[1]) and parts[2].isdigit():
            _report, created = vb.report_answer(actor, parts[1], int(parts[2]))
            api.send(chat_id, tr(lang, 'reported' if created else 'reported_again'))
        else:
            api.send(chat_id, tr(lang, 'stale'))
    except ContractAPIException as error:
        if error.contract_code == 'RUN_EXPIRED':
            api.send(chat_id, tr(lang, 'expired'))
        else:
            api.send(chat_id, tr(lang, 'stale') if error.contract_code in ('RUN_NOT_FOUND', 'RUN_FINISHED', 'QUESTION_NOT_FOUND', 'VALIDATION_ERROR',
                                                                         'VOCABULARY_SET_NOT_FOUND', 'NOTHING_TO_REPORT') else tr(lang, 'error'))
    except Exception:  # pragma: no cover
        logger.exception('vocab callback failed')
        api.send(chat_id, tr(lang, 'error'))
    return True


def handle_text(chat_id, text):
    """A plain private message answers the pending typed vocabulary question."""
    actor, problem = _actor(chat_id)
    if problem:
        return False
    dialog, payload = state.get_dialog(actor.id)
    if dialog != 'vocab_text':
        return False
    lang = state.language_of(actor.id)
    try:
        outcome = vb.answer(actor, payload['runId'], int(payload['index']), text)
        if not outcome['repeat']:
            send_feedback(chat_id, None, lang, outcome, int(payload['index']))
        state.clear_dialog(actor.id)
    except ContractAPIException as error:
        state.clear_dialog(actor.id)
        api.send(chat_id, tr(lang, 'expired') if error.contract_code == 'RUN_EXPIRED' else tr(lang, 'stale'))
    except (KeyError, ValueError):
        state.clear_dialog(actor.id)
        api.send(chat_id, tr(lang, 'stale'))
    return True
