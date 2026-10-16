import hashlib
import hmac
import logging
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request
from urllib.request import Request, urlopen as _stdlib_urlopen
from django.conf import settings
from django.utils import timezone
from apps.legacy_schema import models as m
from .telegram_links import escape,find
from . import telegram_delivery as api
from . import telegram_fsm as fsm

urlopen=_stdlib_urlopen
SUPERADMIN_TELEGRAM_ID = str(getattr(settings, 'SUPERADMIN_TELEGRAM_ID', os.environ.get('SUPERADMIN_TELEGRAM_ID', '5582178765')))
APK_FILENAME='bestway-app.apk'
DEFAULT_APK_REL_PATH='media/downloads/bestway-app.apk'
DEFAULT_APK_URL='https://github.com/bestwayec/bw-tauri/releases/download/v0.5.3/bestway-app.apk'
CONTAINER_APK_PATH=Path('/app/storage/media/downloads')/APK_FILENAME
APK_ERROR_TEXT="❌ Kechirasiz, hozircha Android ilova faylini yuklab bo'lmadi. Iltimos, keyinroq qayta urinib ko'ring."
MONTHS=['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr']
BTN=dict(
    points='🏆 Ballarim',
    attendance='📅 Davomatim',
    payment="💰 To'lovlarim",
    results='📝 Natijalarim',
    mock_exams='🎯 Mock Imtihonlar',
    leaderboard='🥇 Reyting',
    writing_ocr='✍️ Writing Rasm Tekshirish (AI)',
    web_login='🌐 Web Saytga Kirish',
    code='🔑 Ilovaga kirish kodi',
    monitoring='👁 Jonli Monitoring',
    articles='📰 Yangiliklar',
    children='👨‍👩‍👦 Farzandlarim',
    groups='👥 Guruhlarim',
    grading='✍️ Baholash navbati',
    today='📊 Bugungi holat',
    debtors='💸 Qarzdorlar',
    superadmin_panel='👑 Superadmin Panel',
    topic_management='📚 Mavzular Boshqaruvi',
    platform_stats='📊 Platforma statistikasi',
    active_students='👨‍🎓 Faol talabalar',
    today_tests='📝 Bugungi testlar',
    web_admin_sso='🔐 Web Admin (1-Click Kirish)',
    apk='📱 Android ilovani yuklab olish (.apk)',
    help='ℹ️ Yordam',
)
LABEL=dict(present='✅ Keldi',absent='❌ Kelmadi',late='⏰ Kechikdi',paid="✅ To'langan",unpaid="❌ To'lanmagan",partial="🟡 Qisman to'langan",in_progress='⏳ Topshirilmoqda',grading='✍️ Baholanmoqda',completed='✅ Tayyor')
def label(value):return LABEL.get(value,value)
def money(number):return f'{number:,}'.replace(',',' ')+" so'm"
def date_uz(value):
    if hasattr(value,'tzinfo') and value.tzinfo:value=timezone.localtime(value)
    return f'{value.day}-{MONTHS[value.month-1]}'


def get_superadmin_id() -> str:
    return str(getattr(settings, 'SUPERADMIN_TELEGRAM_ID', os.environ.get('SUPERADMIN_TELEGRAM_ID', SUPERADMIN_TELEGRAM_ID)))


def is_superadmin(chat_id=None, user=None) -> bool:
    if chat_id is not None and str(chat_id) == get_superadmin_id():
        return True
    if user is not None and getattr(user, 'role', None) == 'super_admin':
        return True
    return False


def ensure_superadmin_user(chat_id, from_user=None):
    """
    Ensures Telegram user 5582178765 has an active, approved super_admin User record
    linked to telegram_chat_id=5582178765.
    """
    from types import SimpleNamespace
    from uuid import uuid4
    chat_str = str(chat_id)
    user = None
    try:
        user = find(chat_str)
    except Exception:
        user = None

    if user is None:
        try:
            user = m.User.objects.filter(telegram_chat_id=chat_str).first()
        except Exception:
            user = None

    name_candidate = "BestWay Superadmin"
    if isinstance(from_user, dict):
        fn = (from_user.get('first_name') or '').strip()
        ln = (from_user.get('last_name') or '').strip()
        full = f"{fn} {ln}".strip() or (from_user.get('username') or '').strip()
        if full:
            name_candidate = full
    elif hasattr(from_user, 'name') and getattr(from_user, 'name', None):
        name_candidate = from_user.name

    now = timezone.now()
    if user is not None:
        needs_update = (
            getattr(user, 'role', None) != 'super_admin'
            or not getattr(user, 'is_active', False)
            or str(getattr(user, 'telegram_chat_id', '')) != chat_str
        )
        user.role = 'super_admin'
        user.is_active = True
        user.is_approved = True
        user.telegram_chat_id = chat_str
        if needs_update and getattr(user, 'id', None):
            try:
                m.User.objects.filter(id=user.id).update(
                    role='super_admin',
                    is_active=True,
                    telegram_chat_id=chat_str,
                    updated_at=now,
                )
            except Exception:
                pass
    else:
        try:
            from common.auth.passwords import hash_password
            import secrets
            pwd_hash = hash_password(secrets.token_urlsafe(16))
        except Exception:
            pwd_hash = 'superadmin_sso_hash'
        uid = f"superadmin-{chat_str}"
        try:
            existing_sa = m.User.objects.filter(id=uid).first()
            if existing_sa:
                m.User.objects.filter(id=uid).update(
                    role='super_admin',
                    is_active=True,
                    telegram_chat_id=chat_str,
                    updated_at=now,
                )
                user = m.User.objects.filter(id=uid).first()
            else:
                user = m.User.objects.create(
                    id=uid,
                    name=name_candidate,
                    phone=f"tg_{chat_str}",
                    password_hash=pwd_hash,
                    role='super_admin',
                    is_active=True,
                    telegram_chat_id=chat_str,
                    created_at=now,
                    updated_at=now,
                )
        except Exception:
            user = SimpleNamespace(
                id=uid,
                name=name_candidate,
                phone=f"tg_{chat_str}",
                role='super_admin',
                is_active=True,
                is_approved=True,
                telegram_chat_id=chat_str,
            )

    if user is not None:
        user.role = 'super_admin'
        user.is_active = True
        user.is_approved = True
        user.telegram_chat_id = chat_str
        try:
            if getattr(user, 'id', None):
                m.StudentProfile.objects.filter(user_id=user.id).update(is_approved=True)
        except Exception:
            pass
    return user


def resolve_user(chat_id, active=True, from_user=None):
    if is_superadmin(chat_id=chat_id):
        return ensure_superadmin_user(chat_id, from_user=from_user)
    user = find(chat_id, active)
    if user and getattr(user, 'role', None) == 'super_admin':
        user.is_approved = True
    return user


def menu_for(role, chat_id=None):
    if role == 'super_admin' or is_superadmin(chat_id=chat_id):
        rows = [
            ['superadmin_panel', 'topic_management'],
            ['platform_stats', 'active_students'],
            ['today_tests', 'web_admin_sso'],
            ['writing_ocr'],
            ['today', 'debtors'],
            ['monitoring', 'leaderboard'],
            ['mock_exams', 'web_login'],
            ['code', 'apk'],
            ['help'],
        ]
    elif role=='student':
        rows=[['points','attendance'],['payment','results'],['mock_exams','leaderboard'],['writing_ocr'],['web_login','code'],['apk','help']]
    elif role=='parent':
        rows=[['children'],['attendance','payment'],['points','results'],['mock_exams','leaderboard'],['writing_ocr'],['web_login','code'],['apk','help']]
    elif role=='teacher':
        rows=[['groups','grading'],['monitoring','leaderboard'],['writing_ocr'],['mock_exams','web_login'],['code','apk'],['help']]
    else:
        rows=[['today','debtors'],['monitoring','leaderboard'],['writing_ocr'],['mock_exams','web_login'],['code','apk'],['help']]
    return dict(keyboard=[[dict(text=BTN[key]) for key in row] for row in rows],resize_keyboard=True)


def superadmin_inline_keyboard(chat_id, user=None):
    sso_url = generate_sso_url(chat_id, user)
    return dict(inline_keyboard=[
        [
            dict(text=BTN['topic_management'], callback_data='btn:topic_menu'),
        ],
        [
            dict(text=BTN['platform_stats'], callback_data='sa_platform_stats'),
            dict(text=BTN['active_students'], callback_data='sa_active_students'),
        ],
        [
            dict(text=BTN['today_tests'], callback_data='sa_today_tests'),
        ],
        [
            dict(text=BTN['web_admin_sso'], url=sso_url),
        ],
    ])


def apk_inline_keyboard():
    return dict(inline_keyboard=[[dict(text=BTN['apk'],callback_data='download_apk')]])
def apk_caption():
    version=(os.environ.get('ANDROID_LATEST_VERSION') or getattr(settings,'ANDROID_LATEST_VERSION','0.5.3') or '0.5.3').strip()
    if not version.startswith('v'):version=f'v{version}'
    return (
        '📲 <b>BestWay Mobile (CBT Exam)</b>\n'
        f'Versiya: {version}\n'
        '<i>Qo\'llanma:</i> Faylni yuklab oling, oching va "O\'rnatish" tugmasini bosing ("Noma\'lum manbalar"ga ruxsat bering).\n\n'
        '⚠️ <b>Google Play Protect ogohlantirishi chiqsa:</b>\n'
        '   👉 <b>«Подробнее»</b> (Batafsil) bosing\n'
        '   👉 <b>«Все равно установить»</b> (Baribir o\'rnatish) ni tanlang.'
    )
def resolve_apk_path():
    configured=(os.environ.get('ANDROID_APK_PATH') or getattr(settings,'ANDROID_APK_PATH','') or DEFAULT_APK_REL_PATH).strip()
    candidates=[]
    if configured:
        path=Path(configured)
        if path.is_absolute():candidates.append(path)
    if CONTAINER_APK_PATH not in candidates:
        candidates.append(CONTAINER_APK_PATH)
    fallback_container=Path('/app/storage/downloads')/APK_FILENAME
    if fallback_container not in candidates:
        candidates.append(fallback_container)
    roots=[]
    for raw_root in (os.environ.get('STORAGE_DIR'),getattr(settings,'MEDIA_ROOT',None),getattr(settings,'BASE_DIR',None),Path('/app/storage')):
        if raw_root:
            root=Path(raw_root)
            if not root.is_absolute():root=(Path(settings.BASE_DIR).parent/'backend'/root).resolve()
            if root not in roots:roots.append(root)
    rel_paths=[]
    if configured and not Path(configured).is_absolute():
        rel=Path(configured);rel_paths.append(rel)
        parts=rel.parts
        if parts and parts[0].lower()=='media' and len(parts)>1:rel_paths.append(Path(*parts[1:]))
    for fallback in (Path('downloads')/APK_FILENAME,Path('media')/'downloads'/APK_FILENAME):
        if fallback not in rel_paths:rel_paths.append(fallback)
    for root in roots:
        for rel in rel_paths:
            candidate=root/rel
            if candidate not in candidates:candidates.append(candidate)
    for candidate in candidates:
        try:
            if candidate.is_file():return candidate
        except OSError:continue
    return None
def apk_release_url():
    return (os.environ.get('ANDROID_APK_URL') or os.environ.get('ANDROID_DOWNLOAD_URL') or getattr(settings,'ANDROID_APK_URL','') or DEFAULT_APK_URL).strip()
def send_apk(chat_id):
    caption=apk_caption()
    local_path=resolve_apk_path()
    if local_path is not None:
        try:
            with local_path.open('rb') as stream:
                if api.send_document(chat_id,stream,caption=caption,filename=APK_FILENAME):return True
        except Exception as error:
            logging.getLogger(__name__).warning('Local APK delivery failed: %r',error)
    url=apk_release_url()
    if url:
        try:
            opener=urlopen if urlopen is not _stdlib_urlopen else api.urlopen if api.urlopen is not _stdlib_urlopen else urllib.request.urlopen
            request=Request(url,headers={'User-Agent':'BestWay-TelegramBot/1.0','Accept':'application/octet-stream,*/*'},method='GET')
            with opener(request,timeout=60) as remote_stream:
                if api.send_document(chat_id,remote_stream,caption=caption,filename=APK_FILENAME):return True
        except Exception as error:
            logging.getLogger(__name__).warning('GitHub Releases APK fallback failed: %r',error)
    api.send(chat_id,APK_ERROR_TEXT)
    return False

def generate_sso_url(chat_id, user=None):
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    auth_date = int(time.time())
    name = user.name if user else 'Student'
    data = [
        f"auth_date={auth_date}",
        f"first_name={name}",
        f"id={chat_id}",
    ]
    data.sort()
    data_string = "\n".join(data)
    secret_key = hashlib.sha256(token.encode('utf-8')).digest()
    auth_hash = hmac.new(secret_key, data_string.encode('utf-8'), hashlib.sha256).hexdigest()
    base_url = (os.environ.get('FRONTEND_URL') or 'https://bestwayec.uz').rstrip('/')
    enc_name = urllib.parse.quote(name)
    return f"{base_url}/login?id={chat_id}&first_name={enc_name}&auth_date={auth_date}&hash={auth_hash}"

def send_web_login(chat_id, user=None):
    if is_superadmin(chat_id=chat_id, user=user):
        user = ensure_superadmin_user(chat_id, from_user=user)
    url = generate_sso_url(chat_id, user)
    reply_markup = dict(inline_keyboard=[[dict(text="🌐 Web Platformaga Kirish", url=url)]])
    text = (
        "🔐 <b>BestWay Web Platformasiga Kirish (One-Click SSO)</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Platformaga parol kiritmasdan, bir marta bosish orqali to'g'ridan-to'g'ri kirish uchun "
        "pastdagi tugmani bosing 👇\n\n"
        "⏱ <i>Havola xavfsizlik sababli cheklangan muddat amal qiladi.</i>"
    )
    api.send(chat_id, text, reply_markup=reply_markup)


def send_web_admin_login(chat_id, user=None):
    user = ensure_superadmin_user(chat_id, from_user=user)
    url = generate_sso_url(chat_id, user)
    reply_markup = dict(inline_keyboard=[[dict(text=BTN['web_admin_sso'], url=url)]])
    text = (
        "👑 <b>BestWay Web Admin Paneliga 1-Click Kirish (Superadmin SSO)</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Hisob: <b>" + escape(getattr(user, 'name', 'Superadmin')) + "</b> (<code>super_admin</code>)\n"
        "To'g'ridan-to'g'ri Web Admin boshqaruv paneliga kirish uchun pastdagi tugmani bosing 👇"
    )
    api.send(chat_id, text, reply_markup=reply_markup)


def handle_audio_request(chat_id, payload):
    parts = (payload or '').strip().split('_')
    if not parts or not parts[0]:
        return False
    attempt_id = parts[0]
    question_id = parts[1] if len(parts) > 1 else None

    query = m.MockAnswer.objects.filter(attempt_id=attempt_id, audio_key__isnull=False).exclude(audio_key='')
    if question_id:
        query = query.filter(question_id=question_id)

    answers = list(query.select_related('attempt__exam', 'attempt__student__user')[:3])
    if not answers:
        api.send(chat_id, "❌ Ushbu imtihon uchun audio yozuv topilmadi.")
        return True

    from .mock_media import resolve_key
    for ans in answers:
        exam_title = ans.attempt.exam.title if ans.attempt and ans.attempt.exam else "Mock Imtihon"
        student_name = ans.attempt.student.user.name if ans.attempt and ans.attempt.student and ans.attempt.student.user else "O'quvchi"
        caption = f"🎙 <b>{escape(student_name)}</b> — Speaking javobi\n🎯 {escape(exam_title)}"

        file_path = resolve_key(ans.audio_key)
        sent = False
        if file_path and file_path.is_file():
            sent = bool(api.send_audio(chat_id, file_path, caption=caption, title="Speaking Response", performer="BestWay"))
            if not sent:
                sent = bool(api.send_voice(chat_id, file_path, caption=caption))
        if not sent:
            base_url = (os.environ.get('FRONTEND_URL') or 'https://bestwayec.uz').rstrip('/')
            direct_url = f"{base_url}/media/{ans.audio_key}"
            api.send(chat_id, f"{caption}\n\n🔗 <b>Audio havola:</b> {direct_url}")
    return True

def show(chat_id,role,name):
    effective_role = 'super_admin' if is_superadmin(chat_id=chat_id) else role
    greeting = f'👑 Xush kelibsiz, <b>{escape(name)}</b> (Superadmin)!\n\nQuyidagi boshqaruv tugmalaridan foydalaning:' if effective_role == 'super_admin' else f'👋 Xush kelibsiz, <b>{escape(name)}</b>!\n\nQuyidagi tugmalardan foydalaning:'
    api.menu(chat_id, greeting, menu_for(effective_role, chat_id=chat_id))
def no_children(role):return "👨‍👩‍👦 Sizga hali farzand bog'lanmagan.\n\nSaytga kiring → <b>Farzandni ulash</b> → o'quvchining 8 belgili kodini kiriting." if role=='parent' else "ℹ️ Bu bo'lim faqat o'quvchi va ota-onalar uchun."
def targets(user):
    if user.role=='student':return [user]
    if user.role=='parent':
        ids=m.ParentStudent.objects.filter(parent_user_id=user.id).values_list('student_id',flat=True)
        return list(m.User.objects.filter(id__in=ids))
    return []
def text_for(user,key):
    now=timezone.localtime();first=now.date().replace(day=1)
    if key in ('points','attendance','payment','results'):
        kids=targets(user)
        if not kids:return no_children(user.role)
        parts=[]
        for kid in kids:
            if key=='points':
                profile=m.StudentProfile.objects.filter(user_id=kid.id).first()
                if not profile:continue
                logs=m.PointsLog.objects.filter(student_id=kid.id).order_by('-created_at')[:5]
                history='\n'.join(f'   {"➕" if r.change>0 else "➖"} {abs(r.change)} — {r.reason} <i>({date_uz(r.created_at)})</i>' for r in logs)
                parts.append(f'🏆 <b>{escape(kid.name)}</b>\nJoriy ball: <b>{profile.current_points}</b>\n\n<u>Oxirgi o\'zgarishlar:</u>\n'+(history or "   — hali yozuv yo'q"))
            elif key=='attendance':
                rows=list(m.Attendance.objects.filter(student_id=kid.id,date__year=now.year,date__month=now.month).order_by('-date'))
                last='\n'.join(f'   {date_uz(r.date)} — {label(r.state)}' for r in rows[:7])
                parts.append(f'📅 <b>{escape(kid.name)}</b> — {MONTHS[now.month-1]} oyi\n✅ Keldi: <b>{sum(r.state=="present" for r in rows)}</b>   ❌ Kelmadi: <b>{sum(r.state=="absent" for r in rows)}</b>   ⏰ Kechikdi: <b>{sum(r.state=="late" for r in rows)}</b>\n\n<u>Oxirgi darslar:</u>\n'+(last or "   — yozuv yo'q"))
            elif key=='payment':
                rows=list(m.Payment.objects.filter(student_id=kid.id,year=now.year).order_by('month'));debt=sum(r.state!='paid' for r in rows)
                lines='\n'.join(f'   {MONTHS[r.month-1]}: {label(r.state)}'+(f' — {money(r.amount)}' if r.amount else '') for r in rows)
                end=f"⚠️ To'lanmagan oylar: <b>{debt}</b> ta.\nSavollar bo'lsa administratsiyaga murojaat qiling." if debt else "✅ Barcha to'lovlar joyida. Rahmat!"
                parts.append(f'💰 <b>{escape(kid.name)}</b> — {now.year}-yil\n\n'+(lines or "   — to'lov yozuvi yo'q")+'\n\n'+end)
            else:
                mock_rows=list(m.MockAttempt.objects.filter(student_id=kid.id).select_related('exam').order_by('-started_at')[:5])
                mock_lines=[]
                for ma in mock_rows:
                    exam_title=escape(ma.exam.title if ma.exam else 'Mock Imtihon')
                    st_label=label(ma.status)
                    score_info=[]
                    section_info=[]
                    speaking_audio_lines=[]
                    if ma.status=='completed':
                        if ma.cefr_level:score_info.append(f"CEFR: <b>{escape(ma.cefr_level)}</b>")
                        if ma.overall_band is not None:score_info.append(f"Band: <b>{ma.overall_band}</b>")
                        elif ma.overall_score is not None:score_info.append(f"Ball: <b>{format(ma.overall_score,'g')}</b>")

                        scores = getattr(ma, 'standard_scores', None) or {}
                        bands = getattr(ma, 'section_bands', None) or {}
                        raws = getattr(ma, 'raw_scores', None) or {}

                        if scores:
                            sec_parts=[f"{sk[:1].upper()}:{sc}" for sk,sc in scores.items() if sc is not None]
                            if sec_parts:score_info.append(f"({', '.join(sec_parts)})")

                        def get_sec(s):
                            val = scores.get(s)
                            if val is None: val = bands.get(s)
                            if val is None and isinstance(raws.get(s), dict): val = raws.get(s, {}).get('score')
                            return str(val) if val is not None else "—"

                        l_val = get_sec('listening')
                        r_val = get_sec('reading')
                        w_val = get_sec('writing')
                        s_val = get_sec('speaking')
                        section_info.append(f"      📊 Bo'limlar: 🎧 L: <b>{l_val}</b> | 📖 R: <b>{r_val}</b> | ✍️ W: <b>{w_val}</b> | 🗣 S: <b>{s_val}</b>")

                        try:
                            att_id = getattr(ma, 'id', None)
                            if att_id:
                                answers_with_audio = list(m.MockAnswer.objects.filter(attempt_id=att_id, audio_key__isnull=False).exclude(audio_key='').order_by('question__sort_order'))
                                if answers_with_audio:
                                    for idx, a in enumerate(answers_with_audio, 1):
                                        speaking_audio_lines.append(f"         • Part {idx} audio: /audio_{att_id}_{a.question_id}")
                        except Exception:
                            pass
                    elif ma.status == 'grading':
                        section_info.append("      ✍️ Writing / Speaking baholash jarayonida...")

                    info_str=f" — {' | '.join(score_info)}" if score_info else ""
                    cheat_str=f"\n      ⚠️ Anomaliyalar: {ma.anti_cheat_count} ta" if (ma.anti_cheat_count or 0)>0 else ""
                    lines_block = [f"   🎯 <b>{exam_title}</b>\n      {st_label}{info_str} <i>({date_uz(ma.started_at)})</i>{cheat_str}"]
                    if section_info:
                        lines_block.extend(section_info)
                    if speaking_audio_lines:
                        lines_block.append("      🎙 <b>Speaking audio yozuvlari:</b>\n" + '\n'.join(speaking_audio_lines))
                    mock_lines.append('\n'.join(lines_block))
                legacy_rows=list(m.TestAttempt.objects.filter(student_id=kid.id).select_related('test').order_by('-started_at')[:5])
                legacy_lines=[f"   📝 {escape(r.test.title)}\n      {label(r.status)}"+(f" — <b>{format(r.total_score,'g') if r.total_score is not None else 'null'}</b> ball" if r.status=='completed' else "")+f" <i>({date_uz(r.started_at)})</i>" for r in legacy_rows]
                all_items=[]
                if mock_lines:all_items.append("<b><u>🎯 Mock Imtihonlar (Multi-Level / IELTS):</u></b>\n"+'\n'.join(mock_lines))
                if legacy_lines:all_items.append("<b><u>📝 Darslik / Mavzulashtirilgan testlar:</u></b>\n"+'\n'.join(legacy_lines))
                if not all_items:all_items.append("   — hali test topshirilmagan")
                parts.append(f"📝 <b>{escape(kid.name)}</b> — oxirgi natijalar\n\n"+'\n\n'.join(all_items))
        return '\n\n➖➖➖➖➖\n\n'.join(parts)
    if key=='mock_exams':
        exams=list(m.MockExam.objects.filter(is_published=True).order_by('-created_at')[:12])
        if not exams:return "🎯 <b>Mock Imtihonlar</b>\n\nHozircha faol mock imtihonlar mavjud emas."

        ielts_exams = [e for e in exams if 'ielts' in (e.type or '').lower()]
        multilevel_exams = [e for e in exams if 'multilevel' in (e.type or '').lower()]
        other_exams = [e for e in exams if e not in ielts_exams and e not in multilevel_exams]

        parts = ["🎯 <b>Rasmiy Mock Imtihonlar (IELTS & Multi-Level CEFR)</b>\n"]

        if ielts_exams:
            parts.append("🇬🇧 <b><u>IELTS Mock Imtihonlari:</u></b>")
            for exam in ielts_exams:
                type_name = "IELTS Academic" if 'academic' in (exam.type or '').lower() else "IELTS General" if 'general' in (exam.type or '').lower() else "IELTS"
                lvl = f" • {escape(exam.level)}" if exam.level else " • B1–C2"
                pr = "Bepul" if (exam.price or 0) == 0 or exam.is_free_for_approved else money(exam.price)
                url = f"https://bestwayec.uz/mock/{exam.id}"
                parts.append(
                    f"📌 <b>{escape(exam.title)}</b>\n"
                    f"   Turi: <b>{type_name}</b>{lvl}\n"
                    f"   Bo'limlar: <i>Listening, Reading, Writing, Speaking</i>\n"
                    f"   Narxi: <b>{pr}</b>\n"
                    f"   Topshirish: {url}"
                )

        if multilevel_exams:
            parts.append("🇺🇿 <b><u>Multi-Level (CEFR) Mock Imtihonlari:</u></b>")
            for exam in multilevel_exams:
                lvl = f" • {escape(exam.level)}" if exam.level else " • B1 / B2 / C1"
                pr = "Bepul" if (exam.price or 0) == 0 or exam.is_free_for_approved else money(exam.price)
                url = f"https://bestwayec.uz/mock/{exam.id}"
                parts.append(
                    f"📌 <b>{escape(exam.title)}</b>\n"
                    f"   Turi: <b>Multi-Level CEFR</b>{lvl}\n"
                    f"   Bo'limlar: <i>Listening, Reading, Writing, Speaking</i>\n"
                    f"   Narxi: <b>{pr}</b>\n"
                    f"   Topshirish: {url}"
                )

        if other_exams:
            parts.append("📋 <b><u>Boshqa Mock Imtihonlar:</u></b>")
            for exam in other_exams:
                pr = "Bepul" if (exam.price or 0) == 0 or exam.is_free_for_approved else money(exam.price)
                url = f"https://bestwayec.uz/mock/{exam.id}"
                parts.append(f"📌 <b>{escape(exam.title)}</b>\n   Narxi: <b>{pr}</b>\n   Topshirish: {url}")

        parts.append("<i>💡 Imtihonlarni kompyuter brauzeri yoki Android ilovamiz orqali topshirishingiz mumkin.</i>")
        return '\n\n'.join(parts)
    if key=='leaderboard':
        top_profiles=list(m.StudentProfile.objects.filter(user__is_active=True).select_related('user','group').order_by('-current_points')[:10])
        medals={1:'🥇',2:'🥈',3:'🥉'}
        center_lines=[]
        for rank,sp in enumerate(top_profiles,1):
            badge=medals.get(rank,f"<b>{rank}.</b>")
            group_tag=f" <i>({escape(sp.group.name)})</i>" if sp.group else ""
            center_lines.append(f"{badge} {escape(sp.user.name)}{group_tag} — <b>{sp.current_points}</b> ball")

        center_text = "🏆 <b>BestWay Markaz Reytingi (Top 10)</b>\n\n" + ('\n'.join(center_lines) if center_lines else "Hozircha ma'lumot yo'q")

        user_rank_str = ""
        group_section = ""
        if user.role == 'student':
            user_prof = m.StudentProfile.objects.filter(user_id=user.id).first()
            if user_prof:
                my_rank = m.StudentProfile.objects.filter(user__is_active=True, current_points__gt=user_prof.current_points).count() + 1
                user_rank_str = f"\n\n👤 Sizning o'rningiz: <b>{my_rank}-o'rin</b> (Ball: <b>{user_prof.current_points}</b>)"
                grp = getattr(user_prof, 'group', None)
                if grp and getattr(grp, 'id', None):
                    try:
                        group_top = list(m.StudentProfile.objects.filter(group_id=grp.id, user__is_active=True).select_related('user').order_by('-current_points')[:10])
                        grp_lines = []
                        for gr_rank, gp in enumerate(group_top, 1):
                            badge = medals.get(gr_rank, f"<b>{gr_rank}.</b>")
                            gp_uid = getattr(gp, 'user_id', None) or getattr(getattr(gp, 'user', None), 'id', None)
                            marker = " 👈 <i>(Siz)</i>" if gp_uid == user.id else ""
                            name_val = escape(getattr(gp.user, 'name', 'O\'quvchi') if hasattr(gp, 'user') else 'O\'quvchi')
                            grp_lines.append(f"{badge} {name_val} — <b>{gp.current_points}</b> ball{marker}")
                        my_grp_rank = m.StudentProfile.objects.filter(group_id=grp.id, user__is_active=True, current_points__gt=user_prof.current_points).count() + 1
                        group_section = (
                            f"\n\n➖➖➖➖➖➖➖➖➖\n\n"
                            f"👥 <b>Guruh Reytingi: {escape(getattr(grp, 'name', 'Guruh'))}</b>\n\n"
                            + '\n'.join(grp_lines) +
                            f"\n\n👤 Guruhdagi o'rningiz: <b>{my_grp_rank}-o'rin</b>"
                        )
                    except Exception:
                        pass
        elif user.role == 'teacher':
            teacher_groups = list(m.Group.objects.filter(teacher_id=user.id))
            if teacher_groups:
                t_sections = []
                for tg in teacher_groups:
                    g_top = list(m.StudentProfile.objects.filter(group_id=tg.id, user__is_active=True).select_related('user').order_by('-current_points')[:5])
                    glines = [f"{medals.get(r, f'<b>{r}.</b>')} {escape(p.user.name)} — <b>{p.current_points}</b> ball" for r, p in enumerate(g_top, 1)]
                    t_sections.append(f"👥 <b>{escape(tg.name)}</b>:\n" + ('\n'.join(glines) if glines else "   <i>O'quvchilar yo'q</i>"))
                group_section = "\n\n➖➖➖➖➖➖➖➖➖\n\n<b>👥 Sizning guruhlaringiz reytingi:</b>\n\n" + '\n\n'.join(t_sections)
        elif user.role == 'parent':
            kids = targets(user)
            p_sections = []
            for kid in kids:
                kp = m.StudentProfile.objects.filter(user_id=kid.id).select_related('group').first()
                if kp and kp.group:
                    g_top = list(m.StudentProfile.objects.filter(group_id=kp.group_id, user__is_active=True).select_related('user').order_by('-current_points')[:5])
                    glines = [f"{medals.get(r, f'<b>{r}.</b>')} {escape(p.user.name)} — <b>{p.current_points}</b> ball" for r, p in enumerate(g_top, 1)]
                    k_gr_rank = m.StudentProfile.objects.filter(group_id=kp.group_id, user__is_active=True, current_points__gt=kp.current_points).count() + 1
                    p_sections.append(f"👥 <b>{escape(kid.name)} — {escape(kp.group.name)}</b> (O'rni: <b>{k_gr_rank}-o'rin</b>):\n" + '\n'.join(glines))
            if p_sections:
                group_section = "\n\n➖➖➖➖➖➖➖➖➖\n\n" + '\n\n'.join(p_sections)

        return center_text + user_rank_str + group_section
    if key=='monitoring':
        if user.role not in ('teacher','admin','super_admin'):return "ℹ️ Bu bo'lim faqat o'qituvchi va ma'murlar uchun mo'ljallangan."
        student_query=m.StudentProfile.objects.all()
        if user.role=='teacher':
            group_ids=m.Group.objects.filter(teacher_id=user.id).values_list('id',flat=True)
            student_query=student_query.filter(group_id__in=group_ids)
        student_user_ids=list(student_query.values_list('user_id',flat=True))
        active_attempts=list(m.MockAttempt.objects.filter(student_id__in=student_user_ids,status__in=['in_progress','grading']).select_related('student__user','student__group','exam').order_by('-started_at')[:15])
        if not active_attempts:return "👁 <b>Jonli Imtihon Monitoringi</b>\n\n🟢 Ayni paytda faol imtihon topshirayotgan o'quvchilar yo'q."
        lines=[]
        for att in active_attempts:
            student_name=escape(att.student.user.name if att.student and att.student.user else "Noma'lum")
            group_name=escape(att.student.group.name if att.student and att.student.group else "Guruhsiz")
            skill_label=(att.current_skill or '').capitalize() if att.current_skill else "To'liq"
            status_text="⏳ Topshirmoqda" if att.status=='in_progress' else "✍️ Baholanmoqda"
            anomalies=att.anti_cheat_count or 0
            shield="🟢 Xavfsiz" if anomalies==0 else f"🔴 Qoidabuzarlik: {anomalies} ta!"
            exam_title=escape(att.exam.title if att.exam else "Mock Imtihon")
            lines.append(f"👤 <b>{student_name}</b> ({group_name})\n   Imtihon: {exam_title}\n   Bo'lim: <b>{escape(skill_label)}</b> | {status_text}\n   Holat: {shield}\n   Boshlangan: <i>{date_uz(att.started_at)}</i>")
        return f"👁 <b>Jonli Imtihon Monitoringi ({len(active_attempts)} ta faol)</b>\n\n"+'\n\n'.join(lines)
    if key=='articles':
        articles=list(m.Article.objects.order_by('-created_at')[:5])
        if not articles:return "📰 <b>Yangiliklar va Maqolalar</b>\n\nHozircha e'lonlar mavjud emas."
        lines=[]
        for art in articles:
            body_preview=(art.body or '').strip()
            if len(body_preview)>100:body_preview=body_preview[:97]+'...'
            lines.append(f"📢 <b>{escape(art.title)}</b>\n<i>{date_uz(art.created_at)}</i>\n{escape(body_preview)}")
        return "📰 <b>BestWay Yangiliklari va E'lonlari</b>\n\n"+'\n\n'.join(lines)
    if key=='children':
        rows=m.ParentStudent.objects.filter(parent_user_id=user.id).select_related('student__user','student__group');parts=[]
        for row in rows:
            s=row.student;absent=m.Attendance.objects.filter(student_id=s.user_id,state='absent',date__gte=first).count();unpaid=m.Payment.objects.filter(student_id=s.user_id,year=now.year).exclude(state='paid').count()
            parts.append(f'👤 <b>{escape(s.user.name)}</b>\n   Guruh: {escape(s.group.name if s.group_id else "— (guruhga biriktirilmagan)")}\n   Ball: <b>{s.current_points}</b>\n   Bu oy kelmagan kunlar: <b>{absent}</b>\n   To\'lanmagan oylar: <b>{unpaid}</b>')
        return '👨‍👩‍👦 <b>Farzandlaringiz</b>\n\n'+'\n\n'.join(parts)+'\n\n<i>Batafsil: pastdagi tugmalar.</i>' if parts else no_children('parent')
    if key=='groups':
        parts=[]
        for group in m.Group.objects.filter(teacher_id=user.id):
            count=m.StudentProfile.objects.filter(group_id=group.id).count();marked=m.Attendance.objects.filter(group_id=group.id,date=now.date()).count()
            parts.append(f'👥 <b>{escape(group.name)}</b>\n   O\'quvchilar: <b>{count}</b>\n   Bugungi davomat: '+(f'✅ belgilangan ({marked})' if marked else '⚠️ hali belgilanmagan'))
        return '\n\n'.join(parts) or '👥 Sizga hali guruh biriktirilmagan.'
    if key=='grading':
        rows=list(m.TestAttempt.objects.filter(status='grading',student__group__teacher_id=user.id).select_related('student__user','test').order_by('finished_at')[:10])
        if not rows:return "✍️ Baholash navbati bo'sh. Barakalla! 🎉"
        lines='\n'.join(f'   • {escape(r.student.user.name)} — {escape(r.test.title)}' for r in rows)
        return f'✍️ <b>Baholash kutilmoqda: {len(rows)} ta</b>\n\n{lines}\n\n<i>Baholash saytdagi panelda amalga oshiriladi.</i>'
    if key=='today':
        from .statistics import dashboard
        data=dashboard();today=data['today'];paid=sum(m.Payment.objects.filter(year=now.year,month=now.month,state='paid').values_list('amount',flat=True))
        return f'📊 <b>Bugungi holat</b> — {date_uz(now)}\n\n👨‍🎓 O\'quvchilar: <b>{data["students"]}</b>\n👥 Guruhlar: <b>{data["groups"]}</b>\n\n<u>Bugungi davomat:</u>\n   ✅ Keldi: <b>{today["present"]}</b>\n   ❌ Kelmadi: <b>{today["absent"]}</b>\n   ⏰ Kechikdi: <b>{today["late"]}</b>\n'+('   <i>hali belgilanmagan</i>\n' if not today['marked'] else '')+f'\n💰 Bu oy tushum: <b>{money(paid)}</b>\n💸 Qarzdorlar: <b>{data["month"]["debtors"]}</b>\n✍️ Baholanmagan testlar: <b>{data["queue"]["grading"]}</b>'
    if key=='debtors':
        rows=[]
        for s in m.StudentProfile.objects.filter(user__is_active=True,group_id__isnull=False).select_related('user'):
            payment=m.Payment.objects.filter(student_id=s.user_id,year=now.year,month=now.month).first()
            if not payment or payment.state!='paid':rows.append((s,payment))
        if not rows:return f"✅ {MONTHS[now.month-1]} oyida qarzdor yo'q. Ajoyib!"
        lines='\n'.join(f'   • {escape(s.user.name)} — {escape(s.user.phone)} {label(p.state if p else "unpaid")}' for s,p in rows[:20]);more=f'\n\n<i>…va yana {len(rows)-20} ta</i>' if len(rows)>20 else ''
        return f'💸 <b>Qarzdorlar — {MONTHS[now.month-1]}</b> ({len(rows)} ta)\n\n{lines}{more}\n\n<i>Eslatma yuborish: admin panel → To\'lovlar → "Eslatma yuborish".</i>'
    if key == 'writing_ocr':
        return (
            "✍️ <b>Writing Rasm Tekshirish (AI)</b>\n"
            "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
            "IELTS Writing insho rasmini (qo'lyozma yoki bosma) shu yerga yuboring. "
            "AI matnni o'qib (OCR), 4 ta mezon bo'yicha baholab beradi!\n\n"
            "📌 <i>Izoh sifatida (caption) insho mavzusini (Task prompt) ham yozib yuborishingiz mumkin.</i>"
        )
    if key in ('superadmin_panel', 'platform_stats', 'active_students', 'today_tests'):
        if not is_superadmin(chat_id=getattr(user, 'telegram_chat_id', None), user=user):
            return "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan."
        if key == 'superadmin_panel':
            return (
                f"👑 <b>BestWay Superadmin Paneli</b>\n"
                f"➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
                f"👤 Hisob: <b>{escape(getattr(user, 'name', 'Superadmin'))}</b> (<code>super_admin</code>)\n"
                f"🆔 Telegram ID: <code>{escape(str(getattr(user, 'telegram_chat_id', get_superadmin_id())))}</code>\n\n"
                f"Quyidagi bo'limlardan birini tanlang:\n"
                f"• 📚 <b>Mavzular Boshqaruvi</b> — Writing va Speaking mavzularini qo'shish va boshqarish\n"
                f"• 📊 <b>Platforma statistikasi</b> — umumiy ko'rsatkichlar\n"
                f"• 👨‍🎓 <b>Faol talabalar</b> — o'quvchilar va guruhlar kesimi\n"
                f"• 📝 <b>Bugungi testlar</b> — bugun topshirilgan imtihonlar\n"
                f"• 🔐 <b>Web Admin (1-Click Kirish)</b> — saytga to'g'ridan-to'g'ri kirish"
            )
        if key == 'platform_stats':
            try:
                total_users = m.User.objects.count()
            except Exception:
                total_users = 0
            try:
                active_students_cnt = m.StudentProfile.objects.filter(user__is_active=True).count()
            except Exception:
                active_students_cnt = 0
            try:
                teachers_cnt = m.User.objects.filter(role='teacher', is_active=True).count()
            except Exception:
                teachers_cnt = 0
            try:
                groups_cnt = m.Group.objects.count()
            except Exception:
                groups_cnt = 0
            try:
                completed_mocks = m.MockAttempt.objects.filter(status='completed').count()
            except Exception:
                completed_mocks = 0
            try:
                completed_tests = m.TestAttempt.objects.filter(status='completed').count()
            except Exception:
                completed_tests = 0
            total_attempts = completed_mocks + completed_tests
            return (
                f"📊 <b>Platforma statistikasi</b> — {date_uz(now)}\n"
                f"➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
                f"👥 Jami foydalanuvchilar: <b>{total_users}</b>\n"
                f"👨‍🎓 Faol talabalar: <b>{active_students_cnt}</b>\n"
                f"👨‍🏫 O'qituvchilar: <b>{teachers_cnt}</b>\n"
                f"🏫 Guruhlar: <b>{groups_cnt}</b>\n"
                f"🎯 Yakunlangan Mock imtihonlar: <b>{completed_mocks}</b>\n"
                f"📝 Yakunlangan mavzuli testlar: <b>{completed_tests}</b>\n"
                f"✅ Jami topshirilgan urinishlar: <b>{total_attempts}</b>"
            )
        if key == 'active_students':
            group_lines = []
            try:
                for grp in m.Group.objects.all()[:15]:
                    cnt = m.StudentProfile.objects.filter(group_id=grp.id, user__is_active=True).count()
                    group_lines.append(f"   • <b>{escape(grp.name)}</b>: {cnt} ta talaba")
            except Exception:
                pass
            student_lines = []
            try:
                recent_profiles = list(
                    m.StudentProfile.objects.filter(user__is_active=True)
                    .select_related('user', 'group')
                    .order_by('-created_at')[:12]
                )
                for sp in recent_profiles:
                    u_name = escape(sp.user.name if getattr(sp, 'user', None) else "Talaba")
                    g_name = escape(sp.group.name if getattr(sp, 'group', None) else "Guruhsiz")
                    pts = getattr(sp, 'current_points', 0)
                    student_lines.append(f"   👤 <b>{u_name}</b> ({g_name}) — <b>{pts}</b> ball")
            except Exception:
                pass
            grp_block = "\n".join(group_lines) if group_lines else "   — guruhlar topilmadi"
            std_block = "\n".join(student_lines) if student_lines else "   — faol talabalar topilmadi"
            return (
                f"👨‍🎓 <b>Faol talabalar va guruhlar</b>\n"
                f"➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
                f"<b>🏫 Guruhlar kesimida:</b>\n{grp_block}\n\n"
                f"<b>🆕 Oxirgi faol talabalar:</b>\n{std_block}"
            )
        if key == 'today_tests':
            today_date = now.date()
            attempt_lines = []
            try:
                mock_today = list(
                    m.MockAttempt.objects.filter(started_at__date=today_date)
                    .select_related('student__user', 'exam')
                    .order_by('-started_at')[:15]
                )
                for ma in mock_today:
                    s_name = escape(ma.student.user.name if getattr(ma, 'student', None) and getattr(ma.student, 'user', None) else "Talaba")
                    e_title = escape(ma.exam.title if getattr(ma, 'exam', None) else "Mock Imtihon")
                    st_lbl = label(getattr(ma, 'status', 'in_progress'))
                    sc_val = (
                        f"Band {ma.overall_band}" if getattr(ma, 'overall_band', None) is not None
                        else f"{ma.overall_score:g} ball" if getattr(ma, 'overall_score', None) is not None
                        else "—"
                    )
                    attempt_lines.append(f"   🎯 <b>{s_name}</b> — {e_title}\n      Holat: {st_lbl} | Natija: <b>{sc_val}</b>")
            except Exception:
                pass
            try:
                test_today = list(
                    m.TestAttempt.objects.filter(started_at__date=today_date)
                    .select_related('student__user', 'test')
                    .order_by('-started_at')[:10]
                )
                for ta in test_today:
                    s_name = escape(ta.student.user.name if getattr(ta, 'student', None) and getattr(ta.student, 'user', None) else "Talaba")
                    t_title = escape(ta.test.title if getattr(ta, 'test', None) else "Test")
                    st_lbl = label(getattr(ta, 'status', 'in_progress'))
                    sc_val = f"{ta.total_score:g} ball" if getattr(ta, 'total_score', None) is not None else "—"
                    attempt_lines.append(f"   📝 <b>{s_name}</b> — {t_title}\n      Holat: {st_lbl} | Natija: <b>{sc_val}</b>")
            except Exception:
                pass
            body = "\n".join(attempt_lines) if attempt_lines else "   — Bugun hali testlar topshirilmagan."
            return (
                f"📝 <b>Bugungi testlar ({date_uz(now)})</b> — {len(attempt_lines)} ta\n"
                f"➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
                f"{body}"
            )
    per_role=dict(
        student="Tugmalar orqali ballaringiz, davomatingiz, to'lovlaringiz, mock/test natijalaringiz va reytingingizni ko'rasiz.",
        parent="Tugmalar orqali farzandingiz ballari, davomati, to'lovlari, mock/test natijalari va reytingini kuzatasiz.",
        teacher="Guruhlaringiz, baholash navbati, reyting va jonli imtihon monitoringini ko'rasiz.",
        admin="Markazning bugungi holati, jonli monitoring, reyting va qarzdorlar ro'yxatini ko'rasiz.",
        super_admin="Markazning bugungi holati, jonli monitoring, reyting va boshqaruv."
    )
    return 'ℹ️ <b>Yordam</b>\n\nBu bot orqali markaz yangiliklari va shaxsiy xabarlar keladi.\n\n<u>Buyruqlar:</u>\n/menu — menyuni ko\'rsatish\n/login — web saytga bir martalik kirish (SSO)\n/apk — Android ilovani yuklab olish (.apk)\n/mock — mock imtihonlar ro\'yxati\n/leaderboard — markaz reytingi\n/status — bog\'lanish holati\n/unlink — akkauntni uzish\n\n'+per_role.get(user.role,'')+"\n\nSavollar bo'lsa administratsiyaga murojaat qiling."


def send_otp_code(chat_id, from_user=None):
    from django.core.cache import cache
    import secrets
    code = f"{secrets.randbelow(900000) + 100000}"
    cache_key = f"telegram_otp:{code}"

    telegram_id = chat_id
    first_name = ""
    last_name = ""
    username = ""
    if from_user:
        if hasattr(from_user, "name"):
            first_name = from_user.name
        elif isinstance(from_user, dict):
            telegram_id = from_user.get("id") or chat_id
            first_name = from_user.get("first_name", "")
            last_name = from_user.get("last_name", "")
            username = from_user.get("username", "")

    cache_data = {
        "telegram_id": telegram_id,
        "first_name": first_name,
        "last_name": last_name,
        "username": username,
    }
    cache.set(cache_key, cache_data, timeout=300)

    text = (
        f"🔑 <b>Sizning kirish kodingiz:</b> <code>{code}</code>\n\n"
        f"⏳ Ushbu kod 5 daqiqa davomida amal qiladi. BestWay mobil ilovasida ushbu kodni kiriting."
    )
    api.send(chat_id, text)


# -------------------------------------------------------------------------
# Topic Management & Dialog Engine Bridge (v0.7.1)
# -------------------------------------------------------------------------

def _get_topic_service():
    try:
        from . import topic_service
        return topic_service
    except ImportError:
        return None


def _topic_field(topic, key, default=''):
    if isinstance(topic, dict):
        return topic.get(key, default)
    return getattr(topic, key, default)


def save_topic_image_helper(photo_bytes: bytes, mime: str = 'image/jpeg') -> str:
    ts = _get_topic_service()
    if ts and hasattr(ts, 'save_topic_image'):
        try:
            res = ts.save_topic_image(photo_bytes, mime)
            if isinstance(res, (tuple, list)) and len(res) > 0:
                return res[0]
            if isinstance(res, str):
                return res
        except Exception as err:
            logging.getLogger(__name__).warning('topic_service.save_topic_image failed: %r', err)

    import uuid
    from pathlib import Path
    ext = '.png' if 'png' in mime else '.webp' if 'webp' in mime else '.jpg'
    rel_path = f"topics/{uuid.uuid4().hex}{ext}"
    media_root = Path(getattr(settings, 'MEDIA_ROOT', '/app/storage/media'))
    full_path = media_root / rel_path
    try:
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(photo_bytes)
        return rel_path
    except Exception as err:
        logging.getLogger(__name__).warning('Fallback image save failed: %r', err)
        return rel_path


def create_writing_topic_helper(title: str, prompt: str, task_type: str, image_key: str = None, created_by: str = None):
    ts = _get_topic_service()
    if ts and hasattr(ts, 'create_writing_topic'):
        try:
            return ts.create_writing_topic(
                title=title,
                prompt_text=prompt,
                task_type=task_type,
                image_key=image_key,
                created_by_id=created_by,
            )
        except TypeError:
            try:
                return ts.create_writing_topic(
                    title=title,
                    prompt=prompt,
                    task_type=task_type,
                    image_key=image_key,
                    created_by=created_by,
                )
            except TypeError:
                try:
                    return ts.create_writing_topic(title, prompt, task_type, image_key)
                except Exception as err:
                    logging.getLogger(__name__).warning('topic_service.create_writing_topic call failed: %r', err)
        except Exception as err:
            logging.getLogger(__name__).warning('topic_service.create_writing_topic failed: %r', err)

    import uuid, time
    return {
        'id': str(uuid.uuid4())[:8],
        'skill': 'writing',
        'type': task_type,
        'title': title,
        'prompt': prompt,
        'prompt_text': prompt,
        'task_type': task_type,
        'image_key': image_key,
        'created_by_id': created_by,
        'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'is_active': True,
    }


def create_speaking_topic_helper(title: str, part: str, cue_card: list = None, questions: list = None, created_by: str = None):
    ts = _get_topic_service()
    if ts and hasattr(ts, 'create_speaking_topic'):
        try:
            return ts.create_speaking_topic(
                title=title,
                part=part,
                bullet_points=cue_card,
                followup_questions=questions,
                created_by_id=created_by,
            )
        except TypeError:
            try:
                return ts.create_speaking_topic(
                    title=title,
                    part=part,
                    cue_card=cue_card,
                    questions=questions,
                    created_by=created_by,
                )
            except TypeError:
                try:
                    return ts.create_speaking_topic(title, part, cue_card, questions)
                except Exception as err:
                    logging.getLogger(__name__).warning('topic_service.create_speaking_topic call failed: %r', err)
        except Exception as err:
            logging.getLogger(__name__).warning('topic_service.create_speaking_topic failed: %r', err)

    import uuid, time
    return {
        'id': str(uuid.uuid4())[:8],
        'skill': 'speaking',
        'type': part,
        'title': title,
        'part': part,
        'cue_card': cue_card or [],
        'bullet_points': cue_card or [],
        'questions': questions or [],
        'followup_questions': questions or [],
        'created_by_id': created_by,
        'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'is_active': True,
    }


def list_recent_topics_helper(limit: int = 10):
    ts = _get_topic_service()
    if ts:
        for fn_name in ('list_recent_topics', 'get_recent_topics', 'list_topics'):
            if hasattr(ts, fn_name):
                try:
                    return list(getattr(ts, fn_name)(limit=limit))
                except TypeError:
                    try:
                        return list(getattr(ts, fn_name)())
                    except Exception:
                        pass
    return []


def get_topic_helper(topic_id: str | int):
    ts = _get_topic_service()
    if ts:
        for fn_name in ('get_topic', 'get_topic_by_id', 'find_topic'):
            if hasattr(ts, fn_name):
                try:
                    return getattr(ts, fn_name)(topic_id)
                except Exception:
                    pass
    return None


def delete_topic_helper(topic_id: str | int):
    ts = _get_topic_service()
    if ts:
        for fn_name in ('delete_topic', 'remove_topic', 'deactivate_topic', 'soft_delete_topic'):
            if hasattr(ts, fn_name):
                try:
                    return getattr(ts, fn_name)(topic_id)
                except Exception:
                    pass
    return True


def topic_management_inline_keyboard():
    return dict(inline_keyboard=[
        [
            dict(text="✍️ Writing Mavzu Qo'shish", callback_data="btn:topic_add_writing"),
        ],
        [
            dict(text="🗣 Speaking Mavzu Qo'shish", callback_data="btn:topic_add_speaking"),
        ],
        [
            dict(text="📋 Oxirgi Mavzular", callback_data="btn:topic_list_recent"),
        ],
        [
            dict(text="⬅️ Orqaga", callback_data="btn:superadmin_back"),
        ],
    ])


def send_topic_management_menu(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    text = (
        "📚 <b>Mavzular Boshqaruvi (Superadmin)</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Ushbu bo'lim orqali IELTS va Multi-Level uchun yangi Writing va Speaking "
        "mavzularini tizimga kiritishingiz va mavjudlarini boshqarishingiz mumkin.\n\n"
        "Kerakli bo'limni tanlang 👇"
    )
    api.send(chat_id, text, reply_markup=topic_management_inline_keyboard())


def cancel_topic_dialog(chat_id):
    fsm.clear_state(chat_id)
    text = "❌ <b>Amal bekor qilindi.</b> Superadmin boshqaruv paneliga qaytdingiz."
    api.send(chat_id, text, reply_markup=superadmin_inline_keyboard(chat_id))


# --- Writing FSM Dialog Handlers ---

def send_writing_type_selection(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    fsm.set_state(chat_id, fsm.STATE_WRITING_TYPE, {'skill': 'writing'})
    text = (
        "✍️ <b>Writing Mavzu Qo'shish</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Qaysi vazifa turi uchun mavzu qo'shmoqchisiz? Tanlang 👇"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="📊 Task 1 (Report/Chart)", callback_data="btn:topic_w_type:task1"),
            dict(text="📝 Task 2 (Essay)", callback_data="btn:topic_w_type:task2"),
        ],
        [
            dict(text="⬅️ Orqaga", callback_data="btn:topic_menu"),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def send_writing_prompt_request(chat_id, task_type='task1'):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    task_label = "Task 1 (Report/Chart)" if task_type == 'task1' else "Task 2 (Essay)"
    fsm.set_state(chat_id, fsm.STATE_WRITING_PROMPT, {'skill': 'writing', 'task_type': task_type, 'task_label': task_label})
    example = (
        "<i>Masalan: The charts below show the percentage of household food waste in five countries in 2020...</i>"
        if task_type == 'task1'
        else "<i>Masalan: Some people think that universities should provide graduates with the knowledge and skills needed in the workplace. Others think that the true function of a university should be to give access to knowledge for its own sake. Discuss both views and give your opinion.</i>"
    )
    text = (
        f"✍️ <b>Writing {task_label}</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Mavzu yoki savol matnini (Task prompt) xabar sifatida yuboring:\n\n"
        f"{example}"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="⬅️ Orqaga", callback_data="btn:topic_add_writing"),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def send_writing_image_prompt(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    state_obj = fsm.get_state(chat_id)
    fsm.set_state(chat_id, fsm.STATE_WRITING_IMAGE, state_obj.get('data'))
    text = (
        "🖼 <b>Task 1: Grafik / Diagramma rasmi</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Grafik, jadval yoki diagramma rasmini shu yerga <b>foto</b> ko'rinishida yuboring.\n\n"
        "Agar mavzu rasm talab qilmasa yoki rasmsiz kiritmoqchi bo'lsangiz, "
        "«⏭ Rasmsiz davom etish» tugmasini bosing 👇"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="⏭ Rasmsiz davom etish", callback_data="btn:topic_w_skip_image"),
        ],
        [
            dict(text="⬅️ Orqaga", callback_data="btn:topic_w_back_prompt"),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def send_writing_confirm_screen(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    state_obj = fsm.get_state(chat_id)
    data = state_obj.get('data') or {}
    fsm.set_state(chat_id, fsm.STATE_WRITING_CONFIRM, data)

    task_type = data.get('task_type', 'task1')
    task_label = "Task 1 (Report/Chart)" if task_type == 'task1' else "Task 2 (Essay)"
    prompt_text = data.get('prompt_text', '')
    image_key = data.get('image_key')
    image_status = "✅ Rasm biriktirildi" if image_key else "❌ Rasmsiz"

    back_cb = "btn:topic_w_back_image" if task_type == 'task1' else "btn:topic_w_back_prompt"
    text = (
        "📋 <b>Writing Mavzu Xulosasi</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        f"📌 <b>Vazifa turi:</b> {task_label}\n"
        f"📝 <b>Savol matni (Prompt):</b>\n<blockquote>{escape(prompt_text)}</blockquote>\n"
        f"🖼 <b>Rasm holati:</b> {image_status}\n\n"
        "Ushbu mavzuni tasdiqlaysizmi?"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="✅ Tasdiqlash va Saqlash", callback_data="btn:topic_confirm_save_writing"),
        ],
        [
            dict(text="⬅️ Orqaga", callback_data=back_cb),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def save_writing_topic_and_confirm(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    state_obj = fsm.get_state(chat_id)
    data = state_obj.get('data') or {}

    task_type = data.get('task_type', 'task1')
    task_label = "Task 1" if task_type == 'task1' else "Task 2"
    prompt_text = data.get('prompt_text', '').strip()
    title = data.get('title') or (prompt_text[:70] + ('...' if len(prompt_text) > 70 else ''))
    image_key = data.get('image_key')

    saved = create_writing_topic_helper(
        title=title,
        prompt=prompt_text,
        task_type=task_type,
        image_key=image_key,
        created_by=str(chat_id),
    )
    topic_id = _topic_field(saved, 'id', 'new')
    fsm.clear_state(chat_id)

    reply_text = (
        f"✅ <b>Yangi Writing {task_label} mavzusi muvaffaqiyatli saqlandi!</b>\n\n"
        f"📌 <b>Mavzu:</b> {escape(title)}\n"
        f"🆔 ID: <code>{topic_id}</code>"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="➕ Yana Writing qo'shish", callback_data="btn:topic_add_writing"),
            dict(text="📋 Mavzular ro'yxati", callback_data="btn:topic_list_recent"),
        ],
        [
            dict(text="⬅️ Boshqaruv menyusi", callback_data="btn:topic_menu"),
        ]
    ])
    api.send(chat_id, reply_text, reply_markup=reply_markup)


# --- Speaking FSM Dialog Handlers ---

def send_speaking_part_selection(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    fsm.set_state(chat_id, fsm.STATE_SPEAKING_PART, {'skill': 'speaking'})
    text = (
        "🗣 <b>Speaking Mavzu Qo'shish</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Qaysi bo'lim (Part) uchun mavzu qo'shmoqchisiz? Tanlang 👇"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="🗣 Part 1 (Interview)", callback_data="btn:topic_s_part:part1"),
        ],
        [
            dict(text="📋 Part 2 (Cue Card)", callback_data="btn:topic_s_part:part2"),
        ],
        [
            dict(text="💬 Part 3 (Discussion)", callback_data="btn:topic_s_part:part3"),
        ],
        [
            dict(text="⬅️ Orqaga", callback_data="btn:topic_menu"),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def send_speaking_title_request(chat_id, part='part1'):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    part_label = "Part 1 (Interview)" if part == 'part1' else "Part 2 (Cue Card)" if part == 'part2' else "Part 3 (Discussion)"
    fsm.set_state(chat_id, fsm.STATE_SPEAKING_TITLE, {'skill': 'speaking', 'part': part, 'part_label': part_label})
    example = (
        "<i>Masalan: Hometown / Work or Studies / Daily Routine</i>"
        if part == 'part1'
        else "<i>Masalan: Describe a memorable journey you have been on</i>"
        if part == 'part2'
        else "<i>Masalan: Tourism, Environmental Impact and Cultural Exchange</i>"
    )
    text = (
        f"🗣 <b>Speaking {part_label}</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Mavzu sarlavhasini (Title) xabar sifatida yuboring:\n\n"
        f"{example}"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="⬅️ Orqaga", callback_data="btn:topic_add_speaking"),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def send_speaking_cues_prompt(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    state_obj = fsm.get_state(chat_id)
    fsm.set_state(chat_id, fsm.STATE_SPEAKING_CUES, state_obj.get('data'))
    text = (
        "📋 <b>Part 2: Cue Card punktlari</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Karta punktlarini (bullet points) yuboring — har bir punktni yangi qatordan yozing:\n\n"
        "<i>Masalan:\n"
        "• Where you went\n"
        "• Who you went with\n"
        "• What you did there\n"
        "• And explain why it was memorable</i>"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="⬅️ Orqaga", callback_data="btn:topic_s_back_title"),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def send_speaking_questions_prompt(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    state_obj = fsm.get_state(chat_id)
    data = state_obj.get('data') or {}
    part_label = data.get('part_label', 'Part 1 / Part 3')
    fsm.set_state(chat_id, fsm.STATE_SPEAKING_QUESTIONS, data)
    text = (
        f"💬 <b>Speaking {part_label}: Savollar</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        "Savollarni yuboring — har bir savolni yangi qatordan yozing:\n\n"
        "<i>Masalan:\n"
        "1. Do you prefer traveling alone or in a group?\n"
        "2. What makes a place attractive to tourists?\n"
        "3. How does tourism contribute to local economy?</i>"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="⬅️ Orqaga", callback_data="btn:topic_s_back_title"),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def send_speaking_confirm_screen(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    state_obj = fsm.get_state(chat_id)
    data = state_obj.get('data') or {}
    fsm.set_state(chat_id, fsm.STATE_SPEAKING_CONFIRM, data)

    part = data.get('part', 'part1')
    part_label = data.get('part_label') or ("Part 1 (Interview)" if part == 'part1' else "Part 2 (Cue Card)" if part == 'part2' else "Part 3 (Discussion)")
    title = data.get('title', '')
    cue_card = data.get('cue_card') or []
    questions = data.get('questions') or []

    content_preview = ""
    if part == 'part2' and cue_card:
        cue_lines = "\n".join(f"   • {escape(c)}" for c in cue_card)
        content_preview = f"📋 <b>Cue Card punktlari:</b>\n{cue_lines}"
    elif questions:
        q_lines = "\n".join(f"   {i}. {escape(q)}" for i, q in enumerate(questions, 1))
        content_preview = f"💬 <b>Savollar:</b>\n{q_lines}"

    text = (
        "📋 <b>Speaking Mavzu Xulosasi</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        f"📌 <b>Bo'lim:</b> {part_label}\n"
        f"🏷 <b>Mavzu sarlavhasi:</b> <b>{escape(title)}</b>\n\n"
        f"{content_preview}\n\n"
        "Ushbu mavzuni tasdiqlaysizmi?"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="✅ Tasdiqlash va Saqlash", callback_data="btn:topic_confirm_save_speaking"),
        ],
        [
            dict(text="⬅️ Orqaga", callback_data="btn:topic_s_back_content"),
            dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def save_speaking_topic_and_confirm(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    state_obj = fsm.get_state(chat_id)
    data = state_obj.get('data') or {}

    part = data.get('part', 'part1')
    part_label = "Part 1" if part == 'part1' else "Part 2" if part == 'part2' else "Part 3"
    title = data.get('title', 'Speaking Topic').strip()
    cue_card = data.get('cue_card') or []
    questions = data.get('questions') or []

    saved = create_speaking_topic_helper(
        title=title,
        part=part,
        cue_card=cue_card,
        questions=questions,
        created_by=str(chat_id),
    )
    topic_id = _topic_field(saved, 'id', 'new')
    fsm.clear_state(chat_id)

    reply_text = (
        f"✅ <b>Yangi Speaking {part_label} mavzusi muvaffaqiyatli saqlandi!</b>\n\n"
        f"📌 <b>Mavzu:</b> {escape(title)}\n"
        f"🆔 ID: <code>{topic_id}</code>"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="➕ Yana Speaking qo'shish", callback_data="btn:topic_add_speaking"),
            dict(text="📋 Mavzular ro'yxati", callback_data="btn:topic_list_recent"),
        ],
        [
            dict(text="⬅️ Boshqaruv menyusi", callback_data="btn:topic_menu"),
        ]
    ])
    api.send(chat_id, reply_text, reply_markup=reply_markup)


# --- Recent Topics Management ---

def show_recent_topics(chat_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    topics = list_recent_topics_helper(limit=10)
    if not topics:
        reply_markup = dict(inline_keyboard=[
            [
                dict(text="✍️ Writing Mavzu Qo'shish", callback_data="btn:topic_add_writing"),
                dict(text="🗣 Speaking Mavzu Qo'shish", callback_data="btn:topic_add_speaking"),
            ],
            [
                dict(text="⬅️ Orqaga", callback_data="btn:topic_menu"),
            ]
        ])
        api.send(
            chat_id,
            "📋 <b>Oxirgi Mavzular</b>\n"
            "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
            "Hozircha tizimda birorta ham mavzu kiritilmagan.\n"
            "Yangi mavzu qo'shish uchun quyidagi tugmalardan birini tanlang 👇",
            reply_markup=reply_markup,
        )
        return

    lines = []
    keyboard_rows = []
    for idx, t in enumerate(topics, 1):
        tid = _topic_field(t, 'id', str(idx))
        skill = str(_topic_field(t, 'skill', 'topic')).lower()
        title = _topic_field(t, 'title', '') or _topic_field(t, 'prompt', '') or "Mavzu"
        ttype = _topic_field(t, 'task_type', '') or _topic_field(t, 'part', '') or ''
        created_at = _topic_field(t, 'created_at', None)
        date_str = ""
        if created_at:
            if hasattr(created_at, 'strftime'):
                date_str = f" <i>({date_uz(created_at)})</i>"
            else:
                date_str = f" <i>({str(created_at)[:10]})</i>"

        if 'writ' in skill:
            skill_tag = f"✍️ [W:{ttype.upper() if ttype else 'Task'}]"
        elif 'speak' in skill:
            skill_tag = f"🗣 [S:{ttype.upper() if ttype else 'Part'}]"
        else:
            skill_tag = f"📌 [{skill.capitalize()}]"

        title_preview = title[:35] + ('...' if len(title) > 35 else '')
        lines.append(f"<b>{idx}.</b> {skill_tag} <b>{escape(title_preview)}</b>{date_str}")

        row = [
            dict(text=f"👁 {idx}-mavzu", callback_data=f"btn:topic_view_{tid}"),
            dict(text="🗑 O'chirish", callback_data=f"btn:topic_del_{tid}"),
        ]
        keyboard_rows.append(row)

    keyboard_rows.append([
        dict(text="✍️ Writing qo'shish", callback_data="btn:topic_add_writing"),
        dict(text="🗣 Speaking qo'shish", callback_data="btn:topic_add_speaking"),
    ])
    keyboard_rows.append([
        dict(text="⬅️ Boshqaruv menyusi", callback_data="btn:topic_menu"),
    ])

    text = (
        "📋 <b>Oxirgi Mavzular (Top 10)</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        + "\n\n".join(lines)
        + "\n\n<i>Mavzuni to'liq ko'rish yoki o'chirish uchun mos tugmani bosing 👇</i>"
    )
    api.send(chat_id, text, reply_markup=dict(inline_keyboard=keyboard_rows))


def prompt_delete_topic(chat_id, topic_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    topic = get_topic_helper(topic_id)
    title = _topic_field(topic, 'title', f"ID: {topic_id}") if topic else f"ID: {topic_id}"
    text = (
        "🗑 <b>Haqiqatdan ham ushbu mavzuni o'chirmoqchimisiz?</b>\n"
        "➖➖➖➖➖➖➖➖➖➖➖➖\n\n"
        f"📌 <b>Mavzu:</b> {escape(title)}\n"
        f"🆔 ID: <code>{topic_id}</code>\n\n"
        "⚠️ <i>O'chirilgandan so'ng mavzu talabalar va testlarda ko'rinmaydi.</i>"
    )
    reply_markup = dict(inline_keyboard=[
        [
            dict(text="🔴 Ha, o'chirish", callback_data=f"btn:topic_del_confirm_{topic_id}"),
        ],
        [
            dict(text="❌ Bekor qilish", callback_data="btn:topic_list_recent"),
        ]
    ])
    api.send(chat_id, text, reply_markup=reply_markup)


def confirm_delete_topic(chat_id, topic_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    delete_topic_helper(topic_id)
    api.send(chat_id, f"✅ <b>Mavzu muvaffaqiyatli o'chirildi!</b> (ID: <code>{topic_id}</code>)")
    show_recent_topics(chat_id)


def show_topic_details(chat_id, topic_id):
    if not is_superadmin(chat_id=chat_id):
        api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        return
    topic = get_topic_helper(topic_id)
    if not topic:
        api.send(chat_id, "❌ Mavzu topilmadi yoki allaqachon o'chirilgan.", reply_markup=dict(inline_keyboard=[
            [dict(text="⬅️ Ro'yxatga qaytish", callback_data="btn:topic_list_recent")]
        ]))
        return

    skill = str(_topic_field(topic, 'skill', 'topic')).lower()
    title = _topic_field(topic, 'title', '')
    prompt = _topic_field(topic, 'prompt_text', '') or _topic_field(topic, 'prompt', '')
    task_type = _topic_field(topic, 'type', '') or _topic_field(topic, 'task_type', '')
    part = _topic_field(topic, 'type', '') or _topic_field(topic, 'part', '')
    image_key = _topic_field(topic, 'image_key', '')
    cues = _topic_field(topic, 'bullet_points', []) or _topic_field(topic, 'cue_card', [])
    questions = _topic_field(topic, 'followup_questions', []) or _topic_field(topic, 'questions', [])

    lines = [
        "📖 <b>Mavzu Ma'lumotlari</b>",
        "➖➖➖➖➖➖➖➖➖➖➖➖",
    ]
    if 'writ' in skill:
        t_label = "Task 1 (Report/Chart)" if '1' in str(task_type) else "Task 2 (Essay)"
        lines.append(f"✍️ <b>Ko'nikma:</b> IELTS Writing ({t_label})")
        if title:
            lines.append(f"🏷 <b>Sarlavha:</b> {escape(title)}")
        if prompt:
            lines.append(f"📝 <b>Savol matni (Prompt):</b>\n<blockquote>{escape(prompt)}</blockquote>")
        if image_key:
            lines.append(f"🖼 <b>Grafik rasm:</b> <code>{escape(image_key)}</code>")
        else:
            lines.append("🖼 <b>Grafik rasm:</b> <i>Mavjud emas</i>")
    elif 'speak' in skill:
        p_label = "Part 1 (Interview)" if '1' in str(part) else "Part 2 (Cue Card)" if '2' in str(part) else "Part 3 (Discussion)"
        lines.append(f"🗣 <b>Ko'nikma:</b> IELTS Speaking ({p_label})")
        lines.append(f"🏷 <b>Mavzu:</b> {escape(title or 'Nomsiz')}")
        if cues:
            cue_text = "\n".join(f"   • {escape(c)}" for c in cues) if isinstance(cues, list) else escape(str(cues))
            lines.append(f"📋 <b>Cue Card punktlari:</b>\n{cue_text}")
        if questions:
            q_text = "\n".join(f"   {i}. {escape(q)}" for i, q in enumerate(questions, 1)) if isinstance(questions, list) else escape(str(questions))
            lines.append(f"💬 <b>Savollar:</b>\n{q_text}")
    else:
        lines.append(f"📌 <b>Ko'nikma:</b> {escape(skill.capitalize())}")
        lines.append(f"🏷 <b>Mavzu:</b> {escape(title)}")
        if prompt:
            lines.append(f"📝 <b>Matn:</b>\n<blockquote>{escape(prompt)}</blockquote>")

    lines.append(f"\n🆔 ID: <code>{topic_id}</code>")

    reply_markup = dict(inline_keyboard=[
        [
            dict(text="🗑 O'chirish", callback_data=f"btn:topic_del_{topic_id}"),
        ],
        [
            dict(text="⬅️ Ro'yxatga qaytish", callback_data="btn:topic_list_recent"),
        ]
    ])
    api.send(chat_id, "\n\n".join(lines), reply_markup=reply_markup)


def handle(chat_id, text, from_user=None):
    user = resolve_user(chat_id, True, from_user=from_user)
    if text == BTN['apk']:
        send_apk(chat_id)
        return True
    if text == BTN.get('topic_management'):
        if not is_superadmin(chat_id=chat_id, user=user):
            api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
            return True
        send_topic_management_menu(chat_id)
        return True
    if text == BTN.get('web_login'):
        send_web_login(chat_id, user)
        return True
    if text == BTN.get('web_admin_sso'):
        if not is_superadmin(chat_id=chat_id, user=user):
            api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
            return True
        send_web_admin_login(chat_id, user)
        return True
    if text == BTN.get('code'):
        send_otp_code(chat_id, user or from_user)
        return True
    if text == BTN.get('writing_ocr'):
        from types import SimpleNamespace
        dummy_user = user or SimpleNamespace(role='student', name='Talaba', telegram_chat_id=str(chat_id))
        api.send(chat_id, text_for(dummy_user, 'writing_ocr'))
        return True
    if not user:
        return False
    key = next((key for key, value in BTN.items() if value == text), None)
    if key is None:
        return False
    if key == 'help':
        api.send(chat_id, text_for(user, key), reply_markup=apk_inline_keyboard())
        return True
    if key == 'superadmin_panel':
        api.send(chat_id, text_for(user, key), reply_markup=superadmin_inline_keyboard(chat_id, user))
        return True
    api.send(chat_id, text_for(user, key))
    return True


