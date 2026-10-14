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

urlopen=_stdlib_urlopen
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
    web_login='🌐 Web Saytga Kirish',
    monitoring='👁 Jonli Monitoring',
    articles='📰 Yangiliklar',
    children='👨‍👩‍👦 Farzandlarim',
    groups='👥 Guruhlarim',
    grading='✍️ Baholash navbati',
    today='📊 Bugungi holat',
    debtors='💸 Qarzdorlar',
    apk='📱 Android ilovani yuklab olish (.apk)',
    help='ℹ️ Yordam',
)
LABEL=dict(present='✅ Keldi',absent='❌ Kelmadi',late='⏰ Kechikdi',paid="✅ To'langan",unpaid="❌ To'lanmagan",partial="🟡 Qisman to'langan",in_progress='⏳ Topshirilmoqda',grading='✍️ Baholanmoqda',completed='✅ Tayyor')
def label(value):return LABEL.get(value,value)
def money(number):return f'{number:,}'.replace(',',' ')+" so'm"
def date_uz(value):
    if hasattr(value,'tzinfo') and value.tzinfo:value=timezone.localtime(value)
    return f'{value.day}-{MONTHS[value.month-1]}'
def menu_for(role):
    if role=='student':
        rows=[['points','attendance'],['payment','results'],['mock_exams','leaderboard'],['web_login','apk'],['articles','help']]
    elif role=='parent':
        rows=[['children'],['attendance','payment'],['points','results'],['mock_exams','leaderboard'],['web_login','apk'],['articles','help']]
    elif role=='teacher':
        rows=[['groups','grading'],['monitoring','leaderboard'],['mock_exams','web_login'],['apk','help']]
    else:
        rows=[['today','debtors'],['monitoring','leaderboard'],['mock_exams','web_login'],['articles','apk'],['help']]
    return dict(keyboard=[[dict(text=BTN[key]) for key in row] for row in rows],resize_keyboard=True)
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

def show(chat_id,role,name):api.menu(chat_id,f'👋 Xush kelibsiz, <b>{escape(name)}</b>!\n\nQuyidagi tugmalardan foydalaning:',menu_for(role))
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
    per_role=dict(
        student="Tugmalar orqali ballaringiz, davomatingiz, to'lovlaringiz, mock/test natijalaringiz va reytingingizni ko'rasiz.",
        parent="Tugmalar orqali farzandingiz ballari, davomati, to'lovlari, mock/test natijalari va reytingini kuzatasiz.",
        teacher="Guruhlaringiz, baholash navbati, reyting va jonli imtihon monitoringini ko'rasiz.",
        admin="Markazning bugungi holati, jonli monitoring, reyting va qarzdorlar ro'yxatini ko'rasiz.",
        super_admin="Markazning bugungi holati, jonli monitoring, reyting va boshqaruv."
    )
    return 'ℹ️ <b>Yordam</b>\n\nBu bot orqali markaz yangiliklari va shaxsiy xabarlar keladi.\n\n<u>Buyruqlar:</u>\n/menu — menyuni ko\'rsatish\n/login — web saytga bir martalik kirish (SSO)\n/apk — Android ilovani yuklab olish (.apk)\n/mock — mock imtihonlar ro\'yxati\n/leaderboard — markaz reytingi\n/status — bog\'lanish holati\n/unlink — akkauntni uzish\n\n'+per_role.get(user.role,'')+"\n\nSavollar bo'lsa administratsiyaga murojaat qiling."


def handle(chat_id,text):
    if text==BTN['apk']:
        send_apk(chat_id);return True
    if text==BTN.get('web_login'):
        user=find(chat_id,True)
        send_web_login(chat_id,user);return True
    user=find(chat_id,True)
    if not user:return False
    key=next((key for key,value in BTN.items() if value==text),None)
    if key is None:return False
    if key=='help':
        api.send(chat_id,text_for(user,key),reply_markup=apk_inline_keyboard());return True
    api.send(chat_id,text_for(user,key));return True
