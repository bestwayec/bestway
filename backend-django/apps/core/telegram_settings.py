"""Settings screen: language, notifications on/off, per-kind switches and quiet hours (any linked role).

callback grammar: st (open)   st:l:<uz|en>   st:n (toggle all)   st:q (toggle quiet hours)   st:k:<kind> (toggle one kind)
Only the sender's own TelegramPreference row is ever read or written.
"""
from __future__ import annotations

import datetime
import logging

from . import telegram_delivery as api
from . import telegram_links as links
from . import telegram_outbox as outbox
from . import telegram_state as state

logger = logging.getLogger(__name__)
PREFIXES = ('st',)
KIND_LABELS = {
    'uz': dict(tests='Yangi testlar', deadlines='Muddat eslatmalari', vocab='Lug\'at takrori', results='Natijalar', feedback='O\'qituvchi fikri', attendance='Davomat', teacher='Ustoz xabarlari', announcements="E'lonlar"),
    'en': dict(tests='New tests', deadlines='Deadline reminders', vocab='Vocabulary review', results='Results', feedback='Teacher feedback', attendance='Attendance', teacher='Teacher alerts', announcements='Announcements'),
}
TEXT = {
    'uz': dict(title='⚙️ <b>Sozlamalar</b>', language='Til: {l}', notif='Bildirishnomalar: {s}', quiet='Tinch soatlar: {s}', on='yoqilgan', off="o'chirilgan", quiet_on='{a}–{b} (Asia/Tashkent)',
               lang_btn='🌐 {l}', notif_btn='🔔 Bildirishnomalar', quiet_btn='🌙 Tinch soatlar', back='🏠 Menyu', not_linked="🔗 Avval akkauntingizni bog'lang: /start", private_only='🔒 Iltimos, shaxsiy chatda yozing.', stale='Bu tugma eskirgan. /sozlamalar'),
    'en': dict(title='⚙️ <b>Settings</b>', language='Language: {l}', notif='Notifications: {s}', quiet='Quiet hours: {s}', on='on', off='off', quiet_on='{a}–{b} (Asia/Tashkent)',
               lang_btn='🌐 {l}', notif_btn='🔔 Notifications', quiet_btn='🌙 Quiet hours', back='🏠 Menu', not_linked='🔗 Please link your account first: /start', private_only='🔒 Please write in a private chat.', stale='This button is outdated. /settings'),
}
COMMANDS = ('/settings', '/sozlamalar')


def _user(chat_id):
    return links.find(str(chat_id), True)


def _render(chat_id, message_id, text, keyboard):
    markup = dict(inline_keyboard=keyboard)
    if message_id and api.call('editMessageText', dict(chat_id=chat_id, message_id=message_id, text=text, parse_mode='HTML', reply_markup=markup)) is not None:
        return
    api.send(chat_id, text, reply_markup=markup)


def show(chat_id, message_id, user):
    pref = state.get_preference(user.id)
    lang = pref.language if pref.language in ('uz', 'en') else 'uz'
    t = TEXT[lang]
    quiet_off = pref.quiet_start == pref.quiet_end
    lines = [t['title'], t['language'].format(l='🇺🇿 O\'zbekcha' if lang == 'uz' else '🇬🇧 English'),
             t['notif'].format(s=t['on'] if pref.notify_enabled else t['off']),
             t['quiet'].format(s=t['off'] if quiet_off else t['quiet_on'].format(a=pref.quiet_start.strftime('%H:%M'), b=pref.quiet_end.strftime('%H:%M')))]
    keyboard = [[dict(text='🇺🇿 O\'zbekcha', callback_data='st:l:uz'), dict(text='🇬🇧 English', callback_data='st:l:en')],
                [dict(text=t['notif_btn'], callback_data='st:n'), dict(text=t['quiet_btn'], callback_data='st:q')]]
    muted = set(pref.muted_kinds or [])
    row = []
    for kind in outbox.KINDS:
        mark = '🔕' if kind in muted else '🔔'
        row.append(dict(text=f'{mark} {KIND_LABELS[lang][kind]}', callback_data=f'st:k:{kind}'))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    _render(chat_id, message_id, '\n'.join(lines), keyboard)


def is_settings_callback(data):
    return isinstance(data, str) and data.split(':', 1)[0] in PREFIXES


def command(chat_id, text, *, chat_type='private'):
    name = text.split('@')[0].split()[0].lower() if text else ''
    if name not in COMMANDS:
        return False
    if chat_type != 'private':
        api.send(chat_id, TEXT['uz']['private_only'])
        return True
    user = _user(chat_id)
    if user is None:
        api.send(chat_id, TEXT['uz']['not_linked'])
        return True
    show(chat_id, None, user)
    return True


def handle_callback(from_id, message_id, data, *, chat_type='private'):
    if not is_settings_callback(data):
        return False
    chat_id = from_id
    if chat_type != 'private':
        api.send(chat_id, TEXT['uz']['private_only'])
        return True
    user = _user(from_id)
    if user is None:
        api.send(chat_id, TEXT['uz']['not_linked'])
        return True
    parts = data.split(':')
    pref = state.get_preference(user.id)          # always the SENDER's own row
    if len(parts) == 1:
        pass
    elif parts[1] == 'l' and len(parts) == 3 and parts[2] in ('uz', 'en'):
        pref.language = parts[2]
        pref.save(update_fields=['language', 'updated_at'])
    elif parts[1] == 'n' and len(parts) == 2:
        pref.notify_enabled = not pref.notify_enabled
        pref.save(update_fields=['notify_enabled', 'updated_at'])
    elif parts[1] == 'q' and len(parts) == 2:
        if pref.quiet_start == pref.quiet_end:
            pref.quiet_start, pref.quiet_end = datetime.time(22, 0), datetime.time(7, 0)
        else:
            pref.quiet_start = pref.quiet_end = datetime.time(0, 0)
        pref.save(update_fields=['quiet_start', 'quiet_end', 'updated_at'])
    elif parts[1] == 'k' and len(parts) == 3 and parts[2] in outbox.KINDS:
        muted = set(pref.muted_kinds or [])
        muted.symmetric_difference_update({parts[2]})
        pref.muted_kinds = sorted(muted)
        pref.save(update_fields=['muted_kinds', 'updated_at'])
    else:
        api.send(chat_id, TEXT[pref.language if pref.language in TEXT else 'uz']['stale'])
        return True
    show(chat_id, message_id, user)
    return True
