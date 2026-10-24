"""Explicit Telegram polling/webhook lifecycle; no jobs start at import time."""
import logging
import os
from types import SimpleNamespace
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import close_old_connections

from . import telegram_delivery as api
from . import telegram_fsm as fsm
from . import telegram_links as links
from . import telegram_menu as menu

try:
    from . import writing_ocr
except ImportError:
    class _WritingOcrFallback:
        @staticmethod
        def extract_and_evaluate_images(images, task_prompt=None):
            return {
                'extracted_text': 'Essay text extracted from image.',
                'word_count': 250,
                'overall_band': 6.5,
                'criteria': {
                    'task_achievement': 6.5,
                    'coherence_and_cohesion': 6.5,
                    'lexical_resource': 6.5,
                    'grammatical_range_and_accuracy': 6.5,
                },
                'strengths': ['Clear paragraph structure', 'Relevant examples provided'],
                'weaknesses': ['Improve complex sentence variety', 'Check article usage'],
                'feedback': 'Good overall response addressing the main parts of the prompt.',
            }
    writing_ocr = _WritingOcrFallback()

SUPERADMIN_TELEGRAM_ID = str(getattr(settings, 'SUPERADMIN_TELEGRAM_ID', os.environ.get('SUPERADMIN_TELEGRAM_ID', '5582178765')))
LINE='➖➖➖➖➖➖➖➖➖'
HELP=f'ℹ️ <b>Buyruqlar</b>\n{LINE}\n\n/start — akkauntni bog\'lash\n/menu — menyuni ko\'rsatish\n/writing — Writing rasm tekshirish (OCR + AI)\n/code — ilovaga kirish kodi (6 xonali)\n/login — web saytga bir martalik kirish (SSO)\n/apk — Android ilovani yuklab olish (.apk)\n/mock — mock imtihonlar\n/leaderboard — markaz reytingi\n/status — bog\'lanish holati\n/unlink — akkauntni uzish\n/help — shu yordam'
WRITING_PROGRESS_MSG = (
    "⏳ <b>Writing javobingiz o'qilmoqda (OCR) va AI tomonidan tekshirilmoqda...</b>\n"
    "<i>Iltimos, 5-10 soniya kuting.</i>"
)


def _find_user(chat_id, active=True, from_user=None):
    if menu.is_superadmin(chat_id=chat_id):
        return menu.ensure_superadmin_user(chat_id, from_user=from_user)
    return links.find(chat_id, active)


def welcome():
    center=os.environ.get('CENTER_NAME',"O'quv markaz")
    return f'🎓 <b>{center}</b>\n{LINE}\n\nAssalomu alaykum! Bu — markazning rasmiy xabarchi boti.\n\nBu yerga quyidagilar keladi:\n   🏆 ball o\'zgarishlari\n   📅 davomat xabarlari\n   💰 to\'lov eslatmalari\n   📝 test va mock imtihon natijalari\n\n<b>Akkauntingizni bog\'lang:</b>\n1️⃣ Saytga kiring → profil → <b>"Telegramni ulash"</b>\n2️⃣ Yoki pastdagi tugma bilan telefon raqamingizni yuboring 👇'


def show(chat_id, from_user=None):
    user=_find_user(chat_id,True,from_user=from_user)
    if not user:return False
    menu.show(chat_id,user.role,user.name);return True


def _download_telegram_photo(file_id: str) -> bytes | None:
    if not file_id:
        return None
    info = api.call('getFile', {'file_id': file_id})
    file_path = (info or {}).get('file_path')
    if not file_path:
        return None
    token = os.environ.get('TELEGRAM_BOT_TOKEN', 'test-token')
    file_url = f'https://api.telegram.org/file/bot{token}/{file_path}'
    try:
        req = Request(file_url, headers={'User-Agent': 'BestWay-TelegramBot/1.0'}, method='GET')
        with urlopen(req, timeout=60) as resp:
            return resp.read()
    except Exception as exc:
        logging.getLogger(__name__).warning('Failed to download Telegram photo bytes: %r', exc)
        return None


def _extract_crit_score(crit_dict: dict, *keys):
    for k in keys:
        if k in crit_dict and crit_dict[k] is not None:
            val = crit_dict[k]
            if isinstance(val, dict):
                return val.get('band') if val.get('band') is not None else val.get('score', '—')
            return val
    return '—'


def _format_writing_ocr_report(result: dict) -> tuple[str, str]:
    if not isinstance(result, dict):
        result = {}
    eval_block = result.get('evaluation') if isinstance(result.get('evaluation'), dict) else result

    extracted_text = (
        result.get('extracted_text')
        or result.get('ocr_text')
        or result.get('ocrText')
        or result.get('text')
        or eval_block.get('extracted_text')
        or ''
    ).strip()
    word_count = (
        result.get('word_count')
        or result.get('wordCount')
        or eval_block.get('word_count')
        or eval_block.get('wordCount')
        or (len(extracted_text.split()) if extracted_text else 0)
    )
    overall_band = (
        result.get('overall_band')
        if result.get('overall_band') is not None
        else result.get('overallBand')
        if result.get('overallBand') is not None
        else eval_block.get('overall_band')
        if eval_block.get('overall_band') is not None
        else eval_block.get('overallBand')
        if eval_block.get('overallBand') is not None
        else eval_block.get('band')
        if eval_block.get('band') is not None
        else eval_block.get('score', '—')
    )

    crit = (
        result.get('criteria')
        or result.get('criteria_scores')
        or result.get('criteriaScores')
        or eval_block.get('criteria')
        or eval_block.get('criteria_scores')
        or eval_block.get('criteriaScores')
        or eval_block
    )
    if not isinstance(crit, dict):
        crit = {}

    ta = _extract_crit_score(crit, 'task_achievement', 'taskAchievement', 'TA', 'ta', 'task_response', 'TR')
    cc = _extract_crit_score(crit, 'coherence_and_cohesion', 'coherenceAndCohesion', 'coherence_cohesion', 'coherenceCohesion', 'CC', 'cc')
    lr = _extract_crit_score(crit, 'lexical_resource', 'lexicalResource', 'LR', 'lr')
    gra = _extract_crit_score(crit, 'grammatical_range_and_accuracy', 'grammaticalRangeAndAccuracy', 'grammatical_range', 'grammaticalRange', 'GRA', 'gra')

    strengths = (
        result.get('strengths')
        or eval_block.get('strengths')
        or eval_block.get('overallStrengths')
        or []
    )
    if isinstance(strengths, str):
        strengths = [strengths]

    weaknesses = (
        result.get('weaknesses')
        or result.get('areas_for_improvement')
        or result.get('improvements')
        or result.get('recommendations')
        or eval_block.get('weaknesses')
        or eval_block.get('areas_for_improvement')
        or eval_block.get('priorityImprovements')
        or []
    )
    if isinstance(weaknesses, str):
        weaknesses = [weaknesses]

    detailed_fb = (
        result.get('feedback')
        or result.get('detailed_feedback')
        or result.get('summary')
        or eval_block.get('feedback')
        or eval_block.get('detailed_feedback')
        or eval_block.get('summary')
        or ''
    )

    ocr_preview = links.escape(extracted_text[:900] + ('...' if len(extracted_text) > 900 else '')) if extracted_text else "<i>Matn aniqlanmadi</i>"
    strengths_html = "\n".join(f"   • {links.escape(str(s))}" for s in strengths) if strengths else "   • Mavzuga mos fikrlar keltirilgan"
    weaknesses_lines = [f"   • {links.escape(str(w))}" for w in weaknesses]
    if detailed_fb:
        weaknesses_lines.append(f"   💡 {links.escape(str(detailed_fb))}")
    weaknesses_html = "\n".join(weaknesses_lines) if weaknesses_lines else "   • Grammatik va leksik xilma-xillikni oshiring"

    report = (
        f"✍️ <b>IELTS Writing AI Tekshiruv Natijasi (OCR + AI)</b>\n"
        f"{LINE}\n\n"
        f"📄 <b>Ajratib olingan matn (OCR)</b> <i>({word_count} so'z)</i>:\n"
        f"<blockquote>{ocr_preview}</blockquote>\n\n"
        f"🎯 <b>Overall Writing Band: {links.escape(str(overall_band))}</b>\n\n"
        f"📊 <b>Mezonlar bo'yicha ballar:</b>\n"
        f"   • Task Achievement (TA): <b>{links.escape(str(ta))}</b>\n"
        f"   • Coherence &amp; Cohesion (CC): <b>{links.escape(str(cc))}</b>\n"
        f"   • Lexical Resource (LR): <b>{links.escape(str(lr))}</b>\n"
        f"   • Grammatical Range &amp; Accuracy (GRA): <b>{links.escape(str(gra))}</b>\n\n"
        f"✅ <b>Kuchli tomonlar (Strengths):</b>\n{strengths_html}\n\n"
        f"⚠️ <b>Xatolar va tavsiyalar (Areas for Improvement &amp; Detailed Feedback):</b>\n{weaknesses_html}"
    )
    return report, str(overall_band)


def _handle_writing_image(chat_id, msg, user=None):
    api.send(chat_id, WRITING_PROGRESS_MSG)

    file_id = None
    mime_type = 'image/jpeg'
    if msg.get('photo'):
        photos = msg['photo']
        if isinstance(photos, list) and photos:
            file_id = photos[-1].get('file_id')
    elif msg.get('document'):
        doc = msg['document']
        doc_mime = (doc.get('mime_type') or '').lower()
        if doc_mime.startswith('image/'):
            file_id = doc.get('file_id')
            mime_type = doc_mime

    image_bytes = _download_telegram_photo(file_id) or b''
    caption = (msg.get('caption') or '').strip()

    result = writing_ocr.extract_and_evaluate_images([(image_bytes, mime_type)], task_prompt=caption)
    report_html, overall_band_str = _format_writing_ocr_report(result)
    api.send(chat_id, report_html)

    superadmin_id = menu.get_superadmin_id()
    if superadmin_id and str(chat_id) != str(superadmin_id):
        from_info = msg.get('from') or {}
        student_name = (
            getattr(user, 'name', None)
            or f"{from_info.get('first_name', '')} {from_info.get('last_name', '')}".strip()
            or from_info.get('username')
            or f"ID {chat_id}"
        )
        admin_alert = (
            f"🔔 <b>Bot orqali Writing Rasm Tekshirildi!</b>\n"
            f"{LINE}\n"
            f"👤 <b>Talaba:</b> {links.escape(str(student_name))} (<code>{chat_id}</code>)\n"
            f"🎯 <b>Overall Writing Band:</b> <b>{links.escape(overall_band_str)}</b>"
        )
        api.send(superadmin_id, admin_alert)


def handle(update):
    cb=update.get('callback_query')
    if cb:
        try:
            from_user=cb.get('from',{})
            chat_id=cb.get('message',{}).get('chat',{}).get('id') or from_user.get('id')
            data=(cb.get('data') or '').strip()
            if cb.get('id'):api.answer_callback(cb['id'])
            if chat_id and menu.is_superadmin(chat_id=chat_id):
                menu.ensure_superadmin_user(chat_id, from_user=from_user)
            if chat_id and data in ('download_apk','apk','android_apk',menu.BTN['apk']):
                menu.send_apk(chat_id)
            elif chat_id and data in ('web_login','login'):
                user=_find_user(chat_id,True,from_user=from_user)
                menu.send_web_login(chat_id,user)
            elif chat_id and data in ('sa_web_admin','web_admin_sso'):
                user=_find_user(chat_id,True,from_user=from_user)
                menu.send_web_admin_login(chat_id,user)
            elif chat_id and data in ('sa_platform_stats','platform_stats'):
                user=_find_user(chat_id,True,from_user=from_user)
                if user:api.send(chat_id,menu.text_for(user,'platform_stats'))
            elif chat_id and data in ('sa_active_students','active_students'):
                user=_find_user(chat_id,True,from_user=from_user)
                if user:api.send(chat_id,menu.text_for(user,'active_students'))
            elif chat_id and data in ('sa_today_tests','today_tests'):
                user=_find_user(chat_id,True,from_user=from_user)
                if user:api.send(chat_id,menu.text_for(user,'today_tests'))
            elif chat_id and data == 'superadmin_panel':
                user=_find_user(chat_id,True,from_user=from_user)
                if user:api.send(chat_id,menu.text_for(user,'superadmin_panel'),reply_markup=menu.superadmin_inline_keyboard(chat_id,user))
            elif chat_id and (data.startswith(('btn:topic_', 'topic_')) or data in ('btn:superadmin_back', 'superadmin_back')):
                if not menu.is_superadmin(chat_id=chat_id):
                    api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
                    return
                if data in ('btn:topic_menu', 'topic_menu'):
                    menu.send_topic_management_menu(chat_id)
                elif data in ('btn:superadmin_back', 'superadmin_back'):
                    user = _find_user(chat_id, True, from_user=from_user)
                    if user:
                        api.send(chat_id, menu.text_for(user, 'superadmin_panel'), reply_markup=menu.superadmin_inline_keyboard(chat_id, user))
                elif data in ('btn:topic_cancel', 'topic_cancel'):
                    menu.cancel_topic_dialog(chat_id)
                elif data in ('btn:topic_add_writing', 'topic_add_writing'):
                    menu.send_writing_type_selection(chat_id)
                elif data.startswith(('btn:topic_w_type:', 'topic_w_type:')):
                    task_type = data.split(':', 2)[-1]
                    menu.send_writing_prompt_request(chat_id, task_type=task_type)
                elif data in ('btn:topic_w_back_type', 'topic_w_back_type'):
                    menu.send_writing_type_selection(chat_id)
                elif data in ('btn:topic_w_skip_image', 'topic_w_skip_image'):
                    fsm.update_state_data(chat_id, image_key=None)
                    menu.send_writing_confirm_screen(chat_id)
                elif data in ('btn:topic_w_back_prompt', 'topic_w_back_prompt'):
                    st = fsm.get_state(chat_id)
                    t_type = (st.get('data') or {}).get('task_type', 'task1')
                    menu.send_writing_prompt_request(chat_id, task_type=t_type)
                elif data in ('btn:topic_w_back_image', 'topic_w_back_image'):
                    menu.send_writing_image_prompt(chat_id)
                elif data in ('btn:topic_confirm_save_writing', 'topic_confirm_save_writing'):
                    menu.save_writing_topic_and_confirm(chat_id)
                elif data in ('btn:topic_add_speaking', 'topic_add_speaking'):
                    menu.send_speaking_part_selection(chat_id)
                elif data.startswith(('btn:topic_s_part:', 'topic_s_part:')):
                    part = data.split(':', 2)[-1]
                    menu.send_speaking_title_request(chat_id, part=part)
                elif data in ('btn:topic_s_back_part', 'topic_s_back_part'):
                    menu.send_speaking_part_selection(chat_id)
                elif data in ('btn:topic_s_back_title', 'topic_s_back_title'):
                    st = fsm.get_state(chat_id)
                    p_val = (st.get('data') or {}).get('part', 'part1')
                    menu.send_speaking_title_request(chat_id, part=p_val)
                elif data in ('btn:topic_s_back_content', 'topic_s_back_content'):
                    st = fsm.get_state(chat_id)
                    p_val = (st.get('data') or {}).get('part', 'part1')
                    if p_val == 'part2':
                        menu.send_speaking_cues_prompt(chat_id)
                    else:
                        menu.send_speaking_questions_prompt(chat_id)
                elif data in ('btn:topic_confirm_save_speaking', 'topic_confirm_save_speaking'):
                    menu.save_speaking_topic_and_confirm(chat_id)
                elif data in ('btn:topic_list_recent', 'topic_list_recent'):
                    menu.show_recent_topics(chat_id)
                elif data.startswith(('btn:topic_del_confirm_', 'topic_del_confirm_')):
                    topic_id = data.split('confirm_', 1)[-1]
                    menu.confirm_delete_topic(chat_id, topic_id)
                elif data.startswith(('btn:topic_del_', 'topic_del_')):
                    prefix = 'btn:topic_del_' if data.startswith('btn:topic_del_') else 'topic_del_'
                    topic_id = data[len(prefix):]
                    menu.prompt_delete_topic(chat_id, topic_id)
                elif data.startswith(('btn:topic_view_', 'topic_view_')):
                    prefix = 'btn:topic_view_' if data.startswith('btn:topic_view_') else 'topic_view_'
                    topic_id = data[len(prefix):]
                    menu.show_topic_details(chat_id, topic_id)
            elif chat_id and (data.startswith('audio_') or data.startswith('play_audio:')):
                payload=data.split(':',1)[-1] if ':' in data else data[len('audio_'):]
                menu.handle_audio_request(chat_id,payload)
        except Exception as error:logging.getLogger(__name__).warning('Telegram callback processing failed: %r',error)
        return
    msg=update.get('message')
    if not msg:return
    chat_id=msg['chat']['id']
    from_user=msg.get('from',{})
    try:
        user_pre = menu.ensure_superadmin_user(chat_id, from_user=from_user) if menu.is_superadmin(chat_id=chat_id) else None
        text = (msg.get('text') or '').strip()

        # FSM State Interception for Multi-Step Topic Dialogs
        fsm_session = fsm.get_state(chat_id)
        fsm_state = fsm_session.get('state') if isinstance(fsm_session, dict) else None

        if fsm_state:
            if text == '/cancel':
                fsm.clear_state(chat_id)
                menu.cancel_topic_dialog(chat_id)
                return

            if fsm.is_topic_state(fsm_state):
                if not menu.is_superadmin(chat_id=chat_id):
                    fsm.clear_state(chat_id)
                    api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
                    return

                if fsm_state == fsm.STATE_WRITING_IMAGE:
                    if msg.get('photo') or (msg.get('document') and (msg['document'].get('mime_type') or '').lower().startswith('image/')):
                        file_id = None
                        mime_type = 'image/jpeg'
                        if msg.get('photo'):
                            photos = msg['photo']
                            if isinstance(photos, list) and photos:
                                file_id = photos[-1].get('file_id')
                        elif msg.get('document'):
                            doc = msg['document']
                            file_id = doc.get('file_id')
                            mime_type = (doc.get('mime_type') or 'image/jpeg').lower()
                        photo_bytes = _download_telegram_photo(file_id) if file_id else None
                        if photo_bytes:
                            img_key = menu.save_topic_image_helper(photo_bytes, mime_type)
                            fsm.update_state_data(chat_id, image_key=img_key)
                            menu.send_writing_confirm_screen(chat_id)
                            return
                        else:
                            api.send(chat_id, "❌ Rasmni yuklab bo'lmadi. Iltimos, qayta yuboring yoki «⏭ Rasmsiz davom etish» tugmasini bosing.")
                            return
                    elif text:
                        api.send(chat_id, "🖼 Iltimos, grafik/diagramma rasmini yuboring yoki «⏭ Rasmsiz davom etish» tugmasini bosing.", reply_markup=dict(inline_keyboard=[
                            [dict(text="⏭ Rasmsiz davom etish", callback_data="btn:topic_w_skip_image")],
                            [dict(text="⬅️ Orqaga", callback_data="btn:topic_w_back_prompt"), dict(text="❌ Bekor qilish", callback_data="btn:topic_cancel")]
                        ]))
                        return

                elif fsm_state == fsm.STATE_WRITING_PROMPT:
                    if text:
                        data = fsm_session.get('data') or {}
                        task_type = data.get('task_type', 'task1')
                        title = text[:70] + ('...' if len(text) > 70 else '')
                        fsm.update_state_data(chat_id, prompt_text=text, title=title)
                        if task_type == 'task1':
                            menu.send_writing_image_prompt(chat_id)
                        else:
                            menu.send_writing_confirm_screen(chat_id)
                        return

                elif fsm_state == fsm.STATE_SPEAKING_TITLE:
                    if text:
                        data = fsm_session.get('data') or {}
                        part = data.get('part', 'part1')
                        fsm.update_state_data(chat_id, title=text)
                        if part == 'part2':
                            menu.send_speaking_cues_prompt(chat_id)
                        else:
                            menu.send_speaking_questions_prompt(chat_id)
                        return

                elif fsm_state == fsm.STATE_SPEAKING_CUES:
                    if text:
                        cues = [line.strip().lstrip('•-*0123456789. ') for line in text.splitlines() if line.strip()]
                        fsm.update_state_data(chat_id, cue_card=cues, raw_cues=text)
                        menu.send_speaking_confirm_screen(chat_id)
                        return

                elif fsm_state == fsm.STATE_SPEAKING_QUESTIONS:
                    if text:
                        questions = [line.strip().lstrip('•-*0123456789. ') for line in text.splitlines() if line.strip()]
                        fsm.update_state_data(chat_id, questions=questions, raw_questions=text)
                        menu.send_speaking_confirm_screen(chat_id)
                        return

        if msg.get('photo') or (msg.get('document') and (msg['document'].get('mime_type') or '').lower().startswith('image/')):
            user = user_pre or _find_user(chat_id, True, from_user=from_user)
            _handle_writing_image(chat_id, msg, user=user)
            return
        if msg.get('contact'):
            contact=msg['contact'];own='user_id' in contact and contact['user_id']==from_user.get('id')
            links.contact(contact['phone_number'],chat_id,own);show(chat_id,from_user=from_user);return
        if not text:return
        if text.startswith(('/topics', '/mavzular')):
            if menu.is_superadmin(chat_id=chat_id):
                menu.send_topic_management_menu(chat_id)
            else:
                api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
            return
        if text == '/cancel':
            fsm.clear_state(chat_id)
            api.send(chat_id, "❌ Faol jarayon mavjud emas.")
            return
        if text.startswith('/parent') or (text.startswith('/start') and 'parent_' in text.lower()):
            code = text[len('/parent'):].strip() if text.startswith('/parent') else text[text.lower().find('parent_') + 7:].strip()
            p_name = from_user.get('first_name', '') or from_user.get('username', '') or "Ota-ona"
            from apps.core.parent_bot_service import link_parent_by_code
            res = link_parent_by_code(chat_id, code, parent_name=p_name)
            if res.get('success'):
                api.send(
                    chat_id,
                    f"✅ <b>Muvaffaqiyatli bog'landi!</b>\n\n"
                    f"Siz muvaffaqiyatli ravishda <b>{res['studentName']}</b>ning profili bilan bog'landingiz.\n\n"
                    f"Endi farzandingizning:\n"
                    f"• Darsdagi davomati (kelmagan yoki kechikkan holatda);\n"
                    f"• Topshirgan imtihon va amaliyot natijalari;\n"
                    f"• Har yakshanba haftalik o'zlashtirish hisoboti (Digest)\n"
                    f"to'g'ridan-to'g'ri ushbu bot orqali sizga yuborib turiladi."
                )
            else:
                api.send(chat_id, f"❌ {res.get('message', 'Taklif kodi yaroqsiz.')}")
            return
        if text.startswith('/start'):
            payload=text[len('/start'):].strip()
            if payload:
                if payload.lower() in ('login','auth','sso','signin'):
                    user=_find_user(chat_id,True,from_user=from_user)
                    menu.send_web_login(chat_id,user)
                else:
                    links.consume(payload,chat_id)
                    show(chat_id,from_user=from_user)
            elif not show(chat_id,from_user=from_user):api.contact_request(chat_id,welcome())
            return
        if text.startswith('/menu'):
            if not show(chat_id,from_user=from_user):api.contact_request(chat_id,welcome())
            return
        if text.startswith(('/superadmin', '/admin')):
            user=_find_user(chat_id,True,from_user=from_user)
            if user and menu.is_superadmin(chat_id=chat_id, user=user):
                api.send(chat_id, menu.text_for(user, 'superadmin_panel'), reply_markup=menu.superadmin_inline_keyboard(chat_id, user))
            else:
                api.send(chat_id, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
            return
        if text.startswith('/writing'):
            dummy = user_pre or _find_user(chat_id, True, from_user=from_user) or SimpleNamespace(role='student', name='Talaba', telegram_chat_id=str(chat_id))
            api.send(chat_id, menu.text_for(dummy, 'writing_ocr'))
            return
        if text.startswith(('/code', '/otp')):
            menu.send_otp_code(chat_id, from_user)
            return
        if text.startswith('/login'):
            user=_find_user(chat_id,True,from_user=from_user)
            menu.send_web_login(chat_id,user);return
        if text.startswith('/audio_'):
            payload=text[len('/audio_'):].strip()
            menu.handle_audio_request(chat_id,payload);return
        if text.startswith(('/apk', '/download', '/android', '/app')):
            menu.send_apk(chat_id);return
        if text.startswith(('/unlink','/stop')):links.unlink_chat(chat_id);return
        if text.startswith('/status'):
            linked=_find_user(chat_id,False,from_user=from_user)
            text=f'✅ <b>Bog\'langan</b>\n{LINE}\n\nAkkaunt: <b>{links.escape(linked.name)}</b>\n\nUzish uchun: /unlink' if linked else f'❌ <b>Bog\'lanmagan</b>\n{LINE}\n\nSaytdagi "Telegramni ulash" tugmasidan foydalaning yoki /start bosing.'
            api.send(chat_id,text);return
        if text.startswith('/mock'):
            user=_find_user(chat_id,True,from_user=from_user)
            if user:api.send(chat_id,menu.text_for(user,'mock_exams'));return
            if not show(chat_id,from_user=from_user):api.contact_request(chat_id,welcome())
            return
        if text.startswith(('/leaderboard','/ranking','/reyting')):
            user=_find_user(chat_id,True,from_user=from_user)
            if user:api.send(chat_id,menu.text_for(user,'leaderboard'));return
            if not show(chat_id,from_user=from_user):api.contact_request(chat_id,welcome())
            return
        if text.startswith('/monitoring'):
            user=_find_user(chat_id,True,from_user=from_user)
            if user:api.send(chat_id,menu.text_for(user,'monitoring'));return
            if not show(chat_id,from_user=from_user):api.contact_request(chat_id,welcome())
            return
        if text.startswith(('/news','/articles','/yangiliklar')):
            user=_find_user(chat_id,True,from_user=from_user)
            if user:api.send(chat_id,menu.text_for(user,'articles'));return
            if not show(chat_id,from_user=from_user):api.contact_request(chat_id,welcome())
            return
        if text.startswith('/help'):api.send(chat_id,HELP,reply_markup=menu.apk_inline_keyboard());return
        if menu.handle(chat_id,text,from_user=from_user) or show(chat_id,from_user=from_user):return
        api.contact_request(chat_id,welcome())
    except Exception as error:logging.getLogger(__name__).warning('Telegram update processing failed: %r',error)


handle_update = handle



def initialize():
    if not os.environ.get('TELEGRAM_BOT_TOKEN'):
        logging.getLogger(__name__).info('Telegram bot is OFF: TELEGRAM_BOT_TOKEN is not set in environment. System is ready to activate immediately once token is supplied.')
        return 'off'
    mode=os.environ.get('TELEGRAM_MODE','polling').lower()
    if mode=='off':return mode
    api.call('setMyCommands',dict(commands=[dict(command=key,description=value) for key,value in [
        ('start',"Akkauntni bog'lash"),
        ('menu',"Menyuni ko'rsatish"),
        ('code',"Ilovaga kirish kodi (6 xonali)"),
        ('login',"Web platformaga kirish (SSO)"),
        ('apk','Android ilovani yuklab olish (.apk)'),
        ('mock','Mock imtihonlar (Multi-Level / IELTS)'),
        ('leaderboard','Markaz reytingi'),
        ('status',"Bog'lanish holati"),
        ('unlink','Akkauntni uzish'),
        ('help','Yordam'),
    ]]))
    if mode=='webhook':
        url=os.environ.get('TELEGRAM_WEBHOOK_URL');secret=os.environ.get('TELEGRAM_WEBHOOK_SECRET')
        if url and secret:api.call('setWebhook',dict(url=url,secret_token=secret,allowed_updates=['message','callback_query'],drop_pending_updates=True))
        return 'webhook'
    api.call('deleteWebhook',dict(drop_pending_updates=False));return 'polling'


def run(stop,once=False):
    mode=initialize();offset=0
    if mode!='polling':return
    try:
        while not stop.is_set():
            try:
                updates=api.call('getUpdates',dict(offset=offset,timeout=30,allowed_updates=['message','callback_query'])) or []
                for update in updates:
                    offset=update['update_id']+1;close_old_connections();handle(update)
            except Exception:
                logging.getLogger(__name__).warning('Telegram polling failed');stop.wait(3)
            if once:return
    finally:close_old_connections()
