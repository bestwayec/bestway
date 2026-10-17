"""TelegramService HTTP delivery; bot polling/link/menu lifecycle is separate."""
import json
import logging
import os
from pathlib import Path
from uuid import uuid4
from urllib.request import Request, urlopen


def call(method, payload=None):
    token=os.environ.get('TELEGRAM_BOT_TOKEN','')
    if not token:return None
    try:
        request=Request(f'https://api.telegram.org/bot{token}/{method}',data=json.dumps(payload or {}).encode(),headers={'Content-Type':'application/json'},method='POST')
        with urlopen(request,timeout=40) as response: data=json.loads(response.read())
        if data.get('ok'):return data.get('result')
    except Exception:
        # Never log token-bearing URLs or private notification content.
        logging.getLogger(__name__).warning('Telegram delivery failed for %s',method)
    return None


def send(chat_id,text,reply_markup=None):
    if not chat_id:return None
    payload=dict(chat_id=chat_id,text=text,parse_mode='HTML')
    if reply_markup is not None:payload['reply_markup']=reply_markup
    return call('sendMessage',payload)


def answer_callback(callback_query_id,text=None):
    if not callback_query_id:return None
    payload=dict(callback_query_id=callback_query_id)
    if text:payload['text']=text
    return call('answerCallbackQuery',payload)


def send_document(chat_id,document,caption=None,filename='bestway-app.apk',parse_mode='HTML',reply_markup=None):
    if not chat_id or document is None:return None
    token=os.environ.get('TELEGRAM_BOT_TOKEN','')
    if not token:return None
    if isinstance(document,str) and document.startswith(('http://','https://')):
        payload=dict(chat_id=chat_id,document=document)
        if caption is not None:
            payload['caption']=caption
            if parse_mode:payload['parse_mode']=parse_mode
        if reply_markup is not None:payload['reply_markup']=reply_markup
        return call('sendDocument',payload)
    try:
        if isinstance(document,(str,Path)):
            path=Path(document)
            raw=path.read_bytes()
            if not filename:filename=path.name
        elif hasattr(document,'read'):
            raw=document.read()
            if isinstance(raw,str):raw=raw.encode('utf-8')
        elif isinstance(document,(bytes,bytearray)):
            raw=bytes(document)
        else:
            return None
        boundary='tg-doc-'+uuid4().hex
        fields=dict(chat_id=str(chat_id))
        if caption is not None:
            fields['caption']=caption
            if parse_mode:fields['parse_mode']=parse_mode
        if reply_markup is not None:
            fields['reply_markup']=json.dumps(reply_markup)
        parts=[]
        for key,value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode('utf-8'))
        safe_name=(filename or 'bestway-app.apk').replace('"','')
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{safe_name}"\r\n'
            f'Content-Type: application/vnd.android.package-archive\r\n\r\n'.encode('utf-8')
            + raw + f'\r\n--{boundary}--\r\n'.encode('utf-8')
        )
        request=Request(
            f'https://api.telegram.org/bot{token}/sendDocument',
            data=b''.join(parts),
            headers={'Content-Type':f'multipart/form-data; boundary={boundary}'},
            method='POST',
        )
        with urlopen(request,timeout=120) as response: data=json.loads(response.read())
        if data.get('ok'):return data.get('result')
    except Exception:
        # Never log token-bearing URLs or private notification content.
        logging.getLogger(__name__).warning('Telegram delivery failed for sendDocument')
    return None


def send_audio(chat_id,audio,caption=None,title=None,performer=None,filename='speaking.mp3',parse_mode='HTML',reply_markup=None):
    if not chat_id or audio is None:return None
    token=os.environ.get('TELEGRAM_BOT_TOKEN','')
    if not token:return None
    if isinstance(audio,str) and audio.startswith(('http://','https://')):
        payload=dict(chat_id=chat_id,audio=audio)
        if caption is not None:payload['caption']=caption;payload['parse_mode']=parse_mode
        if title:payload['title']=title
        if performer:payload['performer']=performer
        if reply_markup is not None:payload['reply_markup']=reply_markup
        return call('sendAudio',payload)
    try:
        if isinstance(audio,(str,Path)):
            path=Path(audio)
            raw=path.read_bytes()
            if not filename:filename=path.name
        elif hasattr(audio,'read'):
            raw=audio.read()
            if isinstance(raw,str):raw=raw.encode('utf-8')
        elif isinstance(audio,(bytes,bytearray)):
            raw=bytes(audio)
        else:
            return None
        boundary='tg-aud-'+uuid4().hex
        fields=dict(chat_id=str(chat_id))
        if caption is not None:fields['caption']=caption;fields['parse_mode']=parse_mode
        if title:fields['title']=title
        if performer:fields['performer']=performer
        if reply_markup is not None:fields['reply_markup']=json.dumps(reply_markup)
        parts=[]
        for key,value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode('utf-8'))
        safe_name=(filename or 'speaking.mp3').replace('"','')
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="{safe_name}"\r\n'
            f'Content-Type: audio/mpeg\r\n\r\n'.encode('utf-8')
            + raw + f'\r\n--{boundary}--\r\n'.encode('utf-8')
        )
        request=Request(
            f'https://api.telegram.org/bot{token}/sendAudio',
            data=b''.join(parts),
            headers={'Content-Type':f'multipart/form-data; boundary={boundary}'},
            method='POST',
        )
        with urlopen(request,timeout=120) as response: data=json.loads(response.read())
        if data.get('ok'):return data.get('result')
    except Exception:
        logging.getLogger(__name__).warning('Telegram delivery failed for sendAudio')
    return None


def send_voice(chat_id,voice,caption=None,parse_mode='HTML',reply_markup=None):
    if not chat_id or voice is None:return None
    token=os.environ.get('TELEGRAM_BOT_TOKEN','')
    if not token:return None
    if isinstance(voice,str) and voice.startswith(('http://','https://')):
        payload=dict(chat_id=chat_id,voice=voice)
        if caption is not None:payload['caption']=caption;payload['parse_mode']=parse_mode
        if reply_markup is not None:payload['reply_markup']=reply_markup
        return call('sendVoice',payload)
    try:
        if isinstance(voice,(str,Path)):
            path=Path(voice)
            raw=path.read_bytes()
            filename=path.name
        elif hasattr(voice,'read'):
            raw=voice.read()
            if isinstance(raw,str):raw=raw.encode('utf-8')
            filename='voice.ogg'
        elif isinstance(voice,(bytes,bytearray)):
            raw=bytes(voice)
            filename='voice.ogg'
        else:
            return None
        boundary='tg-voi-'+uuid4().hex
        fields=dict(chat_id=str(chat_id))
        if caption is not None:fields['caption']=caption;fields['parse_mode']=parse_mode
        if reply_markup is not None:fields['reply_markup']=json.dumps(reply_markup)
        parts=[]
        for key,value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode('utf-8'))
        safe_name=(filename or 'voice.ogg').replace('"','')
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="voice"; filename="{safe_name}"\r\n'
            f'Content-Type: audio/ogg\r\n\r\n'.encode('utf-8')
            + raw + f'\r\n--{boundary}--\r\n'.encode('utf-8')
        )
        request=Request(
            f'https://api.telegram.org/bot{token}/sendVoice',
            data=b''.join(parts),
            headers={'Content-Type':f'multipart/form-data; boundary={boundary}'},
            method='POST',
        )
        with urlopen(request,timeout=120) as response: data=json.loads(response.read())
        if data.get('ok'):return data.get('result')
    except Exception:
        logging.getLogger(__name__).warning('Telegram delivery failed for sendVoice')
    return None



_username=None

def username():
    global _username
    configured=os.environ.get('TELEGRAM_BOT_USERNAME')
    if configured:return configured.replace('@','',1)
    if _username:return _username
    _username=(call('getMe') or {}).get('username')
    return _username


def plain(chat_id,text):
    call('sendMessage',dict(chat_id=chat_id,text=text,parse_mode='HTML',reply_markup=dict(remove_keyboard=True)))


def menu(chat_id,text,keyboard):
    call('sendMessage',dict(chat_id=chat_id,text=text,parse_mode='HTML',reply_markup=keyboard))


def contact_request(chat_id,text):
    call('sendMessage',dict(chat_id=chat_id,text=text,parse_mode='HTML',reply_markup=dict(keyboard=[[dict(text='📱 Telefon raqamimni yuborish',request_contact=True)]],resize_keyboard=True,one_time_keyboard=True)))


def _get_superadmin_id() -> str:
    try:
        from django.conf import settings as dj_settings
        val = getattr(dj_settings, 'SUPERADMIN_TELEGRAM_ID', None)
    except Exception:
        val = None
    return str(val or os.environ.get('SUPERADMIN_TELEGRAM_ID', '5582178765'))


SUPERADMIN_TELEGRAM_ID = _get_superadmin_id()


def download_file(file_id: str) -> bytes | None:
    if not file_id:
        return None
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    if not token:
        return None
    try:
        info = call('getFile', {'file_id': file_id})
        file_path = (info or {}).get('file_path')
        if not file_path:
            return None
        file_url = f'https://api.telegram.org/file/bot{token}/{file_path}'
        request = Request(file_url, headers={'User-Agent': 'BestWay-TelegramBot/1.0'}, method='GET')
        with urlopen(request, timeout=60) as response:
            return response.read()
    except Exception:
        logging.getLogger(__name__).warning('Telegram file download failed')
        return None


def _html_escape(value) -> str:
    return str(value if value is not None else '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def notify_submission_result(job_or_attempt):
    """
    Sends real-time formatted submission result notification to:
    1. Superadmin (5582178765)
    2. Student's Group Teacher (if the teacher has a telegram_chat_id)
    Never raises exceptions to caller.
    """
    if job_or_attempt is None:
        return []
    try:
        superadmin_id = _get_superadmin_id()
        student_name = "O'quvchi"
        group_name = "Guruhsiz"
        teacher_name = "Biriktirilmagan"
        teacher_chat_id = None
        exam_title = "Mock Imtihon"
        section_label = "Mock"
        score_str = "—"
        criteria_lines = []
        feedback_summary = ""
        attempt_id = None

        if isinstance(job_or_attempt, dict):
            d = job_or_attempt
            student_name = d.get('student_name') or d.get('studentName') or student_name
            group_name = d.get('group_name') or d.get('groupName') or group_name
            teacher_name = d.get('teacher_name') or d.get('teacherName') or teacher_name
            teacher_chat_id = d.get('teacher_telegram_id') or d.get('teacher_chat_id') or d.get('teacherChatId')
            exam_title = d.get('exam_title') or d.get('examTitle') or d.get('title') or exam_title
            raw_sec = d.get('section') or d.get('skill') or 'Mock'
            section_label = str(raw_sec).capitalize()
            sc = d.get('overall_band') if d.get('overall_band') is not None else d.get('score') if d.get('score') is not None else d.get('band')
            if sc is not None:
                score_str = str(sc)
            crit = d.get('criteria') or d.get('criteria_scores') or {}
            if isinstance(crit, dict):
                for ck, cv in crit.items():
                    val = cv.get('score') if isinstance(cv, dict) else cv
                    criteria_lines.append(f"{str(ck).upper()}: <b>{_html_escape(val)}</b>")
            feedback_summary = d.get('feedback') or d.get('summary') or ''
            attempt_id = d.get('attempt_id') or d.get('attemptId') or d.get('id')
        else:
            obj = job_or_attempt
            is_job = hasattr(obj, 'skill') and (hasattr(obj, 'final_result') or hasattr(obj, 'ai_score') or hasattr(obj, 'final_score'))
            attempt = getattr(obj, 'attempt', None) if is_job else obj
            attempt_id = getattr(obj, 'attempt_id', None) if is_job else getattr(obj, 'id', None)
            if not attempt_id and attempt is not None:
                attempt_id = getattr(attempt, 'id', None)
            if not attempt_id:
                attempt_id = getattr(obj, 'id', None)

            student_prof = getattr(obj, 'student', None) or (getattr(attempt, 'student', None) if attempt else None)
            student_id = getattr(obj, 'student_id', None) or (getattr(attempt, 'student_id', None) if attempt else None)

            if student_prof is None and student_id:
                try:
                    from apps.legacy_schema.models import StudentProfile
                    student_prof = StudentProfile.objects.select_related('user', 'group__teacher').filter(user_id=student_id).first()
                except Exception:
                    student_prof = None

            if student_prof is not None:
                u = getattr(student_prof, 'user', None)
                if u is None and getattr(student_prof, 'user_id', None):
                    try:
                        from apps.legacy_schema.models import User
                        u = User.objects.filter(id=student_prof.user_id).first()
                    except Exception:
                        u = None
                if u and getattr(u, 'name', None):
                    student_name = u.name
                elif getattr(student_prof, 'name', None):
                    student_name = student_prof.name

                grp = getattr(student_prof, 'group', None)
                if grp is None and getattr(student_prof, 'group_id', None):
                    try:
                        from apps.legacy_schema.models import Group
                        grp = Group.objects.select_related('teacher').filter(id=student_prof.group_id).first()
                    except Exception:
                        grp = None
                if grp is not None:
                    if getattr(grp, 'name', None):
                        group_name = grp.name
                    teacher = getattr(grp, 'teacher', None)
                    if teacher is None and getattr(grp, 'teacher_id', None):
                        try:
                            from apps.legacy_schema.models import User
                            teacher = User.objects.filter(id=grp.teacher_id).first()
                        except Exception:
                            teacher = None
                    if teacher is not None:
                        if getattr(teacher, 'name', None):
                            teacher_name = teacher.name
                        if getattr(teacher, 'telegram_chat_id', None):
                            teacher_chat_id = teacher.telegram_chat_id

            if attempt is None and attempt_id:
                try:
                    from apps.legacy_schema.models import MockAttempt
                    attempt = MockAttempt.objects.select_related('exam').filter(id=attempt_id).first()
                except Exception:
                    attempt = None

            exam = getattr(attempt, 'exam', None) if attempt else getattr(obj, 'exam', None)
            if exam and getattr(exam, 'title', None):
                exam_title = exam.title

            if is_job:
                skill_raw = getattr(obj, 'skill', '') or 'writing'
                section_label = str(skill_raw).capitalize()
                sc = getattr(obj, 'final_score', None)
                if sc is None:
                    sc = getattr(obj, 'ai_score', None)
                if sc is None:
                    sc = getattr(obj, 'teacher_score', None)
                if sc is not None:
                    score_str = f"{sc:g}" if isinstance(sc, float) else str(sc)

                res = getattr(obj, 'approved_feedback', None) or getattr(obj, 'final_result', None) or {}
                if isinstance(res, dict):
                    if score_str == "—":
                         fallback_sc = res.get('overall_band') or res.get('band') or res.get('score') or res.get('practiceGrade')
                         if fallback_sc is not None:
                             score_str = str(fallback_sc)
                    parts = res.get('parts') or []
                    seen_crit = {}
                    for p in parts:
                        if isinstance(p, dict):
                            for ck, cv in (p.get('criteria') or {}).items():
                                if cv is not None and ck not in seen_crit:
                                    seen_crit[ck] = cv
                    if not seen_crit and isinstance(res.get('criteria'), dict):
                        for ck, cv in res['criteria'].items():
                            val = cv.get('score') if isinstance(cv, dict) else cv
                            if val is not None:
                                seen_crit[ck] = val
                    for ck, cv in seen_crit.items():
                        criteria_lines.append(f"{str(ck).upper()}: <b>{_html_escape(cv)}</b>")

                    strengths = res.get('overallStrengths') or res.get('strengths') or []
                    improvements = res.get('priorityImprovements') or res.get('weaknesses') or res.get('areas_for_improvement') or []
                    if not strengths and parts and isinstance(parts[0], dict):
                        fb_part = parts[0].get('feedback') or {}
                        if isinstance(fb_part, dict):
                            strengths = fb_part.get('strengths') or []
                            improvements = fb_part.get('issues') or []
                    summary_parts = []
                    if strengths and isinstance(strengths, list):
                        summary_parts.append("✅ " + "; ".join(str(x) for x in strengths[:2]))
                    if improvements and isinstance(improvements, list):
                        summary_parts.append("⚠️ " + "; ".join(str(x) for x in improvements[:2]))
                    if not summary_parts and isinstance(res.get('feedback'), str):
                        summary_parts.append(res['feedback'])
                    feedback_summary = " | ".join(summary_parts)
            else:
                curr_skill = getattr(obj, 'current_skill', None)
                section_label = str(curr_skill).capitalize() if curr_skill else "Mock"
                band = getattr(obj, 'overall_band', None)
                score = getattr(obj, 'overall_score', None)
                cefr = getattr(obj, 'cefr_level', None)
                score_items = []
                if band is not None:
                    score_items.append(f"Band {band}")
                if score is not None:
                    score_items.append(f"{score:g} ball" if isinstance(score, float) else f"{score} ball")
                if cefr:
                    score_items.append(f"CEFR {cefr}")
                if score_items:
                    score_str = " / ".join(score_items)

                sec_scores = getattr(obj, 'standard_scores', None) or getattr(obj, 'section_bands', None) or {}
                if isinstance(sec_scores, dict):
                    for sk, sv in sec_scores.items():
                        if sv is not None:
                            criteria_lines.append(f"{str(sk).capitalize()}: <b>{_html_escape(sv)}</b>")

        base_url = (os.environ.get('FRONTEND_URL') or 'https://bestwayec.uz').rstrip('/')
        review_link = f"{base_url}/uz/results/{attempt_id}" if attempt_id else f"{base_url}/uz/results"
        criteria_str = " | ".join(criteria_lines) if criteria_lines else "—"
        summary_str = _html_escape(feedback_summary[:350]) if feedback_summary else "AI tekshiruvi yakunlandi."

        text = (
            f"🔔 <b>Yangi Imtihon / Baholash Natijasi!</b>\n"
            f"➖➖➖➖➖➖➖➖➖➖➖➖\n"
            f"👤 <b>Talaba:</b> {_html_escape(student_name)}\n"
            f"👥 <b>Guruh:</b> {_html_escape(group_name)}\n"
            f"👨‍🏫 <b>Ustoz:</b> {_html_escape(teacher_name)}\n"
            f"📝 <b>Imtihon:</b> {_html_escape(exam_title)}\n"
            f"📝 <b>Bo'lim:</b> {_html_escape(section_label)}\n"
            f"🎯 <b>Ball / Band:</b> <b>{_html_escape(score_str)}</b>\n"
            f"📊 <b>Mezonlar:</b> {criteria_str}\n"
            f"💬 <b>Qisqacha tahlil:</b> {summary_str}\n\n"
            f"🔗 <a href=\"{review_link}\">Platformada ko'rish ({review_link})</a>"
        )

        recipients = []
        if superadmin_id:
            recipients.append(str(superadmin_id))
        if teacher_chat_id and str(teacher_chat_id) not in recipients:
            recipients.append(str(teacher_chat_id))

        for cid in recipients:
            send(cid, text)
        return recipients
    except Exception as exc:
        logging.getLogger(__name__).warning("notify_submission_result failed: %r", exc)
        return []

